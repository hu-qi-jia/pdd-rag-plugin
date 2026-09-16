/**
 * scripts 共享底座(2026-09-16 工程审查②):Playwright 验收脚本的公共样板。
 * 此前 28 份脚本各持一份 launchPersistentContext 样板、sleep、扩展 id 发现循环,
 * 并散落 80 处硬编码绝对路径(E:\个人项目\... / C:\Users\胡起嘉\...)——
 * 换机即全废。统一后:路径相对化(可环境变量覆盖),样板一处维护。
 */
import { chromium } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** 仓库根(scripts/ 的上一级) */
export const ROOT = path.resolve(import.meta.dirname, '..')
/** 扩展构建产物目录(pnpm build 后生成) */
export const EXT = path.join(ROOT, 'build', 'chrome-mv3-prod')
/** Chromium:默认本机 ms-playwright 缓存,可用环境变量 PDD_E2E_CHROME 覆盖 */
export const CHROME =
  process.env.PDD_E2E_CHROME ??
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
/** 真机已登录 profile(父目录,复用 cookie;DPAPI 绑定本机账户) */
export const LOGGED_IN_PROFILE = path.resolve(ROOT, '..', '.chrome-debug-profile')
/** 常驻诊断 profile(仓库内,模型缓存可复用;已 gitignore) */
export const persistentProfile = (name) => path.join(ROOT, `.diag-${name}`)
/** 一次性诊断 profile(系统临时目录,不污染仓库) */
export const freshProfile = () => mkdtempSync(path.join(tmpdir(), 'pddcs-diag-'))

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 加载扩展启动 Chromium(各脚本原有 launch 参数组的统一版) */
export async function launchExtContext(profile, { headless = false, timeout = 60000 } = {}) {
  return chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless,
    timeout,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--hide-crash-restore-bubble',
      '--no-default-browser-check',
    ],
  })
}

/** 轮询等待扩展 SW 就绪,返回扩展 id(约 10s 内);失败返回 null */
export async function findExtensionId(ctx) {
  let extId = null
  for (let i = 0; i < 10 && !extId; i++) {
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
    if (sw) extId = new URL(sw.url()).host
    if (!extId) await sleep(1000)
  }
  return extId
}

/** 打开扩展 popup 页(SW 就绪后可能仍需数秒,内置重试);失败返回 null */
export async function openPopup(ctx, extId) {
  let pop = null
  for (let i = 0; i < 12 && !pop; i++) {
    await sleep(2000)
    try {
      const p = await ctx.newPage()
      await p.goto(`chrome-extension://${extId}/popup.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      })
      pop = p
    } catch {
      /* 重试 */
    }
  }
  return pop
}
