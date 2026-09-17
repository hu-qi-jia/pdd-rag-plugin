# 拼多多客服检索工具

单人客服在本地 Chrome 中使用的 MV3 扩展:自动捕获拼多多商家后台聊天页的买家问答,沉淀为本地可向量检索的回复候选;检索历史回复 / 标准回答 / 知识库,一键填充到官方输入框。

> 由开源项目 Personal AI Memory v0.0.7(Apache 2.0)改造而来,仅保留其本地嵌入/检索底座,业务层为拼多多客服场景全新实现。

## 功能

- **自动捕获**:客服打开的会话内,买家连续消息合并为问题、客服回复挂载到问题,本地 IndexedDB 存储,保留期默认 90 天(可调);
- **混合检索**:问题向量(bge-small-zh-v1.5,本地推理)+ BM25 双路 RRF 融合,完全本地运行,无云端调用;
- **标准回答**:优秀回复可提升为标准回答(独立问答文档,文件夹归类,豁免保留期),同问题可挂多条;
- **知识库**:手工"标题+正文"话术卡与 .md 文档上传(自动分块),作为独立检索来源;
- **推荐回复面板**:聊天页「AI回复」按钮或自定义快捷键唤起,组成固定:标准回答至多 3 + 历史最近 3 + 知识库 3(另含可选的「AI 整合」行);
- **一键填充**:候选点击后写入官方输入框 `textarea#replyTextarea`,**发送永远由人工点击**——绝不自动发送;
- **主题**:亮 / 暗两主题,聊天页覆盖层与弹窗跟随设置。

## 合规边界

只记录与填充,不替客服发送;数据仅存本机。

**唯一的外发通道**(ADR-0006,默认关):你亲手填好第三方 LLM 接口与密钥、打开「AI 整合」开关、
再主动点击面板里的「根据知识库内容整合并回复」行 —— 三条同时满足,才把**当轮面板展示的知识库内容
与买家问题**发给你配置的那个接口。**历史回答与标准回答永不外发**,API Key 只进本机存储、
不随导出外发;整合结果也只填进输入框,发送仍由你点。此外无遥测、无日志上报。

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
├── popup/        # 弹窗 UI(React):统计 / 记忆 / 文件夹 / 知识库 / 设置五页签;logic.ts 为纯逻辑 Model 层
├── ui/           # 设计系统:theme 令牌 / design 尺寸 / components(Toggle·Slider·Card)/ overlay-css
├── shared/       # 跨上下文基础设施:text、mdText、chunkText、hotkey、message-passing、chrome-storage、常量
├── pdd/          # 拼多多平台领域纯逻辑:dom-parser、bubble-anchor、ui-logic、segmenter(分段状态机)
└── types/        # 纯类型:memory(存储 schema)、messages/(24 对消息按域拆分)、transfer(导入导出信封)
tests/
└── unit/{background,popup,ui,shared,pdd}/   # vitest 单测,目录与 src 对应
scripts/          # 数据层 e2e 验收脚本(Playwright 真实扩展上下文)+ lib.mjs 公共底座
docs/             # 设计文档(唯一事实源)、DESIGN.md、ADR、工作状态日志
```

分层约定:`types/` 只放类型;运行时常量在 `shared/constants.ts`;平台纯逻辑进 `pdd/`,通用基础设施进 `shared/`,UI 组件与令牌进 `ui/` —— 任何目录都不做杂物抽屉。

## 开发

```bash
pnpm install
pnpm dev     # 开发模式(自动加载扩展)
pnpm build   # 产物在 build/chrome-mv3-prod
pnpm test    # vitest 单测
node scripts/package.mjs   # 打发布 zip(pdd-cs-quick-reply-v<版本>.zip;自检产物版本一致 + 内置模型在包内)
```

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
