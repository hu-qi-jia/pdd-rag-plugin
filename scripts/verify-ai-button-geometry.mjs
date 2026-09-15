/**
 * AI回复按钮几何验收(不依赖拼多多登录态):
 * 把**构建产物**里的 content script(CSS 模板 + 锚点算法都是真货)注入一个复刻真机结构的
 * 夹具页面,直接量按钮与气泡的真实矩形。
 *   验收点:① 按钮高 26px(= controlH.form,与 popup 按钮同档)、6px 圆角、12.5px 字号;
 *          ② 与气泡可视外缘间距 12px(修复前按 <p> 内缘定位,视觉间距只剩 ~2px);
 *          ③ 与气泡垂直居中。
 * 用法:node scripts/verify-ai-button-geometry.mjs
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

/** 真机结构:li.onemsg > .buyer-item > div[currentuid] > .msg-content > p.msg-content-box
 *  两行分别把气泡底色放在 .msg-content(常态)与更外层 div[currentuid](容错路径)。 */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#f5f5f5; font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
  #msgListContainer { width: 640px; height: 600px; overflow:auto; }
  ul.msg-list { margin:0; padding:0; list-style:none; }
  li.onemsg { padding: 8px 12px; }
  .buyer-item { display:flex; gap:8px; align-items:flex-start; }
  .avatar { width:32px; height:32px; border-radius:50%; background:#ccc; flex-shrink:0; }
  [currentuid] { display:inline-block; }
  .msg-content { background:#ffffff; padding:10px; border-radius:6px; }
  .msg-content-box { margin:0; font-size:13px; line-height:1.5; }
  .row-b [currentuid] { background:#ffffff; padding:10px; border-radius:6px; }
  .row-b .msg-content { background:transparent; padding:0; }
</style></head><body>
<div id="msgListContainer"><ul class="msg-list">
  <li class="onemsg row-a"><div class="buyer-item"><span class="avatar"></span>
    <div currentuid="u1"><div class="msg-content"><p class="msg-content-box">退货政策</p></div></div>
  </div></li>
  <li class="onemsg row-b"><div class="buyer-item"><span class="avatar"></span>
    <div currentuid="u2"><div class="msg-content"><p class="msg-content-box">发货时间</p></div></div>
  </div></li>
</ul></div></body></html>`

const browser = await chromium.launch({
  executablePath:
    'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.addInitScript(() => {
  // content script 依赖的最小 chrome 桩(本用例不点击,不触发 sendMessage)
  window.chrome = {
    storage: { local: {}, onChanged: { addListener() {} } },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage() {},
      get lastError() {
        return undefined
      },
    },
  }
})
await page.route('**/fixture.html', (route) =>
  route.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE }),
)
await page.goto('https://fixture.local/fixture.html')
await page.addScriptTag({ path: `${DIR}\\${CS}` })
await sleep(1500)

const measure = () =>
  page.evaluate(() => {
    const rect = (el) => {
      const b = el.getBoundingClientRect()
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }
    }
    const out = []
    for (const li of document.querySelectorAll('li.onemsg')) {
      const btn = [...document.querySelectorAll('.pddcs-ai-btn')].find((b) =>
        li.contains(li) && b.dataset.row === undefined,
      )
      out.push({ li: li.className })
    }
    // 逐行:按按钮纵向位置归位到所在行
    const rows = [...document.querySelectorAll('li.onemsg')].map((li, i) => {
      const btn = [...document.querySelectorAll('.pddcs-ai-btn')][i]
      const bubble = li.querySelector('[currentuid]')
      const text = li.querySelector('.msg-content-box')
      const cs = btn ? getComputedStyle(btn) : null
      return {
        row: li.className,
        btn: btn ? rect(btn) : null,
        bubble: rect(bubble),
        text: rect(text),
        style: cs
          ? {
              height: cs.height,
              radius: cs.borderRadius,
              fontSize: cs.fontSize,
              boxSizing: cs.boxSizing,
              padding: cs.padding,
              background: cs.backgroundColor,
            }
          : null,
        label: btn?.textContent ?? '',
      }
    })
    return { rows, btnCount: document.querySelectorAll('.pddcs-ai-btn').length }
  })

const { rows, btnCount } = await measure()
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

check('两行买家消息各渲染一个 .pddcs-ai-btn', btnCount === 2, `count=${btnCount}`)

for (const r of rows) {
  if (!r.btn) continue
  const gapFromBubble = r.btn.l - r.bubble.r
  const gapFromText = r.btn.l - r.text.r
  const centerDiff = Math.abs((r.btn.t + r.btn.h / 2) - (r.bubble.t + r.bubble.h / 2))
  console.log(
    `\n[${r.row}] 按钮 ${r.btn.w.toFixed(1)}×${r.btn.h.toFixed(1)} @left=${r.btn.l.toFixed(1)}` +
      ` | 气泡右缘=${r.bubble.r.toFixed(1)} 文本右缘=${r.text.r.toFixed(1)}` +
      ` | 到气泡视觉间距=${gapFromBubble.toFixed(1)}px(旧口径到文本=${gapFromText.toFixed(1)}px)` +
      ` | 垂直居中偏差=${centerDiff.toFixed(1)}px`,
  )
  console.log(`         computed: ${JSON.stringify(r.style)} label=${JSON.stringify(r.label)}`)
  check(`按钮高 26px(controlH.form)`, Math.abs(r.btn.h - 26) < 0.6, `${r.btn.h.toFixed(2)}px`)
  check(`按钮圆角 6px`, r.style.radius === '6px', r.style.radius)
  check(`按钮字号 12.5px / border-box`, r.style.fontSize === '12.5px' && r.style.boxSizing === 'border-box', `${r.style.fontSize} / ${r.style.boxSizing}`)
  check(
    `与气泡可视外缘间距 12px(拆包前按文本内缘只剩 ~2px)`,
    Math.abs(gapFromBubble - 12) < 1.5,
    `${gapFromBubble.toFixed(1)}px`,
  )
  check('按钮未压住气泡(间距 > 8px)', gapFromBubble > 8, `${gapFromBubble.toFixed(1)}px`)
  check('按钮与气泡垂直居中(偏差 < 1.5px)', centerDiff < 1.5, `${centerDiff.toFixed(1)}px`)
}

await page.screenshot({ path: ROOT + '\\logs\\ui-0915-ai-button.png', clip: { x: 0, y: 0, width: 640, height: 140 } })
console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await browser.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
