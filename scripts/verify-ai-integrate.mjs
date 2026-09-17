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
 *  ⑤ 流式:DELTA 逐段累加显示草稿 →DONE 填输入框 + **面板自行退场**(第五十一轮,
 *     用户"填充内容到输入框后面板退出"),退场前 toast 交代结果
 *  ⑥ NO_ANSWER → 不填输入框,文案「知识库内容不足以回答」
 *  ⑦ ERROR → 显示可读文案 + 「重试」;点重试再发一次
 *  ⑧ 生成中途 Port 断开(SW 被回收)→ 落到可重试的失败态,不永久卡在「正在整合」
 *  ⑨ **键盘唤起时默认选中跳过整合行**:Ctrl+Enter 开面板后直接按 Enter 填的是
 *    第一条真实候选,而不是发起一次付费 API 请求(整合行是 ↑↓/Tab 走过去才触发的动作)
 *  ⑩ 重设计(v2.6.34 立规 / v2.7.0 随面板重设计改表达方式,两条口径未动):
 *     整合行与候选行**高度同档**(按真实 rect 量,不靠 padding 虚撑)、
 *     靠"常驻知识库绿软底"(候选行静止时是彻底无底的纸)与素材区分、内容左缘与候选行重合;
 *  ⑪ 生成后的展示:说明行让位给正文、正文取面板主层 13.5px、重试钮 24px 在行内右端、
 *     整行不塌回单行;出结果后点整行不再发起请求(防误触再烧一次)
 *  ⑫ 第五十轮:①面板上**每条**知识库候选都进 knowledgeIds(top-k=3,不是只发一条)、
 *     说明行如实报出条数;②说明行与生成结果同档 13.5px(整行只有一档字号,靠字重区分)、
 *     行首不再挂 ✦ 图标
 *  ⑬ 第五十一轮:关闭钮静止时是**裸 ×**(撤掉常驻圆底,命中区仍 26px);
 *     键盘路径(Ctrl+Enter → Tab 走到整合行 → Enter)填完后同样自行退场
 *
 * 用法:node scripts/verify-ai-integrate.mjs   (需先 npm run build)
 * 注:验证全程无网络请求 —— LLM 调用被桩在 Port 后面,不进 content script。
 */
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { CHROME, EXT, ROOT, sleep } from './lib.mjs'

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

/**
 * 读一屏所有行 —— 文字之外还量**真实几何**(第四十八轮重设计要验"高度和词条类似、
 * 视觉和词条区分",那两条只能在真浏览器的 computedStyle / rect 上量)。
 */
const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.pddcs-cand')].map((r) => {
      const box = r.getBoundingClientRect()
      const cs = getComputedStyle(r)
      const q = (s) => r.querySelector(s)
      const shown = (el) => !!el && el.style.display !== 'none'
      const draftEl = q('.pddcs-ai-draft')
      const hintEl = q('.pddcs-ai-hint')
      const retryEl = q('.pddcs-ai-retry')
      const labelEl = q('.pddcs-ai-label')
      const textEl = q('.pddcs-cand-text')
      const padLeft = parseFloat(cs.paddingLeft)
      return {
        ai: r.classList.contains('pddcs-ai-row'),
        selected: r.classList.contains('pddcs-cand-selected'),
        label: labelEl?.textContent ?? '',
        hint: hintEl?.textContent ?? '',
        hintShown: shown(hintEl),
        draft: draftEl?.textContent ?? '',
        draftShown: shown(draftEl),
        retry: shown(retryEl) ? (retryEl?.textContent ?? '') : '',
        text: textEl?.textContent ?? '',
        busy: r.classList.contains('is-busy'),
        idle: r.classList.contains('is-idle'),
        // 几何 / 配色:高度、底色、描边、内容左缘(rect 左缘 + 内边距 + 描边)
        h: Math.round(box.height * 10) / 10,
        bg: cs.backgroundColor,
        borderW: cs.borderTopWidth,
        borderColor: cs.borderTopColor,
        cursor: cs.cursor,
        contentLeft: Math.round(box.left + padLeft + parseFloat(cs.borderTopWidth)),
        labelFont: labelEl ? getComputedStyle(labelEl).fontSize : '',
        hintFont: hintEl ? getComputedStyle(hintEl).fontSize : '',
        draftFont: draftEl ? getComputedStyle(draftEl).fontSize : '',
        textFont: textEl ? getComputedStyle(textEl).fontSize : '',
        retryH: retryEl ? Math.round(retryEl.getBoundingClientRect().height * 10) / 10 : 0,
      }
    }),
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

