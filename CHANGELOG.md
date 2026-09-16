# Changelog

本扩展(拼多多客服快捷回复)的变更记录。格式参考 Keep a Changelog,版本号即 package.json 版本。

> 上游 Personal AI Memory 的历史变更见 `docs/upstream-CHANGELOG.md`(Apache 2.0);
> 逐轮开发明细见 `docs/工作状态-2026-09-08.md` 与 git log(每轮均有 docs+test 提交)。

## 0.10.0 — 2026-09-16

### 修复
- 编辑金标准问题后检索缓存未失效,旧问题锚/旧向量继续参与检索直至 SW 重启(第二十七轮)
- 知识库文档整篇替换「先删旧后写新」无事务,中途失败丢失整篇旧文档(第二十七轮)

### 工程审查(第二十七轮起)
- SW 消息路由 24 分支 switch 改类型化 handler 映射表,消除逐 case 的 `as` 强转
- manifest 配置收敛到 package.json 单处(原 config 文件优先,双份有静默漂移风险)
- scripts/ 抽公共底座 `lib.mjs`:路径相对化 + 环境变量覆盖,归档一次性探针/诊断脚本
- `.gitignore` 覆盖乱码 profile 目录,防登录态误入库
- 中期重构(第二十九轮):建 `src/shared/`(跨上下文基础设施+常量)与 `src/pdd/`(平台领域纯逻辑),types/ 回归纯类型,embedding 引擎归位 offscreen —— 后台 bundle -85%;utils/ 与 504 行 messages.ts 按域拆清
- 数据层 e2e 进 GitHub Actions(第三十一轮);scripts 底座去硬编码 chrome 路径(`channel: 'chromium'` 支持无头加载扩展,`PDD_E2E_CHROME` 可覆盖)
- FoldersTab 操作流补 11 例特征测试;pdd-ai-button 覆盖层几何(行可视/按钮与弹窗定位/滚动校正)提取为 5 个纯函数,TDD 18 例
- ADR 0004:检索管线不包化,目录分层即边界

### 界面(第二十五~二十六轮)
- 推荐面板 ChatGPT 化:去分隔线 / 柔和双层阴影 / 徽标圆点化 / 页脚键帽化
- 候选卡对话式排版 + 字号主次四层级(回答正文为唯一主层)
- 面板循环切换滚动校正:回绕首条回顶,不再被 sticky 头遮盖

### 更早(第二十~二十四轮)
- 检索配额 3/3/3、知识库独立阈值、标准回答同问多答上限
- 面板键盘导航(Tab 循环 + Enter 填充)、细滚动条公共化、面板不透明双保险

明细见 `docs/工作状态-2026-09-08.md` §〇-S 至 §〇-Z。
