# 分发渠道与向量模型内置 — 设计文档

- 日期:2026-09-16
- 状态:待评审
- 决策记录:`docs/adr/0005-distribution-chrome-first-model-bundled.md`
- 背景讨论:公开免费分发;用户为拼多多商家客服(国内、非技术);维护者只有 GitHub,无自有服务器

## 〇、要解决的两个问题

1. **安装渠道**:国内 Chrome 用户无梯子装不了 Chrome 应用商店;公开分发需要一条无需代理、可自动更新的主路径。
2. **首跑模型下载**:当前首跑从 hf-mirror.com 在线拉取 ~25MB 模型(`offscreen/embedding.ts`,`allowRemoteModels=true`)。hf-mirror 为免费社区镜像无 SLA;公开分发后首跑失败率与支持成本不可控;用户首跑无进度提示,失败仅 20s 冷却重试。

## 一、总体决策

| # | 决策 | 说明 |
|---|---|---|
| 1 | 渠道顺序:**Chrome Web Store → Edge Add-ons → 离线 zip 兜底** | 用户指定 Chrome 先行;Edge 国内直连、免费、审核快;离线 zip 覆盖坚持用 Chrome 且无梯子的用户 |
| 2 | **向量模型内置扩展包**:量化 ONNX + tokenizer 随包分发,运行时零远程请求 | 首跑零下载、离线可用;`host_permissions` 中 hf-mirror.com 移除,合规边界升级为"无任何远程传输" |
| 3 | 首个公开发布版本号:**0.11.0** | 模型内置属功能性变更,0.10.0 为内部最后版本 |

三条渠道共用同一份产物 `build/chrome-mv3-prod`(打包 zip),不维护分支版本。

## 二、模型内置设计

### 2.1 文件落位与目录结构

模型文件放 **`public/model/`**(Plasmo 约定:`public/` 下文件原样复制到产物根,不经打包器处理、不改文件名;`assets/` 目录会被打包管线重命名,不适用)。transformers.js 的 `localModelPath` 期望 `<path>/<model_name>/` 结构,模型名含斜杠,故目录为:

```
public/model/Xenova/bge-small-zh-v1.5/
├── config.json
├── tokenizer.json
├── tokenizer_config.json
├── special_tokens_map.json
├── vocab.txt
└── onnx/model_quantized.onnx   (~23MB)
```

### 2.2 构建期拉取脚本

新增 `scripts/fetch-model.mjs`(Node,非扩展运行时):

- 通过 `https://hf-mirror.com/api/models/Xenova/bge-small-zh-v1.5` 枚举文件清单,按 2.1 白名单下载,锁定**固定 revision(commit hash)**保证可复现;
- 幂等:已存在且大小一致则跳过;
- 首次执行需人工跑一次(构建机需能访问 hf-mirror;本机已验证可达),产物**入库**(25MB 一次性成本,换取换机/换人可构建,不做 .gitignore 分叉);
- `pnpm build` 前置校验:模型文件缺失时构建失败并提示先跑 `pnpm fetch-model`(在 package.json 增加该 script;不自动下载,避免构建意外联网)。

### 2.3 运行时加载改造

`src/offscreen/embedding.ts`:

```ts
env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = chrome.runtime.getURL('model/')
```

- `quantized: true` 保持不变(transformers.js 将读取 `onnx/model_quantized.onnx`);
- 扩展页面 fetch 自身资源属 `'self'`,CSP 无需改动;`wasm-unsafe-eval` 已允许现有 WASM 推理;
- 失败闩锁与 20s 冷却逻辑**保留**(覆盖本地文件损坏场景);
- `src/shared/embedding-model.ts` 的 `MODEL_NAME`/`EMBEDDING_VERSION` **不动**(512 维、bge 中文系 2.x),检索链路与既有向量零迁移。

### 2.4 manifest 变更(package.json)

- 删除 `host_permissions` 中 `https://hf-mirror.com/*`(仅保留 `https://mms.pinduoduo.com/*`);
- 其余权限(`storage`/`unlimitedStorage`/`offscreen`/`alarms`/`scripting`)不动;
- `version` → 0.11.0。

### 2.5 错误处理

- 模型文件缺失/损坏(典型:用户解压不完整):现有闩锁会静默冷却重试,首版补一条明确文案——嵌入失败且错误含加载失败特征时,推荐回复面板提示「本地模型文件缺失,请重新安装扩展」(小改动,复用现有错误上报路径);
- 远程回退**不做**:`allowRemoteModels=false` 后不再有网络分支,杜绝"一半用户在线源一半本地"的调试黑洞。

## 三、渠道设计

### 3.1 Chrome Web Store(先行)

**需维护者操作**:注册 CWS 开发者账号($5 一次性);提交与审核沟通(本机有代理 `127.0.0.1:7897`)。

