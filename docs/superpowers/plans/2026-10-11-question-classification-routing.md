# 问题自动分类 · 检索路由与尺码路由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已经打好的问题类型真正影响检索 —— 按类型收窄候选池、尺码类问题改走"尺码表 + LLM 现场生成"，并且**无 jev 时检索行为与今天逐字节等价**。

**Architecture:** 五层推进。① 让检索源带上类型、并修好缓存一致性（这是本计划的地基，也是最容易被漏掉的一环）；② `rankCandidates` 加一个可选的"允许集合"过滤；③ 查询时分类 → 类型集合（多意图并集）→ 路线决策 → 检索（带 R11 的"切片不显著更优则放宽"）；④ 尺码表标记 + 尺码路由；⑤ 收尾与文档回写。

**Tech Stack:** TypeScript、Dexie、Plasmo MV3、Vitest 3 + happy-dom + fake-indexeddb。

**Spec:** `docs/specs/2026-10-11-question-classification-design.md`（§七 检索路由、§八 尺码路由、§7.6 过滤判据、§7.7 缓存写回、§11.2 补分类跳过规则）
**前两份计划:** `2026-10-11-question-classification-foundation.md`（地基，已落地）、`2026-10-11-question-classification-ui.md`（面板与设置页，已落地）

## Global Constraints

- **TTL / 保留期逻辑一个字不改**；现有全部测试必须保持全绿（起点 **746 passed / 65 files**；`npx tsc --noEmit` **0 错**）。
- **无 jev 时检索行为与今天逐字节等价** —— 这是本计划最重要的一条。未配 jev / jev 超时 / 判不准，一律退化成"不过滤"，结果必须与改动前一致。
- **回复正文与标准回答正文永不出本机**：尺码路由的材料只有**尺码表原文 + 买家问题**。
- **发送永远由人完成**；尺码生成结果只填输入框。
- **未配置时零远程请求**。
- **不得改动** `bm25Scores` / `rrfFuse` / `timeDecay` / `tokenize` / `cosineSim` 的算法；本计划只改"谁进池"与"谁来定路线"。
- 构建必须用 **`npm run build`**，不得裸跑 `plasmo build`。

## Review Focus

以下是 spec 没明写、但使用者会立刻撞上的失败模式。每条都已落到某个 Task 的测试里。

1. **没配 jev 时搜索结果变了** —— 期望：逐字节等价。（Task 3）
2. **jev 判错类型，正确答案被过滤掉且不再出现** —— 期望：切片没有明显更优时放宽到全池，正确答案仍能回来。（Task 3）
3. **分类写回之后，检索还在用旧的类型** —— 期望：缓存的类型字段随之更新，不需要等重启。（Task 1）
4. **尺码表被当成普通知识库文档检索出来，切碎着喂给模型** —— 期望：整篇原文作材料，且不出现在知识库候选里。（Task 4）
5. **纯尺码问题仍然吐出历史回复** —— 期望：池为空，只出生成行。（Task 3、Task 4）

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `src/background/route.ts` | **路线决策纯逻辑**：概率 → 类型集合 → 池子 / 尺码 / 不过滤。无 IO、无 chrome、无网络 |
| `tests/unit/background/route.test.ts` | — |
| `tests/unit/background/sizeRoute.test.ts` | 尺码表标记 + 材料组装（Task 4） |
| `tests/unit/ui/knowledgeSizeToggle.test.tsx` | 知识库页的尺码表开关 + 尺码行门禁（Task 5） |

**修改**

| 文件 | 改动 |
|---|---|
| `src/background/retrieval.ts` | `RetSource.categoryId`；`rankCandidates` 加可选 `allowed` 参数 |
| `src/background/retrievalCache.ts` | 三处投影带 `categoryId`（`?? null` 归一）；跳过尺码表文档的块；新增 `updateCachedCategory` |
| `src/background/db.ts` | 三个分类写路径改调 `updateCachedCategory`；`deleteCategory` 与 `putKbDoc` 调 `invalidateRetrievalCache`；新增 `listSizeTableDocIds` |
| `src/background/search.ts` | 编排：并行嵌入 + 分类 → 路线 → 检索（含放宽） |
| `src/types/messages/retrieval.ts` | `UiSettings` 加 `sizeRoute?: boolean` |
| `src/background/aiMaterials.ts` | 新增 `collectSizeTableMaterials()` |
| `src/background/aiIntegrate.ts` | `aiRowAvailable` 与 `handleAiIntegrate` 支持尺码来源 |
| `src/types/messages/ai.ts` | `AiIntegrateRequest.payload` 加 `source?: 'knowledge' \| 'size'` |
| `src/background/knowledge.ts` | `setKbDocSizeTable(docId, on)` |
| `src/types/messages/panel.ts` | `PanelKnowledge` 加 `docId?` / `isSizeTable?` |
| `src/popup/KnowledgeTab.tsx` | 文档行加「尺码表」开关 |
| `src/contents/pdd-ai-button.ts` | 尺码生成行（复用 AI 行的状态机） |
| `src/pdd/ai-row.ts` | 文案按来源分叉 |

