# 问题自动分类与按类型检索 — 设计文档

日期：2026-10-11
状态：**设计已确认，待实施**
上游：`docs/adr/0006-optional-llm-integration.md`（本次修订其外发边界）
相关：`docs/specs/2026-09-17-kb-chunking-and-ai-integration-design.md`（知识库与 LLM 整合，本次复用其调用与面板模式）

---

## 一、背景

历史回复检索有一个结构性缺陷：**它假定答案与买家个体无关。**

订单类问题上这个假定成立 —— "亲，48 小时内更新物流"对谁都一样，历史回复可以直接复用。但尺码类问题上不成立 —— "我 165 能穿吗"和"我 180 能穿吗"在语义上高度相似（向量距离很近），答案却完全相反。**语义相似不等于答案可复用**，而现有检索只认语义相似。

后果是尺码类问题会召回到一批"看起来对、实际答错"的历史回复，比搜不到更糟。

修法不是改检索算法，而是**在检索之前先判断"这个问题该去哪儿找答案"**，据此缩小甚至更换检索源。

同时引入 TypeSafe 的 **jev 模型**（System One 决策模型，非生成模型）承担这个判断。它返回带概率的结构化选项，天然适合路由。

---

## 二、目标与非目标

### 目标

1. 用 jev 给**历史问答**与**标准回答**自动打上问题类型；标准回答可人工纠正
2. 查询时用 jev 判定买家问题类型，据此**缩小检索池**，减少无效计算
3. 纯尺码类问题**不检索历史**，改走"尺码表 + LLM 现场生成"
4. **未配置 jev、jev 超时或失败时，检索结果与今天逐字节等价** —— 兜底是结构性保证，不是补丁分支

### 非目标

- **不给知识库分类**（用户明确要求）。知识库永远不过滤
- **不新建向量数据库**。项目里本来就没有向量库（见 §四）
- **不改动** TTL / 保留期、直接填充开关、快捷键盘、使用统计、相似度阈值、`PANEL_QUOTA` 配额、导入导出信封（详见 §十三 不变量清单）
- **不引入多标签机制**。"多意图"由 `choice` 自带的概率分布处理（见 §七.3），不需要额外请求

---

## 三、已锁定决策汇总

| # | 决策 | 取值 |
|---|---|---|
| D1 | 分类外发的内容 | 只发**问题文本**。回复正文、标准回答正文永不出本机 |
| D2 | 分类体系粒度 | 6 个预置类型（去掉最初的"其他"） |
| D3 | 预置类型可否修改 | **不可改名、不可删、判定说明不可改**。用户可新增自己的类型 |
| D4 | 手工文件夹 | **整套下线**，转为自定义类型保留（不丢名字、不丢归属） |
| D5 | 尺码表形态 | 知识库文档 + 尺码表标记；取**整篇原文**喂 LLM，**不做向量检索** |
| D6 | 无 jev 时 | 全部落未分类 → 检索走全池 → 等价于今天 |
| D7 | 存量补分类 | **手动按钮**，按钮旁写明将发送多少条 |
| D8 | 历史问答分类 | **只读**（90 天过期，纠错价值低于成本） |
| D9 | 标准回答分类 | 可人工纠正（类型标签即下拉） |
| D10 | 补分类按钮位置 | 设置页「问题分类」区 |
| D11 | 分类继承 | 历史问答 → 标准回答**直接继承**，不重复调 jev |
| D12 | 多意图 | 取概率 ≥ 阈值的**所有**类型（并集），不取胜者 |
| D13 | 分类写回缓存 | **定点更新**，不调 `invalidateRetrievalCache()` |
| D14 | 旧的"其他"类型 | 删除。其场景由"未分类"承担 |

---

## 四、现状（本次改动的立足点）

### 4.1 没有向量数据库

向量是 `Float32Array` 字段，**存在每条 IndexedDB 记录里**：

- `QaRecord.embedding`（历史问答，问题锚）
- `GoldenRecord.qEmbedding`（标准回答，问题锚）
- `KnowledgeRecord.qEmbedding`（知识库块，锚文本）

