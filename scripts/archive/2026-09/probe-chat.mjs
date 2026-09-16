/**
 * 聊天页行为探针:点开对话后观察 XHR 响应(聊天接口原文)与 DOM 状态
 * 用法:node scripts/probe-chat.mjs
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

// 聊天相关响应 → 原文前 500 字符
let respCount = 0
page.on('response', async (res) => {
  const url = res.url()
  if (!/mms\.pinduoduo\.com/.test(url)) return
  if (!/(plateau|chat|sync\/message|conversation)/i.test(url)) return
  respCount++
  let body = ''
  try {
    body = (await res.text()).slice(0, 500)
  } catch {
    body = '(body 不可读)'
  }
  console.log(`[HTTP ${res.status()}] ${url.split('?')[0]}`)
  if (/[一-鿿]/.test(body)) console.log('  含中文体:', body.replace(/\n/g, ' ').slice(0, 400))
})
page.on('console', (m) => {
  if (m.text().includes('[PDD CS]')) console.log('页console:', m.text().slice(0, 200))
})

await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(10000)
console.log('页面:', page.url())
console.log('frames:', page.frames().map((f) => f.url().slice(0, 80)).join(' | '))

// 尝试点开对话
const cands = ['E***E', '眼睛的店铺']
let clicked = false
for (const c of cands) {
  const loc = page.getByText(c, { exact: false }).first()
  try {
    await loc.click({ timeout: 4000 })
    clicked = true
    console.log('已点击:', c)
    break
  } catch {
    console.log('点不到:', c)
  }
}
await sleep(15000)
console.log('聊天接口响应数:', respCount)

// DOM 状态:聊天窗口?输入框?
const dom = await page.evaluate(() => {
  const txt = document.querySelector('textarea')
  const msgs = [...document.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent && /客服|您好|亲/.test(el.textContent),
  )
  return {
    url: location.href,
    textarea: !!txt,
    bodyHead: document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '),
    sampleMsgs: msgs.slice(0, 5).map((el) => el.textContent.slice(0, 50)),
  }
})
console.log('DOM:', JSON.stringify(dom, null, 1))

await ctx.close()
process.exit(0)
