# 问题自动分类 · 面板与设置页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让上一份计划建好的分类地基在界面上活着 —— 能在设置页开关分类、配 jev、跑存量补分类，并能在两个页签里按问题类型浏览与纠正。

**Architecture:** 三层推进，每层独立可验收 —— ① 数据管线（DTO 带上 `categoryId`、面板回带类型列表）；② 设置页新开一个「问题分类」区（照抄「AI 整合」区的草稿 + 显式保存 + 主机权限申请那套）；③ 两个列表页从"文件夹树"改成"按类型分区"。本计划**不碰检索** —— 分类结果此时仍不影响搜索结果。

**Tech Stack:** TypeScript、React 18、Plasmo MV3、Dexie、Vitest 3 + happy-dom（**无 @testing-library**，UI 测试用手动 DOM + `react-dom/client`）。

**Spec:** `docs/specs/2026-10-11-question-classification-design.md`
**上一份计划:** `docs/plans/2026-10-11-question-classification-foundation.md`（已落地，HEAD 起点 `db0fc67`）

## Global Constraints

- **TTL / 保留期逻辑一个字不改**；现有全部测试必须保持全绿（`npm test`，起点 **652 passed / 57 files**）。
- **未配置时零远程请求**：`classifyEnabled` 默认 `false`、`jevApiKey` 默认空。设置页把开关打开但字段没填全时，**不得**发出任何请求（沿用 AI 区那两行"配了但不会生效"的自查提示做法）。
- **回复正文与标准回答正文永不出本机**。
- **API Key 只进 `chrome.storage.local`**；`jevApiKey` 与 `llmApiKey` 都必须留在导出信封之外（上一份计划已修，别改回去）。
- **发送永远由人完成**；扩展从不代发消息。
- **设计令牌只能从 `src/ui/design.ts` 与 `tk.*` 取**，不得写字面量尺寸/颜色（设计系统铁律）。
- **预置类型与未分类不可改名、不可删**；自定义类型可以。
- **类型名必须唯一** —— 重名会让 `jev.ts` 里 name→id 的映射互相覆盖，静默错分。这条是硬校验。
- 构建必须用 **`npm run build`**，不得裸跑 `plasmo build`。

## Review Focus

以下是 spec 没明写、但使用者会立刻撞上的失败模式。每条都已落到某个 Task 的测试里。

1. **打开开关但没填全字段，却发出了请求** —— 期望：零请求，且界面上有一行红字说清"开了但不会生效"。（Task 3）
2. **`memory` 页把"没跑过分类"的记录显示成"没有类型"** —— 期望：一律落进「未分类」桶，不漏不丢。（Task 1 的归一 + Task 5）
3. **补分类跑到一半关掉弹窗，再打开看到的是"没在跑"** —— 期望：进度从后台状态读回来，显示仍在跑。（Task 4）
4. **手动把一条标准回答拖进某个类型后，一次补分类把它冲掉** —— 期望：手动指定过的（`categorySource: 'manual'`）补分类一律跳过，且面板上要能看出来它是手动摆的。（Task 6）
5. **新建一个和预置类型重名的类型** —— 期望：挡住。（Task 7）

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `src/pdd/jev-form.ts` | 设置页「问题分类」表单的纯逻辑：字段映射 / 完备性 / 测试连接文案。镜像 `src/pdd/llm-form.ts` |
| `src/popup/jevDraft.ts` | jev 表单草稿（弹窗失焦销毁后续上）。镜像 `src/popup/llmDraft.ts` |
| `src/background/backfillState.ts` | 补分类的**后台状态机**：谁在跑、跑到哪、上次结果。面板轮询它 |
| `tests/unit/background/backfillState.test.ts` | — |
| `tests/unit/background/categoryPanel.test.ts` | 类型 CRUD 与「移动标答到类型」的 handler 测试 |
| `tests/unit/pdd/jev-form.test.ts` | — |
| `tests/unit/popup/categoryGrouping.test.ts` | 分区纯逻辑 |
| `tests/unit/ui/settingsClassify.test.tsx` | 设置页新区 |
| `tests/unit/ui/memoryCategory.test.tsx` | 记忆页分区 |
| `tests/unit/ui/goldenCategory.test.tsx` | 标准回答页分区与移动 |

**修改**

| 文件 | 改动 |
|---|---|
| `src/types/messages/panel.ts` | `MemoryListItem` / `PanelGolden` 加 `categoryId`；新增 `PanelCategory`；`GetPanelDataResponse` 加 `categories`；新增类型 CRUD 与移动标答的消息对 |
| `src/types/messages/system.ts`（或新建 `classify.ts`） | `TEST_JEV` / `GET_BACKFILL_STATE` / `START_BACKFILL` 消息对 |
| `src/types/messages/index.ts` | 两处 union 各补新类型 |
| `src/background/panel.ts` | 两个 handler 回带 `categoryId`；`getPanelData` 回带 `categories` |
| `src/background/categories.ts`（**新建**） | 类型 CRUD 的 IO 层（改名/删除/新建的校验与事务） |
| `src/background/index.ts` | 派发表补新 handler |
| `src/shared/constants.ts` | `JEV_DRAFT_STORAGE_KEY` |
| `src/background/settings.ts` | 若新增设置字段才动；本计划预期**不加新设置** |
| `src/popup/SettingsTab.tsx` | 新增「问题分类」区 |
| `src/popup/index.tsx` | `folders` 页签 label 由「文件夹」改「标准回答」 |
| `src/popup/logic.ts` | 新增 `groupByCategory` / `categoryBuckets` |
| `src/popup/MemoryListTab.tsx` | 按类型分区（只读） |
| `src/popup/FoldersTab.tsx` | 由"文件夹树"改为"按类型分区" + 标答类型下拉 |

**本计划不碰**：`retrieval.ts`、`retrievalCache.ts`、`search.ts`、`llm.ts`、`aiIntegrate.ts`、`classify.ts`、`jev.ts`（除读取既有导出）。

---

## Task 1: DTO 带上类型，面板回带类型表

**Files:**
- Modify: `src/types/messages/panel.ts`
- Modify: `src/background/panel.ts`
- Test: `tests/unit/background/panel.test.ts`（追加）

