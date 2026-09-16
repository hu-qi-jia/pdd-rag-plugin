/**
 * popup 扩展页 → SW 合成 PDD_INGEST:验证响应 detail 与落盘
 * 用法:node scripts/diag-popup-send.mjs
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
await sleep(5000)
let extId = null
for (let i = 0; i < 10 && !extId; i++) {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
  if (sw) extId = new URL(sw.url()).host
  if (!extId) await sleep(1000)
}
if (!extId) {
  console.log('无扩展')
  process.exit(1)
}
const pop = await ctx.newPage()
await pop.goto(`chrome-extension://${extId}/popup.html`, {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
})
await sleep(2000)
const r = await pop.evaluate(async () => {
  const send = (events) =>
    new Promise((res) =>
      chrome.runtime.sendMessage({ type: 'PDD_INGEST', payload: { events } }, res),
    )
  const mk = (id, role, text) => ({
    kind: 'msg',
    sessionKey: 'diag-session-2',
    msg: { source: 'dom', role, text, msgId: id, ts: Date.now() - 60_000 },
  })
  const a = await send([
    mk('diag-a1', 'buyer', '诊断问题一?'),
    mk('diag-a2', 'agent', '诊断回复一。'),
  ])
  const b = await send([mk('diag-a1', 'buyer', '诊断问题一?')]) // 重复 id
  const c = await send([{ kind: 'leave', sessionKey: 'diag-session-2' }])
  const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' })
  return { a, b, c, stats }
})
console.log(JSON.stringify(r, null, 1))
// 读错误表(SW 上下文直查)
const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
if (sw) {
  const errs = await sw.evaluate(async () => {
    const errs = await globalThis.pddDb.getRecentErrors(10)
    return errs.map((e) => ({ msg: e.message, ctx: JSON.stringify(e.context || {}) }))
  })
  console.log('=== 错误表 ===')
  console.log(JSON.stringify(errs, null, 1))
}
await ctx.close()
process.exit(0)
