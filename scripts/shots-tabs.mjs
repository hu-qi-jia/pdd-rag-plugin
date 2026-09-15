/**
 * 四页签 × 亮/暗色 的界面截图(设计评审与暗色排查用):
 * 造一份贴近真实的样本库(多文件夹/多答案标准回答/知识条目/问答),逐页签截图。
 * 用法:node scripts/shots-tabs.mjs [before|after]
 * 产物:logs/ui-0915-<tag>-<tab>-<theme>.png
 */
import { chromium } from '@playwright/test'
import { rmSync } from 'node:fs'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
const PROFILE = ROOT + '\\.diag-run-' + Date.now()
const TAG = process.argv[2] ?? 'shot'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
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
let extId = null
for (let i = 0; i < 10 && !extId; i++) {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
  if (sw) extId = new URL(sw.url()).host
  if (!extId) await sleep(1000)
}
if (!extId) {
  console.log('FAIL: 扩展未加载')
  await ctx.close()
  process.exit(1)
}

const pop = await ctx.newPage()
await pop.setViewportSize({ width: 460, height: 620 })
let opened = false
for (let i = 0; i < 12 && !opened; i++) {
  try {
    await pop.goto(`chrome-extension://${extId}/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })
    opened = true
  } catch {
    await sleep(2000)
  }
}
await sleep(1500)

const send = (type, payload) =>
  pop.evaluate(
    async ({ type, payload }) => {
      const resp = await chrome.runtime.sendMessage({ type, payload })
      return resp?.payload ?? {}
    },
    { type, payload },
  )

// ── 造样本数据 ──
// 填充问答 105 条(验证 PM2 分页:记忆页应出现"加载更早(已显示 100/107 条)")
for (let i = 1; i <= 105; i++) {
  await send('PDD_INGEST', {
    events: [
      {
        kind: 'msg',
        sessionKey: `shot-fill-${i}`,
        msg: {
          source: 'dom',
          role: 'buyer',
          text: `第 ${i} 条:请问这个手机壳有 iPhone 15 的型号吗?颜色有哪些?`,
          msgId: `s-fill-${i}`,
          ts: Date.now() - (200 + i) * 60_000,
        },
      },
      { kind: 'leave', sessionKey: `shot-fill-${i}` },
    ],
  })
}

await send('PDD_INGEST', {
  events: [
    {
      kind: 'msg',
      sessionKey: 'shot-sess',
      msg: { source: 'dom', role: 'buyer', text: '这款大疆 Mic Mini 续航多久?户外收音清楚吗?', msgId: 's-b1', ts: Date.now() - 3_600_000 },
    },
    {
      kind: 'msg',
      sessionKey: 'shot-sess',
      msg: { source: 'dom', role: 'agent', text: '亲,发射器约10克超轻巧,搭配充电盒续航约48小时,强弱两挡降噪,户外室内都清晰哒~', msgId: 's-a1', ts: Date.now() - 3_500_000 },
    },
    {
      kind: 'msg',
      sessionKey: 'shot-sess',
      msg: { source: 'dom', role: 'agent', text: '另外支持7天无理由退换,请放心下单。', msgId: 's-a2', ts: Date.now() - 3_400_000 },
    },
    { kind: 'leave', sessionKey: 'shot-sess' },
  ],
})
await sleep(1200)

const f1 = await send('CREATE_FOLDER', { name: '售前咨询', parentId: null })
const f2 = await send('CREATE_FOLDER', { name: '售后处理', parentId: null })
if (f1.id) await send('CREATE_FOLDER', { name: '退换货', parentId: f1.id })

// 主问题:同题 3 条标准回答(触发「同问题 n 条」标注)
const Q = '这款大疆 DJI Mic Mini 的续航和收音怎么样?'
await send('ADD_GOLDEN', { question: Q, answer: '发射器约10克超轻巧,充电盒总续航约48小时,强弱两挡降噪。' })
await send('ADD_GOLDEN', { question: Q, answer: '续航:发射器单次约4.5小时,配充电盒共约48小时;收音有强弱两挡降噪,户外也清晰。' })
const g3 = await send('ADD_GOLDEN', { question: Q, answer: '主推卖点:约10克超轻、48小时总续航、双挡降噪,日常拍摄够用。' })
const gOther = await send('ADD_GOLDEN', { question: '支持7天无理由退换吗?', answer: '支持7天无理由退换,运费我们承担,请放心下单。' })
const gShip = await send('ADD_GOLDEN', { question: '什么时候发货?', answer: '现货 48 小时内发出,节假日顺延,发圆通/中通。' })
if (gOther.id) await send('UPDATE_GOLDEN', { id: gOther.id, folderId: f1.id })
if (gShip.id) await send('UPDATE_GOLDEN', { id: gShip.id, folderId: f2.id })
if (g3.id) await send('UPDATE_GOLDEN', { id: g3.id, folderId: f1.id })

await send('CREATE_KB', { title: '退货政策', content: '支持 7 天无理由退换,商品需保持完好,运费由我方承担。' })
await send('CREATE_KB', { title: '发票说明', content: '默认开具电子发票,下单备注抬头与税号,3 个工作日内发出。' })
await sleep(1500)

// ── 逐页签 × 亮/暗色截图 ──
const TABS = [
  ['memory', '记忆'],
  ['folders', '文件夹'],
  ['knowledge', '知识库'],
  ['settings', '设置'],
]
for (const theme of ['light', 'dark']) {
  await pop.evaluate(async (t) => {
    await chrome.storage.local.set({ 'pddcs:theme': t })
    localStorage.setItem('pddcs:theme', t)
  }, theme)
  await pop.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1500)
  for (const [id, label] of TABS) {
    await pop.locator(`button[title="${label}"]`).click()
    await sleep(700)
    await pop.screenshot({ path: `${ROOT}\\logs\\ui-0915-${TAG}-${id}-${theme}.png`, clip: { x: 0, y: 0, width: 460, height: 620 } })
  }
  console.log(`${theme} 四页签截图完成`)
}

// ── 附加:记忆页滚动到底,验证 PM2「加载更早」入口(浅色)──
await pop.evaluate(async (t) => {
  await chrome.storage.local.set({ 'pddcs:theme': t })
  localStorage.setItem('pddcs:theme', t)
}, 'light')
await pop.reload({ waitUntil: 'domcontentloaded' })
await sleep(1500)
await pop.locator('button[title="记忆"]').click()
await sleep(600)
await pop.evaluate(() => {
  const el = document.querySelector('.pddcs-scroll')
  if (el) el.scrollTop = el.scrollHeight
})
await sleep(400)
await pop.screenshot({
  path: `${ROOT}\\logs\\ui-0915-${TAG}-memory-paged-light.png`,
  clip: { x: 0, y: 0, width: 460, height: 620 },
})
console.log('记忆页分页入口截图完成')

// ── 附加:设置页滚动到"存储"卡(PM6a)──
await pop.locator('button[title="设置"]').click()
await sleep(600)
await pop.evaluate(() => {
  const el = document.querySelector('.pddcs-scroll')
  if (el) el.scrollTop = el.scrollHeight
})
await sleep(400)
await pop.screenshot({
  path: `${ROOT}\\logs\\ui-0915-${TAG}-settings-storage-light.png`,
  clip: { x: 0, y: 0, width: 460, height: 620 },
})
console.log('设置页存储卡截图完成')

await ctx.close()
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* 忽略 */
}
process.exit(0)
