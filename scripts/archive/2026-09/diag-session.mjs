/**
 * 会话诊断:真实页面 DOM 捕获后,直接在 SW 上下文查 Dexie 落盘情况
 * 用法:node scripts/diag-session.mjs
 */
import { chromium } from '@playwright/test'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
const PROFILE = 'E:\\个人项目\\拼多多客服检索工具\\.chrome-debug-profile'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const logs = []
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('[PDD CS]') || t.includes('Error')) logs.push(t.slice(0, 400))
})
page.on('pageerror', (e) => logs.push('[PAGE_ERROR] ' + e.message.slice(0, 300)))

await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(15000)
// 滚动历史触发消息渲染
await page.evaluate(() => {
  const h = document.querySelector('.history-box')
  if (h) {
    h.scrollTop = 0
    h.dispatchEvent(new Event('scroll'))
    h.scrollTop = h.scrollHeight
    h.dispatchEvent(new Event('scroll'))
  }
})
await sleep(15000)

// SW 上下文直接查库
let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
for (let i = 0; i < 10 && !sw; i++) {
  await sleep(1000)
  sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
}
if (!sw) {
  console.log('无 SW!内容脚本消息可能根本没送达')
} else {
  const dbg = await sw.evaluate(async () => {
    const dbh = globalThis.pddDb
    if (!dbh) return { err: 'no pddDb global' }
    const stats = await dbh.getStats()
    const qas = await dbh.listQaRecords(8)
    const errs = await dbh.getRecentErrors(5)
    return {
      stats,
      qaSample: qas.map((q) => ({
        q: q.question.slice(0, 30),
        session: q.sessionKey,
        buyerTail: q.buyerIdTail,
        replies: q.replyCount,
      })),
      errs: errs.map((e) => ({ msg: e.message.slice(0, 120), ctx: JSON.stringify(e.context || {}).slice(0, 150) })),
    }
  })
  console.log('=== SW 内 Dexie 状态 ===')
  console.log(JSON.stringify(dbg, null, 1))
}
console.log('=== 页面日志(前 15) ===')
console.log(logs.slice(0, 40).join('\n'))
await ctx.close()
process.exit(0)
