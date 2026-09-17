# 知识库切分修复 + AI 整合 — 设计文档

日期：2026-09-17
状态：**已落地**(第四十八轮实现,第五十 / 五十一轮微调面板表达;本文档保留为当时的方案与实测依据)

---

## 一、背景

用户上传 `knowledge/常见问答.md` 作为知识库文档后，提问检索不到。其中一个分块是 9 条互不相关的 QA 挤在一起的 473 字大块。

这不是配置问题，是分块器的结构性缺陷。

---

## 二、目标与非目标

**目标**

1. 修复知识库文档的分块粒度，使短问句能稳定命中对应条目
2. 新增可选的「AI 整合」：用户主动选择时，用自配 API 把命中的知识库内容整合成可直接发送的话术

**非目标**

- 不改动历史回答 / 标准回答的检索路径（它们只检索，不参与任何 LLM 处理）
- 不改动「发送始终由人工确认」这条硬边界
- 不引入云端 embedding（嵌入仍为本地 bge-small-zh-v1.5）
- 默认不改变任何现有交互；AI 整合默认关闭

---

## 三、问题定位

### 3.1 代码根因

`src/shared/mdText.ts#chunkMarkdown()` 的规则是「有标题就按标题切节」。`常见问答.md` 只有 `# 常见问答` 一个标题，11 条 QA 全落进同一个节；节正文 473 字（9 条 QA）≤ `CHUNK_SIZE_CHARS = 500`，整节原样成块。

后果：bge 把 9 个主题平均成**一个**向量，任何单主题问句与它的余弦都被稀释。

### 3.2 实测数据

本地 bge-small-zh-v1.5（量化）实测，阈值 `kbThreshold = 0.4`（`retrieval.ts:165-176` 的阈值过滤是**第一步**，BM25 在其后，无法救回被过滤的块）：

| 查询 | 现状整块（473 字） | 切分后（单条 QA） |
|---|---|---|
| 防水吗 | **0.391 ✗ 低于阈值** | **0.709** |
| 这个防水吗 | 0.422（擦线） | 0.706 |
| 麦克风防水吗 | 0.497 | 0.538 |
| 充电要多久 | 0.555 | 0.780 |
| 续航多久 | 0.552 | 0.629 |
| 能连大疆吗 | 0.459 | 0.649 |
| 怎么连手机 | 0.503 | 0.703 |
| 降噪效果怎么样 | 0.472 | 0.565 |

两点结论：

- 「防水吗」直接跌破阈值 → 完全检索不到，复现用户报告
- 同一意图的不同问法横跨阈值两侧（0.391 / 0.422 / 0.497）→ 表现为「时灵时不灵」，难以归因

> **2026-09-17 落地后复测**（`scripts/_chunk-probe.mjs`，走真实代码路径：esbuild 编译 `src/shared/mdText.ts` → 真实 `chunkMarkdown` → 真实 bge 模型）：
> `常见问答.md` 切出 **11 块，全部 `kind === 'qa'`**（原为 1 块）；上表 8 个查询的实测余弦与「切分后」列**偏差 0.000**，最低 0.538（「麦克风防水吗」），全部过 `kbThreshold = 0.4`，且 top1 均命中正确条目。「防水吗」0.391 → **0.709**。

### 3.3 锚文本变体实测

另测「仅用问句做锚文本」：多数查询更高（怎么连手机 0.812、能连大疆 0.798），但两处明显更差——「降噪效果怎么样」0.437 vs 0.565、「续航多久」0.592 vs 0.629（问句「吵闹环境能用吗？」不含"降噪"二字，答案里才有）。

**结论：锚文本保持 `问句 + 答案`**（即现有 `kbAnchorText()` 的行为），不改。

---

## 四、切分改造

### 4.1 位置

`src/shared/mdText.ts`，在 `chunkMarkdown()` 的节处理分支内，`mdToPlainText()` 之后、`groupLines()` 之前，新增一层 QA 探测。

### 4.2 规则

**探测**：统计 plain 文本中以 `/^(?:Q|问)\s*[：:]/` 开头的行数。

- 行数 ≥ 2 → 进入 QA 切分分支
- 行数 < 2 → 走现有逻辑，行为完全不变

**切分**：每个 Q 行 + 其后到下一个 Q 行前的所有非空行 = 一个块。

