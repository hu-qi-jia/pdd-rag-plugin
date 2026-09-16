/**
 * 全自动自检:调试 Chrome(已带扩展)上验证 P1 捕获链路
 * 1) 打开 mms 聊天页(调试 profile 已登录)
 * 2) 点开买家对话(触发 chat/list 历史拉取)
 * 3) 收集页面 [PDD CS] 控制台输出
 * 4) 打开扩展 popup 页读取统计数字
 * 用法:node scripts/e2e-self-check.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs(extId 发现走 CDP /json/list,机制不同,保留原写法)
 */
import { chromium } from '@playwright/test'
import { sleep } from './lib.mjs'

const CDP = 'http://127.0.0.1:9222'

const browser = await chromium.connectOverCDP(CDP)
const ctx = browser.contexts()[0]
const logs = []

// ── 1) 打开聊天页 ──
let page = ctx.pages().find((p) => p.url().includes('mms.pinduoduo.com'))
if (!page) page = await ctx.newPage()
page.on('console', (msg) => {
  const t = msg.text()
  if (t.includes('[PDD CS]')) logs.push(t)
})
page.on('pageerror', (e) => logs.push('[PAGE_ERROR] ' + e.message))

await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
console.log('页面:', page.url())
await sleep(6000)

// ── 2) 点开买家对话(用已知昵称,侧栏条目) ──
const candidates = ['E***E', '眼睛的店铺']
let opened = false
for (const c of candidates) {
  try {
    const loc = page.getByText(c, { exact: false }).first()
    await loc.click({ timeout: 5000 })
    opened = true
    console.log(`已点击对话: ${c}`)
    break
  } catch {
    /* 换下一个 */
  }
}
if (!opened) console.log('未找到可点对话条目(页面结构未知),仍继续观察')
await sleep(10000)

// ── 3) 收集控制台日志 ──
console.log('=== 页面 [PDD CS] 日志 ===')
console.log(logs.length ? logs.join('\n') : '(无)')
const hooked = await page.evaluate(() => {
  const g = window
  return {
    netHooked: !!g.__pddcsNetHooked,
    wsName: (g.WebSocket && g.WebSocket.name) || 'none',
  }
})
console.log('hook 状态:', JSON.stringify(hooked))

// ── 4) 从 /json 找扩展 id(SW 或扩展页出现后) ──
let extId = null
for (let i = 0; i < 10; i++) {
  const list = await (await fetch(`${CDP}/json/list`)).json()
  const hit = list.find((t) => t.url?.startsWith('chrome-extension://'))
  if (hit) {
    extId = new URL(hit.url).host
    break
  }
  await sleep(1000)
}

if (extId) {
  console.log('扩展 id:', extId)
  // 打开 popup 页(作为标签页,chrome.runtime 可用),读统计
  const pop = await ctx.newPage()
  await pop.goto(`chrome-extension://${extId}/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await sleep(4000)
  const text = await pop.evaluate(() => document.body.innerText)
  console.log('=== popup 页面内容 ===')
  console.log(text.slice(0, 800))
  await pop.close()
} else {
  console.log('未发现扩展 target(加载失败?检查启动参数或扩展报错)')
}

await browser.close()
process.exit(0)