**本计划不碰**：`llm.ts`、`jev.ts`（除调用既有导出）、`classify.ts`、`backfillState.ts`、`SettingsTab.tsx`。

---

## Task 1: 检索源带上类型 + 缓存一致性

**Files:**
- Modify: `src/background/retrieval.ts`（`RetSource`）
- Modify: `src/background/retrievalCache.ts`
- Modify: `src/background/db.ts`（三个写路径 + `deleteCategory`）
- Test: `tests/unit/background/retrievalCache.test.ts`（追加）、`tests/unit/background/panel.test.ts`（追加）

**Interfaces:**
- Consumes: `UNCATEGORIZED_CATEGORY_ID`
- Produces: `RetSource.categoryId: string | null`（**已归一**）；`updateCachedCategory(id: string, categoryId: string | null): void`

**这是本计划的地基，也是最容易漏的一环。** 分类的三个写路径（`updateQaCategory` / `updateGoldenCategory` / `setGoldenCategoryManual`）今天**刻意不作废检索缓存**，因为分类还没进检索。一旦 `rankCandidates` 开始读 `categoryId`，缓存里那份就是**旧的**，用户会看到"我刚改的类型没生效"。

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/background/retrievalCache.test.ts` **末尾追加**：

```ts
describe('检索源携带类型', () => {
  it('三源都带 categoryId,缺省归一成 null', async () => {
    // 造一条不带 categoryId 的 qaRecord、一条带 'preset:order' 的 golden、一条知识库块
    // 断言 entries 里三条的 source.categoryId 分别是 null / 'preset:order' / null
  })

  it('历史与标答的 categoryId 原样带出', async () => { ... })
})