**我可产出**:
- 产物 zip(`build/chrome-mv3-prod` 打包);
- 商店文案:简短描述(≤132 字符,含「只填充不发送」「数据仅存本机」)+ 详细描述(功能、合规边界、权限逐条说明);
- 截图 1280×800 若干张:商店素材是**交付物**而非验证手段,用 Playwright 生成真实页面截图(复用 `scripts/` 现有扩展加载底座);
- 隐私声明文本:单用途声明、权限用途表(`storage`/本地数据、`scripting`/注入填充、`host_permissions`/仅商家后台域名)、"扩展运行期零远程请求"(模型内置后成立);
- 图标:确认 `assets/icon.png` 满足 128×128,不足则补生成。

**审核风险与预案**:`mms.pinduoduo.com` host permission + 输入框填充可能触发人工复审;文案口径「商家自有后台效率工具、填充后人工确认发送、无自动操作」;若被拒,CWS 失败**不影响** Edge 与离线渠道(同一产物,渠道独立)。

### 3.2 Edge Add-ons(第二)

- 同一份 zip;Microsoft 账号即可提交,免费,国内直连,审核通常数小时至数天;
- 材料:名称、简短描述、详细描述、截图(复用 3.1 产物)、隐私声明(同 3.1);
- 商店自动更新,是**国内无梯子用户的主安装路径**。

### 3.3 离线 zip 兜底

- GitHub Releases 发布 `pdd-cs-quick-reply-v<版本>.zip` + 图文安装教程(下载 → 解压 → `chrome://extensions` → 开发者模式 → 加载已解压的 `chrome-mv3-prod` 目录);
  - 发布走 `npm run release`(`scripts/release.mjs`,2026-09-17 第五十二轮补):构建 → 打包 → 建 release,前面拦两道 —— **工作区有未提交改动**、**有提交没推送**。理由:tag 指向远端分支的提交,而 zip 是本地工作区构建的,两者不一致时用户下载的包与 GitHub 上那份代码对不上,且事后无法从 tag 重建成同一个包。说明正文优先取 `docs/release-notes/v<版本>.md`(面向用户),没有才退回 CHANGELOG 段并警告(内部口径);末尾校验和行由脚本按本次实测值写入,不手写。`--dry-run` 只构建+打包并打印 gh 命令,`--update` 才覆盖已存在的 release
  - 打包走 `node scripts/package.mjs`(2026-09-17 第五十二轮补):它把"版本一致 / 内置模型在包内 / 解压出来就是一个 `chrome-mv3-prod` 目录"三件事做成**打包前自检** —— 前两件出错用户那边只表现为"装了但检索不到",第三件是 v0.11.0 那个包的真实问题(文件摊在压缩包根上,而本教程让用户去找 `chrome-mv3-prod` 文件夹);
- 教程同时给出国内加速下载参考(gh-proxy 类链接仅为参考,不承诺可用);用户间亦可经网盘/群文件传递 zip;
- 已知代价(写进教程):开发者模式下 Chrome 每次启动弹提示(可忽略)、**无自动更新**,新版本需重新下载;
- 将来项(本期不做):扩展内"检查更新"按钮(fetch GitHub Releases API 比对版本)。

## 四、测试与验收

1. **单测**:`embedding.ts` env 配置断言(`allowRemoteModels=false`、`localModelPath` 指向扩展内路径,mock `chrome.runtime.getURL`);
2. **纯数据层 e2e**(符合本项目"验证不截图"惯例,例外仅商店素材截图):
   - 现有 `scripts/verify-kb.mjs` 等 19+ 例照常通过,首跑不再含"模型下载"阶段,轮询预算缩短;
   - 新增离线证明断言:禁用远程网络(mock fetch 失败)后模型加载与检索链路照常 → 证明真正离线可用;
3. **产物验收**:`pnpm build` 后 zip 体积基线 **16.2MB**(v0.15.1 实测;原写 28-30MB 是拿未压缩体积估的,`package.mjs` 每次会打印实际值);`public/model/` 文件完整进入产物根;
   - **源码不变 ⇒ 从零重建的包 sha256 也不变**(2026-09-17 实测:改完 `release.mjs` 后整体重建,sha256 仍为 `06072708…6863d`,与线上已发布的资产逐字节相同)。这条是发布说明里那个校验和**值得核对**的前提:同一份源码在别人机器上重建就能对上,而不是"某一次压缩的指纹";
4. **渠道验收**:CWS 与 Edge 提交通过审核、商店页可安装;离线教程按步骤在新 profile 可装可用。

## 五、交付物与分工

| 交付物 | 谁 |
|---|---|
| `scripts/fetch-model.mjs` + `public/model/` 产物 + package.json script | Claude |
| `offscreen/embedding.ts` 本地加载改造 + manifest 清理 + 版本 0.11.0 | Claude |
| 模型缺失错误文案 | Claude |
| e2e 改造与离线断言 | Claude |
| 商店文案、隐私声明、截图生成脚本与素材 | Claude |
| CWS 账号注册与两个商店的提交、审核沟通 | 维护者 |
| GitHub Release 发布、安装教程页 | Claude 出物料,发布由维护者执行 |

## 六、将来项(本期明确不做)

- 扩展内检查更新;
- 多源/自托管模型下载与断点续传(模型内置后无此需求);
- Firefox/AMO 与国产浏览器商店分发;
- 模型换代按需走 `EMBEDDING_VERSION` 既有机制 + 商店发版,不设独立更新通道。
