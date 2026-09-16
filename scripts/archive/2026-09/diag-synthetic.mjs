/**
 * 合成消息直测 SW handler:验证 detail/分支计数与落盘
 * 用法:node scripts/diag-synthetic.mjs
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
await sleep(6000)
let sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
for (let i = 0; i < 10 && !sw; i++) {
  await sleep(1000)
  sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
}
if (!sw) {
  console.log('无 SW')
  process.exit(1)
}
const r1 = await sw.evaluate(async () => {
  const send = (events) =>
    new Promise((res) =>
      chrome.runtime.sendMessage({ type: 'PDD_INGEST', payload: { events } }, res),
    )
  const mk = (id, role, text) => ({
    kind: 'msg',
    sessionKey: 'diag-session-1',
    msg: { source: 'dom', role, text, msgId: id, ts: Date.now() - 60_000 },
  })
  const a = await send([mk('diag-1', 'buyer', '这是诊断问题文本?'), mk('diag-2', 'agent', '这是诊断回复文本。')])
  const b = await send([mk('diag-1', 'buyer', '这是诊断问题文本?')]) // 重复 id
  const c = await send([{ kind: 'leave', sessionKey: 'diag-session-1' }])
  const stats = await globalThis.pddDb.getStats()
  const qas = await globalThis.pddDb.listQaRecords(3)
  const errors = await globalThis.pddDb.getRecentErrors(10)
  const sessionRows = await globalThis.pddDb.qaRecords
    .where('sessionKey')
    .equals('diag-session-1')
    .toArray()
  return {
    a, b, c,
    stats,
    sample: qas.map((q) => ({ q: q.question, r: q.replyCount })),
    sessionRows: sessionRows.map((q) => ({ q: q.question, r: q.replyCount })),
    errors: errors.map((e) => ({ ts: e.timestamp, msg: e.message, ctx: e.context })),
  }
})
console.log(JSON.stringify(r1, null, 1))
await ctx.close()
process.exit(0)
