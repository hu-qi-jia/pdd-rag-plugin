/**
 * P1 验收(自动):真实聊天页历史消息 → hook 捕获 → 分段 → 入库 → popup 计数
 * 1) 启动 chromium-1223 + 扩展(复用已登录 profile)
 * 2) 打开聊天页,等 hook 注入
 * 3) 点开买家对话 → chat/list 历史轮询 → [PDD CS] hook 捕获日志
 * 4) 页面跳走(about:blank)触发 leave → 分段器关闭会话 → 入库
 * 5) 打开 popup 读统计(问答记录 > 0、客服回复 > 0)
 * 用法:node scripts/e2e-capture.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化(launch 参数组与样板不同,保留原写法)
 */
import { chromium } from '@playwright/test'
import { CHROME, EXT, LOGGED_IN_PROFILE, findExtensionId, sleep } from './lib.mjs'

const PROFILE = LOGGED_IN_PROFILE

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
})
console.log('浏览器已启动')

const logs = []
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('console', (msg) => {
  const t = msg.text()
  if (t.includes('[PDD CS]')) logs.push(t)
})
page.on('pageerror', (e) => logs.push('[PAGE_ERROR] ' + e.message))

// 聊天页
await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(8000)
console.log('页面:', page.url())
console.log('capture ready:', logs.some((l) => l.includes('capture ready')) ? '是' : '否')

// 点开买家对话(触发 chat/list 历史轮询)
let clicked = false
for (const c of ['E***E', '眼睛的店铺']) {
  try {
    await page.getByText(c, { exact: false }).first().click({ timeout: 5000 })
    clicked = true
    console.log(`已点击对话: ${c}`)
    break
  } catch {
    /* 下一个候选 */
  }
}
if (!clicked) console.log('未找到对话条目,直接观察轮询')
await sleep(15000)
console.log('=== 捕获日志 ===')
const cap = logs.filter((l) => l.includes('DOM 捕获'))
console.log(cap.length ? cap.slice(0, 20).join('\n') : '(无)')
console.log('其它 PDD CS 日志:', logs.filter((l) => !l.includes('hook 捕获')).length, '条')

// 页面跳走 → pagehide → bridge leave → 分段器关会话入库
await page.goto('about:blank', { waitUntil: 'domcontentloaded' })
await sleep(6000)

// popup 统计
const extId = await findExtensionId(ctx)
if (!extId) {
  console.log('未找到扩展 SW')
} else {
  const pop = await ctx.newPage()
  await pop.goto(`chrome-extension://${extId}/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await sleep(4000)
  console.log('=== popup 内容 ===')
  console.log((await pop.evaluate(() => document.body.innerText)).slice(0, 600))
  await pop.close()
}

await ctx.close()
process.exit(0)