// ── ⑩ 重设计(2026-09-17 第四十八轮):高度向词条看齐 + 与词条区分开 ──
// 用户原话:「高度太小了,修改为和词条高度类似,视觉效果要和词条区分开,请你以设计师的视角
// 进行修改。生成后的展示效果也要重新设计」。全部按**真实渲染**的 rect / computedStyle 量,
// 不 grep 源码字面值 —— 上面那些文案断言证明不了"看着像不像"。
let idleAiRowH = 0
{
  const ai = r[1]
  idleAiRowH = ai.h
  const cands = r.filter((x) => !x.ai)
  const minCandH = Math.min(...cands.map((x) => x.h))
  const maxCandH = Math.max(...cands.map((x) => x.h))
  check(
    '⑩ 高度:整合行与候选行同档(矮的那条不再矮一半)',
    ai.h >= minCandH - 8 && ai.h <= maxCandH + 8,
    `ai=${ai.h} 候选=${cands.map((x) => x.h).join('/')}`,
  )
  check(
    '⑩ 高度:不是靠 padding 虚撑 —— 第二层是两行真信息(什么出去 / 什么留下)',
    ai.hintShown &&
      ai.hint.split('\n').length === 2 &&
      ai.hint.includes('1 条知识库内容') &&
      ai.hint.includes('不出本机'),
    JSON.stringify({ hint: ai.hint, h: ai.h }),
  )
  // v2.7.0:整合行那圈绿描边撤掉了 —— 新面板里**所有**候选行静止时都是无底无框的纸,
  // "有底的只有这一块"就已经足够把它读成动作。断言随之从"底色 + 描边两层叠加"
  // 改成"有底 / 没底"这一条真正在承担区分作用的差别
  check(
    '⑩ 视觉:全面板只有整合行有底(常驻知识库绿软底),候选行静止时完全无底无框',
    ai.bg.includes('20, 174, 92') &&
      ai.borderW === '0px' &&
      cands.every((x) => x.borderW === '0px' && x.bg === 'rgba(0, 0, 0, 0)'),
    `ai=${ai.bg}/border=${ai.borderW} 候选=${cands.map((x) => x.bg).join(' ')}`,
  )
  check(
    '⑩ 对齐:整合行内容左缘 = 候选行内容左缘(同类盒子同一个横向内边距)',
    ai.contentLeft === cands[0].contentLeft,
    `ai=${ai.contentLeft} 候选=${cands[0].contentLeft}`,
  )
  // v2.7.1(第五十轮):说明行从辅助档提到内容档 —— 整行的字号只剩一档,
  // 出结果时不再"小字换大字"跳一下。字重仍分两档:.pddcs-ai-label 600 / 说明行 400
  check(
    '⑩ 字号:主文案 / 说明行 / 候选正文同一档 13.5px(整行只有一档字号)',
    ai.labelFont === cands[0].textFont &&
      ai.labelFont === '13.5px' &&
      ai.hintFont === '13.5px',
    `主=${ai.labelFont} 候选正文=${cands[0].textFont} 说明=${ai.hintFont}`,
  )
  check(
    '⑩ 手型只给 idle 态(还没点过才是"点哪儿都行"的大按钮)',
    ai.cursor === 'pointer' && ai.idle === true && cands.every((x) => x.cursor === 'pointer'),
    `ai=${ai.cursor} idle=${ai.idle}`,
  )
  // 版面留档(人工回看用,不是验收手段 —— 验收一律走上面的真实几何断言)
  await page.locator('.pddcs-popup').screenshot({ path: path.join(ROOT, 'logs', 'ui-0917-ai-row-idle.png') })
}

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
check(
  'DONE → 生成结果**替换**输入框原有内容(不是追加)',
  (await textarea()) === '您好,支持7天无理由退换,需保持商品完好。',
  JSON.stringify(await textarea()),
)
// 第五十一轮(用户"填充内容到输入框后面板退出"):填成功后面板自行退场,
// 与候选行的口径拉平 —— 留着它只会挡住刚填好的输入框
const closedState = await page.evaluate(() => ({
  popups: document.querySelectorAll('.pddcs-popup').length,
  toast: document.querySelector('.pddcs-toast')?.textContent ?? '',
}))
check(
  '⑤ 填成功 → 面板**自行退场**(不再停在「已填入输入框」那一版等用户手动关)',
  closedState.popups === 0,
  JSON.stringify(closedState),
)
check(
  '⑤ 退场前给一条 toast 交代结果:已整合并填充 · 请手动发送',
  closedState.toast.includes('已整合并填充') && closedState.toast.includes('请手动发送'),
  JSON.stringify(closedState.toast),
)
check(
  '整合全程零 sendMessage(流式内容只在 Port 上走,不经过一问一答)',
  (await page.evaluate(() => window.__sent.length)) === sentBefore,
  JSON.stringify(await page.evaluate(() => window.__sent.map((m) => m.type))),
)
check('终态后主动断端口(面板没了也不留着连接不放手)',
  (await page.evaluate(() => window.__ai.lastPort().dead)) === true)

