/**
 * 聊天页 AI 候选弹窗 UI 验收(不依赖拼多多登录态):
 * 把**构建产物**的 content script 注入复刻真机 DOM 的夹具页,用桩接管 chrome.runtime,
 * 走到"点击 AI回复 → 候选弹窗 → 设置/取消标准回答"的真实交互路径。
 *
 * 验收点(2026-09-15 用户反馈):
 *  ① 已是标准回答的候选 → 操作钮为「取消标准回答」(原先无法取消)
 *  ② 点取消 → 发 DELETE_GOLDEN { 该候选的标准回答 id },回执后原位翻回「设置标准回答」
 *  ③ 历史候选 → 点「设置标准回答」发 ADD_GOLDEN,成功后原位翻为「取消标准回答」
 *  ④ 达到每问上限时 → 提示且不误报成功
 * 用法:node scripts/verify-ai-popup-2026-09-15.mjs
 */
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const DIR = ROOT + '\\build\\chrome-mv3-prod'
const CS = readdirSync(DIR).find((f) => /^pdd-ai-button\..*\.js$/.test(f))
if (!CS) {
  console.log('FAIL: 未找到 content script 产物,请先 build')
  process.exit(1)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u2"><div class="msg-content"><p class="msg-content-box">填充消息 2:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u3"><div class="msg-content"><p class="msg-content-box">填充消息 3:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u4"><div class="msg-content"><p class="msg-content-box">填充消息 4:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u5"><div class="msg-content"><p class="msg-content-box">填充消息 5:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u6"><div class="msg-content"><p class="msg-content-box">填充消息 6:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u7"><div class="msg-content"><p class="msg-content-box">填充消息 7:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u8"><div class="msg-content"><p class="msg-content-box">填充消息 8:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u9"><div class="msg-content"><p class="msg-content-box">填充消息 9:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u10"><div class="msg-content"><p class="msg-content-box">填充消息 10:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u11"><div class="msg-content"><p class="msg-content-box">填充消息 11:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u12"><div class="msg-content"><p class="msg-content-box">填充消息 12:把最后一条买家消息压到视口底部</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u13"><div class="msg-content"><p class="msg-content-box">填充消息 13:把最后一条买家消息压到视口底部</p></div></div></div></li>
</ul></div>
<textarea id="replyTextarea" style="position:fixed; left:20px; bottom:20px; width:600px; height:60px"></textarea>
</body></html>`

const browser = await chromium.launch({
  executablePath:
    'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

// chrome 桩:记录发出的消息,按类型回执(候选固定 3 条:1 标准回答 + 2 历史)
await page.addInitScript(() => {
  const sent = []
  const cand = (kind, text, id) => ({
    kind,
    text,
    sourceQuestion: '这个支持7天无理由退换吗',
    score: kind === 'golden' ? 0.93 : 0.87,
    sourceId: id,
    ...(kind === 'history' ? { replyId: `rp-${id}` } : {}),
  })
  const suggestions = [
    cand('golden', '标准回答:支持7天无理由退换,运费我们承担。', 'gd-1'),
    cand('history', '历史答复甲:支持7天无理由,请放心下单。', 'h-1'),
    cand('history', '历史答复乙:7天内可退换,需要保持完好。', 'h-2'),
  ]
  window.__sent = sent
  window.__goldenCount = 1
  window.__forceLimit = false
  window.chrome = {
    storage: { local: {}, onChanged: { addListener() {} } },
    runtime: {
      onMessage: { addListener() {} },
      lastError: undefined,
      sendMessage(msg) {
        sent.push(msg)
        const p = msg?.payload ?? {}
        if (msg?.type === 'GET_STATS') {
          return Promise.resolve({
            payload: {
              settings: { directFillEnabled: false, goldenPriorityEnabled: true, autoReplyHotkey: { ctrl: true, alt: false, shift: false, key: 'Enter' } },
            },
          })
        }
        if (msg?.type === 'GET_SUGGESTIONS') {
          return Promise.resolve({
            payload: {
              suggestions,
              settings: { directFillEnabled: false, goldenPriorityEnabled: true },
            },
          })
        }
        if (msg?.type === 'ADD_GOLDEN') {
          if (window.__forceLimit) {
            return Promise.resolve({ payload: { limitReached: true, count: 3 } })
          }
          window.__goldenCount += 1
          return Promise.resolve({
            payload: { id: `gd-new-${window.__goldenCount}`, count: window.__goldenCount },
          })
        }
        if (msg?.type === 'DELETE_GOLDEN') {
          return Promise.resolve({ payload: { success: true } })
        }
        return Promise.resolve({ payload: {} })
      },
    },
  }
  void p
})
await page.route('**/fixture.html', (route) =>
  route.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE }),
)
await page.goto('https://fixture.local/fixture.html')
await page.addScriptTag({ path: `${DIR}\\${CS}` })
await sleep(1200)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.pddcs-cand')].map((r) => ({
      badge: r.querySelector('.pddcs-badge')?.textContent ?? '',
      actions: [...r.querySelectorAll('.pddcs-mini')].map((b) => b.textContent ?? ''),
      text: r.querySelector('.pddcs-cand-text')?.textContent ?? '',
    })),
  )
const sentOf = (type) =>
  page.evaluate((t) => (window.__sent ?? []).filter((m) => m.type === t), type)

// ── 打开候选弹窗 ──
await page.locator('.pddcs-ai-btn').first().click()
await sleep(600)
const first = await rows()
console.log('候选行 =', JSON.stringify(first, null, 1))
check('候选弹窗渲染 3 行', first.length === 3, `rows=${first.length}`)
check('标准回答候选的操作钮是「取消标准回答」', first[0]?.actions.includes('取消标准回答'), JSON.stringify(first[0]?.actions))
check('历史候选的操作钮是「设置标准回答」', first[1]?.actions.includes('设置标准回答'), JSON.stringify(first[1]?.actions))

// ── ① 取消标准回答 ──
await page.locator('.pddcs-mini', { hasText: '取消标准回答' }).first().click()
await sleep(500)
const del = await sentOf('DELETE_GOLDEN')
check('点取消 → 发出 DELETE_GOLDEN 且 id 为该候选的标准回答 id', del.length === 1 && del[0].payload?.id === 'gd-1', JSON.stringify(del))
const afterCancel = await rows()
check('取消成功 → 原位翻回「设置标准回答」', afterCancel[0]?.actions.includes('设置标准回答'), JSON.stringify(afterCancel[0]?.actions))

// ── ② 把历史候选设为标准回答 ──
await page.locator('.pddcs-cand').nth(1).locator('.pddcs-mini', { hasText: '设置标准回答' }).click()
await sleep(500)
const add = await sentOf('ADD_GOLDEN')
check(
  '点设置 → 发出 ADD_GOLDEN(问题=气泡合并文本,答案=该候选文本)',
  add.length === 1 &&
    add[0].payload?.answer === '历史答复甲:支持7天无理由,请放心下单。' &&
    String(add[0].payload?.question).includes('7天无理由'),
  JSON.stringify(add[0]?.payload),
)
const afterAdd = await rows()
check('设置成功 → 原位翻为「取消标准回答」(无需重开面板)', afterAdd[1]?.actions.includes('取消标准回答'), JSON.stringify(afterAdd[1]?.actions))

// ── ③ 触及每问上限(桩切到 limitReached)──
await page.evaluate(() => {
  window.__forceLimit = true
})
await page.locator('.pddcs-cand').nth(2).locator('.pddcs-mini', { hasText: '设置标准回答' }).click()
await sleep(500)
const toast = await page.evaluate(() => document.querySelector('.pddcs-toast')?.textContent ?? '')
console.log('toast =', JSON.stringify(toast))
check('达上限时提示「该问题已有 3 条标准回答…」且不误报成功', toast.includes('已有 3 条标准回答'), toast)
const afterLimit = await rows()
check('达上限时按钮不翻转为已设置态', afterLimit[2]?.actions.includes('设置标准回答'), JSON.stringify(afterLimit[2]?.actions))

// ── ④ 快捷键:Ctrl+Enter 唤起面板 → Enter 填充第一条 ──
await page.evaluate(() => {
  document.querySelector('.pddcs-popup-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(400)
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
})
await sleep(900)
const hkHead = await page.evaluate(() => document.querySelector('.pddcs-popup-head')?.textContent ?? '')
const hkCount = await page.evaluate(() => document.querySelector('.pddcs-popup-count')?.textContent ?? '')
const hkFoot = await page.evaluate(() => document.querySelector('.pddcs-popup-foot')?.textContent ?? '')
check('Ctrl+Enter 唤起「推荐回复」面板(标题 + 数量徽)', hkHead.includes('推荐回复') && hkCount === '3', `${hkHead} / count=${hkCount}`)
check('面板脚注提示 Enter 填充第一条', hkFoot.includes('按 Enter 填充第一条'), hkFoot)

// 面板不溢出视口:顶部 ≥ 8 且底部 ≤ 视口高 - 8
const fit = await page.evaluate(() => {
  const r = document.querySelector('.pddcs-popup').getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, vh: window.innerHeight }
})
check(
  '面板完整落在视口内(不因气泡靠近屏幕底部而溢出)',
  fit.top >= 8 && fit.bottom <= fit.vh - 8,
  JSON.stringify(fit),
)

await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await sleep(500)
const filled = await page.evaluate(() => document.querySelector('#replyTextarea')?.value ?? '')
const popupGone = await page.evaluate(() => !document.querySelector('.pddcs-popup'))
check(
  '再按 Enter → 第一条推荐回复填入输入框,面板关闭',
  filled.length > 0 && popupGone,
  `value=${filled.slice(0, 24)}… popupGone=${popupGone}`,
)

await page.screenshot({ path: ROOT + '\\logs\\ui-0915-ai-popup.png' })
console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await browser.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
