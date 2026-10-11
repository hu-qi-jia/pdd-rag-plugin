# 问题自动分类 · 地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让扩展能用 jev 模型自动把历史问答与标准回答归入 6 个预置问题类型（或"未分类"），并提供一次性补分类能力。

**Architecture:** 新增一张 `categories` 表作为唯一分类轴（取代 `folders` 的分类职责）；新增 `jev.ts`（只负责怎么调 System One 接口）与 `classify.ts`（只负责问到之后怎么落）；打标在两条写入路径上触发——新问答捕获时、标准回答创建/提升时；存量走设置页手动触发的批量补分类。本计划**不触碰检索**，分类结果此时还不影响搜索结果（那是下一份计划）。

**Tech Stack:** TypeScript、Dexie 4（IndexedDB）、Plasmo MV3、Vitest 3 + happy-dom + fake-indexeddb、TypeSafe System One HTTP API。

**Spec:** `docs/specs/2026-10-11-question-classification-design.md`

## Global Constraints

以下取自 spec §十三「不变量」，每个 Task 的要求都隐含包含它们：

- **TTL / 保留期逻辑一个字不改**：`retentionDays`（默认 90，夹取 30–365）与 `purgeExpired` 的清理行为不变。未分类的条目照常过期，分类既不延长也不缩短任何条目的寿命。
- **回复正文与标准回答正文永不出本机**。外发只含**问题文本**。
- **未配置时零远程请求**：`classifyEnabled` 默认 `false`、jev 配置默认空串时，运行期不得发出任何网络请求。
- **API Key 只进 `chrome.storage.local`**，不进 `chrome.storage.sync`，不随导出外发。
- **发送永远由人完成**：扩展从不代发消息。
- **导入导出信封保持 2.0**：新增字段全部可选，旧包照常导入。
- **现有全部测试必须保持全绿**（`npm test`）。
- **预置类型不可改名、不可删、判定说明不可改**；未分类同样不可改名/删。
- **`filterable === true` 与「该类型是 jev 的分类选项」是同一个集合**，不设第二个开关。
- **判定说明必填且非空白**（新增自定义类型时校验）。

## Review Focus

以下是 spec 没有明写、但使用者会立刻撞上的失败模式。每一条都已落到某个 Task 的测试里。

1. **老库升级后，原本挂在某个手工文件夹里的标准回答反而落进"未分类"** —— 用户打开面板会以为数据丢了。期望：文件夹名与其中标准回答的归属都在。（Task 3）
2. **用户手工摆放过的标准回答，被一次补分类覆盖掉** —— 期望：标了 `manual` 的一条一律不动。（Task 3 的迁移标记 + Task 9 的跳过规则）
3. **手工新建一条标准回答（没有历史来源）后它永远卡在未分类** —— 期望：创建时调一次 jev 归类。（Task 8）
4. **设置页填了 jev 地址但没填 key，或填了 key 但总开关是关的，却发出了请求** —— 期望：零网络请求。（Task 4 的默认值 + Task 6 的门禁）
5. **补分类跑到一条正好被 TTL 清掉的问答上** —— 期望：静默跳过，不崩、不复活它。（Task 9）

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `src/background/jev.ts` | jev System One 调用层：拼请求、解析概率、超时、测试连接。**只管"怎么问"** |
| `src/background/classify.ts` | 打标编排：概率 → 落哪个类型 / 落未分类；批量补存量的计数、并发、进度、中断。**只管"问到之后怎么落"** |
| `tests/unit/background/jev.test.ts` | 调用层单测（mock fetch） |
| `tests/unit/background/categories.test.ts` | 类型表种子与读取 |
| `tests/unit/background/classify.test.ts` | 打标编排纯逻辑 |
| `tests/unit/background/backfill.test.ts` | 批量补存量（fake-indexeddb + mock fetch） |
| `tests/unit/shared/categoryPresets.test.ts` | 预置类型常量自检 |

**修改**

| 文件 | 改动 |
|---|---|
| `src/types/memory.ts` | 新增 `CategoryRecord`；`QaRecord` / `GoldenRecord` / `KbDocRecord` 加字段 |
| `src/shared/constants.ts` | 新增 `UNCATEGORIZED_CATEGORY_ID`、`PRESET_CATEGORIES`、`DEFAULT_SETTINGS` 六项、超时/阈值夹取区间 |
| `src/background/db.ts` | `categories` 表 + `version(8)` + 迁移 + 类型 DAO |
| `src/background/settings.ts` | `clampSettings` 覆盖六个新字段 |
| `src/background/pddCapture.ts` | `closeQuestion` 落盘后触发一次打标 |
| `src/background/goldens.ts` | 提升时继承来源问答的类型；手工新建时打标 |

**本计划不碰**：`retrieval.ts`、`retrievalCache.ts`、`search.ts`、`llm.ts`、`aiIntegrate.ts`、任何 `.tsx`。

---

## Task 1: 分类类型定义与六个预置类型

**Files:**
- Modify: `src/types/memory.ts`（在 `KbDocRecord` 之后追加）
- Modify: `src/shared/constants.ts`
- Test: `tests/unit/shared/categoryPresets.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `CategoryRecord`（类型）；`UNCATEGORIZED_CATEGORY_ID: string`；`PresetCategoryDef`（类型）；`PRESET_CATEGORIES: readonly PresetCategoryDef[]`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/shared/categoryPresets.test.ts`：

```ts
// 预置问题类型的自检:它是 jev 的 criteria 来源,写坏了分类质量整体下降,
// 所以尺寸、唯一性、非空这些结构性质要有断言兜着。
import { describe, it, expect } from 'vitest'
import { PRESET_CATEGORIES, UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'

describe('预置问题类型', () => {
  it('恰好六个', () => {
    expect(PRESET_CATEGORIES.length).toBe(6)
  })

  it('id 唯一,且不与未分类冲突', () => {
    const ids = PRESET_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(UNCATEGORIZED_CATEGORY_ID)
  })

  it('id 一律带 preset: 前缀(迁移来的自定义类型用 legacy:,不会被撞上)', () => {
    for (const c of PRESET_CATEGORIES) expect(c.id.startsWith('preset:')).toBe(true)
  })

  it('恰好一个是 size 路由,其余都是 retrieve', () => {
    const sizes = PRESET_CATEGORIES.filter((c) => c.route === 'size')
    expect(sizes.length).toBe(1)
    expect(sizes[0].id).toBe('preset:size')
  })

  it('判定说明非空且互不相同', () => {
    const texts = PRESET_CATEGORIES.map((c) => c.criteria)
    for (const t of texts) expect(t.trim().length).toBeGreaterThan(0)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('判定说明足够具体 —— 过短的描述会让 jev 在相邻类型间摇摆', () => {
    for (const c of PRESET_CATEGORIES) expect(c.criteria.length).toBeGreaterThan(20)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/shared/categoryPresets.test.ts`
Expected: FAIL —— `PRESET_CATEGORIES` is not exported（或导入为 undefined）

- [ ] **Step 3: 在 `src/types/memory.ts` 追加类型**

在 `KbDocRecord` 接口之后、`// ─── 使用统计(v0.16) ───` 之前插入：

```ts
/**
 * 问题类型(categories):自动分类的分类轴(第五十六轮)。
 *
 * 取代 folders 的**分类**职责 —— folders 只挂金标准且是纯手工两层树,
 * 这张表是机器自动打的、跨问答与标准回答两个实体的单一分类轴。
 * folders 表本身保留不删(回滚用),迁移后不再被读写。
 */
export interface CategoryRecord {
  /** 主键。预置为 'preset:size' 等;未分类为 'uncategorized';迁移来的旧文件夹为 'legacy:<旧夹id>';新建为 uuid */
  id: string
  /** 显示名 */
  name: string
  /**
   * 判定说明 —— 原样作为 jev 的 criteria 选项描述。
   * filterable=true 的类型此字段必非空(见 constants.ts 的 PRESET_CATEGORIES 与新增类型校验)。
   */
  criteria: string
  kind: 'preset' | 'custom' | 'uncategorized'
  /** 查询时怎么走:'retrieve' 按类型筛池;'size' 不走检索,走尺码表 + LLM 生成 */
  route: 'retrieve' | 'size'
  /**
   * 是否参与类型过滤。
   * true  = 查询时按类型筛(进了类型集合才会被检索)
   * false = 永远进检索池,不做类型筛
   *
   * 硬约束:filterable === true 与「是 jev 的分类选项」是**同一个集合**,
   * 不设第二个开关。未分类与迁移来的旧文件夹恒为 false。
   */
  filterable: boolean
  /** 显示顺序(升序);未分类恒为 9999,排在最后 */
  position: number
  createdAt: number
  updatedAt: number
}
```

同时给 `QaRecord`、`GoldenRecord`、`KbDocRecord` 各加字段。

`QaRecord`（加在 `replyCount` 之前）：

```ts
  /** 问题类型;null/'uncategorized' = 未分类 */
  categoryId?: string | null
  /** 打标时该标签的概率(0~1);低于阈值不落标,直接进未分类 */
  categoryConfidence?: number
  /** 谁打的标:jev 自动 / 人工指定 */
  categorySource?: 'jev' | 'manual'
  /** 打标时间;判定说明改动后可据此只重跑旧的 */
  categoryAt?: number
```

`GoldenRecord`（加在 `sourceReplyId` 之后）：

```ts
  /** 取代原 folderId;null/'uncategorized' = 未分类 */
  categoryId?: string | null
  /** 打标时该标签的概率(0~1) */
  categoryConfidence?: number
  /** 比 qaRecords 多一个 'inherit':提升时从来源历史问答继承 */
  categorySource?: 'jev' | 'inherit' | 'manual'
  /** 打标时间 */
  categoryAt?: number
```

`KbDocRecord`（加在 `chunkCount` 之后）：

```ts
  /** 是否尺码表。标记为尺码表的文档不做向量检索,整篇原文作为 LLM 生成材料(见 spec §八) */
  isSizeTable?: boolean
```

- [ ] **Step 4: 在 `src/shared/constants.ts` 追加常量**

在 `MAX_GOLDENS_PER_QUESTION` 之后追加：

```ts
// ─── 问题自动分类(第五十六轮) ────────────────────────────────────────────────

/** 未分类类型固定 id:兜底容器,不可改名/删,恒在检索池中(filterable=false) */
export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized'

/** 未分类的显示名与排序位(恒排最后) */
export const UNCATEGORIZED_CATEGORY_NAME = '未分类'
export const UNCATEGORIZED_CATEGORY_POSITION = 9999

export interface PresetCategoryDef {
  id: string
  name: string
  /** 原样作为 jev 的 criteria 选项描述 */
  criteria: string
  route: 'retrieve' | 'size'
}

/**
 * 六个预置问题类型 —— 名称与判定说明写死,不可改名/删/改(设计 D3)。
 *
 * 判据是**答案从哪来**,不是话题:
 *  - size 路由的答案依赖买家个体参数,历史回复不可复用,必须现场生成;
 *  - retrieve 路由的答案模板化,历史与标准回答可直接复用。
 *
 * 判定说明必须彼此可区分 —— jev 的 choice 只从给定选项里选,选项描述含糊时
 * **全部类型**的判断质量一起下降,不只是写得差的那一条。
 */
export const PRESET_CATEGORIES: readonly PresetCategoryDef[] = [
  {
    id: 'preset:size',
    name: '尺码推荐',
    criteria:
      '买家在询问自己该选哪个尺码或规格:给出身高、体重、三围、鞋码等个人参数,或问偏大偏小、是否合适、自己穿几码。答案取决于买家的个体参数。',
    route: 'size',
  },
  {
    id: 'preset:order',
    name: '订单物流',
    criteria:
      '询问发货时间、催发货、快递公司、运单号、物流停滞不更新、修改收货地址、大概多久到货。围绕已经下单的包裹在路上或还没发出。',
    route: 'retrieve',
  },
  {
    id: 'preset:aftersale',
    name: '售后退换',
    criteria:
      '退换货、退款、运费险、七天无理由、商品质量问题、破损、少发漏发、需要维修。围绕成交之后的问题。',
    route: 'retrieve',
  },
  {
    id: 'preset:price',
    name: '价格优惠',
    criteria: '询问价格、优惠券、满减、议价讲价、能不能便宜、是否包邮、有没有活动或赠品。',
    route: 'retrieve',
  },
  {
    id: 'preset:attribute',
    name: '商品属性',
    criteria:
      '询问商品本身的客观属性:材质成分、产地、尺码表以外的规格型号、颜色、配件清单、洗涤保养方式。',
    route: 'retrieve',
  },
  {
    id: 'preset:stock',
    name: '库存发货',
    criteria:
      '购买前询问库存:现在有没有货、某个颜色或某个尺码还有没有、什么时候补货、能不能拍下。与订单物流的区别是这里还没下单。',
    route: 'retrieve',
  },
] as const
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/shared/categoryPresets.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 6: 跑全量测试确认没打断别的**

Run: `npm test`
Expected: 全绿。若 `settings.test.ts` 报 `PddSettings` 新字段相关失败，先记下——那个 Task 4 才处理；此刻 `DEFAULT_SETTINGS` 未加字段，`CategoryRecord` 也不参与设置，预期不失败。

- [ ] **Step 7: 提交**

```bash
git add src/types/memory.ts src/shared/constants.ts tests/unit/shared/categoryPresets.test.ts
git commit -m "feat: 问题类型 CategoryRecord 与六个预置类型(第五十六轮)"
```

---

## Task 2: `categories` 表、种子与读取

**Files:**
- Modify: `src/background/db.ts`
- Test: `tests/unit/background/categories.test.ts`

**Interfaces:**
- Consumes: `CategoryRecord`、`PRESET_CATEGORIES`、`UNCATEGORIZED_CATEGORY_ID`（Task 1）
- Produces: `db.categories`（`Table<CategoryRecord, string>`）；`db.ensurePresetCategories(): Promise<void>`；`db.listCategories(): Promise<CategoryRecord[]>`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/categories.test.ts`：

