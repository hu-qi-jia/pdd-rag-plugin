# 问题类型重制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把问题类型集换成八个记录级类型（含「其他」出口），并把「记录级打标」与「查询级识别」的选项集分开，使「尺码推荐」只参与意图识别、不出现在历史问答与标准回答两个页面。

**Architecture:** 不新增任何存储字段。作用域用现成的 `route` 区分（`route='size'` 的语义正是"答案不可复用、不该有存档记录"）：记录级选项集 = `filterable && route === 'retrieve'`，查询级 = `filterable`（不变）。`classifyGated` 是两条路共用的实现，改为带作用域参数并由三个调用点显式传入。存量标签靠 `updatedAt > categoryAt` 的既有机制自动变成补分类候选。

**Tech Stack:** TypeScript · Plasmo · React 18 · Dexie 4（IndexedDB） · Vitest 3（`fake-indexeddb`） · Playwright（验收脚本）

**Spec:** `docs/specs/2026-10-16-category-taxonomy-redesign-design.md`

## Global Constraints

- **基线是本地 HEAD `1fc7386`**。**不要** `git pull` / merge `origin/feat/question-classification` —— 那是已废弃的复古极简线，会回退暖纸 UI 与低置信/路由守卫/导入往返。见 spec M8。
- **类型集恰好九条**：八个记录级（`route='retrieve'`）+ `preset:size`（`route='size'`），外加 `uncategorized`（`filterable=false`、`position=9999`）。共 10 行。
- **`preset:size` 一个字段都不改**：`kind='preset'`、`filterable=true`、`route='size'`、criteria 与 position 按 spec 5.3 ④ 排到 8。不删除、不退休。
- **不新增存储字段**：`CategoryRecord` 不动。唯一的对外变更是在 `PanelCategory` DTO 上加 `route`。
- **两层判据的写法不同，这是有意的**：后台用白名单 `route === 'retrieve'`（`CategoryRecord.route` 是必填字段）；UI 用黑名单 `route !== 'size'`（DTO 与测试桩可能缺字段，白名单会**静默清空导航**）。见 Review Focus 第 1 条。
- **八条 criteria 逐字取自 spec §4.1**，含"不含…（那走…）"的划边句，**不得改写、不得删减**。含 `preset:size` 的原 criteria 不改。
- 阈值：`DEFAULT_SETTINGS.classifyProbThreshold` = `0.5`；`LOW_CONFIDENCE_LINE` = `0.65`。
- 包管理器用 `pnpm`；测试命令 `pnpm test`（= `vitest run`）。构建只用 `npm run build`（裸跑 `plasmo build` 会产出没有模型的包）。
- 提交信息用中文、`type(scope): 描述` 格式，与仓库既有风格一致。

## Review Focus

五类 spec 暗示、但容易被漏掉的输入/失败模式。每条都在下面某个任务的测试里钉住。

1. **DTO 或测试桩缺 `route` 字段** → 若 UI 判据写成白名单（`=== 'retrieve'`），类型导航会被**静默清空**（一片空白，且不报错）。期望：缺字段最多多出一个桶，绝不清空。→ Task 4
2. **存量里带 `preset:size` 标签的记录** → 导航计数该落在哪。期望计数自洽：`全部 = 各组之和`，条目一条都不丢。→ Task 4
3. **默认阈值与复核线的关系** → `LOW_CONFIDENCE_LINE` 必须**严格大于** `DEFAULT_SETTINGS.classifyProbThreshold`，否则 `isLowConfidenceCategory`（判 `p < 线`）与"过阈值"（判 `p ≥ 阈值`）永不同时成立，「低置信」整个功能静默失效。→ Task 1
4. **用户已有一个叫「其他」的旧文件夹**（v8 迁移从文件夹名造 `legacy:*`，那些行 `criteria` 是空串）→ 迁移后两行同名，而 jev 的 `criteria` **以类型名为键**，空串那行会把「其他」的出口判据顶掉 → 出口失效且无报错。→ Task 5
5. **迁移时间戳取等** → `categoryAt < updatedAt` 不成立 → 类型定义换了却一条都不重跑，界面显示新类型、归类还是旧标准，且没有任何信号。→ Task 5

