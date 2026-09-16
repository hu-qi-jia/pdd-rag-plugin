/**
 * 捕获 SW 控制台:合成消息走完 ingest,看 segmenter/hook 内部错误
 * 用法:node scripts/diag-sw-console.mjs
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
const swLines = []
const cdp = await ctx.newBrowserCDPSession()
await cdp.send('Target.setDiscoverTargets', { discover: true })
cdp.on('Target.targetCreated', async ({ targetInfo }) => {
  if (targetInfo.type !== 'service_worker') return
  try {
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: targetInfo.id,
      flatten: true,
    })
    const s = await cdp.send('Runtime.enable', {}, sessionId)
    console.log('attached SW session')
    const onEvt = (m) => {
      if (m.sessionId === sessionId && m.method === 'Runtime.consoleAPICalled') {
        const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
        swLines.push(text)
      }
    }
    cdp.on('Runtime.consoleAPICalled', onEvt)
  } catch (e) {
    console.log('attach 失败:', String(e).slice(0, 100))
  }
})

// 等 SW 出现并已就绪
await sleep(8000)
let extId = null
for (let i = 0; i < 10 && !extId; i++) {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
  if (sw) extId = new URL(sw.url()).host
  if (!extId) await sleep(1000)
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
    sessionKey: 'diag-session-3',
    msg: { source: 'dom', role, text, msgId: id, ts: Date.now() - 60_000 },
  })
  const a = await send([mk('d3-1', 'buyer', '诊断问题三?'), mk('d3-2', 'agent', '诊断回复三。')])
  await new Promise((r) => setTimeout(r, 1500))
  const b = await send([{ kind: 'leave', sessionKey: 'diag-session-3' }])
  await new Promise((r) => setTimeout(r, 1500))
  const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' })
  return { a, b, stats: stats?.payload }
})
console.log('=== 响应 ===')
console.log(JSON.stringify(r, null, 1))
await sleep(1500)
console.log('=== SW 控制台 ===')
console.log(swLines.length ? swLines.join('\n') : '(无输出)')
await ctx.close()
process.exit(0)
