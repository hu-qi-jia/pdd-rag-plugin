# 捕获层采用页面内网络层 hook(fetch/WebSocket)+ DOM 兜底,不直连平台通道

> **状态:已被后续真机验证取代。** 当前实现为 DOM 单路线
> (`MutationObserver + 低频兜底扫描`)，不再注入网络层 hook。本 ADR 保留为当时决策的历史记录，
> 现行架构见 `docs/拼多多客服快捷回复工具-设计文档.md` §5 与 `src/contents/pdd-chat-capture.ts`。

拼多多商家聊天工作台(`mms.pinduoduo.com/chat-merchant`)实时通道为 WebSocket(`wss://m-ws.pinduoduo.com`)+ HTTP(`/plateau/chat/*`),帧内自带方向字段 `from.role`(user=买家 / mall_cs=客服);官方开放平台无客服会话接口。社区方案(直连 WS + `chats/getToken`)需维护平台轮换的 version 常量与 token,合规风险最高。

本扩展在登录态的页面内 MAIN-world 环境中 hook fetch/WebSocket 与 MutationObserver(DOM 兜底),复用原项目的双 world 桥接架构:免 token 维护、方向字段可靠、DOM 文本兜底。**边界**:扩展只读与填充——所有发送动作落在官方输入框、由客服本人点击发送;内容仅存本地 IndexedDB 不外传,遵守平台"必须使用官方工具沟通"规则的最低风险姿态。
