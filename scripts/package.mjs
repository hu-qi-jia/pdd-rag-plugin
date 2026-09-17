/**
 * 发布包:把 `build/chrome-mv3-prod` 打成 `pdd-cs-quick-reply-v<版本>.zip` —— 离线分发的唯一产物
 * (docs/specs/2026-09-16-distribution-design.md §3.3)。
 *
 * 打包前先验三件事。每一件出问题在用户那边都只表现为"装了但不好用",而这里的报错是当场可见的:
 *   ① **产物版本 = package.json 版本** —— 裸跑 `plasmo build` 之后改了版本、忘了重建,最会在这里露馅;
 *   ② **内置模型真在产物里** —— `model/` 缺了扩展照样能装能跑,只是检索永远是空的(静默失效,
 *      用户此前踩过一次:裸跑 plasmo build 的包没有模型)。`npm run build` 里的 model.mjs copy 负责这一步;
 *   ③ **解压出来就是一个 `chrome-mv3-prod` 目录** —— README 与 release 说明都写着"选择解压出的
 *      chrome-mv3-prod 文件夹";v0.11.0 那个包把文件摊在压缩包根上,用户照说明去找是找不到的。
 *
 * 用法:`node scripts/package.mjs`(走 Windows 自带的 PowerShell 压缩,不引入新依赖)
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'build', 'chrome-mv3-prod')
/** 内置模型的必备文件(缺任一 ⇒ 首跑要联网下载或直接失效) */
const MODEL_FILES = [
  'model/Xenova/bge-small-zh-v1.5/config.json',
  'model/Xenova/bge-small-zh-v1.5/tokenizer.json',
  'model/Xenova/bge-small-zh-v1.5/onnx/model_quantized.onnx',
]

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const ZIP = path.join(ROOT, `pdd-cs-quick-reply-v${version}.zip`)

// ① 产物必须是本次构建的
if (!existsSync(path.join(DIST, 'manifest.json'))) fail('没有产物:先跑 npm run build')
const distVersion = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8')).version
if (distVersion !== version) {
  fail(`产物版本 ${distVersion} ≠ package.json ${version} —— 先跑 npm run build 重建`)
}
// ② 模型在产物里
const missing = MODEL_FILES.filter((f) => !existsSync(path.join(DIST, f)))
if (missing.length) fail(`产物缺内置模型:${missing.join(' / ')} —— 先跑 npm run build(它带 model.mjs copy)`)

// PowerShell 7 优先,退回 Windows PowerShell 5.1(两者都有 Compress-Archive)
const ps =
  ['pwsh', 'powershell'].find((exe) => {
    try {
      execFileSync(exe, ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }) ?? fail('找不到 PowerShell,无法压缩')
const psRun = (script) =>
  execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })

// 压缩:整目录喂进去 ⇒ 包内保留 chrome-mv3-prod/ 这一层(③)
psRun(
  `Compress-Archive -LiteralPath '${DIST}' -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`,
)
// 时间戳归一:目录条目取的是"压缩那一刻",于是**同一份产物每次打出来的包都不一样**
// (实测连跑两次 sha256 就变了)—— 发布说明里那个校验和对不上任何一次重建,等于没有。
// 归一到 DOS 时间能表示的最小值(1980-01-01 本地时间):同一个产物目录 ⇒ 同一个包。
psRun(
  [
    'try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch {}',
    `$z = [System.IO.Compression.ZipFile]::Open('${ZIP}', 'Update')`,
    'foreach ($e in $z.Entries) { $e.LastWriteTime = [datetime]::new(1980, 1, 1, 0, 0, 0) }',
    '$z.Dispose()',
  ].join('; '),
)

// 回读压缩包中央目录核对 —— 只认包内实际有什么,不认"应该有什么"
const entries = psRun(
  [
    'try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch {}',
    `$z = [System.IO.Compression.ZipFile]::OpenRead('${ZIP}')`,
    '$z.Entries | ForEach-Object { $_.FullName }',
    '$z.Dispose()',
  ].join('; '),
)
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)

const bad = []
if (!entries.includes('chrome-mv3-prod/manifest.json')) bad.push('包内没有 chrome-mv3-prod/ 顶层目录')
for (const f of MODEL_FILES) if (!entries.includes(`chrome-mv3-prod/${f}`)) bad.push(`包内缺 ${f}`)
const backslashes = entries.filter((e) => e.includes('\\'))
if (backslashes.length) bad.push(`条目名用了反斜杠(非标准 zip):${backslashes[0]}`)
if (bad.length) fail(`压缩包不合格 —— ${bad.join(';')}`)

const bytes = statSync(ZIP).size
const sha = createHash('sha256').update(readFileSync(ZIP)).digest('hex')
console.log(`✓ ${path.basename(ZIP)}`)
console.log(`  ${entries.length} 个条目 · ${(bytes / 1024 / 1024).toFixed(1)} MB · sha256 ${sha.slice(0, 16)}…`)
console.log(`  解压后直接加载 chrome-mv3-prod/ 目录;上传:gh release upload v${version} <zip>`)
