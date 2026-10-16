# 分发落地:模型内置 + 0.11.0 发布包 + Edge 商店材料 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 向量模型内置扩展包(运行时零远程请求),产出 0.11.0 发布 zip 并发 GitHub Release,备齐 Edge 商店提交材料与用户操作清单。

**Architecture:** 模型文件锁定 revision 从 hf-mirror 构建期下载入库(`model/` 目录);`plasmo build` 后由脚本复制进产物 `model/`(实证:Plasmo 0.90 的 `public/`、未导入的 `assets/` 均不进产物);offscreen 侧 transformers.js 改纯本地加载(`allowRemoteModels=false`);e2e 以「封锁 hf-mirror 后检索照常」做离线证明。

**Tech Stack:** Plasmo 0.90 / MV3、@xenova/transformers 2.17.2、vitest、Playwright(chromium channel)、gh CLI(代理 `HTTPS_PROXY=http://127.0.0.1:7897`)。

**Spec:** `docs/specs/2026-09-16-distribution-design.md` + `docs/adr/0005-distribution-chrome-first-model-bundled.md`

## Global Constraints

- 版本:package.json `0.10.0 → 0.11.0`(首个公开发布)
- 运行时**零远程请求**:`env.allowRemoteModels=false` 永久;hf-mirror 仅存在于构建期脚本
- `host_permissions` 只留 `https://mms.pinduoduo.com/*`,删除 `https://hf-mirror.com/*`
- `MODEL_NAME`/`EMBEDDING_VERSION` **不动**(512 维、bge 中文系 2.x,检索链路零迁移)
- 模型锁定 revision `75c43b069aac4d136ba6bc1122f995fedcfd2781`,白名单 7 文件:
  `config.json`、`tokenizer.json`、`tokenizer_config.json`、`special_tokens_map.json`、`vocab.txt`、`quantize_config.json`、`onnx/model_quantized.onnx`(~23MB)
- 每任务结束:`npx tsc --noEmit` 0 错 + `pnpm test` 全绿(现基线 333)
- 提交遵循项目惯例:`feat:/fix:` 与 `docs:` 分离,轮次号递增(当前第四十六轮,本轮为**第四十七轮**)
- git push 走 `git -c http.proxy=http://127.0.0.1:7897 push`;gh 命令带 `HTTPS_PROXY=http://127.0.0.1:7897`
- 合规口径不变:数据仅存本机、发送永远人工;上架材料中明确「扩展运行期零远程请求」

---

### Task 1: `scripts/model.mjs`(fetch + copy)与模型入库

**Files:**
- Create: `scripts/model.mjs`
- Create(产物): `model/Xenova/bge-small-zh-v1.5/**`(7 文件,入库)

**Interfaces:**
- Produces: `node scripts/model.mjs fetch|copy|copy-dev`(CLI);导出纯函数 `localModelDir()`、`distModelDir(dist)`、`modelFileUrl(file)` 供后续/测试引用
- Produces: 仓库内 `model/Xenova/bge-small-zh-v1.5/` 为模型唯一事实源,Task 3 的 build 复制与 offscreen 加载都依赖它

- [ ] **Step 1: 写 `scripts/model.mjs`**