// ── ⑪ 生成后的展示(重设计的一半:结果按候选正文的口径排版,而不是行内小字)──
// 这条只能在**填不进去**的那条路上验了 —— 填成功就关面板(第五十一轮),
// 而"页面没有输入框"正是面板该留下的那一种情况(结果还在行里,用户要从这儿手动复制)。
// 顺手也证明了:填不进去 ≠ 失败,面板不退场、重试钮照给
await page.evaluate(() => document.querySelector('#replyTextarea')?.remove())
await clickAiButton(0)
await page.locator('.pddcs-ai-row').click()
await sleep(300)
await page.evaluate(() => window.__ai.emit({ type: 'DELTA', payload: { text: '您好,' } }))
await page.evaluate(() => window.__ai.emit({ type: 'DONE', payload: { text: '您好,支持7天无理由退换,需保持商品完好。' } }))
await sleep(300)
const done = await rows()
check(
  '⑪ 填不进去(页面无输入框)→ 面板**不退场**,结果留在行里供手动复制',
  done.length > 0 && done[1]?.ai === true,
  JSON.stringify({ rows: done.length, label: done[1]?.label }),
)
check(
  '⑪ DONE → 文案「✓ 已生成」+ 出现「重新生成」',
  done[1]?.label === '✓ 已生成' && done[1]?.retry === '重新生成',
  JSON.stringify({ label: done[1]?.label, retry: done[1]?.retry }),
)
check('⑪ 终态后退出 busy 态', done[1]?.busy === false)
{
  const rowsNow = await rows()
  const ai = rowsNow[1]
  const candText = rowsNow.find((x) => !x.ai && x.text)?.textFont
  check(
    '⑪ 生成结果:说明行让位给正文(第二块一次只有一块,行高才停在候选那一档)',
    ai.draftShown === true && ai.hintShown === false,
    JSON.stringify({ draftShown: ai.draftShown, hintShown: ai.hintShown, hint: ai.hint }),
  )
  check(
    '⑪ 生成结果:正文取面板主层字号(13.5px,与候选正文同档),不是 11.5px 的小字',
    ai.draftFont === '13.5px' && ai.draftFont === candText,
    `结果=${ai.draftFont} 候选=${candText}`,
  )
  check(
    '⑪ 生成结果:重试钮搬进主行右端、按 24px 行内控件档等高(不再自占一行)',
    done[1]?.retry === '重新生成' && ai.retryH === 24,
    `retryH=${ai.retryH}`,
  )
  // 行高随正文长短走(与候选行同理),但**不能塌回去** —— 出结果那一瞬整行缩水,
  // 看着就像内容丢了。容差取一行正文的高度(13.5px × 1.6 = 21.6),再多就是塌了。
  check(
    '⑪ 生成结果:行高随正文走但不塌回单行(缩水不超过一行正文)',
    ai.h >= idleAiRowH - 22,
    `done=${ai.h} idle=${idleAiRowH} 候选=${rowsNow.filter((x) => !x.ai).map((x) => x.h).join('/')}`,
  )
  check(
    '⑪ 生成结果:整行仍是知识库绿底(出结果不换成中性面色,也不因为"结果来了"就退成普通词条)',
    ai.bg.includes('20, 174, 92') && ai.borderW === '0px',
    `${ai.bg} / border=${ai.borderW}`,
  )
  await page.locator('.pddcs-popup').screenshot({ path: path.join(ROOT, 'logs', 'ui-0917-ai-row-done.png') })

  // 出结果后整行不再是触发器:想复制生成内容的人点一下文字,不该再烧一次 API 请求
  const portsBefore = await page.evaluate(() => window.__ports.length)
  await page.locator('.pddcs-ai-row').click({ position: { x: 40, y: 8 } })
  await sleep(300)
  check(
    '⑪ 出结果后点整行不再发起请求(重试走右上角那枚钮,键盘 Enter 仍等同于点它)',
    (await page.evaluate(() => window.__ports.length)) === portsBefore &&
      (await rows())[1]?.label === '✓ 已生成',
    JSON.stringify({ before: portsBefore, after: await page.evaluate(() => window.__ports.length) }),
  )
}

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

