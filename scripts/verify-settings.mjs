/**
 * 设置开关落库探针:真实 popup UI 上开启"自动回复"(directFillEnabled)→ 不点任何
 * 保存按钮,直接读 chrome.storage 断言 directFillEnabled=true。
 * 复现用户反馈"直接填充开启后会自动关闭"(根因:改动只存 draft,弹窗失焦即丢)。
 * 用法:node scripts/verify-settings.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化
 * 2026-09-16 第三十轮:设置项已由原生 checkbox 改为 Toggle(label+span,无 input),
 * 定位改按 label 文本;headless 运行,不弹窗
 */
import { launchExtContext, findExtensionId, openPopup, persistentProfile, sleep } from './lib.mjs'

const PROFILE = persistentProfile('fresh-profile')

const ctx = await launchExtContext(PROFILE, { headless: true })
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
pop.on('pageerror', (e) => pageErrors.push('[PAGE_ERROR] ' + e.message))
pop.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('[console.error] ' + m.text())
})
await sleep(2500)
console.log('popup readyState:', await pop.evaluate(() => document.readyState))
console.log('popup body 子节点数:', await pop.evaluate(() => document.body.childElementCount))

// 1) 切到设置页签(页签钮可寻址名来自 title 属性)
await pop.locator('button[title="设置"]').click()
await sleep(600)

// 2) 开启「自动回复」开关 —— Toggle 是 label+onClick,但滑块 span 带
//    role="switch" + aria-label(键盘可达,设计6),按语义定位点击
const toggle = pop.getByRole('switch', { name: '自动回复' })
console.log('「自动回复」switch 数:', await toggle.count())
if ((await toggle.count()) === 0) {
  console.log('当前页文本(调试):', JSON.stringify(await pop.evaluate(() => document.body.innerText)).slice(0, 400))
  console.log('root HTML(调试):', (await pop.evaluate(() => document.getElementById('root')?.innerHTML ?? '(无 #root)')).slice(0, 300))
  console.log('页面错误(调试):', pageErrors.length ? pageErrors.join('\n') : '(无)')
}
await toggle.click()
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
