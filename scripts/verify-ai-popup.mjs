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
 *  ⑤ 快捷键面板键盘导航(2026-09-16 第二十一轮引入,第二十四轮改循环):初始选中第一条,
 *    Tab 单键循环切换 —— 末条再按回绕到首条(Shift+Tab 反向已删,不再拦截;↑↓ 亦让位平台切换会话),
 *    Enter 填充**选中项**(非固定第一条)
 * 用法:node scripts/verify-ai-popup.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化
 */
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { CHROME, EXT, ROOT, sleep } from './lib.mjs'

const CS = readdirSync(EXT).find((f) => /^pdd-ai-button\..*\.js$/.test(f))
if (!CS) {
  console.log('FAIL: 未找到 content script 产物,请先 build')
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

const browser = await chromium.launch({ executablePath: CHROME })
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
  window.__extraSuggestions = []
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
          const list = suggestions.concat(window.__extraSuggestions ?? [])
          return Promise.resolve({
            payload: {
              suggestions: list,
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
await page.addScriptTag({ path: path.join(EXT, CS) })
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

// ── ④ 快捷键:Ctrl+Enter 唤起面板 → ↑↓ 选择 → Enter 填充选中项(2026-09-16 第二十一轮)──
await page.evaluate(() => {
  document.querySelector('.pddcs-popup-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(400)
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
})
await sleep(900)
const hkHead = await page.evaluate(() => document.querySelector('.pddcs-popup-head')?.textContent ?? '')
const hkFoot = await page.evaluate(() => document.querySelector('.pddcs-popup-foot')?.textContent ?? '')
check('Ctrl+Enter 唤起「推荐回复」面板', hkHead.startsWith('推荐回复('), hkHead)
check('面板脚注提示 Tab 切换候选(循环) + Enter 填充', hkFoot.includes('Tab 切换候选') && hkFoot.includes('Enter 填充'), hkFoot)

const selIdx = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('.pddcs-cand')]
    return rows.findIndex((r) => r.classList.contains('pddcs-cand-selected'))
  })
check('面板打开 → 选中态初始落在第一条', (await selIdx()) === 0, `selected=${await selIdx()}`)

// ── ⑥ 视觉规格(2026-09-16 第二十三轮:不透明/灰选中/细滚动条;第二十五轮:ChatGPT 化)──
const visual = await page.evaluate(() => {
  const popup = document.querySelector('.pddcs-popup')
  const sel = document.querySelector('.pddcs-cand-selected')
  const cand = document.querySelector('.pddcs-cand')
  const badge = document.querySelector('.pddcs-badge')
  const cs = popup ? getComputedStyle(popup) : null
  const ss = sel ? getComputedStyle(sel) : null
  const hasRule = (needle) =>
    [...document.styleSheets].some((sheet) => {
      try {
        return [...sheet.cssRules].some((r) => r.cssText.includes(needle))
      } catch {
        return false
      }
    })
  return {
    bg: cs?.backgroundColor ?? '',
    opacity: cs?.opacity ?? '',
    selBg: ss?.backgroundColor ?? '',
    selShadow: ss?.boxShadow ?? '',
    thinRule: hasRule('.pddcs-popup::-webkit-scrollbar') && hasRule('width: 6px'),
    candBorder: cand ? getComputedStyle(cand).borderBottomWidth : '',
    candTextFont: document.querySelector('.pddcs-cand-text')
      ? getComputedStyle(document.querySelector('.pddcs-cand-text')).fontSize
      : '',
    qEl: !!document.querySelector('.pddcs-cand-q'),
    qFont: document.querySelector('.pddcs-cand-q')
      ? getComputedStyle(document.querySelector('.pddcs-cand-q')).fontSize
      : '',
    qText: document.querySelector('.pddcs-cand-q')?.textContent ?? '',
    srcGone: !document.querySelector('.pddcs-cand-src'),
    headFont: document.querySelector('.pddcs-popup-head')
      ? getComputedStyle(document.querySelector('.pddcs-popup-head')).fontSize
      : '',
    panelShadow: cs?.boxShadow ?? '',
    badgeBg: badge ? getComputedStyle(badge).backgroundColor : '',
    badgeDot: badge ? getComputedStyle(badge, '::before').width : '',
    footKbd: !!document.querySelector('.pddcs-popup-foot kbd'),
  }
})
check(
  '面板背景不透明(rgb 无 alpha,opacity=1)',
  /^rgb\(\d+, \d+, \d+\)$/.test(visual.bg) && visual.opacity === '1',
  `bg=${visual.bg} opacity=${visual.opacity}`,
)
check(
  '选中态为中性灰(非 accent 蓝)',
  visual.selBg === 'rgba(0, 0, 0, 0.06)' && visual.selShadow.includes('rgba(0, 0, 0, 0.24)') && !visual.selBg.includes('13, 153, 255'),
  `bg=${visual.selBg} shadow=${visual.selShadow}`,
)
check('面板滚动条为 6px 细轨(公共规格)', visual.thinRule, `thinRule=${visual.thinRule}`)
check(
  '候选行无分隔线(border-bottom-width=0,留白分组)',
  visual.candBorder === '0px',
  `candBorder=${visual.candBorder}`,
)
check(
  '浮层阴影柔和双层(含 0 8px 24px 环境影)',
  visual.panelShadow.includes('0px 8px 24px'),
  `panelShadow=${visual.panelShadow}`,
)
check(
  '徽标已降级小圆点(6px ::before,无色块底)',
  visual.badgeDot === '6px' && visual.badgeBg === 'rgba(0, 0, 0, 0)',
  `badgeDot=${visual.badgeDot} badgeBg=${visual.badgeBg}`,
)
check('页脚键位提示键帽化(foot 含 kbd 键帽)', visual.footKbd, `footKbd=${visual.footKbd}`)
check('回答正文为主层(13.5px)', visual.candTextFont === '13.5px', `candTextFont=${visual.candTextFont}`)
check(
  '问题回显上置为引子(11.5px,原问题开头)',
  visual.qEl && visual.qFont === '11.5px' && visual.qText.startsWith('原问题:'),
  `qFont=${visual.qFont} qText=${visual.qText.slice(0, 20)}`,
)
check('底部来源行移除(并入顶部回显)', visual.srcGone, `srcGone=${visual.srcGone}`)
check('头部极简(12.5px 小字)', visual.headFont === '12.5px', `headFont=${visual.headFont}`)

await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
})
await sleep(200)
check('Tab → 选中第二条', (await selIdx()) === 1, `selected=${await selIdx()}`)
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
})
await sleep(200)
check('连按 Tab 到末条后回绕到首条(循环切换)', (await selIdx()) === 0, `selected=${await selIdx()}`)
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
})
await sleep(200)
check('Shift+Tab 不再拦截(反向已删,选中不动)', (await selIdx()) === 0, `selected=${await selIdx()}`)
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
})
await sleep(200)
check('↑↓ 不再拦截(让位平台切换会话,选中不动)', (await selIdx()) === 0, `selected=${await selIdx()}`)

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
  'Enter → 填充的是**选中项**(回绕后的首条标准回答),面板关闭',
  filled === '标准回答:支持7天无理由退换,运费我们承担。' && popupGone,
  `value=${filled.slice(0, 24)}… popupGone=${popupGone}`,
)