检索时 `src/background/retrievalCache.ts` 把三张表的"已嵌"条目读进 **SW 内存**，`rankCandidates` 线性扫一遍算点积。**不是** ANN 检索，没有索引结构。

因此"不同类型一个向量库"不该做 —— 效果等价但成本高得多。正确做法是**一个内存池 + 每条带类型字段 + 检索时过滤**。

### 4.2 真正省下的是什么

`src/background/retrieval.ts:188`：

```ts
const docsTokens = survivors.map((s) => tokenize(s.source.question))
```

**每次检索都要对池子里每条问题重新分词建词表**，这是热路径（比向量点积贵）。池子按类型缩到 10%，这一步的工作量就降到 10%。

### 4.3 文件夹现状

`FolderRecord` 是一棵两层手工树，**只挂在 `goldens` 上**（`GoldenRecord.folderId`）。`qaRecords` 与 `knowledge` 没有任何分类字段。检索**完全不看文件夹** —— `rankCandidates` 连 `folderId` 参数都没有。

### 4.4 无任何意图识别代码

全仓 grep 无分类/意图相关实现。唯一叫"分类"的是 `SourceKind = 'golden' | 'knowledge' | 'history'`（来源类型）与文件夹树的描述。

---

## 五、分类体系

### 5.1 六个预置类型

`kind = 'preset'`，**不可改名、不可删、判定说明不可改**（D3）。

| id | name | route | criteria（即喂给 jev 的选项描述） |
|---|---|---|---|
| `preset:size` | 尺码推荐 | `size` | 买家在询问自己该选哪个尺码或规格：给出身高、体重、三围、鞋码等个人参数，或问偏大偏小、是否合适、自己穿几码。答案取决于买家的个体参数。 |
| `preset:order` | 订单物流 | `retrieve` | 询问发货时间、催发货、快递公司、运单号、物流停滞不更新、修改收货地址、大概多久到货。围绕**已下单的包裹**在路上或还没发。 |
| `preset:aftersale` | 售后退换 | `retrieve` | 退换货、退款、运费险、七天无理由、商品质量问题、破损、少发漏发、需要维修。围绕**成交之后**的问题。 |
| `preset:price` | 价格优惠 | `retrieve` | 询问价格、优惠券、满减、议价讲价、能不能便宜、是否包邮、有没有活动或赠品。 |
| `preset:attribute` | 商品属性 | `retrieve` | 询问商品本身的客观属性：材质成分、产地、尺码表以外的规格型号、颜色、配件清单、洗涤保养方式。 |
| `preset:stock` | 库存发货 | `retrieve` | **购买前**询问库存：现在有没有货、某个颜色或尺码还有没有、什么时候补货、能不能拍。与"订单物流"的区别是这里**还没下单**。 |

> 判定说明必须彼此可区分 —— jev 的 `choice` 只会从给定选项中选，选项描述写得含糊，全部类型的判断质量一起下降。

### 5.2 未分类

`id = 'uncategorized'`，`kind = 'uncategorized'`，`filterable = false`。

它不是第 7 个类型，是**兜底容器**，装三种东西：

1. jev 还没跑过的（新捕获、存量未补）
2. jev 跑了但最高概率低于阈值（判不准）
3. 被人工移出来的

**不可改名、不可删。**

### 5.3 自定义类型

`kind = 'custom'`。用户新增，可改名、可删、判定说明自填，默认 `filterable = true`。

**保存校验**：判定说明**必填**且不可为空白 —— 它是 jev 的选项描述，空描述会让该类型在分类时变成噪声选项。这与 `filterable = true` ⇒ `criteria` 非空这条约束（§6.1）是同一件事。

**风险与缓解**：新增类型若与预置类型语义重叠（例如新增"尺码咨询"），jev 会在两个相近选项间摇摆，**全部类型的判断质量一起下降**，不只是新增那类。因此新增类型保存时需要做重叠检查并提示（实现方式见 §十六 P2）。

### 5.4 从旧文件夹迁移来的类型

`kind = 'custom'`、`filterable = false`、`criteria = ''`。见 §十。

---

## 六、数据模型

### 6.1 新表 `categories`