describe('updateCachedCategory 定点更新', () => {
  it('★ 改一条的类型,不重建整份缓存', async () => {
    // 先在缓存里放两条(不同 id);记录 getRetrievalEntries() 返回的数组**引用**
    // 调 updateCachedCategory(其中一条, 'preset:price')
    // 断言:再取一份缓存,那条的 categoryId 变了,**且数组仍是同一个引用**
    //      (引用相同 = 没走重建路径;重建会生成新数组)
  })

  it('改不存在的 id 是空操作,不抛错', ...)

  it('归一到 null 也生效', ...)
})
```

在 `tests/unit/background/panel.test.ts` **末尾追加**：

```ts
describe('分类写回使检索缓存同步', () => {
  it('★ updateQaCategory 之后,缓存里那条的类型跟着变', async () => {
    // 先 getRetrievalEntries() 建立缓存
    // 调 db.updateQaCategory(id, { categoryId: 'preset:order', confidence: 0.9 })
    // 断言:缓存里那条的 categoryId === 'preset:order'(不需要重建、也不能还是 null)
  })

  it('updateGoldenCategory / setGoldenCategoryManual 同理', ...)

  it('deleteCategory 走整体失效(批量搬动) —— 重建后那些标答是未分类', ...)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/retrievalCache.test.ts tests/unit/background/panel.test.ts`
Expected: FAIL —— `source.categoryId` 为 `undefined`；`updateCachedCategory is not a function`

- [ ] **Step 3: 给 `RetSource` 加字段**

`src/background/retrieval.ts`：

```ts
export interface RetSource {
  id: string
  kind: SourceKind
  /** 原始问题全文(候选展示"原始问题摘要"用);知识库 = 标题 */
  question: string
  /** 问题时间(历史=questionTs,金标准/知识库=updatedAt) */
  questionTs: number
  /**
   * 问题类型 id。**已在检索缓存边界归一**:库里缺省或为 null 的,到这里是 `null`。
   * 知识库不分类,恒为 `null`。
   *
   * 归一的意义(裁决 I2 的教训):`undefined !== null`。若让它以 undefined 流下来,
   * 任何 `!== null` 的判断都会把"没分类"当成"有分类",在类型过滤里被静默排除。
   */
  categoryId: string | null
}
```

- [ ] **Step 4: 缓存三处投影带上它,并加定点更新**

`src/background/retrievalCache.ts`：

三处 `source:` 字面量各加一行 —— 历史 `categoryId: q.categoryId ?? null`、标答 `categoryId: g.categoryId ?? null`、知识库 `categoryId: null`。

新增导出：

```ts
/** id → 缓存下标。定点更新要 O(1) 找位,重建时一并建 */
let index: Map<string, number> | null = null

/**
 * 定点更新一条的类型。
 *
 * 为什么不调 invalidateRetrievalCache():那个是**整体失效**,分类却是一条一条写的 ——
 * 补分类跑一轮会写上千次,每次整体失效都会让紧接着的搜索白重建一遍。
 *
 * 而这正是**定点更新最安全的场景**:条目本身没增没减,只是其中一个字段变了,
 * 所以不存在"增量维护的复杂度"(本文件头部那段注释反对的是增删场景)。
 */
export function updateCachedCategory(id: string, categoryId: string | null): void {
  if (!cache || !index) return
  const i = index.get(id)
  if (i === undefined) return
  const entry = cache[i]
  if (entry) entry.source = { ...entry.source, categoryId }
}
```

`getRetrievalEntries()` 重建时同时建 `index`；`invalidateRetrievalCache()` 里把 `index = null` 一并清掉。

- [ ] **Step 5: 三个写路径改用定点更新**

`src/background/db.ts`：

- `updateQaCategory` —— 写完调 `updateCachedCategory(id, hit ? hit.categoryId : UNCATEGORIZED_CATEGORY_ID)`，把现有那句"不调 invalidateRetrievalCache（分类尚未进检索）"的注释改掉，说明**现在分类进检索了，所以必须同步**。
- `updateGoldenCategory` —— 同理。注意它现在会因为 manual 守卫**跳过写入**并返回 0；**返回值是 0 时不要更新缓存**（没写就不该改缓存）。
- `setGoldenCategoryManual` —— 同理，写 `categoryId`。
- `deleteCategory` —— 它批量搬动标答与历史，**走 `invalidateRetrievalCache()`**（批量场景定点更新反而更绕），并留一行注释说明为什么这里是整体失效。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/retrievalCache.test.ts tests/unit/background/panel.test.ts`
Expected: PASS

- [ ] **Step 7: 跑全量测试并提交**

```bash
npm test && npx tsc --noEmit
git add src/background/retrieval.ts src/background/retrievalCache.ts src/background/db.ts tests/unit/background/
git commit -m "feat: 检索源携带问题类型 + 分类写回定点同步缓存(第五十八轮)"
```

---

## Task 2: `rankCandidates` 的类型过滤

**Files:**
- Modify: `src/background/retrieval.ts`
- Test: `tests/unit/background/retrieval.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `RetSource.categoryId`
- Produces: `rankCandidates(entries, query, qvec, thresholds, now, allowed?: ReadonlySet<string> | null)`

- [ ] **Step 1: 写失败的测试**

```ts
describe('rankCandidates 的类型过滤', () => {
  it('★ allowed 为 null / 省略时,结果与不带过滤**逐字节相同**', () => {
    // 同一组 entries 跑两次:一次不传 allowed、一次传 null
    // 断言两次的 id 序列与 rrfScore **完全相等**
    // (这是本计划的头号不变量:无 jev 时必须等于今天)
  })

  it('allowed 是一个集合时,只保留该集合内的历史与标答', ...)

  it('★ 知识库**永不受过滤** —— 它不参与分类', () => {
    // 池里放一条知识库(anchor 与查询相关)与两条历史(一条在集合内一条不在)
    // allowed = 只含其中一条历史的类型
    // 断言:知识库那条**仍在**结果里
  })

  it('categoryId 为 null 的记录按"未分类"匹配 —— 调用方要把它放进集合', ...)

  it('过滤后池子为空 → 返回空数组(由调用方决定要不要放宽)', ...)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/retrieval.test.ts`
Expected: FAIL —— 多出来的参数被忽略，被过滤的条目仍在结果里

- [ ] **Step 3: 实现**

`rankCandidates` 签名加末位可选参数 `allowed: ReadonlySet<string> | null = null`，并在**阈值循环的第一行**加过滤 —— 位置很关键：要在算余弦**之前**跳过，那才是省下 BM25 分词的地方（`docsTokens` 是对 survivors 算的）。

```ts
  for (const { source, vec } of entries) {
    // 类型过滤(第五十八轮):在**算余弦之前**跳过 —— 省下的是下游对 survivors 的
    // BM25 分词,那才是这条管线真正的热路径。
    // 知识库不参与分类,永不过滤;历史与标答按 categoryId 匹配。
    if (allowed !== null && source.kind !== 'knowledge' && !allowed.has(source.categoryId ?? UNCATEGORIZED_CATEGORY_ID)) {
      continue
    }
    const cosine = ...
```

`UNCATEGORIZED_CATEGORY_ID` 从 `../shared/constants` 导入。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/retrieval.test.ts`
Expected: PASS（原有用例 + 新增 5 个）

- [ ] **Step 5: 跑全量测试并提交**

```bash
npm test && npx tsc --noEmit
git add src/background/retrieval.ts tests/unit/background/retrieval.test.ts
git commit -m "feat: rankCandidates 支持按问题类型过滤(知识库永不过滤)(第五十八轮)"
```

---

## Task 3: 路线决策与检索编排

**Files:**
- Create: `src/background/route.ts`
- Modify: `src/background/search.ts`
- Test: `tests/unit/background/route.test.ts`、`tests/unit/background/search.test.ts`（追加）

**Interfaces:**
- Consumes: `CategoryRecord`、`classifyQuestion` / `jevConfigFromSettings` / `isJevConfigured`（`jev.ts`）、`loadSettings`、`db.listCategories`
- Produces:
  - `type RouteDecision = { kind: 'no-filter' } | { kind: 'size-only' } | { kind: 'filter'; allowed: Set<string>; picked: string[] }`
  - `decideRoute(categories: CategoryRecord[], probabilities: Record<string, number> | null, threshold: number): RouteDecision`
  - `filterAllowed(categories, picked): Set<string>`（= picked 里的 retrieve 型 ∪ 所有 `filterable === false` 的类型 ∪ 未分类）

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/route.test.ts`（纯逻辑，直接喂夹具）：

```ts
describe('decideRoute', () => {
  it('★ probabilities 为 null(jev 不可用) → no-filter', ...)

  it('★ 概率全低于阈值 → no-filter(判不准就别乱筛)', ...)

  it('★ 类型集合恰为 {尺码推荐} → size-only', ...)

  it('类型集合是 {订单物流} → filter,且池 = 订单物流 ∪ 所有 filterable=false 的类型', ...)

  it('★ 多意图:概率 ≥ 阈值的**所有**类型都进集合,不是只取胜者', () => {
    // {订单物流: 0.52, 尺码推荐: 0.43, 价格优惠: 0.03}
    // 阈值 0.2 → 集合 = {订单物流, 尺码推荐}
    // 断言:池含订单物流;且路线里带"要挂尺码行"的信号
  })

  it('★ {尺码推荐, 订单物流} → filter(不是 size-only) —— 买家一次问了两件事', ...)

  it('自定义类型(用户自建、filterable=true)可被选中并进池', ...)

  it('filterable=false 的自定义类型(迁移来的旧文件夹)恒在池里', ...)
})

describe('filterAllowed', () => {
  it('未分类恒在池里', ...)
  it('同一个类型集合,输出稳定(集合内容与顺序无关)', ...)
})
```

在 `tests/unit/background/search.test.ts` **末尾追加**：

```ts
describe('searchSuggestions 的类型路由', () => {
  it('★ 无 jev(未配置) → 结果与改动前逐字节相同', async () => {
    // 与既有用例同一组夹具、同一个查询
    // 断言:id 序列、score、foldCount、来源 kind 全部相等
  })

  it('★ 判成某个类型 → 池收窄,该类型外的历史不再出现', ...)

  it('★ 切片没有显著更优 → 放宽到全池,正确答案仍能回来', () => {
    // 造:买家问题与"价格优惠"类的一条历史高度相似(余弦高),
    //     但 jev 判成"订单物流",而订单物流类里也有一条中等相似的
    // 断言:最终结果里包含价格优惠那条(因为没有放宽就会被静默过滤掉)
  })

  it('★ 纯尺码 → 不检索,面板拿到的候选为空且 settings.sizeRoute 为真', ...)

  it('尺码路由前提不满足(没配 LLM / 没尺码表) → 退化成不过滤', ...)

  it('分类调用超时 → 退化成不过滤,不阻塞检索', ...)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/route.test.ts tests/unit/background/search.test.ts`
Expected: FAIL —— Cannot find module `route`

- [ ] **Step 3: 实现 `src/background/route.ts`**

```ts
/**
 * 检索路线决策(第五十八轮)—— **纯逻辑,无 IO、无 chrome、无网络**。
 *
 * 判据是"答案从哪来",不是话题:
 *  - `size-only`:买家在问自己的尺码 → 历史回复不可复用(答案取决于他的身高体重),
 *    不检索,改走"尺码表整篇原文 + LLM 生成";
 *  - `filter`:收窄到类型集合对应的池子;
 *  - `no-filter`:jev 不可用 / 判不准 → 与今天完全一致。
 */
import { UNCATEGORIZED_CATEGORY_ID } from '../shared/constants'
import type { CategoryRecord } from '../types/memory'

export type RouteDecision =
  /** 不过滤:jev 不可用、或概率全低于阈值。检索行为与今天逐字节相同 */
  | { kind: 'no-filter' }
  /** 纯尺码:池为空,不检索,走尺码生成 */
  | { kind: 'size-only' }
  /** 收窄到 allowed;`picked` 里可能同时含尺码类型(那要额外挂生成行) */
  | { kind: 'filter'; allowed: Set<string>; picked: string[] }

/**
 * 池子 = picked 中的 retrieve 型  ∪  所有 `filterable === false` 的类型。
 *
 * 为什么后半边不可省:未分类与迁移来的旧文件夹**不参与 jev 分类**,它们无法
 * 通过"类型匹配"被选中。若把它们排除,里面的条目将**在任何查询下都搜不到** ——
 * 纯召回倒退。
 */
export function filterAllowed(categories: CategoryRecord[], picked: string[]): Set<string> {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const allowed = new Set<string>()
  for (const id of picked) {
    if (byId.get(id)?.route === 'retrieve') allowed.add(id)
  }
  for (const c of categories) {
    if (!c.filterable) allowed.add(c.id)
  }
  // 显式兜一层:不依赖"未分类恰好 filterable=false"这个巧合
  allowed.add(UNCATEGORIZED_CATEGORY_ID)
  return allowed
}

/**
 * 概率 → 路线。
 *
 * `probabilities` 为 `null` 表示 jev 不可用(未配置 / 超时 / 报错)—— 调用方
 * 已经吞掉了错误,这里只负责"没判出来就不筛"。
 *
 * 多意图:取**概率 ≥ 阈值的所有类型**,不取胜者。概率分散既可能是"判不准"、
 * 也可能是"买家一次问了两件事",而两种情况下"把池子放宽"都是对的 ——
 * 所以不需要两套逻辑,也不需要额外问问题。
 */
export function decideRoute(
  categories: CategoryRecord[],
  probabilities: Record<string, number> | null,
  threshold: number,
): RouteDecision {
  if (probabilities === null) return { kind: 'no-filter' }

  const picked = Object.entries(probabilities)
    .filter(([, p]) => p >= threshold)
    .map(([id]) => id)
  // 全低于阈值 → 判不准,别乱筛
  if (picked.length === 0) return { kind: 'no-filter' }

  const byId = new Map(categories.map((c) => [c.id, c]))
  // 纯尺码:集合里一个 retrieve 型都没有 → 池为空
  const hasRetrieve = picked.some((id) => byId.get(id)?.route === 'retrieve')
  if (!hasRetrieve) return { kind: 'size-only' }

  return { kind: 'filter', allowed: filterAllowed(categories, picked), picked }
}
```

- [ ] **Step 4: 改 `search.ts` 的编排**

在 `embedViaOffscreen` 那一步**并行**发起分类，然后按路线检索。**放宽判据按裁决 R11 升级**：

```
同一次搜索里跑两遍 rankCandidates:
  A. 带 allowed 的切片
  B. 不带 allowed 的全池

  B 的最高余弦 ≥ A 的最高余弦 + FILTER_MARGIN(=0.05)  → 用 B(全池里有明显更好的,切片漏了东西)
  否则                                              → 用 A(切片已经够好)
```

> **方向不能反过来写。** A ⊆ B,所以 `max(A) ≤ max(B)` **恒成立** —— 写成 "A 的最高余弦 ≥ B + margin 就用 A" 的话那个条件**永远不可能满足**,过滤会退化成完全不起作用的死代码。判据只能是"**全池显著更好才放宽**"。

- 为什么不是"池子空了才放宽"（裁决 R11）：把价格类问题误判成订单物流时，池子**不是空的** —— 它装着几条貌似合理的订单物流候选，兜底永不触发，而正确答案被静默过滤掉。判据要判的是"**切片是否真的更优**"，不是"切片是否为空"。
- 两次 pass 的代价：池子几千条时每次 pass 是毫秒级，翻倍也仍在毫秒级 —— 这点开销换"分类判错不会静默丢答案"是划算的。
- **纯尺码**：不走检索，池为空；`settings.sizeRoute = true`，面板据此渲染生成行。
- **`no-filter`**：只跑 B 一遍（与今天完全一致，不多花一次）。

编排的骨架（照 `searchSuggestions` 现有的顺序插进去，别打乱它）：

```ts
  const settings = await loadSettings()
  const [qvec, probabilities] = await Promise.all([
    embedViaOffscreen(query),
    classifyForQuery(query, settings),   // 内部吞掉所有失败 → 返回 null;不发请求的情形见下
  ])

  const categories = await db.listCategories()
  const route = decideRoute(categories, probabilities, settings.classifyProbThreshold)

  if (route.kind === 'size-only') {
    // 不检索:池为空,面板据 settings.sizeRoute 渲染生成行
    return { suggestions: [], settings: uiSettings(settings, [], { sizeRoute: true }) }
  }

  const entries = await getRetrievalEntries()
  const allowed = route.kind === 'filter' ? route.allowed : null

  const full = rankCandidates(entries, query, qvec, thresholds, now, null)
  const narrowed = allowed ? rankCandidates(entries, query, qvec, thresholds, now, allowed) : full
  const ranked = pickByMargin(narrowed, full)   // 见上面那条判据
  // …以下取正文 / assembleSuggestions 全都不变
```

`classifyForQuery` 与 `classifyRecord` 的门禁**完全一致**（总开关 / 已配 key / 有可问类型），区别只在于它返回**整个概率分布**（路由要的是"哪些类型过线"，不是"最高的是哪个"）—— 复用它内部的门禁顺序，别另写一套。

`UiSettings` 加一个可选字段 `sizeRoute?: boolean`（`src/types/messages/retrieval.ts`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/route.test.ts tests/unit/background/search.test.ts`
Expected: PASS

- [ ] **Step 6: 跑全量测试并提交**

```bash
npm test && npx tsc --noEmit
git add src/background/route.ts src/background/search.ts src/types/messages/retrieval.ts tests/unit/background/
git commit -m "feat: 查询时路线决策(多意图并集 + 切片不显著更优则放宽)(第五十八轮)"
```

---

## Task 4: 尺码表标记与尺码材料（后台）

**Files:**
- Modify: `src/background/db.ts`、`src/background/retrievalCache.ts`、`src/background/knowledge.ts`、`src/background/aiMaterials.ts`
- Modify: `src/types/messages/panel.ts`、`src/background/panel.ts`
- Test: `tests/unit/background/sizeRoute.test.ts`（新建）

**Interfaces:**
- Produces: `db.listSizeTableDocIds(): Promise<Set<string>>`；`knowledge.setKbDocSizeTable(docId, on)`；`collectSizeTableMaterials(): Promise<string[]>`；`PanelKnowledge.docId?` / `PanelKnowledge.isSizeTable?`

**这一半只做后台**，UI（知识库开关 + 面板生成行）是 Task 5。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/sizeRoute.test.ts`：

```ts
describe('尺码表标记', () => {
  it('标记后写进 kbDocs.isSizeTable', ...)
  it('★ 标记后,该文档的块**不再进检索缓存**', ...)
  it('★ 取消标记后,块回到检索缓存', ...)
  it('★ putKbDoc 会作废检索缓存(标记一改,池子就变)', ...)
  it('重新上传文档分块不会丢掉标记', ...)
  it('listSizeTableDocIds 只返回被标记的那些', ...)
})

describe('collectSizeTableMaterials', () => {
  it('★ 取整篇原文,不走分块、不走向量', ...)
  it('没有标记的尺码表 → 空数组', ...)
  it('多篇被标记 → 全取,按 docId 稳定排序', ...)
  it('超长时截断到 MAX_MATERIAL_CHARS', ...)
  it('★ 材料里只有尺码表原文(不含任何回复正文)', ...)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/sizeRoute.test.ts`
Expected: FAIL —— `setKbDocSizeTable` / `collectSizeTableMaterials` 不存在

- [ ] **Step 3: 实现**

- `db.listSizeTableDocIds()`：读 `kbDocs`，返回 `isSizeTable === true` 的 `docId` 集合。**kbDocs 只有寥寥几篇文档，整表读没有代价问题** —— 不要为它发明索引。
- `retrievalCache.getRetrievalEntries()`：重建时同时读 `db.listSizeTableDocIds()`，**跳过 docId 命中的知识库块**。这是"尺码表不做向量检索"的落点。
- `db.putKbDoc` 加 `invalidateRetrievalCache()` —— 标记一改，池子就变了；注释里写明这是**为什么**。
- `knowledge.setKbDocSizeTable(docId, on)`：读原文记录 → 改 `isSizeTable` → `putKbDoc`（后者负责失效缓存）。原文不存在时报错，静默返回不写。
- `aiMaterials.collectSizeTableMaterials()`：取**所有**被标记文档的 `content`，按 `MAX_MATERIAL_CHARS` 截断（复用同一个常量与截断语义）。不走分块、不走向量 —— 尺码表通常 5~8 行，整表进 prompt 比"从表里检索几行"更准：检索可能只命中 M 那一行、漏掉相邻的 L 行，而正确答案往往在边界上。

- [ ] **Step 4: 两个 DTO 字段**

`PanelKnowledge` 加 `docId?: string` 与 `isSizeTable?: boolean`；`panel.ts` 的 knowledge 映射带上它们（`isSizeTable` 由 `listSizeTableDocIds()` 现算，不要给每个块存一份）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/sizeRoute.test.ts`
Expected: PASS

- [ ] **Step 6: 跑全量测试并提交**

```bash
npm test && npx tsc --noEmit
git add src/background/ src/types/messages/panel.ts tests/unit/background/sizeRoute.test.ts
git commit -m "feat: 尺码表标记与整篇原文作材料(后台)(第五十八轮)"
```

---

## Task 5: 尺码路由的界面（知识库开关 + 面板生成行）

**Files:**
- Modify: `src/types/messages/ai.ts`、`src/background/aiIntegrate.ts`、`src/pdd/ai-row.ts`
- Modify: `src/popup/KnowledgeTab.tsx`、`src/contents/pdd-ai-button.ts`
- Modify: `src/types/messages/kb.ts`（新消息对）与 `src/types/messages/index.ts`（两处 union）、`src/background/index.ts`（派发表）
- Test: `tests/unit/ui/knowledgeSizeToggle.test.tsx`、`tests/unit/background/aiIntegrate.test.ts`（追加）

**Interfaces:**
- Consumes: Task 4 的 `collectSizeTableMaterials` / `PanelKnowledge.isSizeTable` / `setKbDocSizeTable`；Task 3 的 `UiSettings.sizeRoute`
- Produces: `SET_KB_SIZE_TABLE` 消息对；`AiIntegrateRequest.payload.source?: 'knowledge' | 'size'`

- [ ] **Step 1: 写失败的测试**

```ts
describe('知识库页的尺码表开关', () => {
  it('★ 只在该文档的第一块上渲染 —— 不是每个块一个开关', () => {
    // 同一 docId 造三块(id 为 `${docId}-c0/c1/c2`)
    // 断言:只有 c0 那块上有开关
  })
  it('勾选后发 SET_KB_SIZE_TABLE { docId, on: true }', ...)
  it('没勾的文档不渲染开关', ...)
})

describe('尺码行的门禁', () => {
  it('★ 没配 LLM → 不渲染(与知识库整合行同一套外发闸门)', ...)
  it('没标记尺码表 → 不渲染', ...)
  it('★ directFillEnabled 打开 → 不渲染(那条路径不弹面板、不调 LLM)', ...)
})

describe('材料来源分叉', () => {
  it('source 为 size 时取尺码表原材料,而不是知识库候选', ...)
  it('source 缺省时行为不变(向后兼容既有调用)', ...)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/ui/knowledgeSizeToggle.test.tsx tests/unit/background/aiIntegrate.test.ts`
Expected: FAIL

- [ ] **Step 3: 消息与材料来源**

- 新消息 `SET_KB_SIZE_TABLE`（照 `UPDATE_KB` 写三处：`types/messages/kb.ts` 域文件、`types/messages/index.ts` 的**两处** union、`background/index.ts` 的派发表）。
- `AiIntegrateRequest.payload` 加 `source?: 'knowledge' | 'size'`（**可选**，缺省即今天的语义 —— 向后兼容）。
- `handleAiIntegrate`：按 `source` 选 `collectMaterials` 或 `collectSizeTableMaterials`。**其余不变**：门禁、哨兵缓冲、流式、失败归一全部复用。

- [ ] **Step 4: 界面**

- **知识库页**：一篇文档会被切成很多块、**每块一条记录**，而「是不是尺码表」是**文档级**的 —— 开关只能在**该文档的第一块**上渲染一次。
  - 怎么认出第一块：**不要用 id 字符串去猜** —— 真实 id 是 `kbd-<随机>-cN` 这种形态，而且**单块文档压根没有 `-c0` 后缀**，按后缀匹配会让单块文档永远标不上。用 `KnowledgeRecord` 上已有的**块序号**判断（`chunkOrdinal` 一类的既有工具），序号为 `0` 的那块即第一块。
  - 渲染条件：`k.source === 'doc' && 该块是本文档的第 0 块`。
- **面板**：`settings.sizeRoute` 为真时渲染尺码生成行 —— **复用现有 AI 行的状态机与整条链路**（`ai-row.ts` 的 `reduceAiRow` / 文案 / 重试），只是 `source: 'size'`。**不要新写一套行**。
  - 行的准入沿用现有三道闸门（`aiIntegrateEnabled` + 已配 LLM + 非自动回复）——**不新增开关**。
  - 行内文案要**与 ADR-0007 同源同义**：说明点击后外发的是**尺码表内容与买家问题**，回复正文永不出本机。
  - `PanelRow` 那个 union（`pdd-ai-button.ts` 里）现在是 `{ai:false,s} | {ai:true}`；加尺码行时**优先把 `ai:true` 泛化成带 `source` 的形态**，而不是加第三个分支 —— 否则 `r.ai` 的每一处 switch 都要再分叉一次。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/ui/knowledgeSizeToggle.test.tsx tests/unit/background/aiIntegrate.test.ts tests/unit/pdd/ai-row.test.ts`
Expected: PASS

- [ ] **Step 6: 跑全量测试并提交**

```bash
npm test && npx tsc --noEmit
git add -A
git commit -m "feat: 尺码表开关与面板生成行(复用 AI 行链路)(第五十八轮)"
```

---

## Task 6: 收尾 —— 文档回写与 ADR 修订

**Files:**
- Modify: `docs/specs/2026-10-11-question-classification-design.md`（§7.4 放宽判据、§7.7 缓存写回）
- Modify: `docs/adr/0007-auto-classification-egress.md`（尺码路由的外发面）
- Modify: `docs/工作状态-2026-09-08.md`

- [ ] **Step 1: 改 spec 的两处**

- **§7.4 的兜底**从"池子空则放宽"改成本计划的"**切片不显著优于全池则放宽**"，并把 R11 的理由写进去（"空"是错的判据，"错"才是真实失败模式）。
- **§7.7 的"禁止调 `invalidateRetrievalCache()`"** 要修正：那条禁令的成本模型不成立 —— 缓存失效是**惰性**的（只置 `cache = null`，下次检索才重建），而且捕获路径的嵌入完成那一步**本来就在失效它**。真正的理由不是为了省重建，而是：补分类会写上千次，定点更新比"每次置空"更精确。把理由换成正确的那个。

- [ ] **Step 2: ADR-0007 补尺码路由的外发面**

在「可外发内容」里补一句：**尺码路由发送的是尺码表原文 + 买家问题**（尺码表是店家自己传进知识库的文档，不是买家数据）。并确认不变量没变：**回复正文与标准回答正文仍永不出本机**。

- [ ] **Step 3: 工作状态回写**

按本仓惯例（**新轮在顶部**）追加第五十八轮一节：本份做了什么、**检索行为至此才真正被分类影响**、以及"无 jev 时逐字节等价"这个不变量。

- [ ] **Step 4: 收尾检查并提交**

```bash
npm test && npx tsc --noEmit && npm run build
git add -A
git commit -m "docs: 第五十八轮 —— 检索路由与尺码路由 spec/ADR/工作状态回写"
```

---

## 完成后的状态

- 检索源带类型；分类写回会定点同步缓存（改完立刻生效）
- 查询时 jev 判类型 → 多意图取并集 → 收窄池子；**切片不显著更优时放宽到全池**
- 纯尺码问题不检索，改走"尺码表整篇原文 + LLM 生成"
- **无 jev 时检索行为与改动前逐字节等价**
- 三份计划全部落地：分类体系、界面、路由

**三份计划合起来就是**：给买卖问答自动打上问题类型（地基）→ 让人看得见、能纠正、能补跑（界面）→ 让类型真正改变检索去向（本份）。
