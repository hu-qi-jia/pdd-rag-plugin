/**
 * 设置开关落库探针:真实 popup UI 上勾选"直接填充"→ 不点任何保存按钮,
 * 直接读 chrome.storage 断言 directFillEnabled=true。
 * 复现用户反馈"直接填充开启后会自动关闭"(根因:改动只存 draft,弹窗失焦即丢)。
 * 用法:node scripts/verify-settings.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化
 */
import { launchExtContext, findExtensionId, openPopup, persistentProfile, sleep } from './lib.mjs'

const PROFILE = persistentProfile('fresh-profile')

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
await sleep(1200)

// 1) 切到设置页签
await pop.getByRole('button', { name: '设置', exact: true }).click()
await sleep(600)

// 2) 勾选"直接填充"(检索与填充卡里第一个 checkbox),不点任何保存按钮
const toggles = pop.locator('input[type="checkbox"]')
console.log('checkbox 数:', await toggles.count())
await toggles.nth(0).check()
await sleep(800) // 等自动保存(若实现)

// 3) 直接读 storage + GET_STATS 双重验证
const stored = await pop.evaluate(
  () =>
    new Promise((res) => chrome.storage.local.get(['pddcs:settings'], (items) => res(items['pddcs:settings']))),
)
const stats = await pop.evaluate(
  async () =>
    (await chrome.runtime.sendMessage({ type: 'GET_STATS' }))?.payload?.settings,
)
console.log('storage.directFillEnabled:', stored?.directFillEnabled)
console.log('GET_STATS.directFillEnabled:', stats?.directFillEnabled)

const ok = stored?.directFillEnabled === true && stats?.directFillEnabled === true
console.log(ok ? 'PASS: 开关即时落库' : 'FAIL: 勾选未落库(复现"开了又自动关")')

// 清理:还原为 false
await pop.evaluate(
  () =>
    new Promise((res) => {
      chrome.storage.local.get(['pddcs:settings'], (items) => {
        const s = items['pddcs:settings'] ?? {}
        s.directFillEnabled = false
        chrome.storage.local.set({ 'pddcs:settings': s }, () => res(true))
      })
    }),
)
await ctx.close()
process.exit(ok ? 0 : 1)
