/**
 * 验收:2026-09-15 用户反馈「父文件夹支持修改文件夹名称」。
 * 功能本身一直存在(v2.6.1:悬浮铅笔钮 / 双击文件夹名),但两代入口都不可发现 ——
 * 本轮改为常驻可见。本脚本端到端验证:入口不悬浮也可见 → 点击进入改名 → 保存生效。
 * 用法:node scripts/verify-folder-rename-2026-09-15.mjs
 */
import { chromium } from '@playwright/test'
import { rmSync } from 'node:fs'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
const PROFILE = ROOT + '\\.diag-run-' + Date.now()
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
const pageErrors = []
pop.on('pageerror', (e) => pageErrors.push(String(e)))
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

// 造一个常规(根)文件夹
await send('CREATE_FOLDER', { name: '售后服务', parentId: null })
await pop.reload({ waitUntil: 'domcontentloaded' })
await sleep(1500)
await pop.locator('button[title="文件夹"]').click()
await sleep(600)

// ① 重命名钮不悬浮也可见(常驻)
const pen = pop.locator('button[title*="重命名"]').first()
const visible = await pen.isVisible()
const opacity = await pen.evaluate((el) => getComputedStyle(el.parentElement).opacity)
check('重命名入口不悬浮也可见(opacity=1)', visible && opacity === '1', `opacity=${opacity}`)

// ② 点击进入改名,输入框预填当前名
await pen.click()
await sleep(400)
const input = pop.locator('input.pddcs-input').first()
const prefilled = await input.inputValue()
check('点击后原位出现改名输入框(预填当前名)', prefilled === '售后服务', `value=${prefilled}`)

// ③ 改名并保存
await input.fill('售后服务部')
await pop.locator('button', { hasText: '保存' }).first().click()
await sleep(1200)
const bodyText = await pop.evaluate(() => document.body.innerText)
check('保存后文件夹名更新', bodyText.includes('售后服务部') && !bodyText.includes('售后服务\n'))

await pop.screenshot({ path: ROOT + '\\logs\\ui-0915-folder-rename.png' })

console.log('页面错误 =', JSON.stringify(pageErrors))
console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await ctx.close()
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* 有残留句柄时留给下次清理 */
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
