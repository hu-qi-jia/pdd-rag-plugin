/**
 * 「根据知识库内容整合并回复」整合行 UI 验收(第四十八轮第 2 项)。
 *
 * 与 verify-ai-popup.mjs 同一套路:构建产物的 content script 注入复刻真机 DOM 的夹具页,
 * 用桩接管 chrome.runtime —— 这次连 Port 一起桩掉,于是整条流式链路(DELTA→DONE /
 * NO_ANSWER / ERROR / 断线)都能在无 SW、无 API、无密钥的情况下走一遍。
 *
 * 验收点:
 *  ① 有知识库候选且 aiAvailable → 整合行渲染,且**插在首个知识库候选项之前**
 *  ② aiAvailable=false(开关关/没配 API/自动回复开着)→ 整合行不出现,面板与现状零差异
 *  ③ 有 aiAvailable 但没有知识库候选 → 不出现(没有资料可整合)
 *  ④ 点整合行才发请求:Port 名 = pddcs:ai,knowledgeIds **只含面板上展示过的知识库候选**
 *     (ADR-0006 所见即所发),面板出现本身不发任何东西
 *  ⑤ 流式:DELTA 逐段累加显示草稿 →DONE 填输入框、文案「✓ 已填入输入框」、出「重新生成」
 *  ⑥ NO_ANSWER → 不填输入框,文案「知识库内容不足以回答」
 *  ⑦ ERROR → 显示可读文案 + 「重试」;点重试再发一次
 *  ⑧ 生成中途 Port 断开(SW 被回收)→ 落到可重试的失败态,不永久卡在「正在整合」
 *  ⑨ **键盘唤起时默认选中跳过整合行**:Ctrl+Enter 开面板后直接按 Enter 填的是
 *    第一条真实候选,而不是发起一次付费 API 请求(整合行是 ↑↓/Tab 走过去才触发的动作)
 *
 * 用法:node scripts/verify-ai-integrate.mjs   (需先 npm run build)
 * 注:验证全程无网络请求 —— LLM 调用被桩在 Port 后面,不进 content script。
 */
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { CHROME, EXT, sleep } from './lib.mjs'

