/**
 * SW 代码版本判别 + 强制 reload:
 *  1) 启动后先 chrome.runtime.reload()(等效 chrome://extensions reload,强制 SW 重读磁盘)
 *  2) 发一个必跳过事件(msg 无 sessionKey → nosession):新代码响应含 detail 字段,旧代码没有
 *  3) 再跑完整合成链路(buyer→agent→dup→leave),读 stats/errors/会话行
 * 用法:node scripts/diag-sw-version.mjs
 */
import { chromium } from '@playwright/test'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
// 默认一次性干净 profile(合成测试无需登录态;也排除旧 profile 缓存干扰)
// 要用登录态 profile 时:PDDCS_PROFILE=login node scripts/diag-sw-version.mjs
const PROFILE =
  process.env.PDDCS_PROFILE === 'login'
    ? 'E:\\个人项目\\拼多多客服检索工具\\.chrome-debug-profile'
    : ROOT + '\\.diag-fresh-profile'
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
  console.log('无扩展;已见 SW:', ctx.serviceWorkers().map((w) => w.url()))
  console.log('已见页面:', ctx.pages().map((p) => p.url()))
  await ctx.close()
  process.exit(1)
}

// ── 登录态 profile 才强制 reload:击穿 profile 里可能陈旧的 SW 脚本缓存 ──
// 全新 profile 无缓存问题,直接跳过(reload 后短期内扩展页会被 BLOCKED_BY_CLIENT)
const before = await ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
if (process.env.PDDCS_PROFILE === 'login') {
  await before.evaluate(() => chrome.runtime.reload())
  await sleep(4000)
  let fresh = null
  for (let i = 0; i < 10; i++) {
    fresh = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
    if (fresh && fresh !== before) break
    await sleep(1000)
  }
  console.log('SW reloaded:', fresh !== before ? 'yes(新实例)' : 'no(同一实例,可能未重启)')
}

// 等扩展上下文就绪(SW 可响应)再开 popup,reload 后立即开页会被 BLOCKED_BY_CLIENT
let pop = null
for (let i = 0; i < 10 && !pop; i++) {
  await sleep(2000)
  try {
    const p = await ctx.newPage()
    await p.goto(`chrome-extension://${extId}/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })
    pop = p
  } catch {
    /* 扩展尚未就绪,重试 */
  }
}
if (!pop) {
  console.log('popup 页始终无法打开')
  await ctx.close()
  process.exit(1)
}
await sleep(1500)
const r = await pop.evaluate(async () => {
  const send = (events) =>
    new Promise((res) =>
      chrome.runtime.sendMessage({ type: 'PDD_INGEST', payload: { events } }, res),
    )
  // 版本探针:无 sessionKey 的 msg → 新代码应答 detail:"nosession=1"
  const probe = await send([
    { kind: 'msg', msg: { source: 'dom', role: 'buyer', text: '版本探针', msgId: 'probe-1', ts: Date.now() } },
  ])
  const hasDetail = probe?.payload && 'detail' in probe.payload
  const mk = (id, role, text) => ({
    kind: 'msg',
    sessionKey: 'diag-session-3',
    msg: { source: 'dom', role, text, msgId: id, ts: Date.now() - 60_000 },
  })
  const a = await send([mk('diag-b1', 'buyer', '诊断问题二?'), mk('diag-b2', 'agent', '诊断回复二。')])
  const b = await send([mk('diag-b1', 'buyer', '诊断问题二?')]) // 重复 id
  const c = await send([{ kind: 'leave', sessionKey: 'diag-session-3' }])
  const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' })
  return { probe, hasDetail, a, b, c, stats }
})
console.log(JSON.stringify(r, null, 1))

// SW 上下文直查错误表与会话行
const sw2 = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
if (sw2) {
  const extra = await sw2.evaluate(async () => {
    const errs = await globalThis.pddDb.getRecentErrors(10)
    const rows = await globalThis.pddDb.qaRecords
      .where('sessionKey')
      .equals('diag-session-3')
      .toArray()
    return {
      errors: errs.map((e) => ({ msg: e.message, ctx: JSON.stringify(e.context || {}) })),
      rows: rows.map((q) => ({ q: q.question, r: q.replyCount, ts: q.questionTs })),
    }
  })
  console.log('=== 错误表 / 会话行 ===')
  console.log(JSON.stringify(extra, null, 1))

  // 清理 diag 会话的测试数据,不污染真实库
  const cleaned = await sw2.evaluate(async () => {
    const ids = await globalThis.pddDb.qaRecords
      .filter((q) => typeof q.sessionKey === 'string' && q.sessionKey.startsWith('diag-'))
      .primaryKeys()
    if (ids.length > 0) {
      await globalThis.pddDb.replies.where('qaId').anyOf(ids).delete()
      await globalThis.pddDb.qaRecords.bulkDelete(ids)
    }
    return ids.length
  })
  console.log('已清理 diag 测试问答:', cleaned, '条')
}
await ctx.close()
process.exit(0)