**Interfaces:**
- Consumes: `db.listCategories()`（上一份计划）、`CategoryRecord`、`UNCATEGORIZED_CATEGORY_ID`
- Produces:
  - `MemoryListItem.categoryId: string`（**已归一**，永不为 undefined）
  - `PanelGolden.categoryId: string`（已归一）、`PanelGolden.categorySource?: string`
  - `PanelCategory { id; name; kind; filterable; position }`
  - `GetPanelDataResponse['payload'].categories: PanelCategory[]`

**为什么在 DTO 边界就把 undefined 归一掉：** spec §7.6 的教训（裁决 I2）—— `undefined !== null`，一旦让 `undefined` 流到下游，任何 `!== null` 的判断都会把"没分类"误判成"有分类"。在出口处一次性归一成 `'uncategorized'`，下游就不用再各自防一遍。

- [ ] **Step 1: 写失败的测试**

在 `tests/unit/background/panel.test.ts` **末尾追加**（该文件已有建库与 `getMemoryList` / `getPanelData` 的调用脚手架）：

```ts
// ─── 分类字段回带(第五十七轮) ────────────────────────────────────────────────────
//
// 这一组钉的是"出口归一":库里的 categoryId 可能是 undefined / null / 具体 id 三种形态,
// 面板拿到的必须是**具体的 id**且永不为 undefined —— 否则下游任何 `!== null` 判断
// 都会把"没分类"当成"有分类"(见裁决 I2)。

describe('面板回带分类', () => {
  it('categoryId 缺省或为 null 的记录,一律归一成 uncategorized', async () => {
    // 造两条 qaRecord:一条不带 categoryId,一条 categoryId: null
    // 断言 getMemoryList 返回的两条 categoryId 都是 UNCATEGORIZED_CATEGORY_ID
  })

  it('有类型的记录原样回带', async () => {
    // 造一条 categoryId: 'preset:order'
    // 断言返回的 categoryId === 'preset:order'
  })

  it('标答回带 categoryId 与 categorySource', async () => {
    // 造两条 golden:一条 categoryId: 'preset:price' + categorySource: 'manual'
    //                    一条不带 categoryId
    // 断言前者原样回带;后者 categoryId 归一成 uncategorized 且 categorySource 为 undefined
  })

  it('getPanelData 回带类型表(按 position 升序,未分类在后)', async () => {
    // 先 ensurePresetCategories()
    // 断言 payload.categories 有 7 条,首条是 'preset:size',末条是 'uncategorized'
    //      且每条恰好带 id/name/kind/filterable/position 五个字段(不带 criteria)
  })

  it('没跑过分类时 categories 仍回带(种子在 SW 启动已种下)', async () => {
    // 只 ensure 不造数据
    // 断言 payload.categories.length === 7
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/panel.test.ts`
Expected: FAIL —— `categoryId` 为 `undefined`；`payload.categories` 为 `undefined`

- [ ] **Step 3: 扩 DTO**

`src/types/messages/panel.ts` —— `MemoryListItem` 加一个字段：

```ts
export interface MemoryListItem {
  id: string
  question: string
  questionTs: number
  replyCount: number
  replies: MemoryReplyItem[]
  /**
   * 问题类型 id。**已归一**:库里缺省或为 null 的记录在这里一律是 'uncategorized'。
   * 面板据此分桶,不需要再做 null/undefined 判断。
   */
  categoryId: string
}
```

`PanelGolden` 加两个：

```ts
export interface PanelGolden {
  id: string
  folderId: string | null
  question: string
  answer: string
  hasEmbedding: number
  updatedAt: number
  /** 问题类型 id;**已归一**(缺省 → 'uncategorized') */
  categoryId: string
  /** 谁打的标。'manual' = 你手工摆的,补分类会跳过;缺省 = 机器没跑过 */
  categorySource?: string
}
```

新增类型条目 DTO：

```ts
/** 面板用的类型条目。**不带 criteria** —— 那是喂给 jev 的,面板用不上,也不该跟着 DTO 到处传 */
export interface PanelCategory {
  id: string
  name: string
  kind: 'preset' | 'custom' | 'uncategorized'
  /** true = 参与类型过滤(与"是 jev 的选项"是同一个集合) */
  filterable: boolean
  position: number
}
```

并在 `GetPanelDataResponse` 的 payload 里加 `categories: PanelCategory[]`。

- [ ] **Step 4: 两个 handler 回带**

`src/background/panel.ts`：`getMemoryList` 的 `items = qas.map(...)` 块（约 :56-62）加一行：

```ts
  const items = qas.map((q) => ({
    id: q.id,
    question: q.question,
    questionTs: q.questionTs,
    replyCount: q.replyCount,
    replies: (byQa.get(q.id) ?? []).sort((a, b) => a.ts - b.ts),
    // 出口归一(裁决 I2):库里三种形态(undefined / null / 具体 id)在这里收敛成一种
    categoryId: q.categoryId ?? UNCATEGORIZED_CATEGORY_ID,
  }));
```

`getPanelData`：在 `Promise.all` 里加上类型表，并给标答映射补字段：

```ts
  const [folders, goldens, knowledge, categories] = await Promise.all([
    db.folders.toArray(),
    db.goldens.toArray(),
    db.knowledge.toArray(),
    db.listCategories(),
  ]);
```

```ts
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      filterable: c.filterable,
      position: c.position,
    })),
    goldens: goldens.map((g) => ({
      id: g.id,
      folderId: g.folderId,
      question: g.question,
      answer: g.answer,
      hasEmbedding: g.hasEmbedding,
      updatedAt: g.updatedAt,
      categoryId: g.categoryId ?? UNCATEGORIZED_CATEGORY_ID,
      categorySource: g.categorySource,
    })),
```