```ts
// categories 表种子与读取(fake-indexeddb 内存实现)
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import {
  PRESET_CATEGORIES,
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_NAME,
  UNCATEGORIZED_CATEGORY_POSITION,
} from '../../../src/shared/constants'

let testDb: PddDatabase

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
  testDb = new PddDatabase()
  await testDb.open()
})

describe('categories 种子', () => {
  it('种下 6 个预置 + 未分类', async () => {
    await testDb.ensurePresetCategories()
    const all = await testDb.listCategories()
    expect(all.length).toBe(PRESET_CATEGORIES.length + 1)
    expect(all.map((c) => c.id)).toContain(UNCATEGORIZED_CATEGORY_ID)
  })

  it('预置的 kind/filterable/route 口径正确', async () => {
    await testDb.ensurePresetCategories()
    const all = await testDb.listCategories()
    for (const preset of PRESET_CATEGORIES) {
      const row = all.find((c) => c.id === preset.id)!
      expect(row.kind).toBe('preset')
      expect(row.route).toBe(preset.route)
      expect(row.criteria).toBe(preset.criteria)
      // 预置恒参与过滤(未分类不参与)
      expect(row.filterable).toBe(true)
    }
    const unc = all.find((c) => c.id === UNCATEGORIZED_CATEGORY_ID)!
    expect(unc.kind).toBe('uncategorized')
    expect(unc.filterable).toBe(false)
    expect(unc.criteria).toBe('')
  })

  it('幂等:跑两次不重复种', async () => {
    await testDb.ensurePresetCategories()
    await testDb.ensurePresetCategories()
    expect(await testDb.categories.count()).toBe(PRESET_CATEGORIES.length + 1)
  })

  it('不覆盖已改动过的 position(用户可能调过顺序)', async () => {
    await testDb.ensurePresetCategories()
    await testDb.categories.update('preset:price', { position: 42 })
    await testDb.ensurePresetCategories()
    expect((await testDb.categories.get('preset:price'))!.position).toBe(42)
  })

  it('未分类恒排最后', async () => {
    await testDb.ensurePresetCategories()
    const all = await testDb.listCategories()
    expect(all[all.length - 1].id).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(all[all.length - 1].position).toBe(UNCATEGORIZED_CATEGORY_POSITION)
  })

  it('未分类的显示名与 sort 位取自常量(不散落字面量)', async () => {
    await testDb.ensurePresetCategories()
    const unc = (await testDb.categories.get(UNCATEGORIZED_CATEGORY_ID))!
    expect(unc.name).toBe(UNCATEGORIZED_CATEGORY_NAME)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/categories.test.ts`
Expected: FAIL —— `ensurePresetCategories is not a function`

- [ ] **Step 3: 给 `src/background/db.ts` 加表声明与版本**

在文件顶部的表清单注释里，`folders` 那一行之后加一行：

```
 *   categories — 问题类型(自动分类的分类轴,取代 folders 的分类职责)
```

在 import 里加（按字母序放在 `KbDocRecord` 之后）：

```ts
import type {
  CategoryRecord,
  ErrorLog,
  FolderRecord,
  ...
} from '../types/memory';
```

并在 `UNCATEGORIZED_FOLDER_ID, UNCATEGORIZED_FOLDER_NAME` 后面补上：

```ts
import {
  PRESET_CATEGORIES,
  SELF_TEST_SESSION_KEY,
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_NAME,
  UNCATEGORIZED_CATEGORY_POSITION,
  UNCATEGORIZED_FOLDER_ID,
  UNCATEGORIZED_FOLDER_NAME,
} from '../shared/constants';
```

在类字段区加：

```ts
  categories!: Table<CategoryRecord, string>;
```

在 `version(7)` 之后新增 `version(8)`（**本 Task 只加 stores，`upgrade` 由 Task 3 补**）：

```ts
    // 第五十六轮 问题自动分类:categories 表。
    // 它是跨 qaRecords / goldens 两个实体的单一分类轴,取代 folders 的分类职责;
    // folders 表保留不删(回滚用),迁移后不再被读写。
    this.version(8).stores({
      categories: "id, kind, position",
    });
```

- [ ] **Step 4: 加种子与读取 DAO**

在 `ensurePresetFolders()` 之后插入：

```ts
  /**
   * 确保 6 个预置类型 + 未分类存在(固定 id,幂等)。
   *
   * 已存在的一律不覆盖 —— 用户可能已经调过 position。预置的**内容**
   * (name/criteria/route)按设计 D3 不可改,所以不存在"用户改过要保留"的情形;
   * 这里只保证不把用户调过的顺序冲掉。
   */
  async ensurePresetCategories(): Promise<void> {
    const now = Date.now();
    const seeds: CategoryRecord[] = [
      ...PRESET_CATEGORIES.map((p, i) => ({
        id: p.id,
        name: p.name,
        criteria: p.criteria,
        kind: "preset" as const,
        route: p.route,
        filterable: true,
        position: i,
        createdAt: now,
        updatedAt: now,
      })),
      {
        id: UNCATEGORIZED_CATEGORY_ID,
        name: UNCATEGORIZED_CATEGORY_NAME,
        criteria: "",
        kind: "uncategorized" as const,
        route: "retrieve" as const,
        filterable: false,
        position: UNCATEGORIZED_CATEGORY_POSITION,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const existing = await this.categories.bulkGet(seeds.map((s) => s.id));
    const missing = seeds.filter((_, i) => !existing[i]);
    if (missing.length > 0) await this.categories.bulkAdd(missing);
  }

  // ─── 问题类型(categories) ────────────────────────────────────────────────────

  /** 全部类型,按 position 升序(未分类恒最后,它的 position 为 9999) */
  async listCategories(): Promise<CategoryRecord[]> {
    const all = await this.categories.toArray();
    return all.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/categories.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add src/background/db.ts tests/unit/background/categories.test.ts
git commit -m "feat: categories 表与预置类型种子(第五十六轮)"
```

---

## Task 3: v7 → v8 迁移（旧文件夹转自定义类型）

**Files:**
- Modify: `src/background/db.ts`（给 `version(8)` 加 `.upgrade(...)`）
- Test: `tests/unit/background/dbUpgrade.test.ts`（追加一组用例）

**Interfaces:**
- Consumes: `db.categories`、`CategoryRecord`（Task 1、2）
- Produces: 迁移后的数据形状 —— 每个旧文件夹对应一条 `id = 'legacy:<旧夹id>'`、`kind='custom'`、`filterable=false`、`position = 100 + 序号` 的类型；每条有 `folderId` 的金标准 `categoryId = 'legacy:<folderId>'`、`categorySource='manual'`

**为什么要标 `manual`：** 用户手工摆放过的归属，机器永远不许覆盖。漏了这一步，将来改一次判定说明再跑补分类，用户手工整理的结果会被全部冲掉。

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/background/dbUpgrade.test.ts` **末尾追加**（该文件已有 `import 'fake-indexeddb/auto'`、`Dexie`、`PddDatabase` 的导入）：

```ts
// ─── v7 → v8:旧文件夹转自定义类型 ─────────────────────────────────────────────
//
// 这一步的失败模式是"用户以为数据丢了":如果迁移把原本挂在「双十一」夹里的标准回答
// 落进未分类,用户打开面板会认为手工整理白做了。所以三条断言必须同时成立 ——
// 文件夹名还在、归属还对、且被标成人工的(机器不许再动)。

/** v7 的完整 schema(v1~v7 原样搭一遍,刻意不共用运行时定义) */
const LEGACY_V7: Array<Record<string, string | null>> = [
  {
    qaRecords: 'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs]',
    replies: 'id, qaId, contentHash, ts',
    goldens: 'id, folderId, questionHash, hasEmbedding',
    folders: 'id, parentId',
    errors: '++id, timestamp',
  },
  { knowledge: 'id, questionHash, hasEmbedding, enabled' },
  { knowledge: 'id, questionHash, hasEmbedding, enabled, docId' },
  {
    qaRecords:
      'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs], msgId',
    replies: 'id, qaId, contentHash, ts, msgId',
  },
  { kbDocs: 'docId, splitterVersion' },
  { metrics: 'key', backlogIgnores: 'questionHash' },
  { backlogIgnores: null },
]

/**
 * 造一个"跑过 v7"的库:两个文件夹、三条标答 ——
 * ①在用户自建夹里 ②落在预置默认夹里 ③没入夹。
 * ②是本次迁移最容易搞错的一类:它看着"有归属",其实是 addGolden 的系统默认落点。
 */
