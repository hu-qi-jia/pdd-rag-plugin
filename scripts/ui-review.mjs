/**
 * 稳定 UI 验收入口。
 *
 * Computer Use 在部分 Chrome 版本上无法读取浏览器 URL，从而拒绝采集截图。
 * 本脚本不依赖 Windows UI Automation：用隔离的 Playwright Chromium 加载构建产物，
 * 直接读取 page.url()，打开 popup 的指定页签并保存截图。
 */
import path from 'node:path'
import {
  ROOT,
  findExtensionId,
  freshProfile,
  launchExtContext,
  openPopup,
} from './lib.mjs'

const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const tab = valueAfter('--tab', 'settings')
const headed = args.includes('--headed')
const dark = args.includes('--dark')
const validTabs = {
  memory: '记忆',
  standards: '标准回答',
  knowledge: '知识库',
  settings: '设置',
}

if (!validTabs[tab]) {
  console.error(`Unknown tab "${tab}". Use one of: ${Object.keys(validTabs).join(', ')}`)
  process.exit(2)
}

const ctx = await launchExtContext(freshProfile(), { headless: !headed })
try {
  const extensionId = await findExtensionId(ctx)
  if (!extensionId) throw new Error('Extension service worker not found')

  const page = await openPopup(ctx, extensionId)
  if (!page) throw new Error('Extension popup did not open')

  console.log(`URL: ${page.url()}`)
  await page.getByRole('button', { name: validTabs[tab] }).click()
  await page.waitForTimeout(250)

  if (dark) {
    const toggle = page.getByRole('button', { name: '切换深色主题' })
    if (await toggle.isVisible()) {
      await toggle.click()
      await page.waitForTimeout(150)
    }
  }

  const suffix = dark ? '-dark' : ''
  const output = path.join(ROOT, 'build', `ui-${tab}${suffix}.png`)
  await page.screenshot({ path: output })
  console.log(`Screenshot: ${output}`)
  console.log(`Title: ${await page.title()}`)
} finally {
  await ctx.close()
}
