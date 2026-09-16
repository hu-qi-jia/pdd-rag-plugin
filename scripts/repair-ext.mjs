/**
 * 修复登录态 profile 中扩展被标记损坏/禁用的问题:
 *  1) 打开 chrome://extensions,读扩展状态(state / disable_reasons / path)
 *  2) 若禁用 → setEnabled(true);无论何种状态 → developerPrivate.reload 强制重载
 *  3) 验证 SW 是否出现
 * 用法:node scripts/repair-ext.mjs
 * 2026-09-16 工程审查②:样板抽至 lib.mjs,路径相对化(修复逻辑与样板差异大,仅换路径常量)
 */
import { chromium } from '@playwright/test'
import { CHROME, EXT, LOGGED_IN_PROFILE, sleep } from './lib.mjs'

const PROFILE = LOGGED_IN_PROFILE

console.log('launching...')
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: false,
  timeout: 60000,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--hide-crash-restore-bubble',
    '--no-default-browser-check',
  ],
})
console.log('launched')
await sleep(6000)
console.log('启动后 SW 数:', ctx.serviceWorkers().length, ctx.serviceWorkers().map((w) => w.url()))

const page = await ctx.newPage()
await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(2500)

const info = await page.evaluate(async () => {
  const infos = await new Promise((res) => chrome.developerPrivate.getExtensionsInfo(res))
  return infos
    .filter((e) => e.location === 'UNPACKED' || (e.path || '').includes('chrome-mv3'))
    .map((e) => ({
      id: e.id,
      name: e.name,
      state: e.state,
      disableReasons: e.disableReasons,
      path: e.path,
      version: e.version,
      runtimeErrors: (e.runtimeErrors || []).slice(0, 3).map((x) => x.message),
      installWarnings: (e.installWarnings || []).slice(0, 3),
      manifestErrors: (e.manifestErrors || []).slice(0, 3).map((x) => x.message),
    }))
})
console.log('扩展状态:', JSON.stringify(info, null, 1))

for (const e of info) {
  if (!e.path.includes('chrome-mv3')) continue
  if (e.state !== 'ENABLED') {
    console.log('尝试启用:', e.id)
    await page.evaluate(
      (id) => new Promise((res) => chrome.developerPrivate.updateExtensionConfiguration({
        extensionId: id,
        enabled: true,
      }, res)).catch(() => null),
      e.id,
    )
    // 备用通道:management.setEnabled
    await page.evaluate(
      (id) => new Promise((res) => chrome.management.setEnabled(id, true, res)),
      e.id,
    ).catch((err) => console.log('management.setEnabled 失败:', String(err).slice(0, 120)))
  }
  console.log('reload:', e.id)
  await page.evaluate(
    (id) => new Promise((res, rej) => chrome.developerPrivate.reload(id, { failQuietly: false, populateErrorForUnpacked: true }, () => {
      const err = chrome.runtime.lastError
      err ? rej(new Error(err.message)) : res()
    })),
    e.id,
  ).catch((err) => console.log('reload 报错:', String(err).slice(0, 200)))
}

await sleep(4000)
const sws = ctx.serviceWorkers().map((w) => w.url())
console.log('修复后 SW 数:', sws.length, sws)
await page.close()
await ctx.close()
process.exit(0)