```js
/**
 * 模型内置底座(2026-09-17 第四十七轮):
 *   fetch    —— 从 hf-mirror 锁 revision 下载白名单文件到 model/(幂等:存在且大小一致则跳过)
 *   copy     —— model/ → <dist>/model/(plasmo build 之后跑;Plasmo 不复制 public/ 与未导入 assets/,实证见工作状态 §〇-AU)
 *   copy-dev —— model/ → build/chrome-mv3-dev/model/(dev 会话开始时跑一次,模型文件不变)
 * 网络仅发生在构建期;扩展运行时零远程请求(spec §一.2)。
 */
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '..')
const MIRROR = 'https://hf-mirror.com'
export const MODEL_REPO = 'Xenova/bge-small-zh-v1.5'
export const MODEL_REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
export const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.txt',
  'quantize_config.json',
  'onnx/model_quantized.onnx',
]

/** 仓库内模型事实源目录(model/Xenova/bge-small-zh-v1.5) */
export const localModelDir = () =>
  path.join(ROOT, 'model', ...MODEL_REPO.split('/'))
/** 产物内模型目录(<dist>/model/Xenova/bge-small-zh-v1.5) */
export const distModelDir = (dist) =>
  path.join(dist, 'model', ...MODEL_REPO.split('/'))
/** 锁 revision 的下载 URL */
export const modelFileUrl = (file) =>
  `${MIRROR}/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file}`

async function fetchOne(file) {
  const dest = path.join(localModelDir(), file)
  if (existsSync(dest)) {
    const head = await fetch(modelFileUrl(file), { method: 'HEAD' })
    const len = Number(head.headers.get('content-length') ?? -1)
    if (len >= 0 && statSync(dest).size === len) {
      console.log(`skip  ${file}(${len} bytes 已一致)`)
      return
    }
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  console.log(`fetch ${file} ← ${modelFileUrl(file)}`)
  const res = await fetch(modelFileUrl(file))
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${modelFileUrl(file)}`)
  await Readable.fromWeb(res.body).pipe(createWriteStream(dest))
}

import { createWriteStream } from 'node:fs'

function copyTo(dist) {
  const from = localModelDir()
  const to = distModelDir(dist)
  rmSync(path.join(dist, 'model'), { recursive: true, force: true })
  mkdirSync(path.dirname(to), { recursive: true })
  for (const f of MODEL_FILES) {
    const src = path.join(from, f)
    if (!existsSync(src)) throw new Error(`模型文件缺失:${src}(先跑 pnpm fetch-model)`)
    const dst = path.join(to, f)
    mkdirSync(path.dirname(dst), { recursive: true })
    const bytes = createReadStream(src).pipe(createWriteStream(dst))
    // createWriteStream 同步开流,复制小文件无需 await 也可,但为确定性统一 drain:
    bytes.on('finish', () => {})
  }
  console.log(`copy  model/ → ${to}`)
}

const cmd = process.argv[2]
if (cmd === 'fetch') {
  for (const f of MODEL_FILES) await fetchOne(f)
} else if (cmd === 'copy') {
  copyTo(path.join(ROOT, 'build', 'chrome-mv3-prod'))
} else if (cmd === 'copy-dev') {
  copyTo(path.join(ROOT, 'build', 'chrome-mv3-dev'))
} else {
  console.error('用法:node scripts/model.mjs fetch|copy|copy-dev')
  process.exit(1)
}
```

实现注意:`import { createWriteStream }` 要并进顶部 `node:fs` 导入(上面为示意拆开);管道复制用 `await new Promise((ok) => stream.pipe(out).on('finish', ok))` 保证确定性。

- [ ] **Step 2: 拉模型并核对**

Run: `node scripts/model.mjs fetch`(hf-mirror 本机直连可达,无需代理)
Expected: 7 行 fetch/skip 日志;`ls -la model/Xenova/bge-small-zh-v1.5/onnx/` 中 `model_quantized.onnx` 约 22-24MB

- [ ] **Step 3: Commit**

```bash
git add scripts/model.mjs model/
git commit -m "feat: 模型内置底座 scripts/model.mjs + bge-small-zh-v1.5@75c43b0 入库(第四十七轮)"
```

### Task 2: offscreen 纯本地加载(TDD:先测 `model-env`)

**Files:**
- Create: `src/offscreen/model-env.ts`
- Modify: `src/offscreen/embedding.ts:24-28`(env 配置段)与加载失败文案(catch 段)
- Test: `tests/unit/offscreen/model-env.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `MODEL_DIR_PREFIX` 约定(扩展内路径 `model/`)
- Produces: `configureLocalModelEnv(env, getURL)` 与 `toLocalModelErrorMessage(raw)`(导出自 `src/offscreen/model-env.ts`);`embedding.ts` 模块初始化时调用前者

