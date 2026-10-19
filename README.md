# 拼多多客服检索工具

单人客服在本地 Chrome 中使用的 MV3 扩展:自动捕获拼多多商家后台聊天页的买家问答,沉淀为本地可向量检索的回复候选;检索历史回复 / 标准回答 / 知识库,一键填充到官方输入框。

> 由开源项目 Personal AI Memory v0.0.7(Apache 2.0)改造而来,仅保留其本地嵌入/检索底座,业务层为拼多多客服场景全新实现。

## 功能

- **自动捕获**:客服打开的会话内,买家连续消息合并为问题、客服回复挂载到问题,本地 IndexedDB 存储,保留期默认 90 天(可调);
- **混合检索**:问题向量(bge-small-zh-v1.5,本地推理)+ BM25 双路 RRF 融合,完全本地运行,无云端调用;
- **标准回答**:优秀回复可提升为标准回答(独立问答文档,按**问题类型**归类,豁免保留期),同问题可挂多条;
- **问题类型**:捕获与提升时自动归类(八个记录级类型 + 一个「其他」出口,另有一个只用于意图识别的「尺码推荐」),
  可在「记忆」「标准回答」两页按类型筛选;判不准的落「未分类」,不猜;
- **知识库**:手工"标题+正文"话术卡与 .md 文档上传(自动分块),作为独立检索来源;其中可把一篇标记为**尺码表** —— 整篇原文不参与向量检索,专门作为尺码推荐的生成材料;
- **尺码推荐**:买家问"我穿多大"时,用整篇尺码表 + 你自己配置的 LLM 直接生成一段带具体尺码的回复(如「建议穿 M 码」),不再把买家推去联系客服;买家没给身高体重时先问,不凭空推荐;
- **推荐回复面板**:聊天页「AI回复」按钮或自定义快捷键唤起,组成固定:标准回答至多 3 + 历史最近 3 + 知识库 3(另含可选的「AI 整合」/「根据尺码表生成回复」行);标准回答、历史、知识库用**不同颜色的矩形标签**区分;
- **AI 整合(默认关闭)**:只在点击时,把本轮面板展示的知识库内容(或整篇尺码表原文)与买家问题发给你配置的 OpenAI 兼容接口,流式生成可直接发送的话术;
- **一键填充**:候选点击后写入官方输入框 `textarea#replyTextarea`,**发送永远由人工点击**——绝不自动发送;
- **主题**:亮 / 暗两主题,聊天页覆盖层与弹窗跟随设置。

## 合规边界

只记录与填充,不替客服发送;数据仅存本机。

**只有两条外发通道,都默认关,都要你显式打开**:

1. **AI 整合**(ADR-0006):你亲手填好第三方 LLM 接口与密钥、打开「AI 整合」开关、
   再主动点击面板里的「根据知识库内容整合并回复」(或「根据尺码表生成回复」)行 —— 三条同时满足,
   才把**当轮面板展示的知识库内容(或整篇尺码表原文)与买家问题**发给你配置的那个接口;
2. **问题类型自动分类**(ADR-0007):在设置页填好 TypeSafe 的接口与密钥并打开「自动分类」开关后,
   才把**问题文本**发往分类接口(存量补分类还需**再点一次**「开始分类所有历史」按钮)。

两条通道合起来的外发内容**只有问题文本、知识库正文与尺码表原文**;**历史回答与标准回答的回复正文永不外发**,
API Key 只进本机存储、不随导出外发;两条通道的产出也都只填进输入框,发送仍由你点。
**两个开关都不开时,运行期零网络请求**。此外无遥测、无日志上报。

## 安装与分发