```ts
/** 问题类型(categories):自动分类的分类轴;取代 folders */
export interface CategoryRecord {
  /** 主键。预置为 'preset:size' 等;未分类为 'uncategorized';自定义为 uuid */
  id: string
  /** 显示名 */
  name: string
  /** 判定说明 —— 原样作为 jev 的 criteria 选项描述;预置与未分类不可改 */
  criteria: string
  kind: 'preset' | 'custom' | 'uncategorized'
  /** 查询时怎么走:'retrieve' 按类型筛池;'size' 不走检索,走尺码生成 */
  route: 'retrieve' | 'size'
  /**
   * 是否参与类型过滤。
   * true  = 查询时会按类型筛(类型 T 进池)
   * false = 永远进池,不做类型筛
   * 未分类与迁移来的旧文件夹为 false —— 见 §7.2
   *
   * 硬约束:`filterable === true` 与「是 jev 的分类选项」是**同一个集合**,
   * 不设第二个开关。因此 filterable=true 的类型 criteria 必非空(见 §5.3 的保存校验)。
   */
  filterable: boolean
  /** 显示顺序 */
  position: number
  createdAt: number
  updatedAt: number
}
```

Dexie：`categories: "id, kind, position"`。

种子：SW 启动时 `ensurePresetCategories()`，模式照抄现有 `db.ensurePresetFolders()`（`db.ts:104`）。**已存在的不覆盖**（用户可能已经拖着调过 `position`）。

### 6.2 `qaRecords` 新增字段

```ts
  /** 问题类型;null = 未分类 */
  categoryId?: string | null
  /** 打标时**该标签的概率**(0~1);低于 classifyProbThreshold 不落标,直接进未分类 */
  categoryConfidence?: number
  /** 谁打的标:jev 判的 / 人工指定的 */
  categorySource?: 'jev' | 'manual'
  /** 打标时间。jev 升级或 criteria 调整后可只重跑旧的 */
  categoryAt?: number
```

### 6.3 `goldens` 新增字段

```ts
  /** 取代原 folderId */
  categoryId?: string | null
  categoryConfidence?: number
  /** 比 qaRecords 多一个 'inherit':从历史问答继承而来 */
  categorySource?: 'jev' | 'inherit' | 'manual'
  categoryAt?: number
```

**`folderId` 保留不删**（回滚用），迁移后不再被读写。

### 6.4 `kbDocs` 新增字段

```ts
  /** 是否尺码表。标记为尺码表的文档不做向量检索,整篇原文作为 LLM 材料 */
  isSizeTable?: boolean
```

### 6.5 不加索引

`categoryId` **不加 Dexie 索引**。理由：

- 检索过滤走 `retrievalCache` 的内存条目，不触库
- 面板按类型分组是"全量读后在 JS 里分组"，本来就不依赖索引

加索引意味着 Dexie 要重建该表的索引，迁移代价与风险都不划算。

---

## 七、检索路由

### 7.1 整体判定

```
点击 AI 按钮 / 快捷键
 │
 ├─ bge 算向量  +  jev 判类型            （两条独立，可并行 —— 见 §七.5）
 │
 ├─【A】jev 不可用（未配 key / 超时 / HTTP 错误）
 │      → 类型集合 = ∅ → 不筛 → 全池检索 ＝ 今天的行为，零差异
 │
 ├─【B】类型集合 = ∅（概率全低于阈值，判不准）
 │      → 同上，不筛
 │
 ├─【C】类型集合 = { 尺码推荐 }（且无其他类型）
 │      → 池 = ∅，不检索
 │      → 走尺码路由（§八）
 │      → 尺码路由前提不满足 → 退化成【A】不筛
 │
 └─【D】其余
        → 池 = (类型集合中的 retrieve 型) ∪ (所有 filterable=false 的类型)
        → 知识库永远在池里（不分类）
        → 若类型集合含尺码推荐 → 池照常算，额外挂尺码生成行
        → 有过阈候选 → 返回
        → 无过阈候选 → 放宽到全池重跑（第二段兜底）
```

### 7.2 池子规则

> **池 = 类型集合中 `route='retrieve'` 的类型  ∪  所有 `filterable = false` 的类型**