- 问句 = Q 行去掉前缀（及可选的 `A：` 之后的部分）
- 答案 = 同行 `A：` 之后的内容，或后续行的内容（去掉可能的 `A：` 前缀）
- Q 行之前的引言行归入紧随其后的块
- 单块仍 > `CHUNK_SIZE_CHARS` → 复用 `groupLines()` 兜底，标题加 `(续n)`，`kind` 保持 `'qa'`

**输出**：`MdChunk { title: 问句, text: 答案, kind: 'qa' }`

`MdChunk`（`src/shared/mdText.ts`）新增 `kind: 'qa' | 'section'`，现有分支产出一律为 `'section'`。

`KnowledgeRecord`（`src/types/memory.ts`）相应新增两个字段，供 6.3 的材料组装定位同类块：

```ts
/** 块类型:qa=问答体切出的单条;section=按标题切出的节(含长节续块) */
chunkKind?: 'qa' | 'section'
/** 源节在文档中的序号(0 起,文档顺序):同一节被拆成多块时这些块共享同一 sectionSeq */
sectionSeq?: number
```

经 `importKbDocument` 的 `${docId} · ${title}` 拼装后，检索锚变为：

```
常见问答 · 防水吗？
不防水，请注意防雨防潮，进水不在保修范围。
```

向量、BM25、面板「来源」摘要三处同源，精确到单条。

### 4.3 兼容的写法

必须支持（列入单测）：

| 写法 | 说明 |
|---|---|
| `Q：xxx A：yyy` | 同行，当前文档格式 |
| `Q：xxx` / `A：yyy` | 分行 |
| `- Q：xxx` / `* Q：xxx` | 列表前缀（`mdToPlainText` 已剥离） |
| `**Q：** xxx` | 加粗（`stripInline` 已剥离） |
| `Q: xxx` | 半角冒号 |

### 4.4 边界

- 只有 1 条 Q → 不进 QA 分支
- Q 无 A → 问句作 title，正文为空则跳过该块
- QA 分支只作用于节内，节标题层级不受影响
- **不变量**：`chunkText` / `groupLines` / `snapBlank` 行为不变

---

## 五、kbDocs 原文表与自动重分块

### 5.1 问题

`knowledge` 表只存切好的块，不存原文；`EMBEDDING_VERSION` 的懒重嵌只重嵌锚文本，**不会重新切块**。因此分块器一改，已上传的文档就与新规则脱节。

### 5.2 方案：存原文

`src/types/memory.ts` 新增：

```ts
/** 知识库文档原文(kbDocs):重分块的事实源;豁免保留期 */
export interface KbDocRecord {
  /** 主键:文档名(去扩展名) */
  docId: string
  /** markdown 原文,原样保存 */
  content: string
  /** 落块时的分块器版本;不等于当前值 → 待重分块 */
  splitterVersion: string
  chunkCount: number
  createdAt: number
  updatedAt: number
}
```

`src/background/db.ts` 新增 `version(5)`：

```ts
this.version(5).stores({
  kbDocs: "docId, splitterVersion",
})
```

DAO：`putKbDoc` / `getKbDoc` / `listKbDocs` / `deleteKbDoc` / `getStaleKbDocs(version)`。

`src/shared/constants.ts` 新增 `SPLITTER_VERSION = '2.0.0'`（当前隐式版本记为 `'1.0.0'`）。

### 5.3 改造点

- `importKbDocument()`：事务内写 kbDocs + 删旧块 + 写新块；嵌入入队仍在事务提交后
- 新增 `resplitStaleDocs()`：扫描 `splitterVersion ≠ SPLITTER_VERSION` 的文档 → 重新分块重嵌。挂在 `syncEmbeddings.ts` 的启动钩子（SW 唤醒 8s 那条）上
- `deleteKnowledgeByDoc()` 的所有调用点需同时删 kbDocs 记录

---

## 六、AI 整合

### 6.1 设置

`PddSettings`（`src/types/memory.ts`）新增：

```ts
/** AI 整合开关;默认 false。关闭或未配置 API 时,扩展保持完全本地 */
aiIntegrateEnabled: boolean
/** OpenAI 兼容端点 base url,默认 '' */
llmBaseUrl: string
/** API key,默认 '';仅存 chrome.storage.local,永不同步 */
llmApiKey: string
/** 模型名,默认 '' */
llmModel: string
/** 单次整合超时(毫秒),默认 8000 */
llmTimeoutMs: number
```

`DEFAULT_SETTINGS`（`src/shared/constants.ts`）与 `clampSettings()`（`src/background/settings.ts`）均需覆盖新字段。

设置页（`src/popup/SettingsTab.tsx`）新增「AI 整合」区：