- **Edge 商店(推荐,国内直连,自动更新)**:上架审核通过后见 Release 说明中的商店链接;
- **GitHub Releases(离线安装)**:到 [Releases](https://github.com/hu-qi-jia/pdd-rag-plugin/releases/latest) 下载最新的 `pdd-cs-quick-reply-v<版本>.zip` 并解压,然后
  - Chrome:打开 `chrome://extensions` → 右上角开启「开发者模式」→「加载已解压的扩展程序」→ 选择解压出的 `chrome-mv3-prod` 文件夹;
  - Edge:打开 `edge://extensions` → 左下角开启「开发人员模式」→「加载解压缩的扩展」→ 同上;
  - 已知代价:开发者模式下浏览器每次启动会弹一条提示(可忽略),且不自动更新,新版本需重新下载;
- **安装自检**:popup「设置」页运行嵌入链路自检,通过即模型就绪;
- **首次使用无需任何下载**:检索模型(bge-small-zh-v1.5,量化 ~23MB)已内置扩展包内,安装即用、离线可用。

## 项目结构

```
src/
├── background/   # Service Worker:消息路由、DB(Dexie)、检索、捕获落盘、设置、导入导出
├── offscreen/    # offscreen 页(embedding.ts 本地推理引擎);页面壳在 tabs/offscreen.tsx
├── contents/     # 内容脚本:pdd-ai-button(AI 按钮+候选弹窗+填充)、pdd-chat-capture(捕获桥)
├── popup/        # 弹窗 UI(React):统计 / 记忆 / 标准回答 / 知识库 / 设置五页签;logic.ts 为纯逻辑 Model 层
├── ui/           # 设计系统:theme 令牌 / design 尺寸 / components(Toggle·Slider·Card)/ overlay-css / icons
├── shared/       # 跨上下文基础设施:text、mdText、chunkText、hotkey、message-passing、chrome-storage、常量
├── pdd/          # 拼多多平台领域纯逻辑:dom-parser、bubble-anchor、ui-logic、segmenter(分段状态机)
└── types/        # 纯类型:memory(存储 schema)、messages/(按域拆分的消息对)、transfer(导入导出信封)
tests/
└── unit/{background,popup,ui,shared,pdd}/   # vitest 单测,目录与 src 对应
scripts/          # 工具链(model / package / release)+ 数据层 e2e 验收脚本 + lib.mjs 公共底座
└── archive/      # 已冻结的历史脚本(按年月归档;只备查,不再维护、不可直接运行)
docs/
├── 拼多多客服快捷回复工具-设计文档.md   # 设计总纲(唯一事实源)
├── DESIGN.md     # 设计系统规范(版本号与扩展版本独立计数)
├── specs/        # 逐轮设计文档;plans/ 逐轮实施计划
├── adr/          # 架构决策记录
├── release-notes/ · distribution/       # 发版说明与商店上架材料
└── 工作状态-*.md  # 会话间交接的工作状态快照
```

分层约定:`types/` 只放类型;运行时常量在 `shared/constants.ts`;平台纯逻辑进 `pdd/`,通用基础设施进 `shared/`,UI 组件与令牌进 `ui/` —— 任何目录都不做杂物抽屉(`ui/icons.tsx` 也只导出当下有人用的图标)。

## 开发

```bash
pnpm install
pnpm dev     # 开发模式(自动加载扩展)
pnpm build   # 产物在 build/chrome-mv3-prod
pnpm test    # vitest 单测
node scripts/package.mjs   # 打发布 zip(pdd-cs-quick-reply-v<版本>.zip;自检产物版本一致 + 内置模型在包内)
```

发布(维护者):

```bash
pnpm release                    # 构建 → 打包 → 建 GitHub Release(说明取 docs/release-notes/v<版本>.md)
node scripts/release.mjs --dry-run   # 只看会发布什么:构建+打包照跑,gh 命令只打印不执行
```

脚本会先拦两道:工作区有未提交改动、有提交没推送 —— release 的 tag 指向远端分支的提交,而 zip 是本地工作区构建的,两者不一致时用户下载的包和 GitHub 上那份代码对不上。所以顺序是:提交 → 推送 → `pnpm release`。已在远端存在同名 release 时脚本拒绝执行,确实要覆盖说明与资产才加 `--update`(资产会被 `--clobber` 覆盖,下载计数归零)。

### 验证

- **单测**:`pnpm test`(vitest,覆盖检索计划、分段状态机、DB 契约、面板纯逻辑、组件行为);
- **数据层 e2e**:`node scripts/verify-kb.mjs` / `verify-p3.mjs` / `verify-golden-multi.mjs` / `verify-settings.mjs` —— 在真实扩展上下文(SW + popup)跑纯数据断言,不开窗口、不截图;
- **CI**:push 到 main 自动跑 tsc + 单测 + build + 数据层 e2e(`.github/workflows/ci.yml`);
- `scripts/e2e-chromium.mjs` 为真机联调探针(需登录态,见脚本头说明)。

- 技术栈:Plasmo + React + TypeScript + Dexie(IndexedDB)+ Xenova Transformers(offscreen 本地嵌入)
- 设计规范:`docs/DESIGN.md`;总体设计:`docs/拼多多客服快捷回复工具-设计文档.md`;架构决策:`docs/adr/`
- 工作状态日志:`docs/工作状态-*.md`;变更记录:`CHANGELOG.md`

## License

Apache 2.0(继承上游)