顶部 import 补 `UNCATEGORIZED_CATEGORY_ID`（来自 `../shared/constants`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/panel.test.ts`
Expected: PASS（原有用例 + 新增 5 个）

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全绿。**特别注意 `tests/unit/ui/*` 里渲染 `MemoryListTab` / `FoldersTab` 的用例** —— DTO 加了必填字段，任何手写 `MemoryListItem` / `PanelGolden` 字面量的测试夹具都会因缺字段而 TS 报错，要把它们补上（这是预期的连锁修改，不是回归）。

- [ ] **Step 7: 提交**

```bash
git add src/types/messages/panel.ts src/background/panel.ts tests/unit/background/panel.test.ts tests/unit/ui
git commit -m "feat: 面板 DTO 带上问题类型(出口归一),getPanelData 回带类型表(第五十七轮)"
```

---

## Task 2: jev 表单纯逻辑与草稿

**Files:**
- Create: `src/pdd/jev-form.ts`
- Create: `src/popup/jevDraft.ts`
- Modify: `src/shared/constants.ts`（草稿存储键）
- Test: `tests/unit/pdd/jev-form.test.ts`

**Interfaces:**
- Consumes: `PddSettings` 的 `jevBaseUrl` / `jevApiKey` / `jevModel`；`originsForBaseUrl`（复用 `src/pdd/llm-form.ts` 里已有的那个，**不要复制一份**）
- Produces: `JevFormFields`、`JevSettingsFields`、`jevSettingsPatch`、`jevFormFromSettings`、`sameJevFields`、`jevFormReady`、`JevTestState`、`jevTestLabel`、`jevTestErrorText`、`jevTestFailed`；`JEV_DRAFT_STORAGE_KEY`、`loadJevDraft`、`saveJevDraft`、`clearJevDraft`、`JEV_DRAFT_DEBOUNCE_MS`

**为什么草稿机制不能省：** 弹窗失焦会被 Chrome 销毁（`llmDraft.ts` 的文件注释写明了这一点）。没有草稿，用户填了一半 key 去复制粘贴、回来就白填。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/pdd/jev-form.test.ts`：

```ts
// jev 表单的纯逻辑。与 llm-form 同构,所以这里也照它的写法钉两件事:
//  ① 字段映射是**唯一**的转换点,写错不会报错只会静默丢值 → 往返必须对得上;
//  ② 判据与 background 侧必须同判(这是两份实现,一致性靠测试不靠自觉)。
import { describe, it, expect } from 'vitest'
import {
  jevFormFromSettings,
  jevFormReady,
  jevSettingsPatch,
  jevTestErrorText,
  jevTestLabel,
  sameJevFields,
} from '../../../src/pdd/jev-form'

const S = { jevBaseUrl: 'https://api.typesafe.ai', jevApiKey: 'sk-1', jevModel: 'jev-latest' }

describe('jev 表单字段映射', () => {
  it('设置 → 表单 → 设置 往返不丢值', () => {
    expect(jevSettingsPatch(jevFormFromSettings(S))).toEqual(S)
  })

  it('表单形不带 jev 前缀', () => {
    expect(jevFormFromSettings(S)).toEqual({
      baseUrl: 'https://api.typesafe.ai',
      apiKey: 'sk-1',
      model: 'jev-latest',
    })
  })

  it('sameJevFields 逐字段比,不比对象身份', () => {
    expect(sameJevFields(jevFormFromSettings(S), { ...jevFormFromSettings(S) })).toBe(true)
    expect(sameJevFields(jevFormFromSettings(S), { ...jevFormFromSettings(S), apiKey: 'x' })).toBe(
      false,
    )
  })
})

describe('jevFormReady', () => {
  it('三项都非空才算配好', () => {
    expect(jevFormReady({ baseUrl: 'https://a', apiKey: 'k', model: 'm' })).toBe(true)
    expect(jevFormReady({ baseUrl: 'https://a', apiKey: '', model: 'm' })).toBe(false)
    expect(jevFormReady({ baseUrl: '', apiKey: 'k', model: 'm' })).toBe(false)
    expect(jevFormReady({ baseUrl: 'https://a', apiKey: 'k', model: '' })).toBe(false)
  })

  it('纯空白不算填了', () => {
    expect(jevFormReady({ baseUrl: '   ', apiKey: 'k', model: 'm' })).toBe(false)
  })
})

describe('测试连接文案', () => {
  it('状态机四态', () => {
    expect(jevTestLabel({ phase: 'idle' })).toBe('测试连接')
    expect(jevTestLabel({ phase: 'testing' })).toBe('测试中…')
    expect(jevTestLabel({ phase: 'ok' })).toBe('连接正常')
  })

  it('HTTP 码原样带出(那是用户唯一能自己动手改的线索)', () => {
    expect(jevTestErrorText('http 401')).toContain('401')
    expect(jevTestErrorText('http 500')).toContain('500')
  })

  it('超时与网络分开说,且网络那档要提"是否已授权该域名"', () => {
    expect(jevTestErrorText('timeout')).toContain('超时')
    expect(jevTestErrorText('network')).toContain('授权')
  })

  it('没填全时说清是没填全', () => {
    expect(jevTestErrorText('unconfigured')).toMatch(/没填全|尚未填全/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/pdd/jev-form.test.ts`
Expected: FAIL —— Cannot find module `src/pdd/jev-form`

- [ ] **Step 3: 实现 `src/pdd/jev-form.ts`**

以 `src/pdd/llm-form.ts` 为模板。要点：

- 头部注释写明与 `llm-form.ts` 是**同构**的两个文件，以及为什么 `originsForBaseUrl` 不复制第二份（它本就是通用的 origin 推导，复制会让"改了一个忘了另一个"有处可藏）。
- `JevFormFields = { baseUrl; apiKey; model }`；`JevSettingsFields = Pick<PddSettings, 'jevBaseUrl' | 'jevApiKey' | 'jevModel'>`。
- `jevFormReady` 三项 `trim()` 后都非空（与 `background/jev.ts` 的 `isJevConfigured` 同判据 —— 注释里点明这是两份实现）。
- `jevTestErrorText` 复用 llm 那套文案骨架，但把 `401/403` 的说法换成"jev 服务拒绝了该密钥"，并保留 `network` 那句里的"是否已授权该域名"（jev 走的是动态申请主机权限，同一条坑）。
- `jevTestLabel` / `jevTestFailed` 与 llm 版同形。

- [ ] **Step 4: 加草稿键与草稿模块**

`src/shared/constants.ts` 在 `LLM_DRAFT_STORAGE_KEY` 之后加：

```ts
/** jev 表单草稿(边填边存):与 llm 草稿分开,理由同上 —— 半途而废的密钥不会出网 */
export const JEV_DRAFT_STORAGE_KEY = 'pddcs:jevDraft'
```

创建 `src/popup/jevDraft.ts`，**逐行镜像** `src/popup/llmDraft.ts` 的结构（`JEV_DRAFT_DEBOUNCE_MS = 300`、`loadJevDraft` / `saveJevDraft` / `clearJevDraft`），只换存储键与类型。文件头注释注明它是 llmDraft 的同构副本、以及为什么共用一份不够（两套配置互不覆盖）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/pdd/jev-form.test.ts`
Expected: PASS

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add src/pdd/jev-form.ts src/popup/jevDraft.ts src/shared/constants.ts tests/unit/pdd/jev-form.test.ts
git commit -m "feat: jev 表单纯逻辑与草稿(镜像 llm-form/llmDraft)(第五十七轮)"
```

---

## Task 3: 设置页「问题分类」区

**Files:**
- Modify: `src/types/messages/settings.ts`（或 `system.ts`）—— 加 `TEST_JEV` 消息对
- Modify: `src/types/messages/index.ts` —— 两处 union
- Modify: `src/background/index.ts` —— 派发表
- Modify: `src/popup/SettingsTab.tsx` —— 新增一个 `<Card>`
- Test: `tests/unit/ui/settingsClassify.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `jev-form` / `jevDraft`；`background/jev.ts` 的 `testJevConnection`、`jevConfigFromSettings`、`isJevConfigured`；`originsForBaseUrl`
- Produces: 设置页上一个可用的「问题分类」区；`TEST_JEV` 消息