---

### Task 1: 类型集与两条阈值常量

**Files:**
- Modify: `src/shared/constants.ts`（`PRESET_CATEGORIES`、`DEFAULT_SETTINGS.classifyProbThreshold`、`LOW_CONFIDENCE_LINE`）
- Test: `tests/unit/shared/categoryPresets.test.ts`（重写）、`tests/unit/shared/lowConfidence.test.ts`（加一条不变量）
- Test（机械同步）: `tests/unit/background/panel.test.ts:342-344,362`、`tests/unit/background/dbUpgrade.test.ts:249`、`tests/unit/background/categories.test.ts:25`（仅改测试名）

**Interfaces:**
- Consumes: 无
- Produces: `PRESET_CATEGORIES: readonly PresetCategoryDef[]` 长度 **9**，顺序 = `preset:attribute, preset:price, preset:stock, preset:payment, preset:order, preset:aftersale, preset:quality, preset:other, preset:size`；`PresetCategoryDef` 形状不变（`id`/`name`/`criteria`/`route`）。`DEFAULT_SETTINGS.classifyProbThreshold = 0.5`。`LOW_CONFIDENCE_LINE = 0.65`。

- [ ] **Step 1: 重写 `tests/unit/shared/categoryPresets.test.ts` 为新口径（先失败）**

把「恰好六个」等断言换成：

```ts
it('恰好九条：八个记录级 + 一条尺码', () => {
  expect(PRESET_CATEGORIES.length).toBe(9)
})

it('记录级八条的 route 全是 retrieve，唯一的 size 是 preset:size', () => {
  const sizes = PRESET_CATEGORIES.filter((c) => c.route === 'size')
  expect(sizes.map((c) => c.id)).toEqual(['preset:size'])
  expect(PRESET_CATEGORIES.filter((c) => c.route === 'retrieve')).toHaveLength(8)
})

it('id 顺序即 售前→售中→售后→其他→尺码', () => {
  expect(PRESET_CATEGORIES.map((c) => c.id)).toEqual([
    'preset:attribute', 'preset:price', 'preset:stock', 'preset:payment',
    'preset:order', 'preset:aftersale', 'preset:quality', 'preset:other',
    'preset:size',
  ])
})

it('「其他」的判定说明必须含出口提示，且不得鼓励当垃圾场', () => {
  const other = PRESET_CATEGORIES.find((c) => c.id === 'preset:other')!
  expect(other.name).toBe('其他')
  expect(other.criteria).toContain('不属于上面任何一类')
  expect(other.criteria).toContain('仅仅因为你没把握而选它是错的')
})
```

同时保留既有的：id 唯一且不与 `UNCATEGORIZED_CATEGORY_ID` 冲突、`preset:` 前缀、判定说明非空/互不相同/长度 > 20。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/shared/categoryPresets.test.ts`
Expected: FAIL —— `expected 6 to be 9`

- [ ] **Step 3: 改 `src/shared/constants.ts`**

`PRESET_CATEGORIES` 换成九条，**criteria 逐字抄 spec §4.1 的表格**（八条记录级），`preset:size` 那条**原封不动**（含原 criteria 与原注释）。数组末尾附近加一行注释：尺码是**查询级专用**，记录级选项集不含它。

`DEFAULT_SETTINGS`：`classifyProbThreshold: 0.2 → 0.5`，并把注释里的理由从"拍脑袋"改成"八个业务类存在重叠对，0.2 太松"。

`LOW_CONFIDENCE_LINE: 0.5 → 0.65`，注释补上不变量：

```
/** 复核线必须**严格大于** DEFAULT_SETTINGS.classifyProbThreshold ——
 *  否则 isLowConfidenceCategory 判的（p < 线）与"过阈值"（p ≥ 阈值）永不同时成立，
 *  「低置信」标记整个失效（不是少标几条，是永远不显示）。见 spec M9。 */
```

- [ ] **Step 4: 加不变量测试（Review Focus 第 3 条）**

在 `tests/unit/shared/lowConfidence.test.ts` 追加：

```ts
import { DEFAULT_SETTINGS } from '../../../src/shared/constants'