**唯一例外**：类型集合恰为 `{ 尺码推荐 }` 时（即 §7.1 情形【C】），池 = **∅**，不检索。此时上面那条公式会算出 `filterable=false` 的那些类型（也就是未分类），但那是错的 —— 纯尺码问题不该给历史。这条例外由 §7.1【C】先行判定，不交给本公式处理。

三条源的差别：

| 源 | 是否按类型过滤 |
|---|---|
| 历史问答 `qaRecords` | 过滤：`categoryId ∈ 池` |
| 标准回答 `goldens` | 过滤：`categoryId ∈ 池` |
| 知识库 `knowledge` | **永不过滤**（不分类） |

**为什么 `filterable = false` 的类型必须永远进池**：未分类与迁移来的旧文件夹都不参与 jev 分类，它们无法通过"类型匹配"被选中。若把它们排除，里面的条目将**在任何查询下都搜不到** —— 这是纯粹的召回倒退。

### 7.3 多意图：不取胜者，取并集

jev 的 `choice` 返回**全部选项的概率分布**，不只返回被选中的那个：

```json
{
  "type": "choice",
  "choice": "订单物流",
  "probabilities": { "订单物流": 0.52, "尺码推荐": 0.43, "价格优惠": 0.03, "...": 0.02 },
  "confidence": 0.44
}
```

规则：

> **类型集合 = { 概率 ≥ 阈值的所有类型 }。若为空 → 视为判不准 → 不筛。**

默认阈值 `classifyProbThreshold = 0.2`（可设置）。

这个机制**同时覆盖两种情形，而两者的正确反应恰好相同**：

| 买家问题 | 概率分布 | confidence | 类型集合 | 结果 |
|---|---|---|---|---|
| "快递到哪了" | 订单物流 0.95 | 0.94 高 | `{订单物流}` | 只筛订单物流，干净 |
| "什么时候发货，165 穿多大" | 订单 0.52 / 尺码 0.43 | 0.44 低 | `{订单物流, 尺码推荐}` | 两个都进 —— 多意图都搜 |
| "这个咋整啊" | 六类均 0.17 | ≈0 | `∅` | 不筛 —— 判不准就别乱筛 |

**多意图**与**判不准**在数值上都表现为"概率分散"，而"放宽池子"对两者都是对的。因此不需要多标签机制、不需要额外 `noul` 问题、不多花一分钱。

### 7.4 全池兜底

第二段只在**确实做了类型筛选**时生效：

> 类型筛选后无过阈候选 → 用全池按现有阈值重跑一次。

**为什么必须放宽**：放宽到全池 ＝ 退回今天的行为。这保证了"加了分类之后**永远不会比今天搜得差**"。若不放宽，一次分类错误就等于一次空结果 —— 功能倒退。

【C】纯尺码情形**没有第二段**：那里池子为空是设计意图，放宽会违背"纯尺码不给历史"的原始要求。

### 7.5 查询分类与嵌入的顺序

两条调用互相独立（算向量不需要知道类型，判类型不需要向量），因此可并行，耗时从 `jev + bge` 降到 `max(jev, bge)`。

唯一例外：【C】纯尺码情形不需要嵌入，此时顺序执行反而省一次嵌入。默认实现取**并行**（尺码是少数），但这是 100ms 量级的优化，顺序实现同样可接受。

### 7.6 代码改动点

**唯一过滤点**：`src/background/retrieval.ts:166-176` 那个已经在做的阈值循环。

```ts
for (const { source, vec } of entries) {
  if (allowed !== null && source.categoryId !== null && !allowed.has(source.categoryId)) continue
  const cosine = Math.max(0, Math.min(1, cosineSim(qvec, vec)))
  ...
}
```

`allowed === null` 表示不筛（情形 A / B / C 退化）。

配套：`RetSource`（`retrieval.ts:23-30`）加 `categoryId: string | null`；`retrievalCache.ts` 重建时一并带上。

**RRF、BM25、`PANEL_QUOTA`、阈值门控、时间衰减一律不动。**

### 7.7 缓存写回必须是定点更新

