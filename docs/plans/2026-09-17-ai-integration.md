# AI 整合（P2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户自配 LLM API 后，推荐面板知识库候选上方出现「根据知识库内容整合并回复」一行；点击后流式整合本轮知识库内容，生成完直接填入输入框。

**Architecture:** 流式走长连接 Port（content 发起 `chrome.runtime.connect`，SW 增量回推）。材料 = 面板已展示的知识库候选（所见即所发），`section` 型候选追加同节续块。默认关闭 + 未配 API + 「自动回复」开，三种情况下面板与现状零差异、零网络请求。

**Tech Stack:** TypeScript · Plasmo · Chrome MV3 Port 长连接 · SSE 流式 · Vitest（mock fetch）

**Spec:** `docs/specs/2026-09-17-kb-chunking-and-ai-integration-design.md` §六/§七/§八

## Global Constraints

- 不引入任何新依赖
- **不发送任何 reasoning / thinking 参数**（用户明确「不需要深度思考」）
- 历史回答与标准回答**永不**外发；只有知识库候选文本 + 当前买家问题出网
- 默认 `aiIntegrateEnabled = false`；「自动回复」(`directFillEnabled`) 开时 SW 侧也必须拒绝整合请求
- 发送始终由人工点击 —— 整合结果只填输入框，绝不自动发送
- 提交信息格式：`type: 描述(第四十八轮)`

## 关键接口（实现前锁定）

```ts
// src/background/llm.ts
export const NO_ANSWER_SENTINEL = '[无法回答]'
export interface LlmConfig { baseUrl: string; apiKey: string; model: string; timeoutMs: number }
export type LlmResult = { ok: true; text: string } | { ok: false; error: string }
export function isLlmConfigured(c: Pick<LlmConfig,'baseUrl'|'apiKey'|'model'>): boolean
export function buildMessages(query: string, materials: string[]): ChatMessage[]
export async function integrateReply(opts: {
  query: string; materials: string[]; config: LlmConfig; onDelta: (t: string) => void
}): Promise<LlmResult>

// src/background/aiMaterials.ts
export async function collectMaterials(knowledgeIds: string[]): Promise<string[]>

// src/types/messages/retrieval.ts — UiSettings 增
aiAvailable: boolean

// 面板行模型（pdd-ai-button.ts 内部）
type PanelRow = { kind: 'cand'; s: Suggestion } | { kind: 'ai' }
```

## 任务

- [x] **P2-1 设置项**：`PddSettings` 加 `aiIntegrateEnabled` / `llmBaseUrl` / `llmApiKey` / `llmModel` / `llmTimeoutMs`；`DEFAULT_SETTINGS` 与 `clampSettings` 覆盖（timeout 夹在 2000~30000）；JSON 校验拒绝非 http(s) 的 baseUrl。测试走 `tests/unit/background/settings.test.ts`（若无则新建）。
- [x] **P2-2 LLM 调用层**：`src/background/llm.ts`。SSE 解析、超时（函数内部 AbortController，归一为 `{ok:false,error:'timeout'}`）、HTTP 错误、哨兵。测试 `tests/unit/background/llm.test.ts`（mock fetch + ReadableStream）。
- [x] **P2-3 材料组装**：`src/background/aiMaterials.ts`。取候选 → `section` 型补同节续块（同 docId + 同 chunkKind + 同 sectionSeq，按 id 的 `-c<n>` 序号排）→ 去重 → 3000 字截断。测试 `tests/unit/background/aiMaterials.test.ts`。
- [x] **P2-4 SW 接线**：`GET_SUGGESTIONS` 回传 `aiAvailable`；新增 `AI_INTEGRATE` Port 通道（`pddcs:ai`），流式推 `DELTA` / `DONE` / `ERROR`。
- [x] **P2-5 面板整合行**：`pdd-ai-button.ts`。条件成立时在首个知识库候选上方插入 `.pddcs-cand.pddcs-ai-row`；纳入 `armedPanel` 键盘导航；<200ms 不显示 loading；流式逐句渲染；完成直接 `fillInput`；失败显示「整合失败，请检查 API 配置」+ 重试。
- [x] **P2-6 设置页 UI**：`SettingsTab.tsx` 新增「AI 整合」区（开关 + 说明文案 + base url / api key / model / 超时 + 测试连接）；保存时在用户手势内 `chrome.permissions.request({ origins })`；`package.json` 加 `optional_host_permissions`(收了 https 与 http —— 本地 Ollama/LM Studio 走 http,是"数据不出本机"最该支持的部署方式)。
- [x] **P2-7 ADR + 工作状态**：`docs/adr/0006-optional-llm-integration.md`；回写 `docs/工作状态-*.md`。

## 完成记录(2026-09-17)

七个任务全部落地,提交在 `feat/kb-chunking-and-ai-integration`(11 提交,含 P1 分块 5 个)。

**验收**:`tsc --noEmit` 0 错;单测 **446/446**(41 文件,本轮 335→446);`plasmo build` 过;
产物 manifest 确认 `optional_host_permissions` 正确落盘。

**实现中偏离计划的两处**(均已按实际需要调整):
1. `PanelRow` 用可辨识联合 `{ ai: false; s: Suggestion } | { ai: true }` —— 计划里写的
   `{ kind: 'cand' | 'ai' }` 会和 `Suggestion` 自己的 `kind` 字段撞名。
2. 设置页三个文本框走**显式保存**(全页唯一),而非沿用开关/滑杆的自动保存:
   API Key 不该每敲一个字符就落一次库,且 `chrome.permissions.request` 必须有用户手势。

**未做**:真机 e2e(`verify-ai-popup.mjs` 一类)未跑,本轮只做纯数据层验证;
带真实 API 的全链路仍需一次手动验收。

**验收**：开关关 / 未配 API / 「自动回复」开 → 面板与现状零差异且零网络请求；三条同时成立 → 知识库候选上方出现整合行；选中后 ≤ 8s 内填入输入框或给出明确失败提示；直接填充路径全程零 LLM 调用。