it('★ 复核线必须严格高于默认阈值 —— 取等或更低会让这个功能静默失效', () => {
  expect(LOW_CONFIDENCE_LINE).toBeGreaterThan(DEFAULT_SETTINGS.classifyProbThreshold)
})
```

`lowConfidence.test.ts` 其余用例用的字面量（0.21 / 0.49 / 0.95）在新线下结论不变，**不要改**。

- [ ] **Step 5: 机械同步三处断言**

- `tests/unit/background/panel.test.ts`：两处 `toHaveLength(7)` → `10`；`categories[0].id` 从 `'preset:size'` → `'preset:attribute'`；`categories[6].id === UNCATEGORIZED_CATEGORY_ID` → `categories[9]`。
- `tests/unit/background/dbUpgrade.test.ts:249`：`toBe(7)` → `toBe(10)`。
- `tests/unit/background/categories.test.ts:25`：只改测试名「种下 6 个预置」→「种下 9 个预置」（断言用的是 `PRESET_CATEGORIES.length + 1`，会自适应）。
- `tests/unit/background/panel.test.ts` 的 DTO 键集断言（约 :347）**本任务不要动** —— 加 `route` 是 Task 4 的事。

- [ ] **Step 6: 跑全量测试确认通过**

Run: `pnpm test`
Expected: 全绿（`classify.test.ts` 此时仍应通过 —— 作用域参数是 Task 2）

- [ ] **Step 7: Commit**

```bash
git add src/shared/constants.ts tests/unit/shared/categoryPresets.test.ts tests/unit/shared/lowConfidence.test.ts tests/unit/background/panel.test.ts tests/unit/background/dbUpgrade.test.ts tests/unit/background/categories.test.ts
git commit -m "feat(classify): 类型集换为八记录级 + 尺码，复核线抬到阈值之上"
```

---

### Task 2: 作用域 —— `classifiableCategories` 贯通四个调用点

**Files:**
- Modify: `src/background/classify.ts:24-28`（`classifiableCategories`）、`:54-75`（`classifyGated`）、`:83-94`（`classifyRecord`）、`:104-109`（`classifyForQuery`）、`:189`（`runBackfill`）
- Modify: `src/background/backfillState.ts:103`
- Test: `tests/unit/background/classify.test.ts:50-64`（改用新签名）+ 新增作用域用例
- Test: `tests/unit/background/backfillState.test.ts:39`（桩数据补 `route`）

**Interfaces:**
- Consumes: Task 1 的 `PRESET_CATEGORIES`（不直接用，只影响 DB 内容）
- Produces:
  - `export type ClassifyScope = 'record' | 'query'`
  - `export function classifiableCategories(cats: CategoryRecord[], scope: ClassifyScope): JevCategoryOption[]` —— `'record'` 取 `filterable && route === 'retrieve'`；`'query'` 取 `filterable`
  - `classifyRecord(question: string): Promise<{categoryId: string; confidence: number} | null>`（签名不变，内部走 `'record'`）
  - `classifyForQuery(question: string, settings: PddSettings): Promise<Record<string, number> | null>`（签名不变，内部走 `'query'`）

- [ ] **Step 1: 写作用域测试（先失败）**

在 `tests/unit/background/classify.test.ts` 的 `classifiableCategories` describe 里改签名并新增：

```ts
const cats = [
  makeCat({ id: 'preset:order', name: '订单物流', route: 'retrieve' }),
  makeCat({ id: 'preset:size', name: '尺码推荐', route: 'size' }),
  makeCat({ id: 'uncategorized', name: '未分类', kind: 'uncategorized', filterable: false }),
]

it("record：排除 route='size' —— 尺码不该有存档记录", () => {
  expect(classifiableCategories(cats, 'record').map((c) => c.id)).toEqual(['preset:order'])
})

it('query：包含 route=size —— 意图识别要用它', () => {
  expect(classifiableCategories(cats, 'query').map((c) => c.id))
    .toEqual(['preset:order', 'preset:size'])
})