分类结果回来时**禁止**调 `invalidateRetrievalCache()`（`retrievalCache.ts:25`）—— 它会让下次检索整体重建缓存（全表读）。而分类是每捕获一条新问答就回来一次，若每次都整体失效，缓存会在"新问答 + 检索"的节奏里反复重建，**比不做缓存还差**。

新增定点更新：

```ts
/** 单条更新缓存里的类型;O(1)(内部维护 id → 下标 Map) */
export function updateCachedCategory(id: string, categoryId: string | null): void
```

---

## 八、尺码路由

### 8.1 前提

三条**同时**成立才走尺码路由：

1. 至少一个 `kbDocs.isSizeTable === true` 的文档
2. LLM 已配置（`isLlmConfigured`）
3. `aiIntegrateEnabled === true`（沿用现有外发闸门，不新增开关 —— 点击生成行即 ADR 要求的"主动点击"）

任一不满足 → 退化为不筛（全池检索）。

### 8.2 材料组装

**取尺码表文档的整篇原文**，不经向量检索。

理由：尺码表通常 5–8 行，小到可以整表进 prompt。而向量检索对它是**有害**的 —— 买家问"165cm 50kg 穿什么码"，检索可能只命中 M 那一行、漏掉相邻的 L 行，而正确答案往往在边界上。整表喂进去让 LLM 自己对着挑，没有检索失败这一说，结果也可复现。

原文来自 `kbDocs.content`（该表本就在存原文，为重分块加的）。超长时截断到 3000 字，沿用 `aiMaterials.ts#MAX_MATERIAL_CHARS`。

### 8.3 面板表现

在候选面板顶部插入一行（样式与现有 AI 整合行同源，见 `docs/DESIGN.md §七-C`）：

```
│ ✦ 根据尺码表生成回复                    │
│   点击后只发送尺码表内容与买家问题        │
```

点击 → 走现有 `AI_INTEGRATE` 链路 → 流式 → 完成后 `fillInput`，**从不代发**。

### 8.4 纯尺码时不给历史

【C】情形下池子为空，历史问答中的尺码类条目（`categoryId = 'preset:size'`）**不进池**，因此永远不会被当成答案浮出来。这是本次改动的核心价值。

---

## 九、面板

### 9.1 「记忆列表」页（历史问答）—— 只读

按类型分区展示，复用 `docs/DESIGN.md §七-B` 已有的分区容器样式：

```
┌ 订单物流 · 43 ──────────────────┐
│  发货多久能到？          3 条回复  │
│  我的快递到哪了           1 条回复  │
└───────────────────────────────┘
┌ 价格优惠 · 28 ──────────────────┐
│  …                               │
└───────────────────────────────┘
┌ 未分类 · 12 ────────────────────┐   ← 默认折叠，排最后
```

**不提供移动/纠正**（D8）。顶部放一个只读提示行：`未分类 12 条 · 去设置页分类`（无操作按钮）。

### 9.2 「回复文件夹」页 → 改名「标准回答」—— 可编辑

同样的分区，但每条可编辑：

- **换类型**：类型标签本身就是下拉，点开列出全部类型。**不做拖拽** —— 拖拽要在两个渲染栈（React popup + 原生 DOM 覆盖层）各实现一遍，成本远高于一个下拉
- **新建类型**：页头「+ 新建类型」，填名称 + 判定说明
- 预置类型与未分类不可改名/删除；自定义类型可以

### 9.3 设置页新增「问题分类」区

```
问题分类
  [ ] 开启自动分类                  ← 默认关。开启后才会有任何问题被发出
      jev 地址  https://api.typesafe.ai
      API Key   [____________]        [测试连接]
      模型      jev-latest
      超时      3000 ms
      概率阈值   0.2
      ───────────────────────────────
      [ 开始分类全部历史 ]
      将把 1,247 条历史问题 + 38 条标准回答的问题
      发送到 api.typesafe.ai（不含任何回复内容）
```

---

## 十、迁移（DB v7 → v8）

