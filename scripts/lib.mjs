/**
 * scripts 共享底座(2026-09-16 工程审查②):Playwright 验收脚本的公共样板。
 * 此前 28 份脚本各持一份 launchPersistentContext 样板、sleep、扩展 id 发现循环,
 * 并散落 80 处硬编码绝对路径(E:\个人项目\... / C:\Users\胡起嘉\...)——
 * 换机即全废。统一后:路径相对化(可环境变量覆盖),样板一处维护。
 */
import { chromium } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** 仓库根(scripts/ 的上一级) */
export const ROOT = path.resolve(import.meta.dirname, '..')
/** 扩展构建产物目录(pnpm build 后生成) */
export const EXT = path.join(ROOT, 'build', 'chrome-mv3-prod')
/** Chromium 可执行文件:仅当设 PDD_E2E_CHROME 时显式指定(真机联调/特殊浏览器);
 *  默认 null → Playwright 自带注册表解析(本机缓存与 CI 同机制,不再硬编码绝对路径) */
export const CHROME = process.env.PDD_E2E_CHROME ?? null
/** 真机已登录 profile(父目录,复用 cookie;DPAPI 绑定本机账户) */
export const LOGGED_IN_PROFILE = path.resolve(ROOT, '..', '.chrome-debug-profile')
/** 常驻诊断 profile(仓库内,模型缓存可复用;已 gitignore) */
export const persistentProfile = (name) => path.join(ROOT, `.diag-${name}`)
/** 一次性诊断 profile(系统临时目录,不污染仓库) */
export const freshProfile = () => mkdtempSync(path.join(tmpdir(), 'pddcs-diag-'))

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 产物自检:模型必须在包里,否则整条检索链路必死。
 *
 * 第四十七轮实证「Plasmo 0.90 不复制 public/」,模型靠 `npm run build` 里的
 * `&& node scripts/model.mjs copy` 落地 —— 直接跑 `plasmo build` 会产出一个**没有模型的包**,
 * 后果不是构建报错,而是 30 秒后在某一步检索里抛「本地模型加载失败(文件缺失或损坏)」,
 * 把人往"重装扩展""模型损坏"的方向带。这里提前到 0 秒、并且直接说清怎么修。
 */
export function assertModelBundled() {
  const probe = path.join(EXT, 'model', 'Xenova', 'bge-small-zh-v1.5', 'tokenizer.json')
  if (existsSync(probe)) return
  console.error(
    `FAIL: 产物里没有模型 —— ${probe} 不存在。\n` +
      `      多半是直接跑了 \`plasmo build\`。请改用 \`npm run build\`\n` +
      `      (它多一步 \`node scripts/model.mjs copy\`,Plasmo 不会自己复制 public/)。`,
  )
  process.exit(1)
}

/**
 * 加载扩展启动 Chromium(各脚本原有 launch 参数组的统一版)。
 * headless 缺省 false(本地有桌面, headed 观感接近真机);CI 无 X server,
 * 设 PDD_E2E_HEADLESS=1 走无头(channel 'chromium' 新无头模式支持扩展)。
 */
export async function launchExtContext(profile, options = {}) {
  // 唯一入口,所有验收脚本都从这里过 —— 缺模型的包在这里拦下,别等到检索那一步才炸
  assertModelBundled()
  const headless = options.headless ?? process.env.PDD_E2E_HEADLESS === '1'
  const { timeout = 60000 } = options
  return chromium.launchPersistentContext(profile, {
    // 指定 PDD_E2E_CHROME 用之;否则 channel: 'chromium'(完整 chromium,新无头模式,
    // 支持 --load-extension——默认的 headless shell 不加载扩展)
    ...(CHROME ? { executablePath: CHROME } : { channel: 'chromium' }),
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