it('两个作用域都不含 filterable=false 的（未分类永远不是选项）', () => {
  for (const scope of ['record', 'query'] as const) {
    expect(classifiableCategories(cats, scope).map((c) => c.id)).not.toContain('uncategorized')
  }
})
```

原本的「只取 `filterable=true`」那条改成传 `'query'`（用它来钉"查询级与今天逐字节相同"）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/background/classify.test.ts`
Expected: FAIL —— `classifiableCategories` 收到 2 个参数但只接受 1 个（TS 报错 / 断言不符）

- [ ] **Step 3: 改 `src/background/classify.ts`**

- 加 `export type ClassifyScope = 'record' | 'query'`。
- `classifiableCategories(cats, scope)`：`scope === 'record'` 时多一个 `c.route === 'retrieve'` 条件；`'query'` 分支与今天完全相同。函数注释说明为什么用 `route` 而不是新增字段（spec M4）。
- `classifyGated` 加第三个参数 `scope: ClassifyScope`，把它传给 `classifiableCategories`。**不要给默认值** —— 默认值会让"忘了传"静默退回旧行为（spec 6.1 明确要求）。
- `classifyRecord` → `classifyGated(question, settings, 'record')`。
- `classifyForQuery` → `classifyGated(question, settings, 'query')`。
- `runBackfill` 的 `:189` → `classifiableCategories(await db.listCategories(), 'record')`。
- 更新文件头注释：把"jev.ts 只管怎么问"那段补上作用域一句。

- [ ] **Step 4: 改 `src/background/backfillState.ts:103`**

`classifiableCategories(await db.listCategories(), 'record')`。这是补分类的门禁，必须与 `runBackfill` 同口径 —— 否则门禁说"有类型可问"而真正跑起来一个选项都没有。

- [ ] **Step 5: 修桩数据（否则测试会静默漏掉候选）**

`tests/unit/background/backfillState.test.ts:39` 的 `CATS` 桩加 `route: 'retrieve'`：

```ts
const CATS = [{ id: 'preset:order', name: '订单物流', criteria: '发货时间、催发货…', route: 'retrieve', filterable: true }]
```

漏这一步的现象是"门禁认为没有可问类型" → 测试以另一种理由失败，容易被误判成产品 bug。

- [ ] **Step 6: 跑全量测试确认通过**

Run: `pnpm test`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add src/background/classify.ts src/background/backfillState.ts tests/unit/background/classify.test.ts tests/unit/background/backfillState.test.ts
git commit -m "feat(classify): 记录级与查询级选项集分开,尺码只进查询级"
```

---

### Task 3: `INSTRUCTIONS` 给「其他」留出口

**Files:**
- Modify: `src/background/jev.ts:55`（`INSTRUCTIONS`）
- Test: `tests/unit/background/jev.test.ts`（请求体断言）

**Interfaces:**
- Consumes: 无
- Produces: `INSTRUCTIONS` 新文案（模块内常量，不导出）

- [ ] **Step 1: 加请求体断言（先失败）**

在 `tests/unit/background/jev.test.ts` 的「请求体走 System One 协议」那条用例里补：

```ts
// 「其他」是兜底出口：不给出口，模型会本能回避它，缺出口这个病根原样保留
expect(body.questions.category.instructions).toContain('其他')
expect(body.questions.category.instructions).toContain('都不属于')
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/background/jev.test.ts`
Expected: FAIL —— `expected '这是买家发来的消息。判断它属于哪一类问题。' to contain '其他'`

- [ ] **Step 3: 改 `INSTRUCTIONS`**

```ts
const INSTRUCTIONS =
  '这是买家发来的消息。判断它属于哪一类问题；如果都不属于（例如招呼语、闲聊、与交易无关的内容），选「其他」。'
```

同一段注释里说明：出口与「其他」criteria 里那句"仅仅因为你没把握而选它是错的"是配套的一对 —— 一个开出口，一个防泛滥，缺一则失衡。记录级与查询级**共用这一句**（选项表由 `criteria` 决定，不由指令决定）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/unit/background/jev.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/jev.ts tests/unit/background/jev.test.ts
git commit -m "feat(classify): 指令给「其他」留出口,与 criteria 的反向约束成对"
```

---

