/**
 * 一键发布:`构建 → 打包 → 建 GitHub Release` —— 把这条链收成一条命令,是因为三段里漏掉任何一段,
 * 产出的都是"看起来发布了"的坏结果:漏 `npm run build` ⇒ 包里是旧代码;绕过 `package.mjs` ⇒
 * 没有它的三条自检(版本不符 / 内置模型缺失 / 解压出来不是 chrome-mv3-prod 目录,每一个在用户那边
 * 都只表现为"装了但不好用");版本与 tag 对不上 ⇒ 用户下到的和说明写的不是一个东西。
 *
 * **两道闸门**(只在真发布时拦,dry-run 只警告):
 *   ① 工作区干净 ② 无未推送提交 —— release 的 tag 指向远端分支的提交,而 zip 是**本地工作区**构建的;
 *   两者不一致时,用户下载的包和 GitHub 上那份代码对不上,而且**事后无法从 tag 重建成同一个包**。
 *   推送不放在脚本里:push 是另一个外发动作,且本机 push 需走代理而 gh 直连可用(2026-09-17 实测),
 *   混在一起只会让人搞不清是哪一步需要代理。
 *
 * **说明正文**:优先 `docs/release-notes/v<版本>.md`(面向用户、可反复修);
 * 没有就退回 `CHANGELOG.md` 该版本段落并**明确警告**——那是内部口径(带轮次、"验收"这类字眼)。
 * 正文首行的 `# 标题` 抽出来当 release 标题(不写就是 `v<版本>`);
 * 末尾的 `sha256: …` 行由本脚本按**本次实测值**替换或追加,不用手写(手写的必然对不上某次重建)。
 *
 * 联网:脚本原样透传环境变量 —— 本机 `gh` 直连可用;若要代理,`HTTPS_PROXY=… npm run release` 即可。
 * 测试**不**在这里跑:push 之后 CI 会跑 tsc + 单测 + 数据层 e2e;发布前想本地过一遍就 `npm test`。
 *
 * 用法:
 *   npm run release                    # 开发方式:构建 + 打包 + 建 release(tag 指向远端分支 HEAD)
 *   node scripts/release.mjs --dry-run # 只构建+打包,打印将执行的 gh 命令与正文,不联网、不改任何远端状态
 *   node scripts/release.mjs --update  # release 已存在时:改说明 + `--clobber` 重传资产(下载计数归零)
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const UPDATE = argv.includes('--update')

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const say = (msg) => console.log(msg)

/**
 * 走 shell 而不是 execFile:Windows 上 `npm` 是 `npm.cmd`,而 Node 20 起 execFile 不许直接跑
 * .cmd/.bat(CVE-2024-27980 的修复)—— 同一条路也让 `gh` 是 exe 还是 scoop 那种 .cmd 垫片都能用。
 * 代价是得自己加引号:本项目路径无空格,但别人/CI 的路径未必。
 */
