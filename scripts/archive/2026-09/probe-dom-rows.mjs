/**
 * 行结构体检:真实页面上逐行检查提取要素命中率
 * (cs/buyer 容器、currentuid 属性、.msg-content-box 文本)
 * 用法:node scripts/probe-dom-rows.mjs
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
  if (t.includes('[PDD CS]')) logs.push(t)
})

await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(14000)
// 滚动触发消息渲染
await page.evaluate(() => {
  const h = document.querySelector('.history-box')
  if (h) {
    h.scrollTop = 0
    h.dispatchEvent(new Event('scroll'))
    h.scrollTop = h.scrollHeight
    h.dispatchEvent(new Event('scroll'))
  }
})
await sleep(6000)

const d = await page.evaluate(() => {
  const ul = document.querySelector('#msgListContainer .msg-list')
  if (!ul) return { err: 'no msg-list' }
  const out = []
  for (const li of ul.querySelectorAll('li.onemsg')) {
    const cs = li.querySelector('.cs-item')
    const buyer = li.querySelector('.buyer-item')
    const side = cs || buyer
    if (!side) {
      out.push({ li: li.id, skip: 'no-side' })
      continue
    }
    const uidEl = side.querySelector('[currentuid]')
    const box = side.querySelector('.msg-content-box')
    out.push({
      li: li.id,
      side: cs ? 'cs' : 'buyer',
      hasUid: !!uidEl,
      uid: uidEl?.getAttribute('currentuid') || null,
      boxText: box ? (box.textContent || '').trim().slice(0, 24) : null,
    })
  }
  return { total: out.length, rows: out }
})
const uidOk = d.rows ? d.rows.filter((r) => r.hasUid && !r.skip).length : 0
const boxOk = d.rows ? d.rows.filter((r) => r.boxText).length : 0
console.log('行数:', d.total, '| 有currentuid:', uidOk, '| 有正文:', boxOk)
console.log(JSON.stringify(d.rows?.slice(0, 12), null, 1))
console.log('=== 页面 PDD CS 日志 ===')
console.log(logs.join('\n'))
await ctx.close()
process.exit(0)