- 开关 + 说明文案（讲清楚：开启后主动点击整合项时，会把本轮知识库内容与买家问题发往你所配置的 API）
- base url / api key / model 输入 + 「测试连接」
- 文案提示：建议选用不带深度思考的快速模型
- **保存时申请 host 权限**（`chrome.permissions.request({ origins })` 必须在用户手势回调内）

### 6.2 面板表现

`src/contents/pdd-ai-button.ts`（原生 DOM 覆盖层，非 React）：

条件 `aiIntegrateEnabled && 已配 API && 本轮知识库候选 > 0` 全部成立时，在第一个知识库候选**之前**插入一行整合项：

```
│ [标准回答] …                        │
│ [历史] …                            │
├─────────────────────────────────────┤
│ ✦ 根据知识库内容整合并回复            │  ← 新增行
├─────────────────────────────────────┤
│ [知识库] 防水吗？                    │  ← 照常展示、照常可选中填原文
│ [知识库] 充电要多久？                 │
```

- 参与现有 `moveSelection` 键盘导航
- 条件不满足时不渲染该行，面板与现状**零差异**

### 6.3 材料组装

材料 = **本轮面板展示的知识库候选**（最多 `PANEL_QUOTA.knowledge = 3` 条），即「所见即所发」，外发内容完全可预期。

唯一例外：候选的 `chunkKind === 'section'` 时，追加同 `docId` + 同 `chunkKind` + 同 `sectionSeq` 的兄弟续块——因为长节被拆开意味着答案本来就被切断了，必须接上。`chunkKind === 'qa'` 的块答案自足，不扩展。

（三个键缺一不可：同一节里可能既有 `section` 型的引言行又有 `qa` 型问答，只按 `sectionSeq` 匹配会把不相关的块也拉进来。）

组装步骤：

1. 取本轮知识库候选，按 score 降序
2. `section` 型候选 → 按 `(docId, sectionSeq)` 取全部兄弟块，按 `sectionSeq` 内序拼接
3. 去重（同 `id`、同正文哈希）
4. 超 3000 字截断（保留高分块完整，尾部截断）

### 6.4 生成流程

选中整合项 → content script 发 `AI_INTEGRATE` 给 SW → SW 调 LLM 流式生成 → 增量推回 content script。

面板状态机：

| 时点 | 表现 |
|---|---|
| < 200ms | 不显示 loading（防闪烁） |
| ≥ 200ms | 该行原地显示「正在整合知识库…」 |
| 首 token 到达 | 逐句渲染草稿 |
| 完成 | **直接填入输入框**，随即**面板自行退场**（toast「已整合并填充 · 请手动发送」）；填不进去（页面无输入框）才不退场，行显示「✓ 已生成」+「重新生成」供手动复制 |
| 超时 / 失败 | 行显示「整合失败，请检查 API 配置」+「重试」；下方候选照常可用，不阻塞 |
| 模型判定无法回答 | 行显示「知识库内容不足以回答」，不填入 |

> 「完成」那两格是第五十 / 五十一轮改的：先统一成「已生成」而不是「已填入」，
> 再把填成功那一路的退场交给结果（`docs/DESIGN.md` v2.7.2）。**唯一会影响本规格的边界没动** ——
> 见 6.5：填完不等于发送，`AI_INTEGRATE` 全链路只写输入框。

### 6.5 与直接填充路径的关系

`directFillEnabled`（设置页的「直接填充」开关）路径**不调用 LLM**，只按相似度检索填充（优先级沿用现有：金标准 > 知识库空档 > 历史）。

该路径本就不打开面板，天然不会触发 AI 整合；实现上需确保该分支不引入任何网络请求。

---

## 七、LLM 调用层

新文件 `src/background/llm.ts`：

```ts
integrateReply(opts: {
  query: string
  materials: string[]
  settings: { baseUrl: string; apiKey: string; model: string; timeoutMs: number }
  onDelta: (text: string) => void
}): Promise<{ ok: true; text: string } | { ok: false; error: string }>
```

- `POST ${baseUrl}/chat/completions`，OpenAI 兼容协议
- body：`{ model, messages, stream: true, temperature: 0.2, max_tokens: 256 }`
- **不发送任何 reasoning / thinking 相关参数**
- SSE 解析：逐行读 `data: `，取 `choices[0].delta.content`，`[DONE]` 结束
- 函数内部创建 `AbortController` 并设 `timeoutMs` 定时中止，abort 归一为 `{ ok: false, error: 'timeout' }`；调用方无需传 signal
- 从 background service worker 发出（fetch 进行中 SW 不会被挂起）