const quote = (s) => (/[\s"^&|<>]/.test(s) ? `"${s}"` : s)
const run = (cmd, args, opts = {}) =>
  execSync([cmd, ...args.map(quote)].join(' '), { cwd: ROOT, encoding: 'utf8', ...opts })

const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const TAG = `v${version}`
const ZIP = path.join(ROOT, `pdd-cs-quick-reply-v${version}.zip`)
const NOTES_SRC = path.join(ROOT, 'docs', 'release-notes', `${TAG}.md`)
const NOTES_OUT = path.join(ROOT, 'build', `release-notes-${TAG}.md`)

// ── 闸门:工作区与推送状态 ────────────────────────────────────────────────
say(`▶ 发布 ${TAG}(package.json 版本)`)
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
const dirty = run('git', ['status', '--porcelain']).trim()
let ahead = null
try {
  ahead = Number(run('git', ['rev-list', '--count', `origin/${branch}..HEAD`]).trim())
} catch {
  ahead = null // 没有 origin/<branch> 这个跟踪 ref(还没 push 过,或不是克隆来的)
}
const blockers = []
if (dirty) blockers.push(`工作区有未提交改动:\n${dirty.split('\n').map((l) => `    ${l}`).join('\n')}`)
if (ahead === null) blockers.push(`本地没有 origin/${branch} 跟踪分支,无法确认代码已推送`)
else if (ahead > 0) blockers.push(`有 ${ahead} 个提交没推到 origin/${branch}`)
if (blockers.length) {
  const detail = blockers.map((b) => `  ${b}`).join('\n')
  const why =
    'release 的 tag 指向远端分支的提交,而 zip 是本地工作区构建的 —— 两者不一致时,用户下载的包' +
    '和 GitHub 上那份代码对不上,事后也无法从 tag 重建成同一个包。\n  ' +
    '先提交并推送:git add -A && git commit && git push(直连不通时见 README 的代理说明)'
  if (DRY) console.warn(`⚠ 以下问题会让真发布在这里中止(dry-run 继续):\n${detail}`)
  else fail(`${detail}\n  ${why}`)
}

// ── 1/3 构建 ────────────────────────────────────────────────────────────
say('▶ 1/3 构建(npm run build;含 model.mjs copy,出包不裸跑 plasmo build)')
try {
  run('npm', ['run', 'build'], { stdio: 'inherit' })
} catch {
  fail('构建失败 —— 已中止,远端未有任何改动')
}

// ── 2/3 打包 ────────────────────────────────────────────────────────────
say('▶ 2/3 打包(node scripts/package.mjs;三条自检 + 回读中央目录)')
try {
  run('node', ['scripts/package.mjs'], { stdio: 'inherit' })
} catch {
  fail('打包失败 —— 已中止,远端未有任何改动')
}
if (!existsSync(ZIP)) fail(`打包脚本没产出 ${path.basename(ZIP)}`)
const bytes = statSync(ZIP).size
const sha = createHash('sha256').update(readFileSync(ZIP)).digest('hex')

// ── 说明正文 ────────────────────────────────────────────────────────────
const changelogSection = (v) => {
  const lines = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
  const start = lines.findIndex((l) => l === `## ${v}` || l.startsWith(`## ${v} `))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines.slice(start, end < 0 ? lines.length : end).join('\n').trim()
}

let body
if (existsSync(NOTES_SRC)) {
  body = readFileSync(NOTES_SRC, 'utf8').trim()
  say(`▶ 3/3 说明正文:${path.relative(ROOT, NOTES_SRC)}`)
} else {
  body = changelogSection(version)
  if (!body) {
    fail(
      `没有 release 说明 —— 要么写 ${path.relative(ROOT, NOTES_SRC)},要么在 CHANGELOG.md 里补一节 ` +
        `「## ${version} — <日期>」`,
    )
  }
  say(`▶ 3/3 说明正文:CHANGELOG.md 的 ${version} 段`)
  console.warn(
    `⚠ 退回 CHANGELOG 段是内部口径(带轮次、"验收"等字眼),面向用户的说明请写 ` +
      `${path.relative(ROOT, NOTES_SRC)}(本次仍可发布,发布后在 GitHub 上改也一样)`,
  )
}

// 首行的 `# 标题` 当 release 标题(仅当它是第一个非空行);不写就用 tag
let title = TAG
const lines = body.split(/\r?\n/)
const firstNonEmpty = lines.findIndex((l) => l.trim() !== '')
if (firstNonEmpty >= 0 && /^#\s+\S/.test(lines[firstNonEmpty])) {
  title = lines[firstNonEmpty].replace(/^#\s+/, '').trim()
  body = lines.filter((_, i) => i !== firstNonEmpty).join('\n').trim()
}

// 校验和行:替换已有的(手写的必然对不上某次重建),没有就追加
const shaLine = `\`sha256: ${sha}\`(下载后可核对)`
const SHA_RE = /^.*sha256:\s*[0-9a-f]{64}.*$/m
body = SHA_RE.test(body) ? body.replace(SHA_RE, shaLine) : `${body}\n\n${shaLine}`

mkdirSync(path.dirname(NOTES_OUT), { recursive: true })
writeFileSync(NOTES_OUT, `${body}\n`)

// ── 3/3 发布 ────────────────────────────────────────────────────────────
const gh = (...args) => run('gh', args).trim()
const titleArgs = ['--title', title, '--notes-file', NOTES_OUT]

if (DRY) {
  say(`\n▶ dry-run:以下命令**未执行**(正文见 ${path.relative(ROOT, NOTES_OUT)})`)
  say(`  gh release create ${TAG} ${titleArgs.map(quote).join(' ')} --target ${branch} ${quote(ZIP)}`)
  say(`\n  ${path.basename(ZIP)} · ${(bytes / 1024 / 1024).toFixed(1)} MB · sha256 ${sha}`)
  process.exit(0)
}

try {
  run('gh', ['--version'])
} catch {
  fail('找不到 gh(GitHub CLI)—— 装好后 gh auth login;或手动上传 zip 到 release')
}

// 已发布的 tag 不动声色地覆盖是发布流程里最容易后悔的一步:资产一旦换掉,下载计数归零,
// 且已经下载过旧包的人无从得知 —— 所以默认拒绝,--update 才是明说"我知道自己在做什么"。
let exists = true
try {
  gh('release', 'view', TAG, '--json', 'url')
} catch {
  exists = false
}
if (exists && !UPDATE) {
  fail(
    `${TAG} 已存在 —— 若要替换它的说明与资产,加 --update(会 --clobber 覆盖已上传的 zip,` +
      `该资产的下载计数归零);若这是一次新发布,先升 package.json 的版本号`,
  )
}
if (!exists && UPDATE) say(`▶ ${TAG} 尚不存在,--update 退化为新建`)

if (exists) {
  say(`▶ 3/3 更新已有 release:改说明 + 覆盖资产`)
  gh('release', 'edit', TAG, ...titleArgs)
  gh('release', 'upload', TAG, ZIP, '--clobber')
  gh('release', 'edit', TAG, '--latest')
} else {
  say(`▶ 3/3 新建 release(tag ${TAG} → origin/${branch} 的 HEAD)`)
  gh('release', 'create', TAG, ...titleArgs, '--target', branch, '--latest', ZIP)
}
const url = gh('release', 'view', TAG, '--json', 'url', '-q', '.url')

console.log(`✓ ${TAG} ${exists ? '已更新' : '已发布'}`)
console.log(`  ${title}`)
console.log(`  ${url}`)
console.log(`  ${path.basename(ZIP)} · ${(bytes / 1024 / 1024).toFixed(1)} MB · sha256 ${sha}`)