```
1. 建 categories 表;种下 6 个预置 + 未分类
2. folders 里**用户自建**的每一条 → 转成一个 custom 类型
     name 照抄、position = 100 + i(i 按过滤后的序号,让 6 个预置排在前面)
     filterable = false、criteria = ''、route = 'retrieve'
     ⚠ 预置默认夹(id = 'uncategorized')**不转** —— 它不是用户内容,
       是 addGolden 给新标答的系统默认落点;它和新内置的「未分类」是同一件事
3. goldens 的归属:
     folderId ∈ 用户自建夹  → categoryId = 'legacy:<folderId>'
                              categorySource = 'manual'   ← 关键:手工摆放过的,机器永不许覆盖
     其余(默认夹里的、没入夹的) → categoryId = null,且**不写** categorySource
                              ← 这些要留给补分类去归类
4. qaRecords 保持 categoryId 缺省 —— 与 null 等价(判据用 falsy 检查),迁移不必显式写
5. folderId 与 folders 表保留不删(回滚用),但不再被读写
```

> **第 3 步是这次迁移最容易搞错的地方。** 直觉是"有 folderId 就算用户整理过",但 `addGolden`
> 默认就把每一条新标准回答写进默认夹 —— 所以"有 folderId"根本推不出"用户做过选择"。
> 若把默认夹里的也标成 `manual`,补分类会一条都跳过,**用户现有的标准回答将永远得不到自动归类**,
> 而这正是本功能存在的理由。这个错误不会报错、不会崩,只会静默地什么都没发生。

第 3 步的 `'manual'` 是硬要求：**补分类时 `manual` 一律跳过**。若遗漏，将来改一次 criteria 就会把用户手工整理的结果全部冲掉。

`ensurePresetCategories()` 挂在 SW 启动钩子，位置与现有 `ensurePresetFolders()` 一致。

---

## 十一、批量补存量

### 11.1 交互

- 入口：设置页「开始分类全部历史」按钮（D10）
- 按钮文案**必须先算出条数**：`将把 N 条历史问题 + M 条标准回答的问题发送到 api.typesafe.ai（不含任何回复内容）`
- 运行中显示进度 `382 / 1285`，可中断
- 完成报告：`成功 N · 失败 M · 跳过 K（人工指定过）`
- **每条跑完立即落库**，中断不丢进度

### 11.2 跳过与失败

| 处理 | 条件 |
|---|---|
| **待分类** | `categoryId` 为 `null` 或 `'uncategorized'`（含从未跑过的、以及被判不准落进来的） |
| **重跑** | `categorySource === 'jev'` 且 `categoryAt < categories.updatedAt` —— 判定说明改过了，旧标签可能已失效 |
| **跳过** | `categorySource === 'manual'` —— 用户手工摆的，机器不许动 |
| **失败** | 留未分类，重试 2 次后放弃，**不阻塞整批** |

`categorySource === 'inherit'` 的标准回答**两边都不进** —— 它继承自已分类的问答，标签有效，既不用重跑（问题文本相同，重跑结果一样，是白花钱）也不该跳过。它只是"已分类"。

> §11.1 按钮上显示的两个数字**必须是"待分类 + 重跑"的条数**，不是库里的总条数 —— 否则文案在撒谎。跳过的不计入。

### 11.3 限流

- **5 并发 + 失败重试 2 次**（官方限流约 1200 req/min，5 并发远在安全区）
- 单条超时 `classifyTimeoutMs`（默认 3000ms）

### 11.4 成本

jev 输入 `$0.042/百万 token`，输出免费。一条问题约 50 token；**1 万条历史约 2 分钱**。成本可忽略，不需要做预算提示。

---

## 十二、jev 调用层

新建 `src/background/jev.ts`（与 `llm.ts` 同层，风格一致）。

```ts
classifyQuestion(opts: {
  question: string
  categories: Array<{ id: string; name: string; criteria: string }>
  settings: { baseUrl: string; apiKey: string; model: string; timeoutMs: number }
}): Promise<
  | { ok: true; probabilities: Record<string, number>; top: string; confidence: number }
  | { ok: false; error: string }
>
```

- `POST ${baseUrl}/v1/systemone`，`Authorization: Bearer ${apiKey}`
- body：`{ model, state: question, questions: { category: { type: 'choice', instructions: '这是买家发来的消息。判断它属于哪一类问题。', criteria: { [name]: criteria } } } }`
  - `state` 是买家问题原文（`string`，不走 JSON 包装）
  - **`criteria` 的 key 用中文类型名**（它是发给模型的选项标签），返回后按 name → id 映射回本地
  - 问题 id（`category`）只是回传用的字典键，官方明确不会发给模型 —— 语义要写在 `instructions` 里