### Task 4: DTO 带 `route` + 两个页面只显示记录级类型

**Files:**
- Modify: `src/types/messages/panel.ts:101-108`（`PanelCategory`）
- Modify: `src/background/panel.ts:153-160` 与 `src/background/index.ts:258-265`（两处 DTO 构造）
- Modify: `src/popup/logic.ts`（新增 `recordLevelCategories`；用于 `catNavItems:268` 与 `groupByCategory:203`）
- Modify: `src/popup/logic.ts:216-222`（`uncCategory` 兜底字面量补 `route`）
- Modify: `src/popup/FoldersTab.tsx:116`（「移到其他类型」选择器）
- Test: `tests/unit/popup/logic.test.ts`（新增）、`tests/unit/background/panel.test.ts:347`（键集）

**Interfaces:**
- Consumes: Task 1 的类型集
- Produces:
  - `PanelCategory` 增加 `route: 'retrieve' | 'size'`
  - `export function recordLevelCategories(categories: PanelCategory[]): PanelCategory[]`（`popup/logic.ts`）—— **判据写黑名单 `c.route !== 'size'`**，见 Global Constraints 与 Review Focus 第 1 条

- [ ] **Step 1: 写 UI 侧测试（先失败）**

在 `tests/unit/popup/logic.test.ts` 新增：

```ts
const cats = [
  { id: 'preset:attribute', name: '商品信息', kind: 'preset', filterable: true, position: 0, route: 'retrieve' },
  { id: 'preset:size', name: '尺码推荐', kind: 'preset', filterable: true, position: 8, route: 'size' },
  { id: 'uncategorized', name: '未分类', kind: 'uncategorized', filterable: false, position: 9999, route: 'retrieve' },
] as PanelCategory[]

it('导航里不出现尺码推荐', () => {
  const items = catNavItems([], cats)
  expect(items.map((i) => i.id)).not.toContain('preset:size')
})

it('★ 缺 route 字段的类型仍然显示（判据是黑名单，不是白名单）', () => {
  const dto = [{ id: 'c1', name: '自定义', kind: 'custom', filterable: true, position: 9 }] as PanelCategory[]
  expect(catNavItems([], dto).map((i) => i.id)).toContain('c1')
})

it('★ 带尺码标签的记录计进「未分类」—— 全部 = 各组之和，条目不丢', () => {
  const shown = [{ categoryId: 'preset:size' }, { categoryId: 'preset:attribute' }]
  const items = catNavItems(shown, cats)
  expect(items.find((i) => i.id === ALL_CATEGORY_ID)!.count).toBe(2)
  expect(items.find((i) => i.id === UNCATEGORIZED_CATEGORY_ID)!.count).toBe(1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/popup/logic.test.ts`
Expected: FAIL —— `catNavItems` 的返回值里现在含 `preset:size`

- [ ] **Step 3: 加 `recordLevelCategories` 并接进三处**

`src/popup/logic.ts`：

```ts
/**
 * 记录级可见的类型：排除 route='size'（尺码只参与意图识别，不该有存档记录）。
 *
 * 判据刻意用**黑名单**（!== 'size'）而不是白名单（=== 'retrieve'）：
 * DTO 与测试桩可能缺 route 字段，白名单会把它们**全部**滤掉 ——
 * 类型导航会静默变成一片空白，且不报错。黑名单缺字段时最多多出一个桶。
 */
export function recordLevelCategories(categories: PanelCategory[]): PanelCategory[] {
  return categories.filter((c) => c.route !== 'size')
}
```

接到三处（`catNavItems` 里 `known` 与 `categoryOrder` 要用**同一份**过滤后的数组，否则计数与显示会错位）：

1. `catNavItems`：函数开头 `const visible = recordLevelCategories(categories)`，`known` 与 `categoryOrder(...)` 都改用 `visible`。
2. `groupByCategory`（约 :208）：`categoryOrder(recordLevelCategories(categories))`。
3. `FoldersTab.tsx:116`：`categoryOrder(recordLevelCategories(categories)).map(...)`。

`filterByCategory` **不需要改** —— 导航不给尺码入口，`activeCat` 就不可能是它。