- [ ] **Step 1: 写失败测试 `tests/unit/offscreen/model-env.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { configureLocalModelEnv, toLocalModelErrorMessage } from '../../src/offscreen/model-env'

function fakeEnv() {
  return {
    allowLocalModels: false,
    allowRemoteModels: true,
    localModelPath: '',
    useBrowserCache: true,
  }
}

describe('configureLocalModelEnv —— 模型内置后 offscreen 必须纯本地', () => {
  it('四项 env 全部落位:本地开、远程关、路径指向扩展内 model/、关浏览器缓存', () => {
    const env = fakeEnv()
    const seen: string[] = []
    configureLocalModelEnv(env, (p) => {
      seen.push(p)
      return `chrome-extension://abcd/${p}`
    })
    expect(env.allowLocalModels).toBe(true)
    expect(env.allowRemoteModels).toBe(false)
    expect(env.localModelPath).toBe('chrome-extension://abcd/model/')
    expect(env.useBrowserCache).toBe(false)
    expect(seen).toEqual(['model/'])
  })
})

describe('toLocalModelErrorMessage —— 本地加载失败必须给出可行动文案', () => {
  it('保留原始错误并附「重新安装扩展」指引', () => {
    const msg = toLocalModelErrorMessage('TypeError: Failed to fetch')
    expect(msg).toContain('重新安装扩展')
    expect(msg).toContain('Failed to fetch')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/offscreen/model-env.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写 `src/offscreen/model-env.ts`**

```ts
/**
 * 模型加载环境(2026-09-17 第四十七轮):模型内置后 offscreen 必须**纯本地**。
 * 抽成纯函数以便单测(不 import @xenova/transformers);embedding.ts 模块初始化时调用。
 * 约束来源:spec §二.3 / ADR 0005 —— allowRemoteModels=false 永久,杜绝"一半在线一半本地"。
 */

type TransformersEnv = {
  allowLocalModels: boolean
  allowRemoteModels: boolean
  localModelPath?: string
  useBrowserCache: boolean
}

/** 扩展内模型根目录(与 scripts/model.mjs 的 copy 目标一致) */
export const MODEL_DIR_PREFIX = 'model/'

/** 把 transformers env 切到「仅扩展内 model/」;getURL 注入便于测试 */
export function configureLocalModelEnv(
  env: TransformersEnv,
  getURL: (path: string) => string,
): void {
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.localModelPath = getURL(MODEL_DIR_PREFIX)
  // 扩展自带文件走 HTTP 缓存即可,不占 Cache API 存储
  env.useBrowserCache = false
}

/** 本地模型加载失败 → 可行动文案(文件缺失/损坏;原始错误保留供诊断) */
export function toLocalModelErrorMessage(raw: string): string {
  return `本地模型加载失败(文件缺失或损坏),请重新安装扩展;原始错误: ${raw}`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/offscreen/model-env.test.ts`
Expected: PASS(2 tests)

- [ ] **Step 5: 改 `src/offscreen/embedding.ts`**

先 Read `src/offscreen/embedding.ts` 全文,然后:
① 头部 env 配置段(现 `env.allowLocalModels = false` / `env.allowRemoteModels = true` / `env.remoteHost = 'https://hf-mirror.com'` 三行及其注释)替换为:

```ts
// 模型内置(v2.6 之后第四十七轮):模型文件随扩展包分发(扩展内 model/),
// 运行时零远程请求 —— hf-mirror 仅存在于构建期脚本 scripts/model.mjs。
// 注:多线程 WASM 以 blob: 起 worker 被 CSP 拦截,numThreads=1 维持不变。
configureLocalModelEnv(env, (p) => chrome.runtime.getURL(p))
```

(同时 import `configureLocalModelEnv, toLocalModelErrorMessage` 自 `./model-env`;`numThreads = 1` 一行保留不动。)

② 加载失败闩锁段:找到给 `_lastModelError` 赋值的 catch,在赋值处包一层:

```ts
_lastModelError = toLocalModelErrorMessage(String(err))
```

③ 文件头注释中「允许远程下载模型文件…」一段改写为「模型文件随包内置(扩展内 model/),失败文案指向重新安装」。

- [ ] **Step 6: 全量验证**

Run: `npx tsc --noEmit && pnpm test`
Expected: tsc 0 错;`33 passed (33)` 文件、`335 passed` 用例(333 + 新 2)

- [ ] **Step 7: Commit**

```bash
git add src/offscreen/model-env.ts src/offscreen/embedding.ts tests/unit/offscreen/model-env.test.ts
git commit -m "feat: offscreen 嵌入改纯本地加载(扩展内 model/)+ 失败可行动文案(第四十七轮)"
```

### Task 3: manifest 清理 + 0.11.0 + build/dev 脚本接线

**Files:**
- Modify: `package.json`(version、scripts.build、scripts.dev、新增 scripts.fetch-model、host_permissions)

**Interfaces:**
- Consumes: Task 1 的 `node scripts/model.mjs copy|copy-dev`
- Produces: `pnpm build` 产物含 `model/`;"构建机必先有 model/ 目录"由 copy 命令硬校验(缺文件即报错)

- [ ] **Step 1: 改 `package.json`**

① `"version": "0.10.0"` → `"version": "0.11.0"`
② `"scripts"` 改三处:

```json
"dev": "node scripts/model.mjs copy-dev && plasmo dev",
"build": "plasmo build && node scripts/model.mjs copy",
"fetch-model": "node scripts/model.mjs fetch",
```

③ `manifest.host_permissions` 只留 `["https://mms.pinduoduo.com/*"]`

- [ ] **Step 2: 构建并核对产物**

Run: `pnpm build && ls build/chrome-mv3-prod/model/Xenova/bge-small-zh-v1.5/onnx/ && grep -c "hf-mirror" build/chrome-mv3-prod/manifest.json; grep '"version"' package.json`
Expected: build 过;`model_quantized.onnx` 在产物内;hf-mirror 计数 **0**;version 0.11.0

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: v0.11.0 —— 移除 hf-mirror host permission,build/dev 接线模型复制(第四十七轮)"
```

### Task 4: e2e 离线证明(verify-kb 封锁 hf-mirror)

**Files:**
- Modify: `scripts/verify-kb.mjs:13-14`(launch 后)、`:59-65`(注释与进度文案)

- [ ] **Step 1: 加路由封锁与注释更新**

`const ctx = await launchExtContext(PROFILE)` 之后、`await sleep(5000)` 之前插入:

```js
// 离线证明:封锁 hf-mirror —— 模型内置后检索链路必须在不触网的前提下工作
await ctx.route('**hf-mirror.com/**', (route) => route.abort())
```

`── 2. 向量回填(首次含模型下载,预算 ~5 分钟)` 注释改为
`── 2. 向量回填(本地模型,首嵌秒级;5 分钟预算仅作慢机冗余)`;
`if (i === 20)` 的进度文案改为 `console.log('…本地模型推理中(20×3s)')`。

- [ ] **Step 2: 跑 e2e**

Run: `PDD_E2E_HEADLESS=1 node scripts/verify-kb.mjs`
Expected: 19/19 PASS(含「知识条目向量回填」「检索命中 knowledge」)——在 hf-mirror 被封死的前提下通过,即离线证明成立。若失败,优先查 Task 3 产物内 `model/` 路径与 transformers.js `localModelPath` 拼接(URL 结尾必须带 `/`)。

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-kb.mjs
git commit -m "test: verify-kb 封锁 hf-mirror 做离线证明,文案对齐本地模型(第四十七轮)"
```

### Task 5: 文案与文档回写(设置页 / README / 工作状态 / CHANGELOG)

**Files:**
- Modify: `src/popup/SettingsTab.tsx:374`(hf-mirror 文案)
- Modify: `README.md`(新增「安装与分发」节)
- Modify: `docs/工作状态-2026-09-08.md`(头部更新时间 + §〇-AU 节)
- Modify: `CHANGELOG.md`(新增 `## 0.11.0` 节)

- [ ] **Step 1: 设置页文案**

`SettingsTab.tsx:374` 现:「全部数据仅存本机 IndexedDB,不上传任何服务器;模型文件仅从 hf-mirror.com 镜像下载。」
改为:「全部数据仅存本机 IndexedDB,不上传任何服务器;嵌入模型已内置,离线可用,无任何远程下载。」

- [ ] **Step 2: README 增「安装与分发」节**(置于「## 合规边界」之后)

```markdown
## 安装与分发

- **Edge 商店(推荐,国内直连)**:上架审核通过后在此下载(链接见 Release 说明);
- **GitHub Releases**:下载 `pdd-cs-quick-reply-v0.11.0.zip`,解压后
  Chrome/Edge 打开 `chrome://extensions`(Edge 为 `edge://extensions`)→ 开启「开发者模式」
  → 「加载已解压的扩展程序」→ 选择解压出的 `chrome-mv3-prod` 文件夹;
  已知代价:开发者模式下浏览器每次启动会弹提示(可忽略),且无自动更新;
- **安装自检**:popup「设置」页运行嵌入链路自检,通过即模型就绪;
- 首次使用无需任何下载:检索模型(bge-small-zh-v1.5,~25MB)已内置扩展包内,离线可用。
```

- [ ] **Step 3: CHANGELOG 新增 `## 0.11.0 — 2026-09-17` 节**(置于 0.10.0 之上)

```markdown
## 0.11.0 — 2026-09-17

### 新增
- 向量模型内置:bge-small-zh-v1.5 量化 ONNX + tokenizer 随扩展包分发(ADR 0005),安装即用、离线可用,首跑不再下载 ~25MB

### 变更
- offscreen 嵌入改纯本地加载(`allowRemoteModels=false`),本地模型失败给出「重新安装扩展」可行动文案
- `scripts/model.mjs` 构建期模型拉取/复制底座(锁 revision `75c43b0`);`pnpm fetch-model` 新命令
- verify-kb e2e 封锁 hf-mirror 作离线证明;设置页文案同步(「模型已内置,离线可用」)

### 移除
- `host_permissions` 的 `https://hf-mirror.com/*` —— 扩展运行期零远程请求
```

- [ ] **Step 4: 工作状态 §〇-AU 节**(含本轮验证结果,格式对齐既有轮次;注明「Plasmo 不复制 public//未导入 assets/ 为实证结论」)

- [ ] **Step 5: 验证 + 分两笔提交**

Run: `npx tsc --noEmit && pnpm test`(全绿)

```bash
git add src/popup/SettingsTab.tsx README.md && git commit -m "docs: 设置页与 README 对齐模型内置口径(第四十七轮)"
git add CHANGELOG.md docs/工作状态-2026-09-08.md && git commit -m "docs: CHANGELOG 0.11.0 + 工作状态 §〇-AU(第四十七轮)"
```

### Task 6: 发布 zip + GitHub Release + Edge 材料与用户清单

**Files:**
- Create(不入库): `pdd-cs-quick-reply-v0.11.0.zip`
- Create: `docs/distribution/edge-listing.md`(商店文案 + 用户操作清单)
- Create(不入库,随 Release 附): 商店 logo 300×300(自 `assets/icon.png` 放大/取整)

- [ ] **Step 1: 打 zip 并核对**

```bash
cd build/chrome-mv3-prod && powershell -Command "Compress-Archive -Path * -DestinationPath ../../pdd-cs-quick-reply-v0.11.0.zip -Force" && cd ../..
python -c "import zipfile; names=zipfile.ZipFile('pdd-cs-quick-reply-v0.11.0.zip').namelist(); print('manifest@root:', 'manifest.json' in names); print('model in zip:', any('model_quantized' in n for n in names))"
```
Expected: `manifest@root: True`、`model in zip: True`;体积约 28-30MB

- [ ] **Step 2: 生成商店 logo 300×300**

`node -e "import('sharp').then(async s=>{await s('assets/icon.png').resize(300,300).png().toFile('edge-store-logo-300.png');console.log('ok')})"`
(sharp 是 plasmo 既有传递依赖;若不可用则改用 Playwright 对 icon.png 截图,并在清单中注明由维护者自备。)

- [ ] **Step 3: 写 `docs/distribution/edge-listing.md`**

内容四段:
① **商店文案**:名称「拼多多客服快捷回复」;简短描述(≤160 字,含「只填充不发送」「数据仅存本机」「模型内置离线可用」);详细描述(功能四条 + 合规边界 + 权限逐条说明:storage/本地数据、scripting/注入填充、host 权限仅商家后台域名);类别「生产力工具」;语言「中文(简体)」;网站 URL 填 GitHub 仓库页。
② **隐私声明文案**:不收集/不传输任何用户数据;无远程请求;数据仅存本机 IndexedDB。
③ **用户操作清单(Partner Center)**:Microsoft 账号登录 partner.microsoft.com/dashboard → 注册 Edge 开发者(免费,一次性身份验证)→ 「创建新扩展」→ 上传 zip → 填入①②文案 → 上传 300×300 logo 与截图 → 隐私选「不收集任何数据」→ 提交审核(通常数小时至数天,国内直连)。
④ **截图生成**:`PDD_E2E_HEADLESS=1 node scripts/make-store-shots.mjs`(Task 6 内新增小脚本:launchExtContext → openPopup → 对根 div `page.screenshot`,输出 `docs/distribution/shots/*.png`;Edge 建议至少 1 张,尺寸不符时维护者可后补)。

- [ ] **Step 4: 发 GitHub Release**

```bash
HTTPS_PROXY=http://127.0.0.1:7897 gh release create v0.11.0 pdd-cs-quick-reply-v0.11.0.zip \
  --title "v0.11.0 —— 首个公开发布(模型内置,安装即用)" \
  --notes "首个面向公众的版本。检索模型已内置,安装后离线可用,首跑无需任何下载。数据仅存本机,发送永远由人工确认。安装步骤见 README「安装与分发」;Edge 商店上架后优先走商店(自动更新)。"
```

- [ ] **Step 5: 推送 + 汇报**

```bash
git -c http.proxy=http://127.0.0.1:7897 push
```
向用户汇报:Release 链接、Edge 提交需要的 4 样(zip / 文案 / logo / 截图)已备齐在哪、以及清单中必须由维护者本人完成的步骤(Partner Center 注册与提交、身份验证)。

---

## Self-Review 记录

- **Spec 覆盖**:spec §二(2.1→Task1/3、2.2→Task1、2.3→Task2、2.4→Task3、2.5→Task2)、§三.3 离线兜底(Task 5 README + Task 6 Release)、§四 测试(Task 2 单测 + Task 4 e2e + Task 3 产物核对 + Task 6 体积基线)、§五 分工(材料全出,提交动作归维护者)——全覆盖;spec §三.1/3.2(Chrome/Edge 提交本身)为维护者操作,本计划只产材料,与 spec 分工表一致。
- **占位符**:Task 2 Step 5 的 ②③ 是「先 Read 再改」的锚点式步骤,锚点与目标内容均已给全;Task 6 Step 2 的 sharp 失败回退路径已写明。
- **类型一致性**:`MODEL_DIR_PREFIX='model/'`(Task 2)与 Task 1 copy 目标 `<dist>/model/`、Task 3 校验路径一致;`fetch-model` script 名在 Task 1 文档注释、Task 3 package.json、README(未引)三处一致;错误文案函数名 Task 2 测试与实现一致。