// ── ⑦ 循环切换的滚动校正(2026-09-16 第二十六轮:9 条候选出滚动;
//      回绕到首条时滚回顶部,sticky 头不得盖住选中行)──
await page.evaluate(() => {
  window.__extraSuggestions = Array.from({ length: 6 }, (_, i) => ({
    kind: 'history',
    text: `滚动候选 ${i + 1}:填充用长答复,保证面板出滚动条。`,
    sourceQuestion: '这个支持7天无理由退换吗',
    score: 0.7,
    sourceId: `x-${i}`,
    replyId: `rp-x-${i}`,
  }))
})
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
})
await sleep(900)
for (let i = 0; i < 8; i += 1) {
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  })
  await sleep(80)
}
const scrolled = await page.evaluate(() => {
  const p = document.querySelector('.pddcs-popup')
  const sel = document.querySelector('.pddcs-cand-selected')
  const head = document.querySelector('.pddcs-popup-head')
  return {
    count: document.querySelectorAll('.pddcs-cand').length,
    selected: [...document.querySelectorAll('.pddcs-cand')].indexOf(sel),
    scrollTop: p.scrollTop,
    headBottom: head.getBoundingClientRect().bottom,
    selTop: sel.getBoundingClientRect().top,
  }
})
check('9 条候选面板:连按 Tab 到末条(滚动跟随)', scrolled.count === 9 && scrolled.selected === 8 && scrolled.scrollTop > 0, JSON.stringify(scrolled))
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
})
await sleep(200)
const wrapped = await page.evaluate(() => {
  const p = document.querySelector('.pddcs-popup')
  const sel = document.querySelector('.pddcs-cand-selected')
  const head = document.querySelector('.pddcs-popup-head')
  return {
    selected: [...document.querySelectorAll('.pddcs-cand')].indexOf(sel),
    scrollTop: p.scrollTop,
    headBottom: head.getBoundingClientRect().bottom,
    selTop: sel.getBoundingClientRect().top,
  }
})
check(
  '回绕到首条 → 滚回顶部,选中行完整露在 sticky 头下方(不被折叠遮盖)',
  wrapped.selected === 0 && wrapped.scrollTop === 0 && wrapped.selTop >= wrapped.headBottom - 1,
  JSON.stringify(wrapped),
)

await page.screenshot({ path: path.join(ROOT, 'logs', 'ui-0915-ai-popup.png') })
console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await browser.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
