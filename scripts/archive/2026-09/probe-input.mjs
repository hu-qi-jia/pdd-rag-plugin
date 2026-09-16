/**
 * P2-3 真机校准:官方输入框结构 + 填充触发方式 + 买家消息行结构(按钮挂载点)
 *  - 枚举 textarea / contenteditable,输出标签/类名/祖先链/占位符
 *  - 真实填充测试:写入→读回→清空(绝不点发送)
 *  - dump 买家行 outerHTML 与关键坐标(绝对定位按钮方案用)
 * 用法:node scripts/probe-input.mjs
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
  timeout: 60000,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--hide-crash-restore-bubble',
    '--no-default-browser-check',
  ],
})
await sleep(5000)
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(8000)

// 点开一个会话(有历史消息)
for (const c of ['E***E', '眼睛的店铺']) {
  try {
    await page.getByText(c, { exact: false }).first().click({ timeout: 4000 })
    console.log('已点击会话:', c)
    break
  } catch {
    /* 下一个 */
  }
}
await sleep(6000)

const calib = await page.evaluate(() => {
  const out = {}
  const chain = (el, depth = 4) => {
    const parts = []
    let cur = el
    for (let i = 0; i < depth && cur && cur.tagName !== 'BODY'; i++) {
      parts.push(
        `${cur.tagName.toLowerCase()}${cur.id ? '#' + cur.id : ''}${
          cur.className && typeof cur.className === 'string' ? '.' + cur.className.trim().split(/\s+/).join('.') : ''
        }`,
      )
      cur = cur.parentElement
    }
    return parts.join(' < ')
  }

  // 1) 输入框候选
  out.inputs = [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]')]
    .filter((el) => el.getBoundingClientRect().width > 100) // 排除隐藏元素
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      chain: chain(el, 5),
      placeholder: el.getAttribute('placeholder') ?? el.getAttribute('data-placeholder') ?? '',
      rect: (({ x, y, width, height }) => ({ x, y, width, height }))(el.getBoundingClientRect()),
    }))

  // 2) 买家消息行样本(前 2 条)
  const buyerRows = [...document.querySelectorAll('.buyer-item')].slice(0, 2)
  out.buyerRows = buyerRows.map((el) => ({
    chain: chain(el, 3),
    html: el.outerHTML.slice(0, 1500),
    rect: (({ x, y, width, height }) => ({ x, y, width, height }))(el.getBoundingClientRect()),
  }))
  const list = document.querySelector('#msgListContainer')
  out.listRect = list ? (({ x, y, width, height }) => ({ x, y, width, height }))(list.getBoundingClientRect()) : null

  // 3) 填充测试(找到主输入框)
  const input = out.inputs.length > 0 ? document.querySelectorAll('textarea, [contenteditable="true"]')[0] : null
  if (input) {
    const isTextarea = input.tagName === 'TEXTAREA'
    const before = isTextarea ? input.value : input.textContent
    if (isTextarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '校准测试文本123')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      input.focus()
      document.execCommand('insertText', false, '校准测试文本123')
    }
    out.fillTest = {
      isTextarea,
      before: String(before).slice(0, 50),
      after: String(isTextarea ? input.value : input.textContent).slice(0, 50),
    }
    // 清空
    if (isTextarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      input.focus()
      document.execCommand('selectAll', false, null)
      document.execCommand('delete', false, null)
    }
    out.cleared = String(isTextarea ? input.value : input.textContent) === ''
  } else {
    out.fillTest = null
  }
  return out
})

console.log(JSON.stringify(calib, null, 1))

// 追加:会话列表点击后未点会话时的 buyer 行可能为空,提示
if (!calib.buyerRows || calib.buyerRows.length === 0) console.log('⚠ 未找到 .buyer-item 行,可能未点开会话')

await ctx.close()
process.exit(0)