- [ ] **Step 4: `PanelCategory` 加 `route`，两处 DTO 补值，兜底字面量补值**

- `src/types/messages/panel.ts`：`PanelCategory` 加 `route: 'retrieve' | 'size'`，注释写明它与 `filterable` 的分工（`filterable` 管"是不是 jev 选项"，`route` 管"记录级可见 + 进不进检索池"）。
- `src/background/panel.ts` 与 `src/background/index.ts` 两处 `categories.map(...)` 各加 `route: c.route`。
- `src/popup/logic.ts` 的 `uncCategory` 兜底字面量加 `route: 'retrieve'`。

- [ ] **Step 5: 同步 DTO 键集断言**

`tests/unit/background/panel.test.ts:347` 的 `Object.keys(c).sort()` 期望数组加 `'route'`（按字母序插在 `'position'` 与 … 之间的正确位置）。

- [ ] **Step 6: 跑全量测试确认通过**

Run: `pnpm test`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add src/types/messages/panel.ts src/background/panel.ts src/background/index.ts src/popup/logic.ts src/popup/FoldersTab.tsx tests/unit/popup/logic.test.ts tests/unit/background/panel.test.ts
git commit -m "feat(panel): 类型 DTO 带 route,两个归档页面不再显示尺码推荐"
```

---

### Task 5: Dexie `version(9)` 迁移

**Files:**
- Modify: `src/background/db.ts`（`version(8)` 之后追加 `version(9)`；`:192-221` 的 `ensurePresetCategories` **不改** —— 它按数组下标取 position，九条自然排 0..8）
- Test: `tests/unit/background/dbUpgrade.test.ts`（新增迁移用例）

**Interfaces:**
- Consumes: Task 1 的 `PRESET_CATEGORIES`（九条）
- Produces: 从 v8 库升级到 v9 后的不变量 —— 八条记录级 position 0..7、`preset:size` 保留且 `route='size'`/`filterable=true`、非预置行 position ≥9、全表名称唯一、被碰过的类型 `updatedAt > 记录 categoryAt`

- [ ] **Step 1: 写迁移测试（先失败）**

在 `tests/unit/background/dbUpgrade.test.ts` 的 v8 升级 describe 里新增。先造一条 v8 形态的库（既有用例已有造库样板，照抄）：

```ts
it('v9：五个预置改名换 criteria，新增三条，尺码保留', async () => {
  // 造 v8 库 → 升级到 v9
  expect((await upgraded.categories.get('preset:attribute'))!.name).toBe('商品信息')
  expect((await upgraded.categories.get('preset:order'))!.name).toBe('发货与物流')
  expect(await upgraded.categories.get('preset:payment')).toBeTruthy()
  expect(await upgraded.categories.get('preset:quality')).toBeTruthy()
  expect(await upgraded.categories.get('preset:other')).toBeTruthy()
  const size = (await upgraded.categories.get('preset:size'))!
  expect(size.route).toBe('size')
  expect(size.filterable).toBe(true)
})

it('v9：八个记录级 position 0..7，尺码 8，非预置行被推到 >=9', async () => {
  // 造库时先塞一条 position=6 的自定义类型
  expect((await upgraded.categories.get('preset:quality'))!.position).toBe(6)
  expect((await upgraded.categories.get('preset:size'))!.position).toBe(8)
  expect((await upgraded.categories.get('cat-old'))!.position).toBeGreaterThanOrEqual(9)
})

it('★ 名称撞车被让开：已有名叫「其他」的 legacy 行时，全表名称仍唯一', async () => {
  // 造库时先塞 id='legacy:f-other'、name='其他'、criteria=''、filterable=false
  const all = await upgraded.categories.toArray()
  const names = all.map((c) => c.name)
  expect(new Set(names).size).toBe(names.length)
  expect((await upgraded.categories.get('preset:other'))!.criteria).not.toBe('')
})

it('★ updatedAt 严格大于记录 categoryAt —— 否则一条都不会重跑', async () => {
  const { history, golden } = await upgraded.countBackfillCandidates()
  expect(history + golden).toBe(EXPECTED_COUNT) // 造库时埋下的存量条数 − manual 条数
})