- 解析 `answers.category` → `probabilities` / `choice` / `confidence`
- 内部创建 `AbortController` 并设 `timeoutMs`，abort 归一为 `{ ok: false, error: 'timeout' }`
- **不支持流式**（协议本身不支持），一次性返回
- 从 background service worker 发出

`manifest`（`package.json`）：`optional_host_permissions: ["https://*/*"]` **已存在**，无需改动；保存设置时按用户填的地址动态申请 origin，与现有 LLM 配置同一套流程。

### 设置项新增

```ts
/** 自动分类总开关;默认 false。关闭或未配置时,扩展保持完全本地 */
classifyEnabled: boolean
/** jev 端点 base url,默认 'https://api.typesafe.ai' */
jevBaseUrl: string
/** jev API key,默认 '';仅存 chrome.storage.local,永不同步 */
jevApiKey: string
/** jev 模型名,默认 'jev-latest' */
jevModel: string
/** 单次分类超时(毫秒),默认 3000 */
jevTimeoutMs: number
/** 概率阈值:≥ 此值的类型进类型集合,默认 0.2 */
classifyProbThreshold: number
```

`DEFAULT_SETTINGS`（`shared/constants.ts`）与 `clampSettings()`（`background/settings.ts`）均需覆盖新字段。

---

## 十三、不变量（实施的硬约束）

以下逻辑**一个字都不许改**：

| 不变量 | 说明 |
|---|---|
| **TTL / 保留期** | `retentionDays`（默认 90，范围 30–365）与 `purgeExpired` 的清理逻辑不变。**未分类的条目照常过期**，分类既不延长也不缩短任何条目的寿命 |
| **发送永远由人完成** | 分类结果、尺码生成结果都只 `fillInput` 进输入框，扩展从不代发 |
| **直接填充路径不调 LLM** | `directFillEnabled` 分支全程零网络请求 |
| **回复正文与标准回答正文永不出本机** | 外发只含**问题文本** |
| **未配置时零远程请求** | 开关默认关、配置默认空时，运行期无任何网络请求 |
| **API Key 只进 `chrome.storage.local`** | 不进 `chrome.storage.sync`，不随导出外发 |
| **导入导出信封 2.0** | 新增字段全部可选，旧包照常导入 |
| **无 jev 时逐字节等价** | 检索结果与今天完全一致 |
| **现有全部测试保持全绿** | 现有 `mdText` / `chunkText` / `retrievalCache` / `search` / `retrieval` 测试是回归闸 |

---

## 十四、ADR 处理

`docs/adr/0006-optional-llm-integration.md` 写的是"外发内容**仅限**本轮知识库候选 + 当前买家问题"。本次要动三处：

- **可外发内容**新增：历史问答的**问题文本**、标准回答的**问题文本**
- **目的地**新增：`api.typesafe.ai`（现有的是用户自配的 LLM 端点）
- **触发条件**新增：显式打开「自动分类」开关；存量补分类需**额外点一次**按钮

**不变量一个字不改**：回复正文与标准回答正文永不出本机；发送永远由人点击。

处理方式：**新增 `docs/adr/0007-auto-classification-egress.md`** 记录这次修订（ADR 是时间点上的决策记录，不该原地改写历史结论），并在 0006 顶部加一行指向 0007。

---

## 十五、测试