**位置：** 在「AI 整合」`<Card>` 之后、「导入与导出」之前（约 `SettingsTab.tsx:554`）。分类与 AI 整合是两件独立的事，但都要配一个外部端点，放一起用户找得到。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/ui/settingsClassify.test.tsx`，**照抄** `tests/unit/ui/settingsLlmSave.test.tsx` 的整套装置（手动 DOM + `react-dom/client` + `IS_REACT_ACT_ENVIRONMENT` + 内存版 `chrome.storage.local` + 假 `chrome.permissions.request` 返回 true），然后：

```tsx
describe('设置页 · 问题分类区', () => {
  it('默认关闭,且三个字段从设置回填', async () => {
    // GET_STATS 回报 classifyEnabled:false、jevApiKey:'sk-jev'、jevModel:'jev-latest'
    // 断言:开关的 aria-checked 为 false;key 输入框的 value 为 'sk-jev'(type=password)
    //      模型名输入框的 value 为 'jev-latest'
  })

  it('★ 开着但没填全 → 一行红字说清"不会生效",且不发任何请求', async () => {
    // classifyEnabled:true、jevApiKey:'' 的 GET_STATS 回报
    // 渲染后断言:页面上出现"已开启,但…尚未填全"这类文案(颜色为 tk.errorText)
    // 并且 mockedSend 的调用里**没有** TEST_JEV
  })

  it('点「测试连接」→ 发 TEST_JEV,并把结论显示在按钮右侧(不弹 Notice)', async () => {
    // 填全三项,点测试连接,TEST_JEV 回报 { ok: false, error: 'http 401' }
    // 断言:按钮右侧出现含 '401' 的文字;Notice 区域没有出现"失败"字样
  })

  it('保存时会为该地址申请主机权限', async () => {
    // 点保存
    // 断言 chrome.permissions.request 被调用,且 origins 里含 'https://api.typesafe.ai/*'
  })

  it('改完没保存 → 有未保存提示', async () => {
    // 改一下模型名(不点保存)
    // 断言:出现「有未保存的修改。」
  })

  it('未保存的改动会落进草稿(弹窗销毁后能续上)', async () => {
    // 改一下 key,等过防抖
    // 断言 chrome.storage.local 里 JEV_DRAFT_STORAGE_KEY 存着新值
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/ui/settingsClassify.test.tsx`
Expected: FAIL —— 页面上找不到这些控件

- [ ] **Step 3: 加 `TEST_JEV` 消息**

域文件（放在 `src/types/messages/settings.ts` 里，与 `TEST_LLM` 相邻）：

```ts
/** 「测试连接」用**草稿里的**那份配置 —— 用户改完地址点测试,测的必须是刚改的那份 */
export interface TestJevRequest {
  type: 'TEST_JEV'
  payload: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number }
}

export interface TestJevResponse {
  type: 'TEST_JEV_RESPONSE'
  payload: { ok: boolean; error?: string }
}
```

`src/types/messages/index.ts` 的**两处** union 各加一个成员（`ExtensionMessage` 加 `TestJevRequest['type']` 对应的请求接口、`ExtensionMessageResponse` 加 `TestJevResponse`）。两处都要改 —— 那是手工维护的。

`src/background/index.ts` 派发表加（照 `TEST_LLM` 那条写）：

```ts
  TEST_JEV: route(
    "TEST_JEV",
    async (message) => {
      const p = message.payload;
      const config = {
        baseUrl: String(p?.baseUrl ?? ""),
        apiKey: String(p?.apiKey ?? ""),
        model: String(p?.model ?? ""),
        timeoutMs: Number(p?.timeoutMs) || DEFAULT_SETTINGS.jevTimeoutMs,
      };
      if (!isJevConfigured(config)) return { ok: false, error: "unconfigured" };
      const r = await testJevConnection(config);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    (err) => ({ ok: false, error: String(err) }),
  ),
```

import 补 `testJevConnection` / `isJevConfigured` / `jevConfigFromSettings`（来自 `./jev`）。

- [ ] **Step 4: 加设置页的区**

在「AI 整合」`<Card>` 之后插入一个 `<Card tk={tk} title="问题分类" style={SETTINGS_CARD_STYLE}>`，内部结构**逐段对应** AI 区：

1. `<Toggle>` —— label「自动分类」，desc 说清"开启后,新捕获的问答与手工新建的标准回答会自动归类;存量历史要在下方点一次按钮"。
2. 数据边界那行灰字 —— 照 ADR-0007 的口径写三类外发内容：**"开启后,买家问题、历史问答的问题、标准回答的问题会发给 jev 判类型,连同每个类型的名称与说明。回复正文与标准回答正文永不外发,密钥只存本机。"** 这句必须与 ADR-0007 同源同义 —— 改动任一处都要同时核对另一处。
3. `<Field label="接口地址">` / `<Field label="API Key">`（带显示/隐藏，照 AI 区）/ `<Field label="模型名">`。
4. `<Slider label="分类超时">`，读秒、设置存毫秒（**照抄 AI 区那条注释里记的单位换算坑**：`value={draft.jevTimeoutMs / 1000}`、`min={JEV_TIMEOUT_MIN_MS / 1000}`、`max={JEV_TIMEOUT_MAX_MS / 1000}`、`onChange={(v) => persistSlider({ jevTimeoutMs: v * 1000 })}`、`format={(v) => \`${v} 秒\`}`）。
5. 保存 / 测试连接两个 `<Btn>` + 结论就地显示在按钮右侧，右下角两行自查提示（"开了但没填全"红字、"有未保存的修改"灰字）。

保存路径照 `saveLlm`：先 `chrome.permissions.request({ origins: originsForBaseUrl(baseUrl) })`，再 `persist({ ...draft, ...jevSettingsPatch(form) })`，成功后回填表单并 `clearJevDraft()`。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/ui/settingsClassify.test.tsx`
Expected: PASS（6 个用例）

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add src/types/messages src/background/index.ts src/popup/SettingsTab.tsx tests/unit/ui/settingsClassify.test.tsx
git commit -m "feat: 设置页「问题分类」区 —— 开关/jev 配置/测试连接/主机权限(第五十七轮)"
```

---

## Task 4: 补分类按钮与进度

**Files:**
- Create: `src/background/backfillState.ts`
- Modify: `src/types/messages/classify.ts`（新建）与 `index.ts`
- Modify: `src/background/index.ts`
- Modify: `src/popup/SettingsTab.tsx`
- Test: `tests/unit/background/backfillState.test.ts`、`tests/unit/ui/settingsClassify.test.tsx`（追加）

**Interfaces:**
- Consumes: `background/classify.ts` 的 `runBackfill` / `BackfillProgress`；`db.countBackfillCandidates()`
- Produces: `BackfillStatus`、`startBackfill()`、`getBackfillStatus()`；`GET_BACKFILL_STATE` / `START_BACKFILL` 消息

**为什么用轮询而不是长连接：** 补分类跑在 SW 里，弹窗关掉它就没了连接 —— 用 Port 的话用户关闭再打开只会看到"没在跑"。后台留一份状态、面板轮询读，关/开弹窗都能如实反映，也不用处理端口生命周期。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/backfillState.test.ts`：

```ts
describe('补分类后台状态', () => {
  it('初始为 idle,计数为 0', ...)

  it('★ 未配置时 startBackfill 不发请求,并把状态置为 idle 且带 error', async () => {
    // 不种类型 / 不开开关 / 不填 key,各来一遍
    // 用 vi.fn() 记 fetch 调用
    // 断言 fetch 未被调用,status.phase === 'idle',status.error 有值
  })

  it('跑起来时 phase 为 running,进度随回调推进', ...)

  it('跑完 phase 为 done,计数与 runBackfill 的返回值一致', ...)

  it('★ 已在跑时再点一次不会起第二个', async () => {
    // 让 runBackfill 挂住(注入一个不 resolve 的 deps.snapshot)
    // 连续调两次 startBackfill
    // 断言第二次直接返回且没有第二组 worker —— 用 deps 里的调用计数证明
  })

  it('单条失败不把整批标记成失败(phase 仍是 done,计数里有 failed)', ...)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/backfillState.test.ts`
Expected: FAIL —— Cannot find module

- [ ] **Step 3: 实现 `src/background/backfillState.ts`**

要点：

- 模块级单例 `let status: BackfillStatus = { phase: 'idle', total: 0, done: 0, ok: 0, failed: 0, skipped: 0 }`。
- `startBackfill()`：**先判门禁**（`classifyEnabled` + `isJevConfigured` + 有可问类型），任一条不成立就 `status = { ...status, phase: 'idle', error: '…' }` 直接返回，**一次 fetch 都不发**。这与 `runBackfill` 自身"不重复判门禁"的分工一致 —— 门禁在这里，是唯一的入口。
- 已在跑（`phase === 'running'`）时直接返回，不重入。
- 跑之前先 `db.countBackfillCandidates()` 拿总数写进 `status.total`（这样按钮上的数字与进度分母同源）。
- 调 `runBackfill({ onProgress, shouldStop })`，`onProgress` 把进度写进 `status`。
- 结束后 `phase = 'done'`，带上最终计数。
- 导出 `getBackfillStatus()` 返回一份**拷贝**（免得调用方改到内部状态）。

- [ ] **Step 4: 加两条消息与派发表**

`src/types/messages/classify.ts`（新建域文件，记得在 `index.ts` 里 `export *` 并补两处 union）。

**`BackfillStatus` 定义在这里，不在 `backfillState.ts`。** `src/types/messages/` 是共享类型层，**不得**反向 import `src/background/`；而 `runBackfill` 返回的 `BackfillProgress` 在 `src/background/classify.ts` 里、同样不能从这里引用。所以 DTO 自己声明形状，`backfillState.ts` 反过来 import 它 —— 依赖方向永远是 background → types，不是反过来。

```ts
/**
 * 补分类的后台状态。形状在这里声明(而不是从 background import),
 * 因为 types/messages 是共享层,依赖方向只能是 background → types。
 */
export interface BackfillStatus {
  phase: 'idle' | 'running' | 'done'
  /** 待办条数(快照长度);manual 记录在快照阶段就被排除,不计入 */
  total: number
  done: number
  ok: number
  failed: number
  /** 跑的过程中被保留期清掉、写不回去的条数(不是 manual) */
  skipped: number
  /** 上一次的失败原因(门禁未过 / 运行期异常);无则为 undefined */
  error?: string
  /** 本次是被中断结束的 */
  stopped?: boolean
}

export interface GetBackfillStateRequest {
  type: 'GET_BACKFILL_STATE'
}
export interface GetBackfillStateResponse {
  type: 'GET_BACKFILL_STATE_RESPONSE'
  payload: { status: BackfillStatus; /** 待办条数(按钮上显示的就是它) */ pending: number }
}

export interface StartBackfillRequest {
  type: 'START_BACKFILL'
}
export interface StartBackfillResponse {
  type: 'START_BACKFILL_RESPONSE'
  payload: { started: boolean; error?: string }
}

/** 中断:已跑完的条目结果保留,`runBackfill` 的 worker 会在下一轮循环顶部退出 */
export interface StopBackfillRequest {
  type: 'STOP_BACKFILL'
}
export interface StopBackfillResponse {
  type: 'STOP_BACKFILL_RESPONSE'
  payload: { stopping: boolean }
}
```

- [ ] **Step 5: 设置页加按钮与进度**

在「问题分类」区内加：

```
[ 开始分类全部历史 ]
  将把 1,247 条历史问题 + 38 条标准回答的问题发送到 api.typesafe.ai(不含任何回复内容)
```

- 按钮文案里的两个数字**来自 `GET_BACKFILL_STATE` 的 `pending`**（后台用 `countBackfillCandidates()` 算），不是库里的总数 —— 跳过（`manual`）的不计入。
- 挂载时读一次状态；若 `phase === 'running'`，每 500ms 轮询一次直到 `done`（轮询用 `setInterval` + 卸载时 `clearInterval`）。
- 运行中显示 `382 / 1285`，**并把「开始」按钮换成「中断」**。
- **中断**：`STOP_BACKFILL` 消息把后台那个 `shouldStop` 开关置真（`backfillState.ts` 导出一个 `requestBackfillStop()`，内部把传给 `runBackfill` 的 `shouldStop()` 从 `() => false` 变成读一个模块级标志）。`runBackfill` 的 worker 会在下一轮循环顶部退出，**已跑完的条目结果保留**（它自己就是这么设计的）。中断后 `phase` 置 `done`，报告里说明是中断结束的。
- `done` 时显示报告：`成功 N · 失败 M · 跳过 K`（spec §11.1 的口径 —— `跳过` 指的是**跑的过程中被保留期清掉**的记录，不是 `manual`：`manual` 在快照阶段就被排除了，根本不计入 `total`）。
- **门禁不满足时按钮禁用并给出理由**（"先开启自动分类并填全配置"）。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/backfillState.test.ts tests/unit/ui/settingsClassify.test.tsx`
Expected: PASS

- [ ] **Step 7: 跑全量测试并提交**

```bash
npm test
git add src/background/backfillState.ts src/types/messages src/background/index.ts src/popup/SettingsTab.tsx tests/unit/background/backfillState.test.ts tests/unit/ui/settingsClassify.test.tsx
git commit -m "feat: 补分类按钮与进度(后台状态 + 面板轮询)(第五十七轮)"
```

---

## Task 5: 记忆列表按类型分区（只读）

**Files:**
- Modify: `src/popup/logic.ts`（新增分区纯逻辑）
- Modify: `src/popup/MemoryListTab.tsx`
- Test: `tests/unit/popup/categoryGrouping.test.ts`、`tests/unit/ui/memoryCategory.test.tsx`

**Interfaces:**
- Consumes: `MemoryListItem.categoryId`（Task 1）、`PanelCategory`
- Produces: `groupByCategory<T>(items, categories): Array<{ category: PanelCategory; items: T[] }>`、`categoryOrder(categories): PanelCategory[]`

**为什么只读：** spec D8 —— 历史问答 90 天就过期，纠错价值低于成本。但它需要一个**说明性的空状态**，否则用户会以为功能坏了。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/popup/categoryGrouping.test.ts`：

```ts
describe('groupByCategory', () => {
  it('按类型 id 分桶,空桶不返回', ...)
  it('未分类恒排最后一组,不管它的 position', ...)
  it('★ 组内保持传入顺序(调用方已按时间排好,不要再排一次)', ...)
  it('未知的 categoryId(库里有、类型表里没有)落进未分类组,不丢条目', ...)
  it('类型表为空时,全部落未分类组', ...)
  it('每个组的计数等于组内条目数', ...)
})
```

> 最后两条是防丢的：DTO 虽然归一到 `'uncategorized'`，但**类型表本身**可能不含那条 id（例如旧库的自定义类型被删了）。分组函数必须保证"进来的条目一条不少地出现在某个组里"。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/popup/categoryGrouping.test.ts`
Expected: FAIL —— 未导出

- [ ] **Step 3: 实现分区逻辑**

在 `src/popup/logic.ts` 追加（该文件是"纯 Model 层,无 chrome/DB"——保持这个边界）：

```ts
/** 分区结果的一节 */
export interface CategoryBucket<T> {
  category: PanelCategory
  items: T[]
}

/**
 * 按问题类型分桶。
 *
 * 两条不变量:
 *  ① **一条都不能丢** —— 类型表里没有的 categoryId 一律并进「未分类」组。
 *     类型表可能不含某条 id(旧库的自定义类型被删掉了),而条目还在。
 *  ② 未分类恒排最后,不管它的 position 是多少。
 */
export function groupByCategory<T extends { categoryId: string }>(
  items: T[],
  categories: PanelCategory[],
): Array<CategoryBucket<T>> { ... }
```

`PanelCategory` 从 `../types/messages` 导入。空组不产出（面板上不显示空的分区容器）。

- [ ] **Step 4: 记忆页改成按类型分区**

`MemoryListTab.tsx`：

- 新增 props：`categories: PanelCategory[]`。
- **类型表的来源：`GET_STATS`。** `index.tsx` 已经在挂载时调 `GET_STATS`（`refreshStats`），把 `categories` 加到那个 payload 里（`background/index.ts` 的 `GET_STATS` handler 里 `Promise.all` 补一个 `db.listCategories()`，映射成 `PanelCategory[]`），再由 `index.tsx` 作为 props 传给各个页签。**不要**让每个页签各自拉一遍类型表 —— 那是四份重复请求，而且刷新时机各不相同。
  - `GetStatsResponse['payload']` 要同步加 `categories: PanelCategory[]`；它的失败兜底 payload 里也要给一个空数组（照现有那几个字段的做法）。
- 列表从 `shown.map(...)` 改成先 `groupByCategory(shown, categories)`，每组用一个 `<Card tk={tk} title={\`${name} · ${n}\`}>` 包住原有的条目渲染（**条目本身的 JSX 一行不改**，只是外面多了一层容器）。
- 未分类组默认折叠（`useState` 记展开状态，默认 false），其余组默认展开。
- 顶部加只读提示行：`未分类 12 条 · 在设置页点「开始分类全部历史」` （无操作按钮）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/popup/categoryGrouping.test.ts tests/unit/ui/memoryCategory.test.tsx`
Expected: PASS

- [ ] **Step 6: 跑全量测试并提交**

```bash
npm test
git add src/popup/logic.ts src/popup/MemoryListTab.tsx src/popup/index.tsx tests/unit/popup/categoryGrouping.test.ts tests/unit/ui/memoryCategory.test.tsx
git commit -m "feat: 记忆列表按问题类型分区(只读)(第五十七轮)"
```

---

## Task 6: 标准回答页改成按类型分区 + 类型下拉

**Files:**
- Modify: `src/popup/FoldersTab.tsx`
- Modify: `src/popup/index.tsx`（页签 label 改「标准回答」）
- Modify: `src/background/panel.ts`（新增「移动标答到类型」的 handler）
- Test: `tests/unit/ui/goldenCategory.test.tsx`、`tests/unit/background/categoryPanel.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PanelGolden.categoryId` / `categorySource`、`PanelCategory`；Task 5 的 `groupByCategory`
- Produces: `UPDATE_GOLDEN_CATEGORY` 消息对

**这是本计划改动最大的一处。** 文件现有 984 行，其中「两层文件夹树」那一整套（`buildFolderTree` 的树渲染、`folderSection` 的递归、`CREATE_FOLDER`/`RENAME_FOLDER`/`DELETE_FOLDER`/`FLATTEN_FOLDERS` 四个流程）在本任务里被**按类型分区**取代。

**`folders` 表与 `folderId` 字段保留不删**（回滚用），只是 UI 不再读写它们。本任务**不要**删 `db.ts` 里的 folder DAO —— 那是 Task 7 之后、且需要单独决定的事。

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/background/categoryPanel.test.ts`：

```ts
describe('UPDATE_GOLDEN_CATEGORY', () => {
  it('把标答移到一个存在的类型上', ...)
  it('★ 移动后 categorySource 变成 manual —— 补分类从此不许再动它', ...)
  it('目标类型不存在 → 报错,不改动', ...)
  it('移到 uncategorized 也合法(等于手动取消分类)', ...)
  it('不存在的标答 → 报错', ...)
  it('不触发 invalidateRetrievalCache —— 本计划分类还没进检索', ...)
})
```

创建 `tests/unit/ui/goldenCategory.test.tsx`（照 `folderRename.test.tsx` 的最小渲染装置）：

```tsx
describe('标准回答页 · 类型分区', () => {
  it('按类型分区,未分类排最后', ...)
  it('★ 手动指定过的标答要有可辨认的标记(不像机器打的那样)', ...)
  it('点类型标签旁的按钮 → 出现类型下拉,选中即发 UPDATE_GOLDEN_CATEGORY', ...)
  it('下拉里的选项来自类型表(含未分类),不含已删除的类型', ...)
  it('空类型不渲染分区容器', ...)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/categoryPanel.test.ts tests/unit/ui/goldenCategory.test.tsx`
Expected: FAIL

- [ ] **Step 3: 后台 handler**

`src/background/panel.ts` 新增：

```ts
/**
 * 把一条标准回答移到另一个问题类型。
 *
 * 写完把 categorySource 置成 'manual' —— 这是本设计里"机器永不许覆盖用户手工摆放"
 * 的落点:补分类的候选判据对 manual 一律跳过(见 spec §11.2)。
 */
export async function updateGoldenCategory(
  message: UpdateGoldenCategoryRequest,
): Promise<{ success: boolean; error?: string }> {
  const { id, categoryId } = message.payload
  const cat = await db.categories.get(categoryId)
  if (!cat) return { success: false, error: '目标类型不存在' }
  const g = await db.getGolden(id)
  if (!g) return { success: false, error: '标准回答不存在' }
  await db.goldens.update(id, { categoryId, categorySource: 'manual', categoryAt: Date.now() })
  return { success: true }
}
```

消息对加到 `panel.ts` 域文件，并在 `index.ts` 的两处 union 与派发表各补一条。

- [ ] **Step 4: 页面改造**

`FoldersTab.tsx`：

- 数据来源仍是 `GET_PANEL_DATA`（此时已回带 `categories`）。
- 顶层从 `buildFolderTree` + `folderSection` 递归，改成 `groupByCategory(goldens, categories)` 的扁平分区，容器用 `<Card tk={tk} title={\`${name} · ${n}\`}>`。
- **标答条目的自身渲染保持不变**（`goldenRow` 里的问题行、答案预览、编辑态、操作行那四个图标钮都留着）。
- 把原来「迁移到其他文件夹」那个图标钮换成「移到其他类型」，点开后用**同一套原生 `<select>` 样式**（`FoldersTab.tsx:585-604` 那段，包括 `height: controlH.inline`、`fontSize: fontSize.caption`、`border: 1px solid ${tk.btnBorder}` 等），选项来自 `categories`，选中即发 `UPDATE_GOLDEN_CATEGORY` 并 `refresh()`。
- 原来的新建/改名/删除文件夹那一整套 UI **本任务先移除**，类型 CRUD 由 Task 7 接上。
- 每个分区的标题右侧显示条数；手动指定过的标答（`categorySource === 'manual'`）在问题行加一个小徽标（复用 `Badge`，`tone: 'neutral'`，文案「已指定」）—— 让用户看得出哪些是机器打的、哪些是自己摆的。

`src/popup/index.tsx`：`TABS` 里 `folders` 那条的 `label` 由 `'文件夹'` 改成 `'标准回答'`（id 不变，`tabSummary` 里若有对应文案一并改）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/categoryPanel.test.ts tests/unit/ui/goldenCategory.test.tsx tests/unit/ui/folderOps.test.tsx tests/unit/ui/folderRename.test.tsx`
Expected: PASS。**后两个既有用例里会有一部分变红** —— 它们测的是文件夹 CRUD 的 UI，而本任务把那些 UI 移除了。这是预期内的，处理方式按用例实际测什么分两类：

- **测的是被移除的 UI**（点新建按钮弹出输入框、改名流程、删除确认条、子文件夹扁平化入口…）→ 连同用例一起删掉，别留一个测不到东西的空壳。
- **测的是仍在的背景行为**（例如 `FLATTEN_FOLDERS` 的 handler、`buildFolderTree` 这类纯函数若还有别的调用方）→ 保留，改成不经 UI 直接调用的形式。

**逐条判断，不要整文件删。** 拿不准的用例在报告里列出来交审查判定，别自己拍板删掉一个其实还在测真东西的用例。删除或改写时在提交信息里写明原因与清单。

- [ ] **Step 6: 跑全量测试并提交**

```bash
npm test
git add -A
git commit -m "feat: 标准回答页改为按类型分区,标答可移到其他类型(移除文件夹 CRUD UI)(第五十七轮)"
```

---

## Task 7: 类型的新建 / 改名 / 删除

**Files:**
- Create: `src/background/categories.ts`
- Modify: `src/background/index.ts`、`src/types/messages/panel.ts`（或新建 `categories.ts` 域文件）与 `index.ts`
- Modify: `src/popup/FoldersTab.tsx`
- Test: `tests/unit/background/categories.test.ts`（追加）、`tests/unit/ui/categoryCrud.test.tsx`

**Interfaces:**
- Consumes: `db.categories`、`CategoryRecord`
- Produces: `CREATE_CATEGORY` / `RENAME_CATEGORY` / `DELETE_CATEGORY` 消息对；`src/background/categories.ts` 的三个 handler

**四条校验（每条都对应一个真实失败模式）：**

1. **类型名必须唯一**（按 `trim()` 后比较）。重名会让 `jev.ts` 里 `idByName` 互相覆盖 —— 静默错分，且没有任何报错。
2. **判定说明（`criteria`）必填且非空白。** 它是要发给 jev 的**选项描述**；空描述会让这个类型变成分类时的噪声选项，把**所有**类型的判断质量一起拉低。spec §6.1 把这条写成了硬约束（`filterable === true` ⇒ `criteria` 非空），而 `filterable` 在新建时恒为 `true`。
3. **预置与未分类不可改名、不可删**（spec D3）。删掉预置类型会让已按它分类的条目**再也搜不到**（它不在池子里了）。
4. **删除自定义类型前要问"里面的条目怎么办"** —— 删类型不能把标答一起带走。默认把该类型的标答落回未分类。

**关于"与预置类型语义重叠"（spec §五.3）：** 不做计算式检查（那要引入嵌入或大模型，为一个保存时的提示不值得）。改为**在新建表单里放一行说明**：「判定说明若与某个预置类型含义相近（例如又建一个『尺码咨询』），jev 会在两者之间摇摆，**全部类型**的判断质量一起下降」，并在判定说明与任一预置类型的描述字符重合度很高时把这行标成警示色。名称唯一性仍是硬拦截。

- [ ] **Step 1: 写失败的测试**

```ts
describe('类型 CRUD', () => {
  it('新建:名字与判定说明都合法时,filterable 为 true、position 排在自定义段末尾', ...)
  it('★ 重名(含 trim 后重名、与预置重名)→ 拒绝并给出理由', ...)
  it('★ 判定说明为空白 → 拒绝(空描述会拉低全部类型的判断质量)', ...)
  it('★ 改名预置类型 → 拒绝', ...)
  it('★ 删除预置类型 → 拒绝', ...)
  it('删除自定义类型:其中的标答落回未分类,不跟着消失', ...)
  it('改名未分类 → 拒绝', ...)
  it('新建的名字为空白 → 拒绝', ...)
  it('删除不存在的类型 → 报错', ...)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/categories.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 `src/background/categories.ts`**

三个 handler，全部做上面三条校验。删除时在一个事务里：把该类型的标答 `categoryId` 改成 `UNCATEGORIZED_CATEGORY_ID`（`categorySource` 保持原值 —— 手动摆过的仍标 `manual`）、删类型本身。

`position` 取"当前自定义段最大值 + 1"，排在预置（0–5）之后、未分类（9999）之前。

- [ ] **Step 4: 接上 UI**

`FoldersTab.tsx` 页头加 `<CreateBtn>`「新建类型」，走现有的 `inlineForm` 模式（`FoldersTab.tsx:374-433`）收集名字；分区标题旁加改名/删除两个 `iconBtn`（照 `folderSection` 里那两个钮的写法），删除走 `ConfirmRow` 二次确认。

分区标题的左侧显示类型种类：预置与未分类不显示操作按钮。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/categories.test.ts tests/unit/ui/categoryCrud.test.tsx`
Expected: PASS

- [ ] **Step 6: 跑全量测试、类型检查与构建**

```bash
npm test && npx tsc --noEmit && npm run build
```
Expected: 全绿；tsc 0 错；构建通过且模型拷入 `build/chrome-mv3-prod/model/`

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: 问题类型的新建/改名/删除(唯一性校验 + 删除时标答落回未分类)(第五十七轮)"
```

---

## 完成后的状态

- 设置页有「问题分类」区：开关、jev 配置、测试连接、补分类按钮与进度
- 「记忆」页按问题类型分区（只读），未分类可折叠且排最后
- 「标准回答」页按问题类型分区，每条可移到其他类型；手动指定的有可辨认标记
- 类型可新建/改名/删除，重名与改删预置都被挡住
- **检索行为与改动前完全一致** —— 分类结果还没进入检索管线

下一份计划：`docs/plans/2026-10-11-question-classification-routing.md`（检索路由与尺码路由）。
