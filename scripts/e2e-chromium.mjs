/**
 * 全自动自检(Playwright bundled Chromium 版):验证 P1 捕获链路
 * unbranded Chromium 允许 --load-extension(品牌 Chrome 137+ 已禁用)。
 * 复用已登录的 .chrome-debug-profile(※ 见下方阻塞说明)。
 *
 * ⚠ 2026-09-16 首验结论:cookie 复用方案已失效 —— Chrome 127+ 对 cookie 用
 * app-bound encryption(绑定原浏览器二进制),品牌 Chrome 登录态无法被本诊断用
 * chromium 解密,访问聊天页一律 302 到登录页;扩展加载同 profile 亦受 profile
 * 版本 downgrade 保护影响。恢复可跑:用本脚本同款 chromium 对 .chrome-debug-profile
 * 手动登录一次(登录写回后 cookie 属于 chromium 自身,后续可复用)。
 *
 * 1) 启动 chromium-1223 + 扩展(--load-extension build)
 * 2) 打开 mms 聊天页(profile 已登录),等 hook 注入
 * 3) 收集 [PDD CS] 控制台日志 + hook 状态
 * 4) 点开买家对话(触发 chat/list 轮询),再看日志
 * 5) 打开扩展 popup 页读统计数字
 *
 * 退出码:0=PASS(扩展加载 + 未被踢到登录页);2=未登录;1=扩展未加载。
 *
 * 用法:node scripts/e2e-chromium.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化(launch 参数组与样板不同,保留原写法)
 * 2026-09-16 第三十轮:首验失败形态固化 —— 未登录/扩展未加载不再静默 exit 0
 */
import { chromium } from '@playwright/test'
import { CHROME, EXT, LOGGED_IN_PROFILE, sleep } from './lib.mjs'

const PROFILE = LOGGED_IN_PROFILE

const ctx = await chromium.launchPersistentContext(PROFILE, {
  ...(CHROME ? { executablePath: CHROME } : {}),
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--disable-session-crashed-bubble',
  ],
})
console.log('浏览器已启动(profile 复用)')

const logs = []
let page = ctx.pages()[0]
if (!page) page = await ctx.newPage()
page.on('console', (msg) => {
  const t = msg.text()
  if (t.includes('[PDD CS]')) logs.push(t)
})
page.on('pageerror', (e) => logs.push('[PAGE_ERROR] ' + e.message))

// ── 找扩展 id(等 service worker 或扩展页出现) ──
let extId = null
for (let i = 0; i < 15; i++) {
  const sws = ctx.serviceWorkers()
  for (const sw of sws) {
    const m = sw.url().match(/^chrome-extension:\/\/([a-p]{32})\//)
    if (m) extId = m[1]
  }
  const extPages = ctx.pages().filter((p) => p.url().startsWith('chrome-extension://'))
  if (!extId && extPages.length) extId = new URL(extPages[0].url()).host
  if (extId) break
  await sleep(1000)
}
console.log('扩展 id:', extId ?? '(未找到,加载失败?)')
if (!extId) {
  console.log('FAIL: 扩展未加载(该 profile 存在版本 downgrade 保护;全新 profile 可正常加载)')
  await ctx.close()
  process.exit(1)
}

// ── 打开聊天页 ──
await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
console.log('页面:', page.url())
if (page.url().includes('/login')) {
  console.log('FAIL: 登录态已失效(Chrome 127+ app-bound cookie 加密,品牌 Chrome 登录态无法复用);'
    + '需用本款 chromium 对该 profile 手动登录一次')
  await ctx.close()
  process.exit(2)
}
await sleep(8000)

const st = await page.evaluate(() => ({
  netHooked: !!window.__pddcsNetHooked,
  wsName: (window.WebSocket && window.WebSocket.name) || 'none',
}))
console.log('hook 状态:', JSON.stringify(st))
console.log('日志(等 8s):', logs.length ? logs.join('\n') : '(无)')

// ── 点开买家对话(触发历史拉取) ──
for (const c of ['E***E', '眼睛的店铺']) {
  try {
    const loc = page.getByText(c, { exact: false }).first()
    await loc.click({ timeout: 5000 })
    console.log(`已点击对话: ${c}`)
    break
  } catch {
    /* 下一个候选 */
  }
}
await sleep(12000)
console.log('=== 点开对话后日志 ===')
console.log(logs.length ? logs.join('\n') : '(无)')

// ── popup 统计 ──
const pop = await ctx.newPage()
await pop.goto(`chrome-extension://${extId}/popup.html`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
})
await sleep(4000)
console.log('=== popup 页面内容 ===')
console.log((await pop.evaluate(() => document.body.innerText)).slice(0, 1000))
await pop.close()

const hooked = st.netHooked || logs.some((l) => l.includes('hook'))
console.log(hooked ? 'PASS: 注入链路工作(hook/日志有信号)' : 'WARN: 未登录页可达但未见 hook 信号,人工核对日志')
await ctx.close()
process.exit(hooked ? 0 : 3)