Prompt 要点：

- system：只使用给定资料回答，不编造、不添加资料外的承诺；直接输出回复正文，不要开场白、不要复述问题；语气礼貌简洁口语化
- 资料不足以回答时，只输出哨兵 `[无法回答]`
- user：`【知识库资料】…【买家问题】…`

`manifest`（`package.json`）新增：

```json
"optional_host_permissions": ["https://*/*"]
```

保存配置时按用户填的 base url 动态申请具体 origin。

---

## 八、数据边界决策修订

`docs/工作状态-2026-09-08.md:1479` 记录的结论是「暂不接生成模型，云端 LLM 违反『数据不出本机』红线」。

本次不推翻该结论，而是**加条件豁免**，新增 ADR `docs/adr/0006-optional-llm-integration.md`：

> 仅在用户 ① 显式配置第三方 API、② 开启 AI 整合开关、③ 在面板主动点击整合项 三条同时成立时，才将**本轮检索出的知识库候选文本 + 当前买家问题**发往该 API。
> 历史回答与标准回答永不外发；不开启则扩展保持完全本地；默认关闭。

---

## 九、测试

| 文件 | 覆盖 |
|---|---|
| `tests/unit/shared/mdText.test.ts` | QA 切分各写法、边界、单条 Q 不触发、超长续块 |
| `tests/unit/background/kbResplit.test.ts` | kbDocs 存取、版本失配重分块、原子性（fake-indexeddb） |
| `tests/unit/background/llm.test.ts` | SSE 解析、超时中止、HTTP 错误、`[无法回答]`（mock fetch） |
| `tests/unit/pdd/panel-ai-row.test.ts` | 整合行渲染条件、键盘导航、开关关闭时零差异 |

**回归不变量**：现有 `mdText` / `chunkText` 测试必须全绿。

---

## 十、分阶段实施

### P1 切分修复（独立可验收，解决核心 bug）✅ 已完成

1. `mdText.ts` QA 感知切分 + 单测
2. `SPLITTER_VERSION` + `kbDocs` 表 + `resplitStaleKbDocs()`
3. 验收：对 `常见问答.md` 重新索引后复测第 3.2 节表中各查询，两条同时满足：
   - 「防水吗」由 0.391（低于阈值）升至 0.709，稳定过线
   - 全部查询的切分后余弦高于 `kbThreshold = 0.4` 且留有余量（实测最低 0.538，为「麦克风防水吗」）

**落地实现**（第四十八轮，`feat/kb-chunking-and-ai-integration`）：

| 文件 | 内容 |
|---|---|
| `src/shared/mdText.ts` | `SPLITTER_VERSION = '2.0.0'`；`MdChunk` 加 `kind` / `sectionSeq`；`splitQaSection()`；无标题文档也先试 QA 切分 |
| `src/types/memory.ts` | `KbDocRecord`；`KnowledgeRecord` 加 `chunkKind` / `sectionSeq` |
| `src/background/db.ts` | `version(5)` + `kbDocs` 表；`putKbDoc` / `getKbDoc` / `deleteKbDoc` / `getStaleKbDocs` |
| `src/background/knowledge.ts` | 导入落原文 + 写块元数据；删最后一块时清理孤儿原文 |
| `src/background/kbResplit.ts` | `resplitStaleKbDocs()`，挂 SW 启动 8s 钩子（先于补嵌） |

测试：`tests/unit/shared/mdText.test.ts`（+9）、`tests/unit/background/db-pdd.test.ts`（+3）、`tests/unit/background/knowledge.test.ts`（+7）、`tests/unit/background/kbResplit.test.ts`（+4）。全量 359 通过。

> 与设计的偏差：`SPLITTER_VERSION` 放在 `src/shared/mdText.ts` 而非 `src/shared/constants.ts` —— 它是分块器自身的版本，与切分逻辑同文件才不会被漏改。

### P2 AI 整合

1. 设置项 + 设置页 UI + host 权限申请
2. `llm.ts` 流式调用层（超时、降级、哨兵）
3. 面板整合行 + 流式渲染 + 直接填充
4. ADR-0006

**验收标准**

- 开关关或未配 API → 面板与现状零差异，无任何网络请求
- 开关开且已配 → 知识库候选块上方出现整合行
- 无知识库命中 → 不渲染该行
- 选中后 ≤ 8s 内填入输入框，或给出明确失败提示
- 直接填充路径全程零 LLM 调用
