/**
 * 多答案标准回答验收(数据层,真扩展 + SW,不依赖聊天页/嵌入模型):
 *  ① 同一问题可连续设置 3 条不同答复(每条 count 递增)
 *  ② 第 4 条 → limitReached=true,不再写入
 *  ③ 重复答案 → exists=true 幂等命中(不占额度)
 *  ④ GET_PANEL_DATA 返回顺序 = 最近设置靠前(与候选排序同口径)
 *  ⑤ 取消一条后再设第 4 条 → 成功(额度释放)
 *  ⑥ 清理:删掉本轮造的标准回答,不留测试数据
 * 用法:node scripts/verify-golden-multi-2026-09-15.mjs
 */
import { chromium } from '@playwright/test'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
// 每次运行独立 profile:避免陈旧 SW 脚本缓存与 profile 锁(跑完即删)
const PROFILE = ROOT + '\\.diag-run-' + Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const Q = `多答案验收:这款支持7天无理由退换吗?${Date.now()}`
const A = (n) => `多答案验收答复 ${n}`

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
const pageErrors = []
pop.on('pageerror', (e) => pageErrors.push(String(e)))
// SW reload 后扩展页可能短暂不可达 → 重试打开
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
if (!opened) {
  console.log('FAIL: popup 打不开')
  await ctx.close()
  process.exit(1)
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

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const preg = (q) => pop.evaluate(async (q) => {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_PANEL_DATA' })
  return (resp?.payload?.goldens ?? []).filter((g) => g.question === q)
}, q)
const add = (answer) => send('ADD_GOLDEN', { question: Q, answer })
/** 用户在文件夹页看到的真实顺序:重载 popup → 文件夹页 → 按 DOM 顺序取答复序号 */
const panelOrder = async () => {
  await pop.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1500)
  await pop.locator('button[title="文件夹"]').click()
  await sleep(1200)
  return pop.evaluate(() => {
    const txt = document.body.innerText
    return [...txt.matchAll(/多答案验收答复 (\d)/g)].map((m) => Number(m[1]))
  })
}

// ── ①②③ 连续设置 3 条 + 第 4 条超限 + 重复幂等 ──
const r1 = await add(A(1))
const r2 = await add(A(2))
const r3 = await add(A(3))
check('第 1 条成功且 count=1', !!r1.id && r1.count === 1, JSON.stringify(r1))
check('第 2 条成功且 count=2', !!r2.id && r2.count === 2, JSON.stringify(r2))
check('第 3 条成功且 count=3', !!r3.id && r3.count === 3, JSON.stringify(r3))

const r4 = await add(A(4))
check('第 4 条 → limitReached(上限 3)', r4.limitReached === true && r4.count === 3, JSON.stringify(r4))
check('超限请求未写入(库里仍为 3 条)', (await preg(Q)).length === 3)

const dup = await add(A(2))
check(
  '重复答案 → exists 幂等命中(返回已有 id,不占额度)',
  dup.exists === true && dup.id === r2.id,
  JSON.stringify(dup),
)

// ── ④ 面板展示顺序 = 最近设置靠前 ──
const order1 = await panelOrder()
check('文件夹页按最近设置靠前展示(3 → 2 → 1)', order1.join(',') === '3,2,1', `order=${order1.join(',')}`)
check('同问题多条在面板上标注「同问题 3 条 · 已满」', await pop.locator('text=同问题 3 条 · 已满').count() > 0)
await pop.screenshot({ path: ROOT + '\\logs\\ui-0915-golden-multi.png' })

// ── ⑤ 取消一条后额度释放 ──
const del = await send('DELETE_GOLDEN', { id: r2.id })
check('取消标准回答返回 success', del.success === true, JSON.stringify(del))
const r5 = await add(A(5))
check('取消后再设第 4 条 → 成功(额度已释放)', !!r5.id && r5.count === 3, JSON.stringify(r5))
const after = await preg(Q)
check('取消的那条已不在库中,新条入列', !after.some((g) => g.id === r2.id) && after.some((g) => g.id === r5.id))
const order2 = await panelOrder()
check('取消+新设后,最新设置的排最前(5 → 3 → 1)', order2.join(',') === '5,3,1', `order=${order2.join(',')}`)

// ── ⑥ 清理 ──
for (const g of after) await send('DELETE_GOLDEN', { id: g.id })
check('清理完毕(该问题下无残留)', (await preg(Q)).length === 0)
check('无页面错误', pageErrors.length === 0, JSON.stringify(pageErrors))

console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await ctx.close()
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* 有残留句柄时留给下次清理 */
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
