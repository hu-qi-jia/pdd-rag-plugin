/**
 * 多答案标准回答验收(数据层,真扩展 + SW,不依赖聊天页/嵌入模型):
 *  ① 同一问题可连续设置 3 条不同答复(每条 count 递增)
 *  ② 第 4 条 → limitReached=true,不再写入
 *  ③ 重复答案 → exists=true 幂等命中(不占额度)
 *  ④ GET_PANEL_DATA 返回顺序 = 最近设置靠前(与候选排序同口径)
 *  ⑤ 取消一条后再设第 4 条 → 成功(额度释放)
 *  ⑥ 清理:删掉本轮造的标准回答,不留测试数据
 * 用法:node scripts/verify-golden-multi.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化
 */
import { launchExtContext, findExtensionId, openPopup, freshProfile, ROOT, sleep } from './lib.mjs'
import { rmSync } from 'node:fs'
import path from 'node:path'

// 每次运行独立 profile:避免陈旧 SW 脚本缓存与 profile 锁(跑完即删)
const PROFILE = freshProfile()

const Q = `多答案验收:这款支持7天无理由退换吗?${Date.now()}`
const A = (n) => `多答案验收答复 ${n}`

const ctx = await launchExtContext(PROFILE)
await sleep(5000)
const extId = await findExtensionId(ctx)
if (!extId) {
  console.log('FAIL: 扩展未加载')
  await ctx.close()
  process.exit(1)
}

const pop = await openPopup(ctx, extId)
if (!pop) {
  console.log('FAIL: popup 打不开')
  await ctx.close()
  process.exit(1)
}
const pageErrors = []
pop.on('pageerror', (e) => pageErrors.push(String(e)))
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
await pop.screenshot({ path: path.join(ROOT, 'logs', 'ui-0915-golden-multi.png') })

// ── ⑤ 取消一条后额度释放 ──
const del = await send('DELETE_GOLDEN', { id: r2.id })
check('取消标准回答返回 success', del.success === true, JSON.stringify(del))
const r5 = await add(A(5))
check('取消后再设第 4 条 → 成功(额度已释放)', !!r5.id && r5.count === 3, JSON.stringify(r5))
const after = await preg(Q)
check('取消的那条已不在库中,新条入列', !after.some((g) => g.id === r2.id) && after.some((g) => g.id === r5.id))
const order2 = await panelOrder()
check('取消+新设后,最新设置的排最前(5 → 3 → 1)', order2.join(',') === '5,3,1', `order=${order2.join(',')}`)

// ── ⑥ 结构:文件夹优先于内容(2026-09-15 文件夹页重设计)──
const rootF = await send('CREATE_FOLDER', { name: '结构验收根夹', parentId: null })
const childF = await send('CREATE_FOLDER', { name: '结构验收子夹', parentId: rootF.id })
// 用独立问题,避免撞上上面那个问题的 3 条上限
const gStruct = await send('ADD_GOLDEN', { question: '结构验收:换个问题问一次?', answer: '结构验收答复' })
const moved = await send('UPDATE_GOLDEN', { id: gStruct.id, folderId: rootF.id })
check('搬家成功(结构验收用标准回答已入根夹)', moved.id === gStruct.id, JSON.stringify(moved))
await pop.reload({ waitUntil: 'domcontentloaded' })
await sleep(1500)
await pop.locator('button[title="文件夹"]').click()
await sleep(1200)
const rel = await pop.evaluate(() => {
  const headers = [...document.querySelectorAll('.pddcs-row')]
  const head = headers.find((el) => (el.textContent || '').includes('结构验收根夹'))
  const box = head && head.parentElement
  const t = box?.innerText ?? ''
  return { childIdx: t.indexOf('结构验收子夹'), answerIdx: t.indexOf('结构验收答复') }
})
check(
  '子文件夹排在父夹标准回答之前(文件夹优先于内容)',
  rel.childIdx >= 0 && rel.answerIdx >= 0 && rel.childIdx < rel.answerIdx,
  JSON.stringify(rel),
)

// ── ⑦ 清理 ──
for (const g of after) await send('DELETE_GOLDEN', { id: g.id })
check('清理完毕(该问题下无残留)', (await preg(Q)).length === 0)
await send('DELETE_GOLDEN', { id: gStruct.id })
await send('DELETE_FOLDER', { id: childF.id })
await send('DELETE_FOLDER', { id: rootF.id })
check('结构验收文件夹已清理', !(await pop.evaluate(async () => {
  const r = await chrome.runtime.sendMessage({ type: 'GET_PANEL_DATA' })
  return (r?.payload?.folders ?? []).some((f) => String(f.name).startsWith('结构验收'))
})))
check('无页面错误', pageErrors.length === 0, JSON.stringify(pageErrors))

console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await ctx.close()
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* 有残留句柄时留给下次清理 */
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