const CS = readdirSync(EXT).find((f) => /^pdd-ai-button\..*\.js$/.test(f))
if (!CS) {
  console.log('FAIL: 未找到 content script 产物,请先 npm run build')
  process.exit(1)
}

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#f5f5f5; font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
  #msgListContainer { width: 720px; height: 600px; overflow:auto; }
  ul.msg-list { margin:0; padding:0; list-style:none; }
  li.onemsg { padding: 8px 12px; }
  .buyer-item { display:flex; gap:8px; align-items:flex-start; }
  .avatar { width:32px; height:32px; border-radius:50%; background:#ccc; flex-shrink:0; }
  [currentuid] { display:inline-block; }
  .msg-content { background:#ffffff; padding:10px; border-radius:6px; max-width:420px; }
  .msg-content-box { margin:0; font-size:13px; line-height:1.5; }
</style></head><body>
<div id="msgListContainer"><ul class="msg-list">
  <li class="onemsg"><div class="buyer-item"><span class="avatar"></span>
    <div currentuid="u1"><div class="msg-content"><p class="msg-content-box">这个支持7天无理由退换吗</p></div></div>
  </div></li>
  <li class="onemsg"><div class="buyer-item"><span class="avatar"></span>
    <div currentuid="u2"><div class="msg-content"><p class="msg-content-box">发货要多久才能到</p></div></div>
  </div></li>
</ul></div>
<textarea id="replyTextarea" style="position:fixed; left:20px; bottom:20px; width:600px; height:60px"></textarea>
</body></html>`

// 与 lib.mjs 同一约定:设 PDD_E2E_CHROME 用之,否则走完整 chromium(channel)
const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chromium' }),
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

/**
 * chrome 桩。三件事:发出去的消息、Port 上的往返、以及让测试页能往 Port 里推事件。
 * `window.__ai` 是测试与 Port 之间的把手 —— 真机上另一端是 SW,这里由测试扮演。
 */
await page.addInitScript(() => {
  const cand = (kind, text, sourceId) => ({
    kind,
    text,
    sourceQuestion: '这个支持7天无理由退换吗',
    score: kind === 'golden' ? 0.93 : 0.87,
    sourceId,
  })
  const GOLDEN = cand('golden', '标准回答:支持7天无理由退换,运费我们承担。', 'gd-1')
  const KNOWLEDGE = cand('knowledge', '知识库:支持7天无理由退换,需保持商品完好。', 'kb-1')
  const KNOWLEDGE2 = cand('knowledge', '知识库:退换运费由我方承担,7 个工作日内退款。', 'kb-2')
  const HISTORY = cand('history', '历史答复:支持7天无理由,请放心下单。', 'h-1')

  window.__sent = []
  window.__ports = []
  // 每个场景一行:候选列表 + aiAvailable
  window.__suggestions = [GOLDEN, KNOWLEDGE, HISTORY]
  window.__aiAvailable = true

  window.__ai = {
    /** 把事件推给**活着的**端口。真实 SW 只服务当前连接,重试后旧端口早已断开 */
    emit(ev) {
      for (const rec of window.__ports) for (const fn of rec.listeners) fn(ev)
    },
    /** 模拟 SW 中途被回收:活端口断开,content 侧应落到可重试的失败态 */
    drop() {
      for (const rec of window.__ports) {
        if (!rec.dead) rec.onDisconnectCb?.()
      }
    },
    lastPort: () => window.__ports[window.__ports.length - 1],
  }

  window.chrome = {
    storage: { local: {}, onChanged: { addListener() {} } },
    runtime: {
      onMessage: { addListener() {} },
      lastError: undefined,
      connect({ name }) {
        const rec = { name, posted: [], listeners: [], onDisconnectCb: null, dead: false }
        window.__ports.push(rec)
        return {
          postMessage(msg) {
            rec.posted.push(msg)
          },
          // content 侧 dropPort() 会主动断开:监听器随之作废(否则重试后
          // 新旧两个监听器改的是同一份状态,DELTA 会被应用两遍)
          disconnect() {
            rec.dead = true
            rec.listeners.length = 0
          },
          onMessage: {
            addListener(fn) {
              rec.listeners.push(fn)
            },
          },
          onDisconnect: {
            addListener(fn) {
              rec.onDisconnectCb = fn
            },
          },
        }
      },
      sendMessage(msg) {
        window.__sent.push(msg)
        if (msg?.type === 'GET_STATS') {
          return Promise.resolve({
            payload: {
              settings: {
                directFillEnabled: false,
                goldenPriorityEnabled: true,
                aiAvailable: window.__aiAvailable,
                autoReplyHotkey: { ctrl: true, alt: false, shift: false, key: 'Enter' },
                panelNavHotkey: { ctrl: false, alt: false, shift: false, key: 'Tab' },
              },
            },
          })
        }
        if (msg?.type === 'GET_SUGGESTIONS') {
          return Promise.resolve({
            payload: {
              suggestions: window.__suggestions,
              settings: {
                directFillEnabled: false,
                goldenPriorityEnabled: true,
                aiAvailable: window.__aiAvailable,
              },
            },
          })
        }
        return Promise.resolve({ payload: {} })
      },
    },
  }
})
await page.route('**/fixture.html', (route) =>
  route.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE }),
)
await page.goto('https://fixture.local/fixture.html')
await page.addScriptTag({ path: path.join(EXT, CS) })
await sleep(1200)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const setScenario = (patch) =>
  page.evaluate((p) => {
    Object.assign(window, p)
    window.__sent.length = 0
    window.__ports.length = 0
  }, patch)

const clickAiButton = async (idx = 0) => {
  await page.locator('.pddcs-ai-btn').nth(idx).click()
  await sleep(500)
}

const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.pddcs-cand')].map((r) => ({
      ai: r.classList.contains('pddcs-ai-row'),
      selected: r.classList.contains('pddcs-cand-selected'),
      label: r.querySelector('.pddcs-ai-label')?.textContent ?? '',
      draft: r.querySelector('.pddcs-ai-draft')?.textContent ?? '',
      draftShown: (r.querySelector('.pddcs-ai-draft')?.style.display ?? '') !== 'none',
      retry: r.querySelector('.pddcs-ai-retry')?.style.display !== 'none'
        ? (r.querySelector('.pddcs-ai-retry')?.textContent ?? '')
        : '',
      text: r.querySelector('.pddcs-cand-text')?.textContent ?? '',
      busy: r.classList.contains('is-busy'),
    })),
  )
const textarea = () => page.evaluate(() => document.querySelector('#replyTextarea').value)
const setTextarea = (v) => page.evaluate((t) => { document.querySelector('#replyTextarea').value = t }, v)
const lastPort = () =>
  page.evaluate(() => {
    const p = window.__ai.lastPort()
    return p ? { name: p.name, posted: p.posted } : null
  })

// ── ① 整合行的位置 ──
await clickAiButton(0)
let r = await rows()
check(
  '有知识库候选且 aiAvailable → 整合行渲染在首个知识库候选之前(金标 / 整合 / 知识库 / 历史)',
  r.length === 4 && r.map((x) => x.ai).join() === 'false,true,false,false',
  JSON.stringify(r.map((x) => ({ ai: x.ai, label: x.label.slice(0, 12) }))),
)
check(
  '整合行初始文案 = 「根据知识库内容整合并回复」',
  r[1]?.label === '根据知识库内容整合并回复',
  JSON.stringify(r[1]?.label),
)
check(
  '面板出现本身不发任何请求(端口未创建)',
  (await lastPort()) === null,
  JSON.stringify(await page.evaluate(() => window.__ports.length)),
)
check('初始不显示草稿区与重试钮', r[1]?.draftShown === false && r[1]?.retry === '', JSON.stringify({ d: r[1]?.draftShown, retry: r[1]?.retry }))

// ── ④ 点它才发请求,且只带面板上展示过的知识库候选 ──
const sentBefore = await page.evaluate(() => window.__sent.length)
await page.locator('.pddcs-ai-row').click()
await sleep(400)
const port = await lastPort()
check('点击整合行 → 连接端口名 = pddcs:ai', port?.name === 'pddcs:ai', JSON.stringify(port?.name))
const req = port?.posted?.[0]
check(
  '发出 AI_INTEGRATE,query = 买家问题全文',
  req?.type === 'AI_INTEGRATE' && req.payload.query.includes('7天无理由退换'),
  JSON.stringify(req?.payload?.query),
)
check(
  'knowledgeIds 只含面板展示过的知识库候选(所见即所发)',
  JSON.stringify(req?.payload?.knowledgeIds) === JSON.stringify(['kb-1']),
  JSON.stringify(req?.payload?.knowledgeIds),
)
check('请求中:行进入 busy 态(不可重复点击)', (await rows())[1]?.busy === true)

// ── ⑤ 流式 → DONE 填输入框 ──
await setTextarea('原有草稿')
await page.evaluate(() => window.__ai.emit({ type: 'DELTA', payload: { text: '您好,' } }))
await page.evaluate(() => window.__ai.emit({ type: 'DELTA', payload: { text: '支持7天无理由退换。' } }))
await sleep(200)
let mid = await rows()
check(
  'DELTA 逐段累加显示草稿',
  mid[1]?.draft === '您好,支持7天无理由退换。' && mid[1]?.draftShown === true,
  JSON.stringify(mid[1]?.draft),
)
check(
  '流式中文案 = 「正在整合知识库…」',
  mid[1]?.label === '正在整合知识库…',
  JSON.stringify(mid[1]?.label),
)
await page.evaluate(() => window.__ai.emit({ type: 'DONE', payload: { text: '您好,支持7天无理由退换,需保持商品完好。' } }))
await sleep(300)
const done = await rows()
check(
  'DONE → 文案「✓ 已填入输入框」+ 出现「重新生成」',
  done[1]?.label === '✓ 已填入输入框' && done[1]?.retry === '重新生成',
  JSON.stringify({ label: done[1]?.label, retry: done[1]?.retry }),
)
check(
  'DONE → 生成结果**替换**输入框原有内容(不是追加)',
  (await textarea()) === '您好,支持7天无理由退换,需保持商品完好。',
  JSON.stringify(await textarea()),
)
check('终态后退出 busy 态', done[1]?.busy === false)
check(
  '整合全程零 sendMessage(流式内容只在 Port 上走,不经过一问一答)',
  (await page.evaluate(() => window.__sent.length)) === sentBefore,
  JSON.stringify(await page.evaluate(() => window.__sent.map((m) => m.type))),
)
check('终态后主动断端口(不留着连接不放手)',
  (await page.evaluate(() => window.__ai.lastPort().dead)) === true)

// ── ⑦ 重新生成:再发一次 ──
await page.locator('.pddcs-ai-row .pddcs-ai-retry').click()
await sleep(400)
const port2 = await lastPort()
check(
  '点「重新生成」→ 新开端口再发一次 AI_INTEGRATE',
  port2 && port2 !== port && port2.posted[0]?.type === 'AI_INTEGRATE',
  JSON.stringify({ ports: await page.evaluate(() => window.__ports.length) }),
)

// ── ⑧ 生成中断线(SW 被回收)→ 可重试,不永久卡住 ──
await page.evaluate(() => window.__ai.drop())
await sleep(300)
const dropped = await rows()
check(
  'Port 掉线 → 失败文案 + 可重试',
  dropped[1]?.retry === '重试' && dropped[1]?.label.includes('整合失败'),
  JSON.stringify({ label: dropped[1]?.label, retry: dropped[1]?.retry }),
)
check('掉线后不再是 busy 态(不会点不动)', dropped[1]?.busy === false)

// ── ⑥ NO_ANSWER:不填输入框 ──
await page.evaluate(() => document.querySelector('.pddcs-popup-close')?.click())
await setTextarea('保持原样')
await clickAiButton(0)
await page.locator('.pddcs-ai-row').click()
await sleep(300)
await page.evaluate(() => window.__ai.emit({ type: 'NO_ANSWER' }))
await sleep(300)
const na = await rows()
check(
  'NO_ANSWER → 文案「知识库内容不足以回答」且不填输入框',
  na[1]?.label === '知识库内容不足以回答' && (await textarea()) === '保持原样',
  JSON.stringify({ label: na[1]?.label, ta: await textarea() }),
)

// ── ERROR:文案可读 + 重试 ──
// 单独开一次:SW 每个请求只发**一条**终态事件,发完就断端口(上面那条已断言),
// 所以「NO_ANSWER 之后再补一条 ERROR」不是真机会出现的序列。
await page.evaluate(() => document.querySelector('.pddcs-popup-close')?.click())
await sleep(150)
await setTextarea('保持原样')
await clickAiButton(0)
await page.locator('.pddcs-ai-row').click()
await sleep(300)
await page.evaluate(() => window.__ai.emit({ type: 'ERROR', payload: { error: 'unconfigured' } }))
await sleep(250)
const err = await rows()
check(
  'ERROR unconfigured → 「请先在设置中配置 LLM API」+ 「重试」,不填输入框',
  err[1]?.label === '请先在设置中配置 LLM API' &&
    err[1]?.retry === '重试' &&
    (await textarea()) === '保持原样',
  JSON.stringify({ label: err[1]?.label, retry: err[1]?.retry, ta: await textarea() }),
)

// ── ②③ 不该出现整合行的两种情形 ──
await page.evaluate(() => document.querySelector('.pddcs-popup-close')?.click())
await sleep(150)
await setScenario({ __aiAvailable: false })
await clickAiButton(0)
const noAi = await rows()
check(
  '② aiAvailable=false(未开启/未配置/自动回复开着)→ 不渲染整合行',
  noAi.length === 3 && noAi.every((x) => !x.ai),
  JSON.stringify(noAi.map((x) => x.ai)),
)

await page.evaluate(() => document.querySelector('.pddcs-popup-close')?.click())
await sleep(150)
await setScenario({
  __aiAvailable: true,
  __suggestions: [
    { kind: 'golden', text: '标准回答:支持7天无理由退换,运费我们承担。', sourceQuestion: 'q', score: 0.9, sourceId: 'gd-1' },
    { kind: 'history', text: '历史答复:支持7天无理由,请放心下单。', sourceQuestion: 'q', score: 0.8, sourceId: 'h-1' },
  ],
})
await clickAiButton(0)
const noKb = await rows()
check(
  '③ 无知识库候选(没有资料可整合)→ 不渲染整合行',
  noKb.length === 2 && noKb.every((x) => !x.ai),
  JSON.stringify(noKb.map((x) => x.ai)),
)

// ── ⑨ 键盘唤起:默认选中跳过整合行 ──
await page.evaluate(() => document.querySelector('.pddcs-popup-close')?.click())
await sleep(150)
await setScenario({
  __aiAvailable: true,
  __suggestions: [
    { kind: 'knowledge', text: '知识库:支持7天无理由退换,需保持商品完好。', sourceQuestion: 'q', score: 0.9, sourceId: 'kb-1' },
    { kind: 'history', text: '历史答复:支持7天无理由,请放心下单。', sourceQuestion: 'q', score: 0.8, sourceId: 'h-1' },
  ],
})
await setTextarea('')
await page.locator('#msgListContainer').click({ position: { x: 5, y: 5 } })
await sleep(150)
await setTextarea('')
await page.keyboard.press('Control+Enter')
await sleep(700)
const kbPanel = await rows()
check(
  '键盘唤起:整合行排在知识库候选之前(占第 0 行)',
  kbPanel[0]?.ai === true && kbPanel[1]?.ai === false,
  JSON.stringify(kbPanel.map((x) => x.ai)),
)
check(
  '⑨ 默认选中**跳过**整合行,落在第一条真实候选上',
  kbPanel[0]?.selected === false && kbPanel[1]?.selected === true,
  JSON.stringify(kbPanel.map((x) => x.selected)),
)
await page.keyboard.press('Enter')
await sleep(400)
check(
  '⑨ 面板一开就按 Enter → 填的是候选内容,没有发起付费 API 请求',
  (await textarea()).includes('支持7天无理由退换') &&
    (await lastPort()) === null &&
    JSON.stringify(await page.evaluate(() => window.__ports.length)) === '0',
  JSON.stringify({ ta: await textarea(), ports: await page.evaluate(() => window.__ports.length) }),
)

// ── 汇总 ──
await browser.close()
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log('失败项:')
  for (const f of failed) console.log(`  - ${f.name}`)
  process.exit(1)
}
