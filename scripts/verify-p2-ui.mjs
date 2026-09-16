/**
 * P2-4 真机端到端验收:AI 按钮 → 检索 → 填充/弹窗(绝不发送)
 *  1. 按钮渲染:可见买家行出现 .pddcs-ai-btn
 *  2. 点击按钮 → toast/弹窗/textarea 三者必有其一
 *  3. 不自动发送:填充前后消息行数不变
 * 用法:node scripts/verify-p2-ui.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化
 */
import { launchExtContext, LOGGED_IN_PROFILE, sleep } from './lib.mjs'

const PROFILE = LOGGED_IN_PROFILE

const ctx = await launchExtContext(PROFILE)
await sleep(5000)
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(8000)

for (const c of ['E***E', '眼睛的店铺']) {
  try {
    await page.getByText(c, { exact: false }).first().click({ timeout: 4000 })
    console.log('已点击会话:', c)
    break
  } catch {
    /* 下一个 */
  }
}

// 1) 等按钮出现
let btnCount = 0
for (let i = 0; i < 20; i++) {
  btnCount = await page.locator('.pddcs-ai-btn').count()
  if (btnCount > 0) break
  await sleep(1000)
}
console.log('AI 按钮数:', btnCount)

const result = { btnCount, filled: false, popupCount: 0, toast: '', rowsBefore: 0, rowsAfter: 0, inputAfter: '' }
if (btnCount > 0) {
  result.rowsBefore = await page.locator('#msgListContainer li.onemsg').count()
  // 2) 点最后一个按钮(最新消息)
  await page.locator('.pddcs-ai-btn').last().click()
  // 等检索完成(模型加载可能要几秒)
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    result.toast = await page
      .locator('.pddcs-toast.show')
      .first()
      .textContent()
      .catch(() => '')
    result.popupCount = await page.locator('.pddcs-popup').count()
    result.inputAfter = await page
      .locator('#replyTextarea')
      .inputValue()
      .catch(() => '')
    if (result.toast || result.popupCount > 0 || result.inputAfter) break
  }
  result.filled = (result.inputAfter ?? '').length > 0
  // 3) 弹窗出现 → 点第一个候选 → 应填充输入框(仍不发送)
  if (result.popupCount > 0) {
    await page.locator('.pddcs-popup .pddcs-cand').first().click()
    await sleep(800)
    result.inputAfter = await page.locator('#replyTextarea').inputValue().catch(() => '')
    result.filled = (result.inputAfter ?? '').length > 0
    result.toast = await page.locator('.pddcs-toast.show').first().textContent().catch(() => '')
  }
  result.rowsAfter = await page.locator('#msgListContainer li.onemsg').count()
  // 清空输入框(原生 setter,绝不点发送)
  await page.evaluate(() => {
    const el = document.querySelector('#replyTextarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const cleared = await page.locator('#replyTextarea').inputValue()
  console.log('已清空输入框:', cleared === '')
  // 弹窗候选明细
  if (result.popupCount > 0) {
    const cands = await page.locator('.pddcs-popup .pddcs-cand').count()
    console.log('弹窗候选数:', cands)
  }
}
console.log(JSON.stringify(result, null, 1))
console.log('消息行数前后一致(未自动发送):', result.rowsBefore === result.rowsAfter)

await ctx.close()
process.exit(0)