async function seedLegacyV7(): Promise<void> {
  const legacy = new Dexie('PddCSDB')
  LEGACY_V7.forEach((stores, i) => {
    legacy.version(i + 1).stores(stores)
  })
  await legacy.open()
  await legacy.table('folders').bulkAdd([
    { id: 'uncategorized', parentId: null, name: '默认文件夹', position: 0, createdAt: 1000 },
    { id: 'f-hot', parentId: null, name: '双十一', position: 1, createdAt: 2000 },
  ])
  await legacy.table('goldens').bulkAdd([
    {
      id: 'gd-in-folder',
      folderId: 'f-hot',
      question: '能便宜点吗',
      answer: '亲,已经是最低价啦',
      questionHash: 'h1',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'gd-no-folder',
      folderId: null,
      question: '多久发货',
      answer: '48 小时内发出',
      questionHash: 'h2',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      // 落在预置默认夹里 —— addGolden 的默认落点,不是用户的手工摆放
      id: 'gd-in-default',
      folderId: 'uncategorized',
      question: '有色差吗',
      answer: '亲,实物与图片一致哦',
      questionHash: 'h3',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  legacy.close()
}

describe('v7 → v8 旧文件夹迁移', () => {
  beforeEach(async () => {
    await Dexie.delete('PddCSDB')
  })

  it('每个**用户自建**的旧文件夹转成一条 filterable=false 的自定义类型', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()

    const hot = await upgraded.categories.get('legacy:f-hot')
    expect(hot).toBeDefined()
    expect(hot!.name).toBe('双十一')
    expect(hot!.kind).toBe('custom')
    expect(hot!.filterable).toBe(false)
    expect(hot!.criteria).toBe('')

    // 预置默认夹不转:它和新内置的「未分类」是同一件事,且名字是系统占位名
    expect(await upgraded.categories.get('legacy:uncategorized')).toBeUndefined()
    upgraded.close()
  })

  it('标准回答的归属跟着搬,且标成人工的(机器永不许覆盖)', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()

    const inFolder = (await upgraded.goldens.get('gd-in-folder'))!
    expect(inFolder.categoryId).toBe('legacy:f-hot')
    expect(inFolder.categorySource).toBe('manual')

    const noFolder = (await upgraded.goldens.get('gd-no-folder'))!
    expect(noFolder.categoryId).toBeNull()
    expect(noFolder.categorySource).toBeUndefined()
    upgraded.close()
  })

  it('★ 落在默认夹里的标答不算"手工摆放" —— 必须留成补分类候选', async () => {
    // addGolden 默认就把新标答写进默认夹,所以"有 folderId"根本不能推出"用户整理过"。
    // 这里若被标成 manual,用户现有的标答会一条都进不了补分类 —— 自动分类等于没做。
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()

    const inDefault = (await upgraded.goldens.get('gd-in-default'))!
    expect(inDefault.categoryId).toBeNull()
    expect(inDefault.categorySource).toBeUndefined()
    expect(inDefault.categoryAt).toBeUndefined()
    // 这些标答的内容本身分毫未动
    expect(inDefault.question).toBe('有色差吗')
    expect(inDefault.answer).toBe('亲,实物与图片一致哦')
    upgraded.close()
  })

  it('业务数据分毫未动:问题与答案原文还在', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()
    const g = (await upgraded.goldens.get('gd-in-folder'))!
    expect(g.question).toBe('能便宜点吗')
    expect(g.answer).toBe('亲,已经是最低价啦')
    expect(g.folderId).toBe('f-hot')
    upgraded.close()
  })

  it('新装(没有旧库)直接建 v8,不跑迁移也不报错', async () => {
    const fresh = new PddDatabase()
    await fresh.open()
    await fresh.ensurePresetCategories()
    expect(await fresh.categories.count()).toBe(7)
    fresh.close()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/dbUpgrade.test.ts`
Expected: FAIL —— `expected undefined to be defined`（`legacy:f-hot` 不存在）

- [ ] **Step 3: 给 `version(8)` 加 upgrade**

把 Task 2 写入的 `this.version(8).stores({...})` 整段替换为：

```ts
    // 第五十六轮 问题自动分类:categories 表 + 旧文件夹迁移。
    // folders 表保留不删(回滚用),迁移后不再被读写。
    this.version(8)
      .stores({
        categories: "id, kind, position",
      })
      .upgrade(async (tx) => {
        const now = Date.now();

        // ① 旧文件夹 → 自定义类型。filterable=false 是关键:它们不参与 jev 分类,
        //    因此不能靠"类型匹配"被选中,必须永远进检索池 —— 否则夹里的条目
        //    会在任何查询下都搜不到(纯粹的召回倒退,见 spec §7.2)。
        //    position 从 100 起(**按过滤后的序号**),让 6 个预置类型排在前面。
        //
        //    **预置默认文件夹不转**:它不是用户内容,是 addGolden 给新标答的系统默认
        //    落点(goldens.ts),且它和新内置的「未分类」是同一件事 —— 转出来是重复概念。
        //    它丢失无损:名字「默认文件夹」是系统占位名,不是用户起的。
        const folders = (await tx.table("folders").toArray()) as FolderRecord[];
        const realFolders = folders.filter((f) => f.id !== UNCATEGORIZED_FOLDER_ID);
        const legacyCats: CategoryRecord[] = realFolders.map((f, i) => ({
          id: `legacy:${f.id}`,
          name: f.name,
          criteria: "",
          kind: "custom" as const,
          route: "retrieve" as const,
          filterable: false,
          position: 100 + i,
          createdAt: f.createdAt,
          updatedAt: now,
        }));
        if (legacyCats.length > 0) await tx.table("categories").bulkAdd(legacyCats);

        // ② 金标准的归属。
        //    真夹里的:标 manual —— 用户手工摆过的东西,补分类时一律跳过(见 spec §11.2)。
        //    默认夹里的、以及没入夹的:categoryId = null 且**不写** categorySource。
        //
        //    这一条是本次迁移最容易搞错的地方:**落在默认夹 ≠ 手工摆放**。addGolden 默认
        //    就把新标答写进默认夹,若把它也标成 manual,用户现有的标答会一条都进不了
        //    补分类候选 —— 全卡在「默认文件夹」里,自动分类等于没做。
        const realFolderIds = new Set(realFolders.map((f) => f.id));
        const goldens = (await tx.table("goldens").toArray()) as GoldenRecord[];
        for (const g of goldens) {
          const inRealFolder = !!g.folderId && realFolderIds.has(g.folderId);
          const patch: Partial<GoldenRecord> = {
            categoryId: inRealFolder ? `legacy:${g.folderId}` : null,
          };
          if (inRealFolder) {
            patch.categorySource = "manual";
            patch.categoryAt = now;
          }
          await tx.table("goldens").update(g.id, patch);
        }
      });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/dbUpgrade.test.ts`
Expected: PASS（原有用例 + 新增 4 个）

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add src/background/db.ts tests/unit/background/dbUpgrade.test.ts
git commit -m "feat: v7→v8 迁移 —— 旧文件夹转自定义类型,标答归属搬迁并标人工(第五十六轮)"
```

---

## Task 4: 六个新设置项与夹取

**Files:**
- Modify: `src/types/memory.ts`（`PddSettings`）
- Modify: `src/shared/constants.ts`（`DEFAULT_SETTINGS` + 夹取区间）
- Modify: `src/background/settings.ts`（`clampSettings`）
- Test: `tests/unit/background/settings.test.ts`（追加一组用例）

**Interfaces:**
- Consumes: 无
- Produces: `PddSettings` 新增 `classifyEnabled` / `jevBaseUrl` / `jevApiKey` / `jevModel` / `jevTimeoutMs` / `classifyProbThreshold`；常量 `JEV_TIMEOUT_MIN_MS` / `JEV_TIMEOUT_MAX_MS`

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/background/settings.test.ts` **末尾追加**（该文件已有 `loadSettings` / `saveSettings` 的导入与 chrome mock 环境）：

```ts
// ─── 问题分类设置(第五十六轮) ──────────────────────────────────────────────────
//
// 这一组字段的失败模式是静默失效:clampSettings 是逐字段手写的,
// 漏一个字段不会报错,只会让设置页填的值永远读不回来。所以每个字段都要有断言。

describe('问题分类设置', () => {
  it('默认全关、Key 为空 —— 未配置时扩展必须保持完全本地', async () => {
    const s = await loadSettings()
    expect(s.classifyEnabled).toBe(false)
    // 地址有默认值(官方端点),用户要填的只有 key;下面那几条共同保证"未配置 ⇒ 零请求"
    expect(s.jevBaseUrl).toBe('https://api.typesafe.ai')
    expect(s.jevApiKey).toBe('')
    expect(s.jevModel).toBe('jev-latest')
    expect(s.jevTimeoutMs).toBe(3000)
    expect(s.classifyProbThreshold).toBe(0.2)
  })

  it('六个字段都能存能读(漏 clamp 会在这里露馅)', async () => {
    await saveSettings({
      classifyEnabled: true,
      jevBaseUrl: 'https://api.example.com',
      jevApiKey: 'sk-test',
      jevModel: 'jev-1.13.0',
      jevTimeoutMs: 5000,
      classifyProbThreshold: 0.35,
    })
    const s = await loadSettings()
    expect(s.classifyEnabled).toBe(true)
    expect(s.jevBaseUrl).toBe('https://api.example.com')
    expect(s.jevApiKey).toBe('sk-test')
    expect(s.jevModel).toBe('jev-1.13.0')
    expect(s.jevTimeoutMs).toBe(5000)
    expect(s.classifyProbThreshold).toBe(0.35)
  })

  it('地址只认 http(s),尾斜杠剔掉,非法值归一为空串', async () => {
    await saveSettings({ jevBaseUrl: 'https://api.example.com/v1/' })
    expect((await loadSettings()).jevBaseUrl).toBe('https://api.example.com/v1')
    await saveSettings({ jevBaseUrl: 'javascript:alert(1)' })
    expect((await loadSettings()).jevBaseUrl).toBe('')
  })

  it('超时夹在 1000~30000 之间', async () => {
    await saveSettings({ jevTimeoutMs: 1 })
    expect((await loadSettings()).jevTimeoutMs).toBe(1000)
    await saveSettings({ jevTimeoutMs: 999999 })
    expect((await loadSettings()).jevTimeoutMs).toBe(30000)
  })

  it('概率阈值夹在 0~1 之间', async () => {
    await saveSettings({ classifyProbThreshold: -1 })
    expect((await loadSettings()).classifyProbThreshold).toBe(0)
    await saveSettings({ classifyProbThreshold: 5 })
    expect((await loadSettings()).classifyProbThreshold).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/settings.test.ts`
Expected: FAIL —— `expected undefined to be 'jev-latest'`

- [ ] **Step 3: 扩 `PddSettings`**

在 `src/types/memory.ts` 的 `PddSettings` 里，`llmTimeoutMs` 之后追加：

```ts
  /**
   * 「自动分类」总开关,默认关。关闭或未配置 jev 时扩展保持完全本地:
   * 不发起任何网络请求,分类全部落未分类,检索行为与未引入该功能时等价。
   */
  classifyEnabled: boolean
  /** jev(System One)端点 base url,默认 'https://api.typesafe.ai' */
  jevBaseUrl: string
  /** jev API key,默认 ''。仅存 chrome.storage.local,永不同步到云端 */
  jevApiKey: string
  /** jev 模型名,默认 'jev-latest' */
  jevModel: string
  /** 单次分类超时(毫秒),默认 3000,夹取 1000~30000 */
  jevTimeoutMs: number
  /**
   * 概率阈值:概率 ≥ 此值的类型进类型集合,默认 0.2。
   * 查询时用于多意图并集(全低于阈值则不筛);打标时用于"判不准就落未分类"。
   */
  classifyProbThreshold: number
```

- [ ] **Step 4: 扩 `DEFAULT_SETTINGS` 与夹取区间**

在 `src/shared/constants.ts` 的 `LLM_TIMEOUT_MAX_MS` 之后追加：

```ts
/** 单次分类超时的可配置区间(毫秒)：分类是检索链路的一环，等太久不如不筛 */
export const JEV_TIMEOUT_MIN_MS = 1000
export const JEV_TIMEOUT_MAX_MS = 30000
```

在 `DEFAULT_SETTINGS` 里，`llmTimeoutMs: 8000,` 之后追加：

```ts
  // 问题自动分类默认关:不配置、不开启时扩展保持完全本地(ADR-0007)
  classifyEnabled: false,
  jevBaseUrl: 'https://api.typesafe.ai',
  jevApiKey: '',
  jevModel: 'jev-latest',
  jevTimeoutMs: 3000,
  classifyProbThreshold: 0.2,
```

> 注意 `jevBaseUrl` 默认**不是空串** —— 用户要填的只有 key。这与 `llmBaseUrl` 默认空串的取舍不同：jev 只有一个官方端点，没有"你自己找"的问题；而 `isJevConfigured` 仍要求 key 非空才算配好，所以默认关 + 默认无 key 这两条一起保证了"未配置时零请求"。

- [ ] **Step 5: 扩 `clampSettings`**

在 `src/background/settings.ts` 的 import 里补 `JEV_TIMEOUT_MAX_MS`、`JEV_TIMEOUT_MIN_MS`，并在 `clampSettings` 的返回对象末尾（`llmTimeoutMs` 之后）追加：

```ts
    classifyEnabled: !!base.classifyEnabled,
    jevBaseUrl: clampUrl(base.jevBaseUrl),
    jevApiKey: clampText(base.jevApiKey, 512),
    jevModel: clampText(base.jevModel, 128),
    jevTimeoutMs: Math.min(
      JEV_TIMEOUT_MAX_MS,
      Math.max(JEV_TIMEOUT_MIN_MS, Math.round(Number(base.jevTimeoutMs) || DEFAULT_SETTINGS.jevTimeoutMs)),
    ),
    classifyProbThreshold: Math.min(
      1,
      Math.max(0, Number(base.classifyProbThreshold) || 0),
    ),
```

> `classifyProbThreshold` 用 `|| 0` 而不是 `|| DEFAULT_SETTINGS.classifyProbThreshold` —— 用户把阈值设成 0（"全都要"）是合法意图，`||` 会把它当成假值改回默认。默认值由 `DEFAULT_SETTINGS` 与 `base` 的展开承担。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/settings.test.ts`
Expected: PASS（原有用例 + 新增 5 个）

- [ ] **Step 7: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 8: 提交**

```bash
git add src/types/memory.ts src/shared/constants.ts src/background/settings.ts tests/unit/background/settings.test.ts
git commit -m "feat: 问题分类设置项六项与夹取(第五十六轮)"
```

---

## Task 5: jev 调用层

**Files:**
- Create: `src/background/jev.ts`
- Test: `tests/unit/background/jev.test.ts`

**Interfaces:**
- Consumes: `PddSettings`（Task 4）
- Produces:
  - `interface JevConfig { baseUrl: string; apiKey: string; model: string; timeoutMs: number }`
  - `interface JevCategoryOption { id: string; name: string; criteria: string }`
  - `type ClassifyResult = { ok: true; probabilities: Record<string, number>; top: string; confidence: number } | { ok: false; error: string }`
  - `isJevConfigured(c: Pick<JevConfig, 'baseUrl'|'apiKey'|'model'>): boolean`
  - `jevConfigFromSettings(s: PddSettings): JevConfig`
  - `systemOneUrl(baseUrl: string): string`
  - `argmaxId(probabilities: Record<string, number>): string`
  - `classifyQuestion(opts: { question: string; categories: JevCategoryOption[]; config: JevConfig }): Promise<ClassifyResult>`
  - `testJevConnection(config: JevConfig): Promise<{ ok: true } | { ok: false; error: string }>`

**关键约定：** `probabilities` 的 key 是**本地类型 id**，不是 jev 返回的中文名。jev 的 `criteria` 用中文名作选项标签（那是发给模型看的），`classifyQuestion` 内部做一次 name → id 的映射，调用方拿到的永远是 id。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/jev.test.ts`：

```ts
// jev(System One)调用层单测 —— 全部 mock fetch,不打真实网络
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  argmaxId,
  classifyQuestion,
  isJevConfigured,
  systemOneUrl,
  type JevConfig,
} from '../../../src/background/jev'

const CFG: JevConfig = {
  baseUrl: 'https://api.typesafe.ai',
  apiKey: 'sk-test',
  model: 'jev-latest',
  timeoutMs: 3000,
}

const CATS = [
  { id: 'preset:order', name: '订单物流', criteria: '发货时间、催发货、物流停滞…' },
  { id: 'preset:size', name: '尺码推荐', criteria: '身高体重、穿多大、偏大偏小…' },
]

/** 造一个返回给定 JSON 的 fetch */
function stubJson(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('jev 配置判定', () => {
  it('三项都非空才算配好', () => {
    expect(isJevConfigured(CFG)).toBe(true)
    expect(isJevConfigured({ ...CFG, apiKey: '' })).toBe(false)
    expect(isJevConfigured({ ...CFG, baseUrl: '' })).toBe(false)
    expect(isJevConfigured({ ...CFG, model: '' })).toBe(false)
    expect(isJevConfigured({ ...CFG, apiKey: '   ' })).toBe(false)
  })

  it('端点拼在 /v1/systemone(不是 OpenAI 的 /chat/completions)', () => {
    expect(systemOneUrl('https://api.typesafe.ai')).toBe(
      'https://api.typesafe.ai/v1/systemone',
    )
  })
})

describe('classifyQuestion', () => {
  it('把中文选项名映射回本地 id,并带出 top 与 confidence', async () => {
    stubJson({
      model: 'jev-1.13.0',
      answers: {
        category: {
          type: 'choice',
          choice: '订单物流',
          probabilities: { 订单物流: 0.93, 尺码推荐: 0.07 },
          confidence: 0.86,
        },
      },
      usage: { input_tokens: 120, output_tokens: 12 },
    })

    const r = await classifyQuestion({ question: '快递到哪了', categories: CATS, config: CFG })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.probabilities).toEqual({ 'preset:order': 0.93, 'preset:size': 0.07 })
    expect(r.top).toBe('preset:order')
    expect(r.confidence).toBeCloseTo(0.86, 5)
  })

  it('请求体走 System One 协议:state + questions.choice + criteria 用中文名', async () => {
    stubJson({
      answers: {
        category: {
          type: 'choice',
          choice: '尺码推荐',
          probabilities: { 尺码推荐: 0.8, 订单物流: 0.2 },
          confidence: 0.7,
        },
      },
    })
    await classifyQuestion({ question: '165 穿多大', categories: CATS, config: CFG })

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('jev-latest')
    expect(body.state).toBe('165 穿多大')
    expect(body.questions.category.type).toBe('choice')
    expect(Object.keys(body.questions.category.criteria)).toEqual(['订单物流', '尺码推荐'])
    // 外发只有问题文本与选项描述,不含任何回复内容
    expect(JSON.stringify(body)).not.toContain('answer')
  })

  it('HTTP 非 2xx 归一为 http <码>', async () => {
    stubJson({ error: 'nope' }, 401)
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r).toEqual({ ok: false, error: 'http 401' })
  })

  it('响应结构不对(缺 answers.category)归一为 bad response', async () => {
    stubJson({ answers: {} })
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r).toEqual({ ok: false, error: 'bad response' })
  })

  it('概率里全是没见过的选项名 → bad response(不静默返回空分布)', async () => {
    stubJson({
      answers: {
        category: { type: 'choice', probabilities: { 别的类: 1 }, confidence: 1 },
      },
    })
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r).toEqual({ ok: false, error: 'bad response' })
  })

  it('没有类型可问时直接失败,不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await classifyQuestion({ question: 'q', categories: [], config: CFG })
    expect(r).toEqual({ ok: false, error: 'no categories' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('超时中止归一为 timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const r = await classifyQuestion({
      question: 'q',
      categories: CATS,
      config: { ...CFG, timeoutMs: 10 },
    })
    expect(r).toEqual({ ok: false, error: 'timeout' })
  })

  it('网络异常归一为 network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))))
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r).toEqual({ ok: false, error: 'network' })
  })

  it('choice 字段缺失时用概率最高者兜底', async () => {
    stubJson({
      answers: {
        category: {
          type: 'choice',
          probabilities: { 订单物流: 0.4, 尺码推荐: 0.6 },
          confidence: 0.3,
        },
      },
    })
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.top).toBe('preset:size')
  })
})

describe('argmaxId', () => {
  it('取概率最高者', () => {
    expect(argmaxId({ a: 0.1, b: 0.7, c: 0.2 })).toBe('b')
  })
  it('并列取先遇到的(与 jev 平局取第一的口径一致)', () => {
    expect(argmaxId({ a: 0.5, b: 0.5 })).toBe('a')
  })
  it('空对象返回空串', () => {
    expect(argmaxId({})).toBe('')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/jev.test.ts`
Expected: FAIL —— Cannot find module `../../../src/background/jev`

- [ ] **Step 3: 实现 `src/background/jev.ts`**

```ts
/**
 * jev(TypeSafe System One)分类调用层(第五十六轮 · 问题自动分类)。
 *
 * 数据边界(ADR-0007,修订 ADR-0006):只有在本模块被显式调用时才出网,
 * 且外发内容仅限**问题文本**。历史问答的回复正文与标准回答的正文永不出本机 ——
 * 本模块的入参里根本没有它们,这是结构性保证,不是纪律。
 *
 * 与 llm.ts 的差别:jev 不是生成模型。它拿一个 state 和若干类型化问题,
 * 返回带概率的结构化判断;协议是 /v1/systemone,不是 /chat/completions,也不支持流式。
 */
import type { PddSettings } from '../types/memory'

export interface JevConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

/** 一个可选项(发给模型看的是 name 与 criteria,id 只用于回传后定位) */
export interface JevCategoryOption {
  id: string
  name: string
  criteria: string
}

export type ClassifyResult =
  | { ok: true; probabilities: Record<string, number>; top: string; confidence: number }
  | { ok: false; error: string }

export function isJevConfigured(c: Pick<JevConfig, 'baseUrl' | 'apiKey' | 'model'>): boolean {
  return !!c.baseUrl.trim() && !!c.apiKey.trim() && !!c.model.trim()
}

/** 从设置取 jev 配置(字段名不同,集中在这里,免得散落各处) */
export function jevConfigFromSettings(s: PddSettings): JevConfig {
  return {
    baseUrl: s.jevBaseUrl,
    apiKey: s.jevApiKey,
    model: s.jevModel,
    timeoutMs: s.jevTimeoutMs,
  }
}

/** System One 端点(baseUrl 已由设置层规整为无尾斜杠) */
export function systemOneUrl(baseUrl: string): string {
  return `${baseUrl}/v1/systemone`
}

/**
 * 问题 id(`category`)只是回传用的字典键 —— 官方明确它不会发给模型,
 * 语义要写在 instructions 里。
 */
const INSTRUCTIONS = '这是买家发来的消息。判断它属于哪一类问题。'

/** 概率最高者的 id;并列取先遇到的(与 jev 平局取第一的口径一致) */
export function argmaxId(probabilities: Record<string, number>): string {
  let best = ''
  let bestP = -Infinity
  for (const [id, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      bestP = p
      best = id
    }
  }
  return best
}

export async function classifyQuestion(opts: {
  question: string
  categories: JevCategoryOption[]
  config: JevConfig
}): Promise<ClassifyResult> {
  const { question, categories, config } = opts
  // 没有选项可问 —— 发了也是浪费一次请求和一次外发
  if (categories.length === 0) return { ok: false, error: 'no categories' }

  // criteria 的 key 是发给模型的**选项标签**,用中文名;返回后按名字映射回本地 id
  const idByName = new Map<string, string>()
  const criteria: Record<string, string> = {}
  for (const c of categories) {
    idByName.set(c.name, c.id)
    criteria[c.name] = c.criteria
  }

  // 超时由本函数自己拥有:调用方不持有 AbortController,免得生命周期错配
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort('timeout'), config.timeoutMs)
  let timedOut = false
  const onAbort = () => {
    timedOut = true
  }
  ac.signal.addEventListener('abort', onAbort)

  try {
    const res = await fetch(systemOneUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        state: question,
        questions: {
          category: { type: 'choice', instructions: INSTRUCTIONS, criteria },
        },
      }),
      signal: ac.signal,
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }

    const body = (await res.json()) as {
      answers?: Record<
        string,
        { choice?: unknown; probabilities?: Record<string, unknown>; confidence?: unknown }
      >
    }
    const ans = body?.answers?.category
    if (!ans || typeof ans.probabilities !== 'object' || ans.probabilities === null) {
      return { ok: false, error: 'bad response' }
    }

    // 只保留能映射回本地类型的项 —— 模型理论上不会返回选项外的答案,
    // 但真返回了也不能让它变成一条指向不存在类型的分类结果
    const probabilities: Record<string, number> = {}
    for (const [name, p] of Object.entries(ans.probabilities)) {
      const id = idByName.get(name)
      if (!id) continue
      const n = Number(p)
      if (Number.isFinite(n)) probabilities[id] = n
    }
    if (Object.keys(probabilities).length === 0) return { ok: false, error: 'bad response' }

    const top = typeof ans.choice === 'string' ? (idByName.get(ans.choice) ?? '') : ''
    const confidence = Number.isFinite(Number(ans.confidence)) ? Number(ans.confidence) : 0
    return { ok: true, probabilities, top: top || argmaxId(probabilities), confidence }
  } catch {
    return { ok: false, error: timedOut ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    ac.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 「测试连接」:打真正会用的那个端点、真正会用的那个模型 ——
 * 只校验端点通不通会漏掉"模型名写错""该 key 没这个模型的权限"这两类最常见的配错。
 * 用最简单的一个 noul 问题,成本约一次 10 token 的请求。
 */
export async function testJevConnection(
  config: JevConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort('timeout'), Math.min(config.timeoutMs, 10000))
  let timedOut = false
  const onAbort = () => {
    timedOut = true
  }
  ac.signal.addEventListener('abort', onAbort)

  try {
    const res = await fetch(systemOneUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        state: '你好',
        questions: { ping: { type: 'noul', instructions: '这条消息是问候语吗?' } },
      }),
      signal: ac.signal,
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    return { ok: true }
  } catch {
    return { ok: false, error: timedOut ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    ac.signal.removeEventListener('abort', onAbort)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/jev.test.ts`
Expected: PASS（13 个用例）

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add src/background/jev.ts tests/unit/background/jev.test.ts
git commit -m "feat: jev(System One)分类调用层 —— 超时/错误归一/选项名映射(第五十六轮)"
```

---

## Task 6: 打标编排

**Files:**
- Create: `src/background/classify.ts`
- Test: `tests/unit/background/classify.test.ts`

**Interfaces:**
- Consumes: `jev.ts` 的 `classifyQuestion` / `isJevConfigured` / `jevConfigFromSettings` / `argmaxId`；`db.listCategories`；`loadSettings`
- Produces:
  - `classifiableCategories(cats: CategoryRecord[]): JevCategoryOption[]`
  - `pickRecordCategory(probabilities: Record<string, number>, threshold: number): { categoryId: string; confidence: number } | null`
  - `classifyRecord(question: string): Promise<{ categoryId: string; confidence: number } | null>` —— 内部读设置与类型，任何失败（未开开关 / 未配置 / 网络 / 超时 / 判不准）一律返回 `null`，**从不抛错**

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/classify.test.ts`：

```ts
// 打标编排单测:纯逻辑用 makeCats 直接喂,端到端路径走 fake-indexeddb + mock fetch
import 'fake-indexeddb/auto'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { classifiableCategories, pickRecordCategory } from '../../../src/background/classify'
import { saveSettings } from '../../../src/background/settings'
import type { CategoryRecord } from '../../../src/types/memory'

function makeCat(over: Partial<CategoryRecord> & { id: string }): CategoryRecord {
  const now = Date.now()
  return {
    name: over.id,
    criteria: '描述',
    kind: 'preset',
    route: 'retrieve',
    filterable: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

describe('classifiableCategories', () => {
  it('只取 filterable=true 的 —— 它和"是 jev 的选项"是同一个集合', () => {
    const cats = [
      makeCat({ id: 'preset:order', name: '订单物流' }),
      makeCat({ id: 'uncategorized', name: '未分类', kind: 'uncategorized', filterable: false }),
      makeCat({ id: 'legacy:f1', name: '双十一', kind: 'custom', filterable: false }),
    ]
    expect(classifiableCategories(cats).map((c) => c.id)).toEqual(['preset:order'])
  })

  it('只带 id/name/criteria,不带 kind/route 之类的本地字段', () => {
    const out = classifiableCategories([makeCat({ id: 'a', name: '甲', criteria: '甲乙丙' })])
    expect(out[0]).toEqual({ id: 'a', name: '甲', criteria: '甲乙丙' })
  })
})

describe('pickRecordCategory', () => {
  it('取概率最高者,并回带它的概率', () => {
    expect(pickRecordCategory({ a: 0.8, b: 0.2 }, 0.2)).toEqual({
      categoryId: 'a',
      confidence: 0.8,
    })
  })

  it('最高概率低于阈值 → null(落未分类,而不是硬塞进一个不确定的类)', () => {
    expect(pickRecordCategory({ a: 0.18, b: 0.17, c: 0.17 }, 0.2)).toBeNull()
  })

  it('恰好等于阈值算过(边界取含)', () => {
    expect(pickRecordCategory({ a: 0.2, b: 0.8 }, 0.2)!.categoryId).toBe('b')
  })

  it('空分布 → null', () => {
    expect(pickRecordCategory({}, 0.2)).toBeNull()
  })
})

// ─── 端到端:classifyRecord 的门禁 ─────────────────────────────────────────────
//
// 这组测的是**门禁**:什么时候必须一个请求都不发。
// 门禁漏一条,用户在没配好的情况下也会被静默外发问题文本。
// 手法与 search.test.ts 同源:真库(fake-indexeddb)+ vi.resetModules + 动态 import,
// 不 mock db 模块 —— 打标读的是真实类型表,这条链路值得端到端跑。

describe('classifyRecord 门禁', () => {
  let testDb: PddDatabase

  beforeEach(async () => {
    await Dexie.delete('PddCSDB')
    testDb = new PddDatabase()
    await testDb.open()
    await testDb.ensurePresetCategories()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function freshClassify() {
    vi.resetModules()
    const { classifyRecord } = await import('../../../src/background/classify')
    return classifyRecord
  }

  it('总开关关着 → 不发请求,返回 null', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await saveSettings({ classifyEnabled: false, jevApiKey: 'sk-test' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('开着但没填 key → 不发请求,返回 null', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await saveSettings({ classifyEnabled: true, jevApiKey: '' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('开着且配好 → 发一次请求,返回类型与该标签的概率', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            answers: {
              category: {
                type: 'choice',
                choice: '订单物流',
                probabilities: { 订单物流: 0.91, 尺码推荐: 0.09 },
                confidence: 0.85,
              },
            },
          }),
          { status: 200 },
        ),
      ),
    )
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toEqual({
      categoryId: 'preset:order',
      confidence: 0.91,
    })
  })

  it('jev 报错 → 返回 null,不抛错(单条失败不能打断调用方)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toBeNull()
  })

  it('类型表里全是 filterable=false 时 → 不发请求(没有选项可问)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await testDb.categories.toCollection().modify({ filterable: false })
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/classify.test.ts`
Expected: FAIL —— Cannot find module `../../../src/background/classify`

- [ ] **Step 3: 实现 `src/background/classify.ts`**

```ts
/**
 * 打标编排(第五十六轮 · 问题自动分类)。
 *
 * 与 jev.ts 的分工:jev.ts 只管"怎么问",这里管"该不该问、问到之后怎么落"。
 * 门禁先于一切 IO:总开关关、未配 key、无类型可问 —— 任一条不成立就**一次 fetch 都不发**。
 * 这是 ADR-0007 里"未配置时扩展保持完全本地"的落点。
 *
 * 本模块只处理**问题文本**;回复正文与标准回答正文从不进入这里的入参。
 */
import { db } from './db'
import { loadSettings } from './settings'
import {
  argmaxId,
  classifyQuestion,
  isJevConfigured,
  jevConfigFromSettings,
  type JevCategoryOption,
} from './jev'
import type { CategoryRecord } from '../types/memory'

/** 可作为 jev 选项的类型。与"参与类型过滤"是同一个集合(filterable=true) */
export function classifiableCategories(cats: CategoryRecord[]): JevCategoryOption[] {
  return cats
    .filter((c) => c.filterable)
    .map((c) => ({ id: c.id, name: c.name, criteria: c.criteria }))
}

/**
 * 一条问题 → 单一类型。最高概率低于阈值时返回 null,调用方落未分类。
 *
 * 记录级只取单一类型(归档要落在唯一一个组里);**多意图并集只用于查询时的路由**,
 * 那是另一条路径(见 spec §7.3)。
 */
export function pickRecordCategory(
  probabilities: Record<string, number>,
  threshold: number,
): { categoryId: string; confidence: number } | null {
  const top = argmaxId(probabilities)
  if (!top) return null
  const p = probabilities[top] ?? 0
  if (p < threshold) return null
  return { categoryId: top, confidence: p }
}

/**
 * 给一段问题文本打标。
 *
 * **从不抛错** —— 调用方在捕获链路与批量补分类里都是"失败就算了"的语义,
 * 一个网络错误不该把整条链路带崩。任何失败一律返回 null(落未分类)。
 */
export async function classifyRecord(
  question: string,
): Promise<{ categoryId: string; confidence: number } | null> {
  try {
    const settings = await loadSettings()
    // 门禁①:总开关
    if (!settings.classifyEnabled) return null
    // 门禁②:配置齐全
    const config = jevConfigFromSettings(settings)
    if (!isJevConfigured(config)) return null

    const cats = await db.listCategories()
    const options = classifiableCategories(cats)
    // 门禁③:有选项可问
    if (options.length === 0) return null

    const r = await classifyQuestion({ question, categories: options, config })
    if (!r.ok) return null
    return pickRecordCategory(r.probabilities, settings.classifyProbThreshold)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/classify.test.ts`
Expected: PASS（11 个用例）

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add src/background/classify.ts tests/unit/background/classify.test.ts
git commit -m "feat: 打标编排 —— 门禁/概率阈值/失败不抛错(第五十六轮)"
```

---

## Task 7: 新问答捕获时自动打标

**Files:**
- Modify: `src/background/pddCapture.ts`（`closeQuestion` 的 `queueEmbedding` 之后）
- Test: `tests/unit/background/pddCapture.test.ts`（追加一组用例）

**Interfaces:**
- Consumes: `classifyRecord`（Task 6）
- Produces: 新建的 `QaRecord` 在落库后、嵌入排队后，**异步**（不阻塞捕获链路）触发一次打标，命中就写回 `categoryId` / `categoryConfidence` / `categorySource='jev'` / `categoryAt`

**为什么不能 await：** 捕获链路是 segmenter 内部 promise 链串行的，一条网络请求（最长 3 秒）卡在这里会拖住整条链路，让后续消息落盘排队。打标是"锦上添花"，必须即发即忘。

- [ ] **Step 1: 写失败的测试**

这个文件的 `db` 与 `offscreen` 是**全 mock** 的（见文件头），所以这里连 `classify` 一起 mock，只验 `pddCapture` 这一侧的接线与"即发即忘"。

先给文件头的 db mock 补一个 `updateQaCategory`（`vi.mock('../../../src/background/db', ...)` 的返回对象里，`recountReplyCount` 之后）：

```ts
      recountReplyCount: vi.fn(async () => undefined),
      updateQaCategory: vi.fn(async () => undefined),
```

再在 import 区（`import { db } from '../../../src/background/db'` 之后）加：

```ts
import { classifyRecord } from '../../../src/background/classify'
```

然后在文件**末尾追加**：

```ts
// ─── 捕获即打标(第五十六轮) ────────────────────────────────────────────────────
//
// 两条要求,一条关于"要不要做",一条关于"别拖慢":
//  ① 落盘后要带着分类结果写回库;
//  ② 打标必须即发即忘 —— 它是网络请求,await 它会把整条捕获链路的吞吐拖垮。

describe('捕获时自动打标', () => {
  beforeEach(() => {
    vi.mocked(classifyRecord).mockReset()
  })

  it('落盘后触发一次打标,并把结果写回', async () => {
    vi.mocked(classifyRecord).mockResolvedValue({ categoryId: 'preset:order', confidence: 0.91 })
    const ingest = await freshIngest()
    const resp = await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          ...msgEvents('u1875210170836', 'event'),
          {
            kind: 'msg',
            sessionKey: 'u1875210170836',
            buyerIdTail: '0836',
            msg: {
              source: 'dom',
              role: 'agent',
              text: '可以的,支持电子发票。',
              msgId: 'a-tag-1',
              ts: Date.now(),
            },
          },
        ],
      },
    })
    expect(resp.queued).toBe(2)
    // 打标是即发即忘的:让挂着的微任务跑一轮
    await vi.waitFor(() => expect(classifyRecord).toHaveBeenCalledTimes(1))
    expect(vi.mocked(classifyRecord).mock.calls[0][0]).toBe('这个能开发票吗?')
    expect(db.updateQaCategory).toHaveBeenCalledWith(expect.any(String), {
      categoryId: 'preset:order',
      confidence: 0.91,
    })
  })

  it('★ 即发即忘:打标还挂着的时候,捕获已经返回了', async () => {
    let release: (v: null) => void = () => {}
    vi.mocked(classifyRecord).mockImplementation(
      () =>
        new Promise<null>((res) => {
          release = res
        }),
    )
    const ingest = await freshIngest()
    const resp = await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          ...msgEvents('u1875210170837', 'event'),
          {
            kind: 'msg',
            sessionKey: 'u1875210170837',
            buyerIdTail: '0837',
            msg: {
              source: 'dom',
              role: 'agent',
              text: '可以的,支持电子发票。',
              msgId: 'a-tag-2',
              ts: Date.now(),
            },
          },
        ],
      },
    })
    // 若 pddCapture 在这条链路上 await 了打标,上面这个 await ingest(...) 会永远挂着,
    // 测试以超时告终 —— 这正是我们要它失败的样子。
    expect(resp.queued).toBe(2)
    expect(classifyRecord).toHaveBeenCalledTimes(1)
    expect(db.updateQaCategory).not.toHaveBeenCalled()
    release(null)
  })

  it('打标抛错不影响捕获:记录照常入库,且不写分类', async () => {
    vi.mocked(classifyRecord).mockRejectedValue(new Error('boom'))
    const ingest = await freshIngest()
    const resp = await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          ...msgEvents('u1875210170838', 'event'),
          {
            kind: 'msg',
            sessionKey: 'u1875210170838',
            buyerIdTail: '0838',
            msg: {
              source: 'dom',
              role: 'agent',
              text: '可以的,支持电子发票。',
              msgId: 'a-tag-3',
              ts: Date.now(),
            },
          },
        ],
      },
    })
    expect(resp.queued).toBe(2)
    expect(db.addQaRecord).toHaveBeenCalled()
    await vi.waitFor(() => expect(classifyRecord).toHaveBeenCalled())
    expect(db.updateQaCategory).not.toHaveBeenCalled()
  })
})
```

> `msgEvents(sessionKey, 'event')` 造的是买家消息「这个能开发票吗?」，与文件里既有用例同源。
> **三条用例都必须带上客服回复**：只发买家消息时问题段不会关闭（段落由客服回复关闭），
> `closeQuestion` 不触发 → 打标根本不会被调用 —— 那样"即发即忘"那条会**假通过**、
> "抛错不影响捕获"那条会**真失败**。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/pddCapture.test.ts`
Expected: FAIL —— `classifyRecord` 未被调用（`pddCapture` 里还没有那行接线）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/pddCapture.test.ts`
Expected: FAIL —— `categoryId` 为 undefined

- [ ] **Step 3: 实现**

在 `src/background/pddCapture.ts` 顶部 import 区加：

```ts
import { classifyRecord } from "./classify";
```

把 `closeQuestion` 里的收尾三行：

```ts
      await db.addQaRecord(record);
      queueEmbedding("qa", id, ctx.question);
      return id;
```

替换为：

```ts
      await db.addQaRecord(record);
      queueEmbedding("qa", id, ctx.question);
      // 打标即发即忘:捕获链路是 segmenter 内部串行的 promise 链,
      // 一条最长 3 秒的网络请求卡在这里会把后续消息落盘一起拖住。
      // 失败一律静默 —— 没打上标的记录会以「未分类」参与检索(未分类不参与类型过滤,
      // 所以功能上零损失,见 spec §7.2)。
      void classifyAndTag(id, ctx.question);
      return id;
```

并在 `segmenterHooks` 之前（`hookLog` 之后）插入：

```ts
/**
 * 给一条刚入库的问答打标并写回(第五十六轮)。
 *
 * 独立于 closeQuestion 的 try/catch —— 打标失败绝不能走上 hookLog + throw 那条路,
 * 那会让一次网络抖动表现成一次捕获失败。
 */
async function classifyAndTag(qaId: string, question: string): Promise<void> {
  try {
    const hit = await classifyRecord(question);
    await db.updateQaCategory(qaId, hit);
  } catch {
    /* 静默:打标失败 = 保持未分类 */
  }
}
```

- [ ] **Step 4: 给 `db.ts` 加 `updateQaCategory`**

在 `db.ts` 的「问答记录(qaRecords)」区追加：

```ts
  /**
   * 写回分类结果(第五十六轮)。
   *
   * `hit === null` 表示判不准 / jev 失败 / 未启用 —— 一律落未分类,而不是保持 null。
   * 两者在检索时等价(都恒进池),但显式的 'uncategorized' 让面板能区分
   * "还没跑过"与"跑过但判不出来",补分类的候选统计也要靠它。
   */
  async updateQaCategory(
    id: string,
    hit: { categoryId: string; confidence: number } | null,
  ): Promise<void> {
    await this.qaRecords.update(id, {
      categoryId: hit ? hit.categoryId : UNCATEGORIZED_CATEGORY_ID,
      categoryConfidence: hit ? hit.confidence : undefined,
      categorySource: "jev",
      categoryAt: Date.now(),
    });
  }
```

> 这里**不调用** `invalidateRetrievalCache()`。分类字段参与的是下一份计划的检索过滤，届时会在 `retrievalCache.ts` 里加定点更新（见 spec §7.7）；本计划还没让分类进入检索，所以此处的写不会让缓存变脏。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/pddCapture.test.ts`
Expected: PASS（原有用例 + 新增 4 个）

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全绿。**特别确认 `ttl.test.ts` 全绿** —— 保留期逻辑一个字没改，它必须与改动前同样通过。

- [ ] **Step 7: 提交**

```bash
git add src/background/pddCapture.ts src/background/db.ts tests/unit/background/pddCapture.test.ts
git commit -m "feat: 新问答捕获时自动打标(即发即忘,失败落未分类)(第五十六轮)"
```

---

## Task 8: 标准回答的继承与手建打标

**Files:**
- Modify: `src/background/goldens.ts`
- Test: `tests/unit/background/goldens.test.ts`（新建；若已有同名文件则追加）

**Interfaces:**
- Consumes: `classifyRecord`（Task 6）、`db.getQaRecord`
- Produces:
  - `addGoldenFromSuggestion` 在 `payload.sourceRecordId` 指向的问答**已有类型**时继承它（`categorySource='inherit'`），否则异步打标
  - 继承路径**不调用 jev**（同一个问题，重跑结果一样，是白花钱 + 白外发）

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/goldens.test.ts`：

```ts
// 标准回答的继承与手建打标(第五十六轮)
import 'fake-indexeddb/auto'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'
import { hashText } from '../../../src/shared/text'
import type { QaRecord } from '../../../src/types/memory'

// goldens.ts 会排队重嵌 —— 测试不关心嵌入实现
vi.mock('../../../src/background/offscreen', () => ({ queueEmbedding: vi.fn() }))

// 打标本身在 classify.test.ts 里测;这里只验 goldens 这一侧的接线
vi.mock('../../../src/background/classify', () => ({
  classifyRecord: vi.fn(async () => null),
}))

import { classifyRecord } from '../../../src/background/classify'

async function freshGoldens() {
  vi.resetModules()
  const mod = await import('../../../src/background/goldens')
  return mod.addGoldenFromSuggestion
}

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '快递到哪了?',
    questionHash: hashText('快递到哪了?'),
    questionTs: now,
    hasEmbedding: 1,
    replyCount: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

describe('标准回答的分类', () => {
  let testDb: PddDatabase

  beforeEach(async () => {
    vi.mocked(classifyRecord).mockReset()
    vi.mocked(classifyRecord).mockResolvedValue(null)
    await Dexie.delete('PddCSDB')
    testDb = new PddDatabase()
    await testDb.open()
    await testDb.ensurePresetCategories()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('来源问答已有类型 → 直接继承,且一次请求都不发', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await testDb.qaRecords.add(
      makeQa({ id: 'qa-1', categoryId: 'preset:order', categorySource: 'jev', categoryAt: 1 }),
    )
    const addGolden = await freshGoldens()
    const r = await addGolden({
      question: '快递到哪了?',
      answer: '亲,48 小时内发出哦',
      sourceRecordId: 'qa-1',
    })
    expect(r.error).toBeUndefined()
    expect(await testDb.goldens.get(r.id!)).toMatchObject({
      categoryId: 'preset:order',
      categorySource: 'inherit',
    })
    // 同一个问题重跑一次 jev 是白花钱外加多一次外发
    expect(classifyRecord).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('来源问答是未分类 → 新标答也是未分类,且不重复发请求', async () => {
    await testDb.qaRecords.add(
      makeQa({
        id: 'qa-2',
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        categorySource: 'jev',
        categoryAt: 1,
      }),
    )
    const addGolden = await freshGoldens()
    const r = await addGolden({
      question: '快递到哪了?',
      answer: '亲,48 小时内发出哦',
      sourceRecordId: 'qa-2',
    })
    expect(await testDb.goldens.get(r.id!)).toMatchObject({
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      categorySource: 'inherit',
    })
    // 有来源就交给补分类统一处理,这里不重复发
    expect(classifyRecord).not.toHaveBeenCalled()
  })

  it('没有来源(手工新建) → 补一次打标', async () => {
    vi.mocked(classifyRecord).mockResolvedValue({ categoryId: 'preset:price', confidence: 0.77 })
    const addGolden = await freshGoldens()
    const r = await addGolden({ question: '能便宜点吗?', answer: '亲,已经是活动价了哦' })
    await vi.waitFor(() => expect(classifyRecord).toHaveBeenCalledTimes(1))
    expect(vi.mocked(classifyRecord).mock.calls[0][0]).toBe('能便宜点吗?')
    expect(await testDb.goldens.get(r.id!)).toMatchObject({
      categoryId: 'preset:price',
      categorySource: 'jev',
    })
  })

  it('手工新建时打标判不准 → 落未分类,不抛错', async () => {
    vi.mocked(classifyRecord).mockResolvedValue(null)
    const addGolden = await freshGoldens()
    const r = await addGolden({ question: '能便宜点吗?', answer: '亲,已经是活动价了哦' })
    await vi.waitFor(() => expect(classifyRecord).toHaveBeenCalled())
    expect((await testDb.goldens.get(r.id!))!.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/goldens.test.ts`
Expected: FAIL —— 新 golden 的 `categoryId` 为 undefined

- [ ] **Step 3: 实现**

在 `src/background/goldens.ts` 里，把 `addGoldenFromSuggestion` 中 `db.addGolden({...})` 那一段替换为：

```ts
  const answer = normalizeText(payload.answer ?? "");
  const now = Date.now();
  const id = `gd-${now}-${Math.random().toString(36).slice(2, 8)}`;

  // 分类继承(第五十六轮):判定的是**问题**的类型,同一个问题在历史里问过、
  // 又在标准回答里存着,类型不会变 —— 重跑一次 jev 是纯浪费外加多一次外发。
  // 用户手工摆放过的(map 到 manual)不在此列,那条路径走 updateGolden 不改分类。
  const source = payload.sourceRecordId ? await db.getQaRecord(payload.sourceRecordId) : undefined;
  const inherited = source?.categoryId ?? null;

  await db.addGolden({
    id,
    // 保留:回滚用,迁移后不再被读写
    folderId: UNCATEGORIZED_FOLDER_ID,
    question,
    answer,
    questionHash: hashText(question),
    hasEmbedding: 0,
    sourceRecordId: payload.sourceRecordId,
    sourceReplyId: payload.sourceReplyId,
    categoryId: inherited ?? UNCATEGORIZED_CATEGORY_ID,
    categorySource: "inherit",
    categoryAt: now,
    createdAt: now,
    updatedAt: now,
  });
  queueEmbedding("golden", id, question);

  // 手工新建(没有来源)时,继承不出来任何东西 —— 补一次打标。
  // 有来源但来源还没打标的情况由补分类统一处理,这里不重复发请求。
  if (!source) void classifyAndTagGolden(id, question);

  return { id, count: siblings.length + 1 };
```

在文件末尾（`deleteGolden` 之后）追加：

```ts
/**
 * 手工新建的标准回答:补一次打标。
 * 与 pddCapture 的同名逻辑一样即发即忘 —— 失败保持未分类,不打扰用户。
 */
async function classifyAndTagGolden(goldenId: string, question: string): Promise<void> {
  try {
    const hit = await classifyRecord(question)
    await db.updateGoldenCategory(goldenId, hit)
  } catch {
    /* 静默 */
  }
}
```

并在顶部 import 里加：

```ts
import { classifyRecord } from "./classify";
```

- [ ] **Step 4: 给 `db.ts` 加 `updateGoldenCategory`**

在 `db.ts` 的金标准 DAO 区追加：

```ts
  /** 写回标准回答的分类结果(第五十六轮);hit 为 null 表示判不准/失败 → 落未分类 */
  async updateGoldenCategory(
    id: string,
    hit: { categoryId: string; confidence: number } | null,
  ): Promise<void> {
    await this.goldens.update(id, {
      categoryId: hit ? hit.categoryId : UNCATEGORIZED_CATEGORY_ID,
      categoryConfidence: hit ? hit.confidence : undefined,
      categorySource: "jev",
      categoryAt: Date.now(),
    });
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/goldens.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add src/background/goldens.ts src/background/db.ts tests/unit/background/goldens.test.ts
git commit -m "feat: 标准回答继承来源问答的类型,手工新建时打标(第五十六轮)"
```

---

## Task 9: 批量补存量

**Files:**
- Modify: `src/background/classify.ts`（追加计数与批量执行）
- Modify: `src/background/db.ts`（追加候选查询）
- Test: `tests/unit/background/backfill.test.ts`

**Interfaces:**
- Consumes: `classifyQuestion`（Task 5）、`classifiableCategories` / `pickRecordCategory`（Task 6）
- Produces:
  - `db.countBackfillCandidates(): Promise<{ history: number; golden: number }>`
  - `db.snapshotBackfillCandidates(): Promise<{ history: Array<{id: string; question: string}>; golden: Array<{id: string; question: string}> }>`
  - `interface BackfillProgress { total: number; done: number; ok: number; failed: number; skipped: number }`
  - `runBackfill(opts: { onProgress: (p: BackfillProgress) => void; shouldStop: () => boolean; deps?: {...} }): Promise<BackfillProgress>`

**语义（spec §11.2）：**

| 处理 | 条件 |
|---|---|
| 待分类 | `categoryId` 为 null 或 `'uncategorized'` |
| 重跑 | `categorySource === 'jev'` 且 `categoryAt < categories.updatedAt` |
| 跳过 | `categorySource === 'manual'` |
| 失败 | 重试 2 次后放弃，留未分类，不阻塞整批 |

`categorySource === 'inherit'` 两边都不进（标签有效，问题文本与来源相同，重跑是白花钱）。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/backfill.test.ts`：

```ts
// 批量补存量:候选口径、跳过规则、并发上限、单条失败不阻塞(第五十六轮)
import 'fake-indexeddb/auto'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'
import { runBackfill, type BackfillProgress } from '../../../src/background/classify'
import { hashText } from '../../../src/shared/text'
import type { GoldenRecord, QaRecord } from '../../../src/types/memory'

const OPTIONS = [{ id: 'preset:order', name: '订单物流', criteria: '发货时间、催发货…' }]
const CONFIG = {
  baseUrl: 'https://api.example.com',
  apiKey: 'k',
  model: 'jev-latest',
  timeoutMs: 3000,
}

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '快递到哪了?',
    questionHash: hashText('快递到哪了?'),
    questionTs: now,
    hasEmbedding: 1,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function makeGolden(over: Partial<GoldenRecord> & { id: string }): GoldenRecord {
  const now = Date.now()
  return {
    folderId: 'uncategorized',
    question: '快递到哪了?',
    answer: '48 小时内发出',
    questionHash: `h-${over.id}`,
    hasEmbedding: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function okResponse(): Response {
  return new Response(
    JSON.stringify({
      answers: {
        category: { type: 'choice', choice: '订单物流', probabilities: { 订单物流: 0.9 }, confidence: 0.8 },
      },
    }),
    { status: 200 },
  )
}

// ─── Group A:候选口径(真库) ───────────────────────────────────────────────────

describe('补分类候选口径', () => {
  let testDb: PddDatabase

  beforeEach(async () => {
    await Dexie.delete('PddCSDB')
    testDb = new PddDatabase()
    await testDb.open()
    await testDb.ensurePresetCategories()
  })

  it('只算「待分类 + 重跑」,不含 manual 与 inherit', async () => {
    const cat = (await testDb.categories.get('preset:order'))!
    await testDb.qaRecords.bulkAdd([
      makeQa({ id: 'a' }), // categoryId 缺失 → 待分类
      makeQa({ id: 'b', categoryId: UNCATEGORIZED_CATEGORY_ID }), // 未分类 → 待分类
      makeQa({ id: 'c', categoryId: 'preset:order', categorySource: 'manual' }), // 跳过
      makeQa({
        id: 'd',
        categoryId: 'preset:order',
        categorySource: 'jev',
        categoryAt: cat.updatedAt - 1, // 类型定义改过 → 重跑
      }),
      makeQa({
        id: 'e',
        categoryId: 'preset:order',
        categorySource: 'jev',
        categoryAt: cat.updatedAt + 1, // 打标晚于类型定义 → 不算
      }),
    ])
    const snap = await testDb.snapshotBackfillCandidates()
    expect(snap.history.map((r) => r.id).sort()).toEqual(['a', 'b', 'd'])
  })

  it('manual 的条目不在快照里 —— 机器永不许覆盖', async () => {
    await testDb.qaRecords.add(
      makeQa({ id: 'm', categoryId: 'preset:order', categorySource: 'manual', categoryAt: 1 }),
    )
    expect((await testDb.snapshotBackfillCandidates()).history).toHaveLength(0)
  })

  it('inherit 且已归类 → 两边都不进', async () => {
    await testDb.goldens.add(
      makeGolden({ id: 'g1', categoryId: 'preset:order', categorySource: 'inherit', categoryAt: 1 }),
    )
    expect((await testDb.snapshotBackfillCandidates()).golden).toHaveLength(0)
  })

  it('inherit 但没归类出来 → 仍要补(「继承不出来」和「不用补」是两回事)', async () => {
    await testDb.goldens.add(
      makeGolden({
        id: 'g2',
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        categorySource: 'inherit',
        categoryAt: 1,
      }),
    )
    expect((await testDb.snapshotBackfillCandidates()).golden.map((r) => r.id)).toEqual(['g2'])
  })

  it('快照只带 id 与问题文本,不带向量(几万条时内存才扛得住)', async () => {
    await testDb.qaRecords.add(
      makeQa({ id: 'v1', embedding: Float32Array.from([1, 2, 3]), categoryId: null }),
    )
    const row = (await testDb.snapshotBackfillCandidates()).history[0]
    expect(Object.keys(row).sort()).toEqual(['id', 'question'])
  })

  it('countBackfillCandidates 与快照同口径', async () => {
    await testDb.qaRecords.bulkAdd([makeQa({ id: 'a' }), makeQa({ id: 'b' })])
    const counts = await testDb.countBackfillCandidates()
    const snap = await testDb.snapshotBackfillCandidates()
    expect(counts.history).toBe(snap.history.length)
    expect(counts.golden).toBe(snap.golden.length)
    expect(counts.history).toBe(2)
  })
})

// ─── Group B:批量执行编排(注入 deps,不触库不触网) ────────────────────────────

describe('runBackfill', () => {
  /**
   * 造一个可控环境。**刻意用注入的 snapshot / write 而不是真库** ——
   * 这组测的是编排(并发、重试、中断、计数),掺进真的 Dexie 只会让失败原因变模糊。
   */
  function harness(opts: {
    count: number
    /** 带上真实请求体 —— 要按**问题内容**决定成败,不能按调用序号(见下) */
    fetch: (url: string, init: RequestInit) => Promise<Response>
    shouldStop?: () => boolean
    write?: (id: string, hit: { categoryId: string; confidence: number } | null) => Promise<void>
  }) {
    const fetchMock = vi.fn(opts.fetch)
    vi.stubGlobal('fetch', fetchMock)
    const written: Array<{ id: string; hit: { categoryId: string; confidence: number } | null }> = []
    const items = Array.from({ length: opts.count }, (_, i) => ({
      id: `qa-${i}`,
      question: `问题${i}`,
    }))
    const progress: BackfillProgress[] = []
    const write =
      opts.write ??
      (async (id: string, hit: { categoryId: string; confidence: number } | null) => {
        written.push({ id, hit })
      })
    const promise = runBackfill({
      onProgress: (p) => progress.push({ ...p }),
      shouldStop: opts.shouldStop ?? (() => false),
      deps: {
        config: CONFIG,
        categories: OPTIONS,
        threshold: 0.2,
        snapshot: async () => ({ history: items, golden: [] }),
        writeHistory: write,
        writeGolden: async () => undefined,
      },
    })
    return { promise, fetchMock, written, progress }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('全部成功 → ok === total,每条都写回', async () => {
    const h = harness({ count: 10, fetch: async () => okResponse() })
    const p = await h.promise
    expect(p).toMatchObject({ total: 10, ok: 10, failed: 0, skipped: 0, done: 10 })
    expect(h.written).toHaveLength(10)
  })

  it('单条 jev 失败不阻塞整批,失败的以 hit=null 写回(落未分类)', async () => {
    const h = harness({
      count: 5,
      // 按**问题内容**判成败,不按调用序号:5 个 worker 并发跑,
      // "第 N 次调用"属于哪个条目是不确定的,按序号写的测试会时绿时红。
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body as string)
        return body.state === '问题2' ? new Response('{}', { status: 500 }) : okResponse()
      },
    })
    const p = await h.promise
    // 问题2 重试 2 次后放弃,以 hit=null 写回;其余四条成功
    expect(p).toMatchObject({ total: 5, ok: 4, failed: 1, done: 5 })
    expect(h.written.find((w) => w.hit === null)?.id).toBe('qa-2')
  })

  it('失败重试 2 次后才放弃(单条共 3 次请求)', async () => {
    const h = harness({ count: 1, fetch: async () => new Response('{}', { status: 500 }) })
    await h.promise
    expect(h.fetchMock).toHaveBeenCalledTimes(3)
  })

  it('并发峰值不超过 5', async () => {
    let inFlight = 0
    let peak = 0
    const h = harness({
      count: 30,
      fetch: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 0))
        inFlight--
        return okResponse()
      },
    })
    await h.promise
    expect(peak).toBeLessThanOrEqual(5)
    expect(peak).toBeGreaterThan(1) // 没并发起来的话上面那条断言毫无意义
  })

  it('shouldStop 提前停下,已完成的结果照常写回', async () => {
    let calls = 0
    const h = harness({
      count: 50,
      fetch: async () => {
        calls++
        return okResponse()
      },
      shouldStop: () => calls > 3,
    })
    const p = await h.promise
    expect(p.done).toBeLessThan(50)
    expect(p.done).toBeGreaterThan(0)
    expect(h.written.length).toBe(p.done)
  })

  it('写回抛错(记录已被 TTL 清掉)计入 skipped,不中断整批', async () => {
    const h = harness({
      count: 4,
      fetch: async () => okResponse(),
      write: async (id) => {
        if (id === 'qa-1') throw new Error('gone')
      },
    })
    const p = await h.promise
    expect(p).toMatchObject({ total: 4, done: 4, skipped: 1, ok: 3 })
  })

  it('进度回调按完成数递增,最后一次 done === total', async () => {
    const h = harness({ count: 7, fetch: async () => okResponse() })
    await h.promise
    expect(h.progress[0]).toMatchObject({ done: 0, total: 7 })
    expect(h.progress[h.progress.length - 1]).toMatchObject({ done: 7, total: 7 })
    for (let i = 1; i < h.progress.length; i++) {
      expect(h.progress[i].done).toBeGreaterThanOrEqual(h.progress[i - 1].done)
    }
  })

  it('没有候选 → 直接返回,一次请求都不发', async () => {
    const h = harness({ count: 0, fetch: async () => okResponse() })
    const p = await h.promise
    expect(p.total).toBe(0)
    expect(h.fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/backfill.test.ts`
Expected: FAIL —— `snapshotBackfillCandidates is not a function` / `runBackfill is not a function`

- [ ] **Step 3: 给 `db.ts` 加候选快照与计数**

在「问题类型(categories)」区之后追加：

```ts
  // ─── 补分类候选(第五十六轮) ─────────────────────────────────────────────────

  /**
   * 一条记录是否在补分类的候选里。
   *
   *  - 待分类:categoryId 缺失或是未分类
   *  - 重跑:机器打的标,且类型定义在此之后改过(旧标签可能已失效)
   *  - 跳过:人工指定的(机器永不许覆盖)
   *  - inherit 两边都不进:标签有效,而且问题文本与来源相同,重跑是白花钱
   *
   * 注意迁移的时间戳:迁移把类型的 updatedAt 与标答的 categoryAt 写成同一个
   * Date.now(),两者相等 → `<` 不成立 → 迁移来的标答不会被误判成"待重跑"。
   */
  private isBackfillCandidate(
    rec: { categoryId?: string | null; categorySource?: string; categoryAt?: number },
    catUpdatedAt: Map<string, number>,
  ): boolean {
    if (rec.categorySource === "manual") return false;
    if (!rec.categoryId || rec.categoryId === UNCATEGORIZED_CATEGORY_ID) return true;
    if (rec.categorySource !== "jev") return false;
    const catUpdated = catUpdatedAt.get(rec.categoryId);
    if (catUpdated === undefined) return false;
    return (rec.categoryAt ?? 0) < catUpdated;
  }

  private async categoryUpdatedAtMap(): Promise<Map<string, number>> {
    const cats = await this.categories.toArray();
    return new Map(cats.map((c) => [c.id, c.updatedAt]));
  }

  /** 补分类候选条数(设置页按钮上显示的必须是待办的条数,不是库里的总数) */
  async countBackfillCandidates(): Promise<{ history: number; golden: number }> {
    const [qas, goldens, catUpdatedAt] = await Promise.all([
      this.qaRecords.toArray(),
      this.goldens.toArray(),
      this.categoryUpdatedAtMap(),
    ]);
    return {
      history: qas.filter((r) => this.isBackfillCandidate(r, catUpdatedAt)).length,
      golden: goldens.filter((r) => this.isBackfillCandidate(r, catUpdatedAt)).length,
    };
  }

  /**
   * 补分类候选的**快照**:一次读全表,只带 id 与问题文本(向量不带走)。
   *
   * 为什么是快照而不是分页:每跑完一条,它就离开候选集合 —— 对**会缩小的集合**
   * 做 offset 分页会静默跳过条目(跑完前 200 条后,原第 400 条会变成新集合的
   * 第 200 条,而下一页取的是新集合第 200 条起,原第 200~399 条就此丢失)。
   * id + 问题文本很小,几万条也就几百 KB,一次取全没有代价问题。
   */
  async snapshotBackfillCandidates(): Promise<{
    history: Array<{ id: string; question: string }>;
    golden: Array<{ id: string; question: string }>;
  }> {
    const [qas, goldens, catUpdatedAt] = await Promise.all([
      this.qaRecords.toArray(),
      this.goldens.toArray(),
      this.categoryUpdatedAtMap(),
    ]);
    return {
      history: qas
        .filter((r) => this.isBackfillCandidate(r, catUpdatedAt))
        .map((r) => ({ id: r.id, question: r.question })),
      golden: goldens
        .filter((r) => this.isBackfillCandidate(r, catUpdatedAt))
        .map((r) => ({ id: r.id, question: r.question })),
    };
  }
```

- [ ] **Step 4: 在 `classify.ts` 追加批量执行**

先把顶部 import 的 jev 部分补成（`classifyQuestion` 等已有，新增 `pickRecordCategory` 用到的都在本文件内）：

```ts
import {
  argmaxId,
  classifyQuestion,
  isJevConfigured,
  jevConfigFromSettings,
  type JevCategoryOption,
  type JevConfig,
} from './jev'
```

然后在文件末尾追加：

```ts
/** 补分类进度。total 是**待办条数**(不含跳过的),设置页按钮上的文案与它同源 */
export interface BackfillProgress {
  total: number
  done: number
  ok: number
  failed: number
  skipped: number
}

/** 并发上限:官方限流约 1200 req/min,5 并发远在安全区 */
const BACKFILL_CONCURRENCY = 5
/** 单条失败重试次数(不含首发) */
const BACKFILL_RETRIES = 2

/** 打一条,失败重试。成功返回打标结果(可能是 null = 判不准) */
async function classifyWithRetry(
  question: string,
  config: JevConfig,
  options: JevCategoryOption[],
  threshold: number,
): Promise<{ categoryId: string; confidence: number } | null> {
  for (let attempt = 0; attempt <= BACKFILL_RETRIES; attempt++) {
    const r = await classifyQuestion({ question, categories: options, config })
    if (r.ok) return pickRecordCategory(r.probabilities, threshold)
  }
  return null
}

/**
 * 批量补存量。
 *
 * 前置门禁由调用方负责(通过才会调到这里),本函数不重复判。
 * 每条跑完立即落库 —— 中断不丢进度。写回失败(记录已被 TTL 清掉)计入 skipped,
 * **不中断整批**:一次清理不该让几千条的补分类停在中途。
 */
export async function runBackfill(opts: {
  onProgress: (p: BackfillProgress) => void
  shouldStop: () => boolean
  /** 测试注入用;不传则走真实设置、真库 */
  deps?: {
    config?: JevConfig
    categories?: JevCategoryOption[]
    threshold?: number
    snapshot?: () => Promise<{
      history: Array<{ id: string; question: string }>
      golden: Array<{ id: string; question: string }>
    }>
    writeHistory?: (
      id: string,
      hit: { categoryId: string; confidence: number } | null,
    ) => Promise<void>
    writeGolden?: (
      id: string,
      hit: { categoryId: string; confidence: number } | null,
    ) => Promise<void>
  }
}): Promise<BackfillProgress> {
  const settings = await loadSettings()
  const config = opts.deps?.config ?? jevConfigFromSettings(settings)
  const options = opts.deps?.categories ?? classifiableCategories(await db.listCategories())
  const threshold = opts.deps?.threshold ?? settings.classifyProbThreshold
  const snapshot = opts.deps?.snapshot ?? (() => db.snapshotBackfillCandidates())
  const writeHistory = opts.deps?.writeHistory ?? ((id, hit) => db.updateQaCategory(id, hit))
  const writeGolden = opts.deps?.writeGolden ?? ((id, hit) => db.updateGoldenCategory(id, hit))

  const snap = await snapshot()
  const items = [
    ...snap.history.map((r) => ({ ...r, kind: "history" as const })),
    ...snap.golden.map((r) => ({ ...r, kind: "golden" as const })),
  ]
  const progress: BackfillProgress = {
    total: items.length,
    done: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
  }
  opts.onProgress({ ...progress })
  if (items.length === 0) return progress

  // 固定的 worker 池 + 共享游标:并发数恒等于池大小,不需要信号量
  let cursor = 0
  let stopped = false
  const workers = Array.from({ length: BACKFILL_CONCURRENCY }, async () => {
    for (;;) {
      if (stopped || opts.shouldStop()) {
        stopped = true
        return
      }
      const idx = cursor++
      if (idx >= items.length) return
      const item = items[idx]

      const hit = await classifyWithRetry(item.question, config, options, threshold)
      try {
        const write = item.kind === "history" ? writeHistory : writeGolden
        await write(item.id, hit)
        if (hit) progress.ok++
        else progress.failed++
      } catch {
        progress.skipped++
      }
      progress.done++
      opts.onProgress({ ...progress })
    }
  })
  await Promise.all(workers)

  return progress
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/backfill.test.ts`
Expected: PASS（14 个用例）

---

## Task 10: 收尾 —— SW 启动挂钩与文档回写

**Files:**
- Modify: `src/background/index.ts`（启动钩子）
- Modify: `docs/specs/2026-10-11-question-classification-design.md`（§6.2 的 `categoryConfidence` 措辞对齐）

**Interfaces:**
- Consumes: `db.ensurePresetCategories`（Task 2）
- Produces: SW 每次唤醒都保证 6 个预置类型 + 未分类存在

- [ ] **Step 1: 给 SW 启动钩子挂上种子**

在 `src/background/index.ts` 里找到调用 `ensurePresetFolders()` 的那一处（现有代码在初始化路径上），在**紧邻其后**加一行：

```ts
  // 第五十六轮:预置问题类型(幂等,已存在的不会被覆盖)
  void db.ensurePresetCategories();
```

> 位置与 `ensurePresetFolders()` 同级、同样即发即忘。不要放进那个"8 秒后补嵌"的延迟钩子里 —— 类型缺失时补分类会没有选项可问（`classifyRecord` 直接返回 null），越早种下越好。

- [ ] **Step 2: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 3: 类型检查与构建**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc 0 错；构建通过

> **必须用 `npm run build`，不要裸跑 `plasmo build`** —— 裸跑产出的包没有模型文件，会让扩展静默失效。

- [ ] **Step 4: 手工验收（数据层，不截图）**

在聊天页与买家对话几轮，打开 popup：
- 历史问答照常记录、保留天数照常显示（TTL 未受影响）
- 未配 jev 时：设置页「问题分类」区之外一切如常

> 本计划还没有 UI，这一步只验"没把现有功能改坏"。面板按类型分区是下一份计划的事。

- [ ] **Step 5: 对齐 spec 的措辞与文档回写**

`docs/specs/2026-10-11-question-classification-design.md` §6.2 里写的是"jev 给的 confidence"，实际实现落库的是**该标签的概率**（`probabilities[top]`）—— 因为打标阈值比的就是概率，而 `confidence` 描述的是"概率分布尖不尖"，两者不是一回事。把那一行改成：

```
  /** 打标时**该标签的概率**(0~1);低于 classifyProbThreshold 不落标,直接进未分类 */
  categoryConfidence?: number
```

同时按本仓惯例回写工作状态：在 `docs/工作状态-2026-09-08.md` 末尾追加一节「第五十六轮（问题自动分类 · 地基）」，记录本轮做了什么、`runBackfill` 与 UI 的接口边界、以及"检索行为与改动前完全一致"这个当前状态（避免后来的人以为分类已经生效）。

- [ ] **Step 6: 写 ADR-0007**

本 Task 落地的正是"问题文本外发到第二家云服务"这件事 —— ADR 必须与实现同一个 Task 提交，不能留到后面补。

创建 `docs/adr/0007-auto-classification-egress.md`：

```markdown
# 问题自动分类:外发内容扩到"历史问题文本",目的地新增 TypeSafe

## 背景

ADR-0006 开了第一条外发通道:用户自配的 LLM 端点,内容仅限"本轮面板展示的知识库候选文本 + 当前买家问题",
且必须逐次主动点击。那条边界的判据是**话术资产不出本机** —— 历史回答与标准回答是店家攒下来的看家话术,最不该外流。

问题自动分类要落地,必须把**历史问答的提问文本**发给 jev(TypeSafe System One)打标签。
这与 ADR-0006 的三处措辞相抵触:内容(不止"当前买家问题")、目的地(不止用户自配的端点)、触发(不止逐次点击)。

## 决策

在不推翻 ADR-0006 判据的前提下,把边界改写成:

> 外发内容仅限**问题文本** —— 当前买家问题、历史问答的问题、标准回答的问题。
> **回复正文与标准回答正文永不出本机。**

外发目的地新增 `api.typesafe.ai`(可由用户改成兼容端点)。

触发条件:

1. 用户在设置里显式填写 jev 的 API Key(`isJevConfigured` 为真);
2. 用户显式打开「自动分类」开关(`classifyEnabled`,**默认 false**);
3. 开启后,新捕获的问答与手工新建的标准回答会被自动打标;**存量历史需要额外点一次**
   设置页的「开始分类全部历史」按钮,按钮旁写明将发送多少条。

## 判据为什么站得住

被保护的是**店家的回复话术**,不是买家的提问。历史问题与当前买家问题在性质上是同一类内容 ——
ADR-0006 已经放行了后者,放行前者没有引入新的泄露面。而 qaRecords 的回复正文、goldens 的 answer
全流程不进入 `jev.ts` 的入参,这是**结构性保证**,不是纪律。

## 边界(硬约束)

- **回复正文与标准回答正文永不外发**。`classifyQuestion` 的签名里只有 `question: string`,拿不到别的东西。
- **开关默认关、Key 默认空**,不开启时扩展运行期零远程请求。
- **存量补分类是独立的一次点击**,按钮上写明条数;不做"打开开关就默默把全部历史发出去"。
- **API Key 只进 `chrome.storage.local`**,不进 `chrome.storage.sync`,不随导出外发。
- **主机权限按 origin 现申请**(沿用现有的 `optional_host_permissions`),安装时不索取新权限。
- **分类失败不改变检索行为**:未打标的记录落"未分类",而未分类恒进检索池,
  所以"jev 挂掉"只会让分类退化成不分类,不会让任何东西搜不到。

## 代价与取舍

- 红线从"只有知识库候选与当前问题出网"扩到"问题文本都可能出网"。这是本次唯一的实质让步,
  用"显式开关 + 存量再点一次"换"不用配分类也能按类型检索"。
- 分类要经过一家第三方服务可用性。失败时的降级路径已在上面写明(落未分类 → 恒进池)。
- 与 ADR-0006 一样,本条在"本地小模型能跑出可接受的质量"这个条件成立时作废。
```

并在 `docs/adr/0006-optional-llm-integration.md` 顶部标题之下加一行指针：

```markdown
> **2026-10-11 修订**:外发内容与目的地已扩到「问题文本 + TypeSafe」,见 [ADR-0007](./0007-auto-classification-egress.md)。
> 本条的核心判据(话术资产不出本机、发送永远由人点击)未变。
```

- [ ] **Step 7: 提交**

```bash
git add src/background/index.ts docs/adr/0007-auto-classification-egress.md docs/adr/0006-optional-llm-integration.md docs/specs/2026-10-11-question-classification-design.md
git commit -m "feat: SW 启动种下预置问题类型 + ADR-0007(外发扩到问题文本/TypeSafe)(第五十六轮)"
```

---

## 完成后的状态

跑完这份计划：

- `categories` 表存在，6 个预置类型 + 未分类 + 迁移来的自定义类型都在
- 老库升级不丢数据：文件夹名与标准回答归属都在，且标了 `manual` 不会被机器动
- 配好 jev 并打开开关后，新捕获的问答与手工新建的标准回答会被自动归类
- 设置页可以手动触发一次性补分类（UI 是下一份计划的事，本计划只到 `runBackfill` 这一层）
- **检索行为与改动前完全一致** —— 分类结果还没进入检索管线

下一份计划：`docs/superpowers/plans/2026-10-11-question-classification-ui.md`（面板与设置页）；再下一份：检索路由与尺码路由。