| 文件 | 覆盖 |
|---|---|
| `tests/unit/background/categories.test.ts` | 种子幂等、不覆盖已存在项、预置不可改 |
| `tests/unit/background/db-pdd.test.ts`（扩展） | v7→v8 迁移：folders → custom、`folderId` → `categoryId`、`categorySource='manual'`、`qaRecords` 全 null |
| `tests/unit/background/retrieval.test.ts`（扩展） | 过滤谓词：类型内命中 / 类型外排除 / `filterable=false` 永远进池 / `allowed=null` 时行为与今天逐字节相同 |
| `tests/unit/background/retrievalCache.test.ts`（扩展） | `updateCachedCategory` 定点更新、不触发整体重建 |
| `tests/unit/background/jev.test.ts` | 响应解析（choice + probabilities + confidence）、超时中止、HTTP 错误、并发上限、单条失败不阻塞整批（mock fetch） |
| `tests/unit/background/search.test.ts`（扩展） | 编排层：无 jev → 全池；纯尺码 → 不检索；多意图 → 并集；空池 → 全池兜底 |
| `tests/unit/background/classifyRoute.test.ts` | 概率 → 类型集合的规则（含空集 → 不筛） |
| `tests/unit/ui/*` | 面板按类型分区、类型下拉、未分类折叠、预置项不可编辑 |

**最重要的回归闸**：`无 jev 配置时，检索结果与今天逐字节等价`。

---

## 十六、分阶段实施

每阶段独立可验收。

### P1 数据层与面板（无 jev，纯本地）

1. `categories` 表 + 种子 + v8 迁移 + 单测
2. `qaRecords` / `goldens` / `kbDocs` 新字段
3. 面板按类型分区展示（此时全部落未分类，可验证分组与折叠）

**验收**：迁移后老数据不丢 —— 原文件夹名与其中的标准回答归属都在，表现为自定义类型。

### P2 jev 调用层与设置页

1. `jev.ts` + 单测
2. 设置项 + 设置页「问题分类」区 + host 权限申请 + 测试连接
3. 新增类型的重叠检查提示
4. 批量补存量 + 进度 + 报告

**验收**：无配置时设置页与今天零差异、无网络请求；配置后能列出条数、能跑完、能中断。

### P3 检索路由

1. `RetSource.categoryId` + 缓存定点更新
2. `rankCandidates` 过滤谓词
3. 概率 → 类型集合 → 池子 → 全池兜底
4. 多意图并集

**验收**：无 jev 时检索结果与今天逐字节等价；有 jev 时按类型收窄，空池能兜底。

### P4 尺码路由

1. `kbDocs.isSizeTable` + 知识库页标记开关
2. 尺码生成行（复用 `AI_INTEGRATE` 链路与材料组装）
3. 纯尺码情形池子为空

**验收**：传一张尺码表 → 尺码类问题只出生成行、历史候选一条不出；未配 LLM 时退化为全池检索。

### P5 ADR、文案与收尾

1. ADR-0007 + 0006 指针
2. 设置页知情文案与按钮旁的外发清单
3. CHANGELOG / 工作状态回写

---

## 十七、风险与未决

| 风险 | 严重度 | 缓解 |
|---|---|---|
| **jev 分类质量未验证** | 高 | 概率阈值可调；空集不筛；全池兜底。实施 P2 后**必须用真实历史数据实测准确率**再定阈值默认值 |
| **用户新增类型与预置重叠** | 中 | 保存时做重叠检查并提示（P2.3） |
| **本地向量兜底准确率未知** | 低 | 本次**不做**本地分类兜底 —— 无 jev 直接不筛（等价今天）。若以后要做，先实测再说 |
| **`clampSettings` 漏字段导致静默失效** | 中 | 沿用现有模式；单测覆盖每个新字段的 clamp |
| **面板双维度（来源 × 类型）表达混乱** | 中 | 类型做分区容器，来源做行内徽标（现有机制），不新增第三层 |
| **概率阈值默认值拍脑袋** | 中 | 默认 0.2 是起点，P2 实测后回调 |
| **迁移是一次性的，但导入路径没跟着改** | 中 | `transfer.ts` 仍只写 `folders.folderId`、不写 `categoryId`。把**旧版导出的包**导进 v8 库，其中的文件夹会变成谁也看不见的 `folders` 行，标答也不进入分类轴（标答本身不丢，仍可检索）。修它要额外决定「导入时怎么把 folder 映射成 category」，本次不做，留待后续 |

### 明确不做

- 本地向量兜底分类（未验证，先不做）
- 多标签（不需要，见 §7.3）
- 拖拽移动（两个渲染栈成本高，用下拉）
- 知识库分类（用户明确排除）
- 独立的向量数据库（无收益）