// 把输入框装回去(上面为了验"填不进去"那条路把夹具里的输入框摘了;
// ⑥/⑨ 两个场景要用它断言"没有污染输入框")
await page.evaluate(() => {
  const ta = document.createElement('textarea')
  ta.id = 'replyTextarea'
  document.body.appendChild(ta)
})

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

// ── ⑬ 键盘路径走完整条:快捷键开面板 → Tab 走到整合行 → Enter → 填完自行退场 ──
// 用户原话就是这条路径(「当用户使用快捷键调出推荐回复面板后,选择"根据知识库..."后,
// 填充内容到输入框后面板退出」)—— 鼠标那条路上面已经验过,这里验键盘那条
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
// 行序 = [整合行, 知识库, 历史];初始选中跳过整合行落在第 1 行,
// Tab 两次(1 → 2 → 回绕 0)走到整合行 —— 全程只用键盘
await page.keyboard.press('Tab')
await page.keyboard.press('Tab')
await sleep(150)
check(
  '⑬ 键盘导航走得到整合行(Tab 从默认落点移动两格后停在它上面)',
  (await rows())[0]?.selected === true,
  JSON.stringify((await rows()).map((x) => x.selected)),
)
await page.keyboard.press('Enter')
await sleep(400)
const kbPort = await lastPort()
check(
  '⑬ 整合行上按 Enter = 点击它(发出 AI_INTEGRATE)',
  kbPort?.name === 'pddcs:ai' && kbPort.posted[0]?.type === 'AI_INTEGRATE',
  JSON.stringify({ name: kbPort?.name }),
)
await page.evaluate(() => window.__ai.emit({ type: 'DONE', payload: { text: '支持7天无理由退换,需保持商品完好。' } }))
await sleep(350)
check(
  '⑬ 键盘路径填完同样自行退场,且文本落进输入框',
  (await page.evaluate(() => document.querySelectorAll('.pddcs-popup').length)) === 0 &&
    (await textarea()) === '支持7天无理由退换,需保持商品完好。',
  JSON.stringify({
    popups: await page.evaluate(() => document.querySelectorAll('.pddcs-popup').length),
    ta: await textarea(),
  }),
)

// ── ⑭ 关闭钮静止时是裸 ×(第五十一轮,用户"仅保留 × 图标即可")──
await page.keyboard.press('Control+Enter')
await sleep(700)
const closeProbe = await page.evaluate(() => {
  const btn = document.querySelector('.pddcs-popup-close')
  if (!btn) return null
  const cs = getComputedStyle(btn)
  const box = btn.getBoundingClientRect()
  return {
    text: btn.textContent,
    bg: cs.backgroundColor,
    w: Math.round(box.width),
    h: Math.round(box.height),
  }
})
check(
  '⑭ 关闭钮静止无底(只剩 × 字形),命中区仍是 26px',
  closeProbe?.text === '×' &&
    closeProbe?.bg === 'rgba(0, 0, 0, 0)' &&
    closeProbe?.w === 26 &&
    closeProbe?.h === 26,
  JSON.stringify(closeProbe),
)
await page.evaluate(() => document.querySelector('.pddcs-popup-close')?.click())
await sleep(150)

