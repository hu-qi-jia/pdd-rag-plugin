/**
 * SW/MAIN 注册探针:检查 registerContentScripts 是否成功、MAIN hook 是否注入各 frame
 * 用法:node scripts/probe-sw.mjs
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

// ── 等 SW ──
let sw = null
for (let i = 0; i < 10 && !sw; i++) {
  await sleep(1000)
  sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
}
console.log('SW:', sw?.url() ?? '(无)')
if (sw) {
  const regs = await sw.evaluate(async () => {
    try {
      const r = await chrome.scripting.getRegisteredContentScripts()
      return r.map((x) => ({ id: x.id, js: x.js, matches: x.matches, world: x.world }))
    } catch (e) {
      return 'ERR:' + String(e)
    }
  })
  console.log('已注册脚本:', JSON.stringify(regs))
}

const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('[PDD CS]') || /error/i.test(t)) console.log('页console:', t.slice(0, 300))
})
page.on('pageerror', (e) => console.log('[PAGE_ERROR]', e.message.slice(0, 300)))

await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(9000)
console.log('页面:', page.url())

for (const f of page.frames()) {
  try {
    const r = await f.evaluate(() => ({
      hooked: !!window.__pddcsNetHooked,
      ws: window.WebSocket.name,
    }))
    console.log('frame', f.url().slice(0, 110), JSON.stringify(r))
  } catch (e) {
    console.log('frame eval err:', e.message.slice(0, 100))
  }
}

await ctx.close()
process.exit(0)