it('★ 存量里带尺码标签的记录进了补分类候选', async () => {
  // 造库时埋一条 categoryId='preset:size'、categorySource='jev' 的记录
  const { history } = await upgraded.countBackfillCandidates()
  expect(history).toBeGreaterThan(0)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/unit/background/dbUpgrade.test.ts`
Expected: FAIL —— `preset:payment` 为 undefined（迁移还没写）

- [ ] **Step 3: 写 `version(9)`**

在 `version(8)` 块之后追加。顺序即 spec 5.3，**先算时间戳再改行**：

```ts
const now = Date.now()
// ① 取名:让 `updatedAt` **严格大于**存量记录的 categoryAt。
//    上一次迁移(v8)刻意取等让记录不重跑;这一次要的正是重跑 —— 取等会让
//    criteria 改了而旧标签原样留着(界面显示新类型、归类还是旧标准,静默失效)。
const maxCategoryAt = 现读 qaRecords ∪ goldens 的 categoryAt 最大值
const stamp = Math.max(now, maxCategoryAt + 1)
```

然后按序执行：

1. **名称唯一性守卫**（在新增之前）：读全表，若某个非预置行（`kind !== 'preset' && kind !== 'uncategorized'`）的名字与即将新增的三条之一相同，把它改名为 `${name}(旧)`。
2. 五个既有预置改名 + 换 criteria：`preset:attribute`→商品信息、`preset:price`→价格优惠、`preset:stock`→库存与规格、`preset:order`→发货与物流、`preset:aftersale`→退换货。criteria **逐字取自 spec §4.1**（与 `PRESET_CATEGORIES` 同源，建议直接从常量数组读，避免两处抄漏）。
3. 新增三条：`preset:payment` / `preset:quality` / `preset:other`，`kind:'preset'`、`route:'retrieve'`、`filterable:true`、`createdAt: now`。
4. position：八个记录级按数组序 0..7，`preset:size` 排 8。
5. 全部非预置、非未分类的行 position 抬到 `>= 9`（保序：按现有 position 升序重新编号）。
6. 把 1~4 碰过的全部类型**以及 `preset:size`** 的 `updatedAt` 置为 `stamp`（尺码也要顶：存量里可能已有尺码标签，得让它们重判）。
7. **不做任何删除。**

- [ ] **Step 4: 跑迁移测试确认通过**

Run: `pnpm test tests/unit/background/dbUpgrade.test.ts`
Expected: PASS

- [ ] **Step 5: 加一条"取等会失败"的守卫断言**

在时间戳那条用例里补一句，把这条教训钉死：

```ts
// 取等是我踩过的坑：stamp 与 categoryAt 相等时 `<` 不成立，一条都不重跑
expect(stamp).toBeGreaterThan(maxCategoryAt)
```

- [ ] **Step 6: 跑全量测试确认通过**

Run: `pnpm test`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add src/background/db.ts tests/unit/background/dbUpgrade.test.ts
git commit -m "feat(db): v9 迁移 —— 类型集改名/新增/重排,尺码保留并触发重判"
```

---

### Task 6: 验收资产同步

**Files:**
- Modify: `scripts/verify-golden-multi.mjs`（旧类型名字面量）
- Test: 数据层 e2e（本机口径，不截图）

**Interfaces:**
- Consumes: Task 1~5 全部
- Produces: 一个可复跑的验收路径

- [ ] **Step 1: 修脚本里的旧字面量**

`scripts/verify-golden-multi.mjs` 里硬编码的「订单物流」之类改成新名（按 grep 出来的实际位置改；若它靠的是 `data-category-id` 锚点而非文字，则只改注释）。

- [ ] **Step 2: 全仓搜一遍漏网的旧字面量**

Run: `grep -rn "订单物流\|商品属性\|售后退换\|库存发货" src/ scripts/ tests/`
Expected: 只剩 `tests/unit/background/backfillState.test.ts` 与 `classify.test.ts` 的**测试桩**里那两处（它们是刻意保留的样例数据，不是产品字面量）—— 其余都要改掉。

- [ ] **Step 3: 数据层 e2e —— 迁移后待办数（Review Focus 第 5 条的最终验证）**

用临时 profile 起扩展（照 `scripts/_recon-read-db.mjs` 的样板：`launchExtContext(freshProfile())`），跑一次迁移后断言：

- `countBackfillCandidates()` 的待办数 = 存量总数 − manual/已重跑条数
- 库里 `categories` 共 10 行，`preset:size` 在，`preset:payment/quality/other` 在

**不截图**（本仓既定口径：优先纯数据层验收）。

- [ ] **Step 4: 真机抽查（spec 7.3）**

点一次「开始分类全部历史」，然后：
- 「发票」类问题落在 **支付与发票**
- 问候语落在 **其他**
- 「商品信息」占比明显低于改造前的 57%
- **没有一条落在尺码推荐**
- 到「历史问答」「标准回答」两页确认类型导航里**没有「尺码推荐」**，也不是空桶

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-golden-multi.mjs
git commit -m "chore(scripts): 验收脚本适配新类型集"
```

---

### Task 7: 文档回写

**Files:**
- Modify: `CHANGELOG.md`（未发布节）
- Modify: `docs/DESIGN.md`（类型集一节）
- Create/Modify: `docs/工作状态-<今天>.md`

**Interfaces:**
- Consumes: Task 1~6 的实际结果
- Produces: 无代码接口

- [ ] **Step 1: CHANGELOG 未发布节**

写清三件事：类型集 6→8（列出名单）、`preset:size` 转为查询级专用、两条阈值常量变更及其**理由**（复核线与阈值重合会让标记静默失效）。

- [ ] **Step 2: `docs/DESIGN.md` 的类型一节改成八条**

把旧的六个预置类型那段换掉，并加一句作用域说明：记录级 = `filterable && route === 'retrieve'`，查询级 = `filterable`。

- [ ] **Step 3: 工作状态**

按本仓惯例写一节（做了什么、为什么、留了什么欠账）。**欠账必须写明**：本机没上传过尺码表，所以尺码路由今天不会触发（配置状态，不是缺陷）；以及 spec §十 那些留给实现者的判断实际选了什么。

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/DESIGN.md "docs/工作状态-$(date +%F).md"
git commit -m "docs: 回写类型重制的 CHANGELOG/DESIGN/工作状态"
```

---

## Self-Review

**Spec 覆盖：** §三 U1~U7 → Task 1（U1/U2/U3/U5）；Task 3（M1 的出口）；Task 2+4（U7/M4）；Task 5（M3/M6/M7）。M8 是约束不是任务（写进 Global Constraints）。M9 → Task 1+Task 4 的键集。M10 → Task 4。§四.1 criteria → Task 1 Step 3。§五.5/5.6 → Task 5。§六.1 → Task 2；6.2 → Task 3；6.3 → Task 1；6.4 → Task 6 Step 4。§七.1 → Task 1/2/4/5 的测试；7.2 → Task 6 Step 3；7.3 → Task 6 Step 4；7.4 → Task 1/2 的机械同步 + Task 6。§八 → Task 4。§九/§十 → Task 7 Step 3。**无缺口。**

**类型一致性：** `ClassifyScope` 在 Task 2 定义并在同任务内用完；`recordLevelCategories` 在 Task 4 定义并使用；`PanelCategory.route` 在 Task 4 定义，Task 4 的两处 DTO 与 Task 5 的迁移都不依赖它（迁移直接读 `CategoryRecord`）。`classifiableCategories` 的两参数形态只在 Task 2 之后出现，Task 1 不碰它。

**顺序依赖：** Task 1 改类型集后 Task 2 才改签名 —— 但 Task 1 结束时 `classify.test.ts` 仍用旧签名且会通过（它自造桩数据，不读库），所以两个任务都能独立绿。Task 4 的键集断言必须等 Task 4 才改，Task 1 已明确"不要动"。

**比例：** 计划 7 个任务、与 spec 长度相当；代码块只出现在"签名+测试断言"处，没有替实现者写函数体（唯一例外是 `recordLevelCategories` 与 `INSTRUCTIONS` 的整段文本 —— 那两处的措辞本身就是设计决定，不是实现细节）。