// ── ⑩ top-k=3:面板里的知识库候选**一条不落**全部进 knowledgeIds ──
// 用户口径(第五十轮):「ai整合是根据检索到的 top-k=3 的内容整合,而不是只有一条」。
// 面板每类配额 3(retrieval.ts#PANEL_QUOTA.knowledge),内容脚本负责把**展示过的几条**
// 原样带上;后台 collectMaterials 再按 id/正文去重、按字数上限整块截断(单测覆盖)。
await page.evaluate(() => document.querySelector('.pddcs-popup-close')?.click())
await sleep(150)
await setScenario({
  __aiAvailable: true,
  // 顺序照抄后台真实装配结果(retrieval.ts#assembleSuggestions 按 golden → history →
  // knowledge 分段,知识库段内按相关度降序),这样 stub 出来的面板与真机同序
  __suggestions: [
    { kind: 'golden', text: '标准回答:支持7天无理由退换,运费我们承担。', sourceQuestion: 'q', score: 0.93, sourceId: 'gd-1' },
    { kind: 'knowledge', text: '知识库:支持7天无理由退换,需保持商品完好。', sourceQuestion: 'q', score: 0.91, sourceId: 'kb-1' },
    { kind: 'knowledge', text: '知识库:退换运费由我方承担,7 个工作日内退款。', sourceQuestion: 'q', score: 0.88, sourceId: 'kb-2' },
    { kind: 'knowledge', text: '知识库:生鲜类商品不支持无理由退换。', sourceQuestion: 'q', score: 0.84, sourceId: 'kb-3' },
  ],
})
await clickAiButton(0)
const three = await rows()
check(
  '⑩ 三条知识库候选 → 全部渲染(整合行插在首个知识库候选之前)',
  three.length === 5 && three.map((x) => x.ai).join() === 'false,true,false,false,false',
  JSON.stringify(three.map((x) => x.ai)),
)
check(
  '⑩ 说明行如实报出条数:3(不是恒写 1)',
  three[1]?.hint.includes('3 条知识库内容'),
  JSON.stringify(three[1]?.hint),
)
await page.locator('.pddcs-ai-row').click()
await sleep(400)
const threePort = await lastPort()
const threeReq = threePort?.posted?.[0]
check(
  '⑩ 点整合行 → knowledgeIds = 面板上那 3 条,顺序一致(不是只取第一条)',
  JSON.stringify(threeReq?.payload?.knowledgeIds) === JSON.stringify(['kb-1', 'kb-2', 'kb-3']),
  JSON.stringify(threeReq?.payload?.knowledgeIds),
)
check(
  '⑩ 顺带:本轮面板上**没有**标准回答进 knowledgeIds(只有知识库会外发)',
  !JSON.stringify(threeReq?.payload?.knowledgeIds ?? []).includes('gd-'),
  JSON.stringify(threeReq?.payload?.knowledgeIds),
)

// ── ⑫ 字型规范(第五十轮):说明行与生成结果同档,且行首没有图标 ──
// 用户原话:「说明文案简化,而且小字和生成后的文字字号不同。删除图标」「规范一下字号和权重」。
const aiRow = three[1]
const candTextFont = three.find((x) => !x.ai && x.text)?.textFont
check(
  '⑫ 说明行与候选正文同档字号(不再比正文小一号;面板只有 15 / 13.5 / 11.5 三档)',
  aiRow?.hintFont === '13.5px' && aiRow?.hintFont === candTextFont,
  JSON.stringify({ 说明行: aiRow?.hintFont, 候选正文: candTextFont, 动作名: aiRow?.labelFont }),
)
check(
  '⑫ 动作名仍是同档 semibold(与说明行同字号、靠字重区分,不靠字号)',
  aiRow?.labelFont === aiRow?.hintFont,
  JSON.stringify({ 动作名: aiRow?.labelFont, 说明行: aiRow?.hintFont }),
)
const iconProbe = await page.evaluate(() => {
  const row = document.querySelector('.pddcs-ai-row')
  const main = row?.querySelector('.pddcs-ai-main')
  return {
    icon: !!row?.querySelector('.pddcs-ai-icon'),
    sparkle: (row?.textContent ?? '').includes('✦'),
    mainKids: main ? [...main.children].map((c) => c.className) : [],
  }
})
check(
  '⑫ 行首不再挂 ✦ 图标(用户"删除图标"),主行只剩动作名 + 重试钮',
  iconProbe.icon === false && iconProbe.sparkle === false,
  JSON.stringify(iconProbe),
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
