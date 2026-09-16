/**
 * 商店素材截图(2026-09-17 第四十七轮):Edge/Chrome 商店提交用。
 * popup 根元素(420×560)居中到 1280×800 视口(Edge 商店截图标准尺寸),
 * 浅色/深色各一张。纯 Playwright,零后处理依赖。
 * 产物:docs/distribution/shots/screenshot-{light,dark}-1280x800.png
 * 注意:这是**交付物生成**(商店上架材料),与「验证不截图」惯例不冲突。
 * 用法:node scripts/make-store-shots.mjs
 */
import { launchExtContext, findExtensionId, openPopup, freshProfile, sleep, ROOT } from './lib.mjs'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const OUT_DIR = path.join(ROOT, 'docs', 'distribution', 'shots')
mkdirSync(OUT_DIR, { recursive: true })

/** 把 body 布成 1280×800 居中画布,popup 落在正中(商店标准尺寸一次成型) */
async function stageAndShoot(page, backdrop, file) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.evaluate((bg) => {
    const b = document.body
    b.style.margin = '0'
    b.style.minHeight = '100vh'
    b.style.display = 'grid'
    b.style.placeItems = 'center'
    b.style.background = bg
    const root = document.getElementById('__plasmo')
    if (root) root.style.width = 'fit-content'
  }, backdrop)
  await sleep(400)
  await page.screenshot({ path: path.join(OUT_DIR, file) })
  console.log(`shot ${file}`)
}

const ctx = await launchExtContext(freshProfile())
await sleep(3000)
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
await sleep(2000)

await stageAndShoot(pop, '#e8eaed', 'screenshot-light-1280x800.png')

// 切深色(导航栏最底按钮 title=切换深色)再截一张
const darkBtn = pop.locator('button[title="切换深色"]')
if ((await darkBtn.count()) > 0) {
  await darkBtn.click()
  await sleep(800)
  await stageAndShoot(pop, '#141517', 'screenshot-dark-1280x800.png')
} else {
  console.log('未找到深色切换钮,跳过深色截图')
}

await ctx.close()
console.log('DONE')
