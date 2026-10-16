# 知识库切分修复（P1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让知识库问答体文档按「一条 QA 一块」切分，修复短问句检索不到的问题；并把文档原文落库，使分块规则变更后能自动重分块。

**Architecture:** 在 `chunkMarkdown()` 内新增一层 QA 探测分支（`Q：` 行 ≥2 条时每条独立成块），保留既有标题切节 / 行分组 / 滑窗全部逻辑不变。新增 `kbDocs` 表保存 markdown 原文与分块器版本号，SW 启动时对比版本、失配即重新分块重嵌。`MdChunk` / `KnowledgeRecord` 新增 `kind`(`chunkKind`) 与 `sectionSeq` 两个字段，为 P2 的材料组装预留续块定位能力。

**Tech Stack:** TypeScript · Plasmo · Dexie(IndexedDB) · Vitest · @xenova/transformers（本地 bge-small-zh-v1.5）

**Spec:** `docs/specs/2026-09-17-kb-chunking-and-ai-integration-design.md`

## Global Constraints

- 不引入任何新依赖
- 注释与现有风格一致：文件头块注释说明「为什么」，行内注释只写非显然的决策
- 中文注释、中文文案；全角标点保持一致
- 所有改动走 TDD：先写失败测试，再实现，再跑通
- 提交信息格式：`type: 描述(第四十八轮)`（沿用仓库现有风格）
- **回归不变量**：`chunkText` / `groupLines` / `snapBlank` 行为不得改变；现有 `tests/unit/shared/mdText.test.ts`、`tests/unit/shared/chunkText.test.ts` 必须全绿
- 测试命令：`npx vitest run <路径>`

---

### Task 1: QA 感知切分

**Files:**
- Modify: `src/shared/mdText.ts`
- Test: `tests/unit/shared/mdText.test.ts`

**Interfaces:**
- Consumes: 无（本任务是最底层）
- Produces:
  - `MdChunk` 扩展为 `{ title: string; text: string; kind: 'qa' | 'section'; sectionSeq: number }`
  - `chunkMarkdown(md: string): MdChunk[]` 签名不变

- [ ] **Step 1: 写失败测试**

追加到 `tests/unit/shared/mdText.test.ts` 末尾（`tiles_fix` 函数之后）：

```ts
describe('chunkMarkdown · 问答体切分', () => {
  const qa = (q: string, a: string) => `- Q：${q} A：${a}`

  it('每条 QA 独立成块:问句作标题、答案作正文', () => {
    const md = [
      '# 常见问答',
      '',
      qa('这个麦克风能用多久？', '发射器续航约 11.5 小时,接收器约 10.5 小时。'),
      '',
      qa('怎么连手机？', '两种方式:发射器蓝牙直连手机,或接收器 USB-C 接口直连。'),
      '',
      qa('防水吗？', '不防水,请注意防雨防潮,进水不在保修范围。'),
    ].join('\n')

    const chunks = chunkMarkdown(md)
    expect(chunks).toHaveLength(3)
    expect(chunks[0].title).toBe('这个麦克风能用多久？')
    expect(chunks[0].text).toBe('发射器续航约 11.5 小时,接收器约 10.5 小时。')
    expect(chunks[2].title).toBe('防水吗？')
    expect(chunks[2].text).toBe('不防水,请注意防雨防潮,进水不在保修范围。')
    for (const c of chunks) {
      expect(c.kind).toBe('qa')
      expect(c.sectionSeq).toBe(1) // 第 0 节是 H1 之前的空节
    }
  })

  it('Q 与 A 分行写法', () => {
    const md = ['# 常见问答', '', 'Q：能连相机吗？', 'A：可以,接收器通过 3.5 毫米音频线连接相机。', '', 'Q：一拖二吗？', 'A：接收器可同时配对 2 个发射器。'].join(
      '\n',
    )
    const chunks = chunkMarkdown(md)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].title).toBe('能连相机吗？')
    expect(chunks[0].text).toBe('可以,接收器通过 3.5 毫米音频线连接相机。')
  })

  it('兼容半角冒号 / 加粗 / 无序列表前缀', () => {
    const md = ['# FAQ', '', '**Q:** 防水吗？ **A:** 不防水。', '', '* Q: 多久发货？ A: 48 小时内。'].join('\n')
    const chunks = chunkMarkdown(md)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].title).toBe('防水吗？')
    expect(chunks[0].text).toBe('不防水。')
    expect(chunks[1].title).toBe('多久发货？')
    expect(chunks[1].text).toBe('48 小时内。')
  })

  it('只有 1 条 Q → 不触发 QA 分支,按原节逻辑成块', () => {
    const md = ['## 说明', '', 'Q：只有一个问题？ A：是。'].join('\n')
    const chunks = chunkMarkdown(md)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].kind).toBe('section')
    expect(chunks[0].title).toBe('说明')
    expect(chunks[0].text).toBe('Q：只有一个问题？ A：是。')
  })

  it('无标题的问答文档也走 QA 切分', () => {
    const md = ['Q：甲？ A：甲答案。', '', 'Q：乙？ A：乙答案。'].join('\n')
    const chunks = chunkMarkdown(md)
    expect(chunks).toHaveLength(2)
    expect(chunks.map((c) => c.title)).toEqual(['甲？', '乙？'])
    expect(chunks.map((c) => c.kind)).toEqual(['qa', 'qa'])
  })

  it('缺答案的 QA 条目整条跳过,不产出空块', () => {
    const md = ['# Q', '', 'Q：第一个？ A：答案一。', '', 'Q：第二个？', '', 'Q：第三个？ A：答案三。'].join('\n')
    const chunks = chunkMarkdown(md)
    expect(chunks.map((c) => c.title)).toEqual(['第一个？', '第三个？'])
  })

  it('单条答案超长 → 拆续块,续块共享同一 sectionSeq', () => {
    const longAnswer = `答案开头${'内容'.repeat(200)}`
    const md = ['# Q', '', `Q：很长的问题？ A：${longAnswer}`, '', 'Q：短问题？ A：短答案。'].join('\n')
    const chunks = chunkMarkdown(md)
    expect(chunks.length).toBeGreaterThan(2)
    const longParts = chunks.filter((c) => c.title === '很长的问题？')
    expect(longParts.length).toBeGreaterThan(1)
    for (const c of longParts) {
      expect(c.kind).toBe('qa')
      expect(c.sectionSeq).toBe(longParts[0].sectionSeq)
    }
  })

  it('首个 Q 之前的引言行作为 section 块保留,不污染 QA 锚文本', () => {
    const md = ['## 常见问题', '', '以下是买家最常问的问题:', '', 'Q：甲？ A：甲答案。', '', 'Q：乙？ A：乙答案。'].join('\n')
    const chunks = chunkMarkdown(md)
    const preamble = chunks.find((c) => c.kind === 'section')
    expect(preamble?.text).toBe('以下是买家最常问的问题:')
    expect(chunks.filter((c) => c.kind === 'qa')).toHaveLength(2)
  })

  it('非问答体文档完全不受影响(回归)', () => {
    const md = ['# 标题', '', '普通段落一。', '', '普通段落二。'].join('\n')
    const chunks = chunkMarkdown(md)
    expect(chunks.every((c) => c.kind === 'section')).toBe(true)
    expect(chunks[0].text).toContain('普通段落一。')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/shared/mdText.test.ts`
Expected: FAIL —— `chunks[0].kind` 为 `undefined`（字段尚不存在），或用例数量不符

- [ ] **Step 3: 实现 QA 感知切分**

修改 `src/shared/mdText.ts`：

**(a) 扩展 `MdChunk`（替换现有 interface）：**

```ts
export interface MdChunk {
  /** 小节标题(纯文本);文档开头无标题部分 / 无结构回退块为 '' */
  title: string
  /** 纯文本正文(不含标题行、不含 md 标记) */
  text: string
  /** 块类型:qa=问答体切出的单条(答案自足);section=按标题切出的节 */
  kind: 'qa' | 'section'
  /** 源节在文档中的序号(0 起):同一节被拆成多块时共享同一值,供续块定位 */
  sectionSeq: number
}
```

**(b) 文件顶部（`MdChunk` 之前）新增 QA 标记常量与判定：**

```ts
/** 行首问句标记:Q / 问 + 全角或半角冒号(md 标记已由 mdToPlainText 剥净) */
const QA_QUESTION_RE = /^(?:Q|问)\s*[：:]\s*/
/** 行内答案标记:空白 + A / 答 + 冒号。前置空白必需,避免误切 "USB-C:" 这类文本 */
const QA_INLINE_ANSWER_RE = /\s(?:A|答)\s*[：:]\s*/
/** 行首答案标记(分行写法) */
const QA_ANSWER_RE = /^(?:A|答)\s*[：:]\s*/

/** 该行是否为问句行 */
function isQaQuestion(line: string): boolean {
  return QA_QUESTION_RE.test(line.trim())
}
```

**(c) 新增 QA 切分函数（放在 `chunkMarkdown` 之前）：**

```ts
/**
 * 节内 QA 切分:问句行 ≥2 条时,每条 Q(连同其后到下一个 Q 前的行)独立成块。
 * 返回 null 表示该节不是问答体,交回原有的标题切节 / 行分组逻辑。
 *
 * 背景:500 字盲切窗口会把多条无关 QA 并成一块,向量被多主题平均稀释,
 * 单主题问句的余弦跌破 kbThreshold(实测「防水吗」0.391 < 0.4)导致检索不到。
 */
function splitQaSection(plain: string, sectionTitle: string): MdChunk[] | null {
  const lines = plain.split('\n')
  const qIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isQaQuestion(lines[i])) qIdx.push(i)
  }
  if (qIdx.length < 2) return null

  const out: MdChunk[] = []
  const stamp = (c: Omit<MdChunk, 'sectionSeq'>): MdChunk => ({ ...c, sectionSeq: 0 })

  // 首个 Q 之前的引言行:单独成块保留,不并入 QA 锚文本(会稀释问句语义)
  const preamble = lines
    .slice(0, qIdx[0])
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
  if (preamble) out.push(stamp({ title: sectionTitle, text: preamble, kind: 'section' }))

  for (let k = 0; k < qIdx.length; k++) {
    const start = qIdx[k]
    const end = k + 1 < qIdx.length ? qIdx[k + 1] : lines.length
    const head = lines[start].trim().replace(QA_QUESTION_RE, '')

    // Q：xxx A：yyy 同行:按首个「空白+A：」切成问句与答案
    const m = head.match(QA_INLINE_ANSWER_RE)
    let question: string
    const answerParts: string[] = []
    if (m && m.index !== undefined) {
      question = head.slice(0, m.index).trim()
      answerParts.push(head.slice(m.index + m[0].length).trim())
    } else {
      question = head
    }
    for (const raw of lines.slice(start + 1, end)) {
      const l = raw.trim()
      if (l) answerParts.push(l.replace(QA_ANSWER_RE, ''))
    }

    const text = answerParts.filter(Boolean).join('\n').trim()
    if (!question || !text) continue // 问句或答案缺失 → 整条跳过,不产出空块

    if (text.length <= CHUNK_SIZE_CHARS) {
      out.push(stamp({ title: question, text, kind: 'qa' }))
    } else {
      // 单条答案超长:复用行分组兜底,续块共享同一 sectionSeq(由调用方戳)
      for (const part of groupLines(text)) {
        out.push(stamp({ title: question, text: part, kind: 'qa' }))
      }
    }
  }
  return out.length >= 1 ? out : null
}
```

**(d) 改写 `chunkMarkdown` 主体（替换函数体，签名不变）：**

```ts
export function chunkMarkdown(md: string): MdChunk[] {
  const sections: Array<{ title: string | null; bodyLines: string[] }> = []
  let cur: { title: string | null; bodyLines: string[] } = { title: null, bodyLines: [] }
  let inFence = false
  for (const line of md.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) inFence = !inFence
    const m = inFence ? null : line.match(/^\s{0,3}#{1,6}\s+(.*)$/)
    if (m) {
      sections.push(cur)
      cur = { title: m[1].trim(), bodyLines: [] }
    } else {
      cur.bodyLines.push(line)
    }
  }
  sections.push(cur)

  // 全文无任何标题 → 无结构文本:仍先试 QA 切分,不像问答体再回退滑窗
  if (!sections.some((s) => s.title !== null)) {
    const plain = mdToPlainText(md)
    const qa = splitQaSection(plain, '')
    if (qa) return qa
    return chunkText(plain).map((text) => ({ title: '', text, kind: 'section' as const, sectionSeq: 0 }))
  }

  const out: MdChunk[] = []
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si]
    const plain = mdToPlainText(sec.bodyLines.join('\n'))
    if (!plain) continue

    const qa = splitQaSection(plain, sec.title ?? '')
    if (qa) {
      for (const c of qa) out.push({ ...c, sectionSeq: si })
      continue
    }

    if (plain.length <= CHUNK_SIZE_CHARS) {
      out.push({ title: sec.title ?? '', text: plain, kind: 'section', sectionSeq: si })
      continue
    }
    // 超长小节:按行分组,永不截断单行
    for (const part of groupLines(plain)) {
      out.push({ title: sec.title ?? '', text: part, kind: 'section', sectionSeq: si })
    }
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/shared/mdText.test.ts tests/unit/shared/chunkText.test.ts`
Expected: PASS（含全部既有回归用例）

- [ ] **Step 5: 跑全量测试确认无回归**

Run: `npx vitest run`
Expected: PASS。若 `tests/unit/background/knowledge.test.ts` 因 `MdChunk` 新字段报错，修到全绿再提交

- [ ] **Step 6: 提交**

```bash
git add src/shared/mdText.ts tests/unit/shared/mdText.test.ts
git commit -m "feat: chunkMarkdown 问答体按条切分 + MdChunk 加 kind/sectionSeq(第四十八轮)"
```

---

### Task 2: kbDocs 原文表与 DAO

**Files:**
- Modify: `src/types/memory.ts`
- Modify: `src/background/db.ts`
- Test: `tests/unit/background/db-pdd.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `KbDocRecord { docId: string; content: string; splitterVersion: string; chunkCount: number; createdAt: number; updatedAt: number }`
  - `KnowledgeRecord` 新增 `chunkKind?: 'qa' | 'section'`、`sectionSeq?: number`
  - `db.putKbDoc(rec: KbDocRecord): Promise<void>`
  - `db.getKbDoc(docId: string): Promise<KbDocRecord | undefined>`
  - `db.deleteKbDoc(docId: string): Promise<void>`
  - `db.getStaleKbDocs(version: string): Promise<KbDocRecord[]>`
  - `SPLITTER_VERSION = '2.0.0'`（导出位置见 Task 3）

- [ ] **Step 1: 写失败测试**

追加到 `tests/unit/background/db-pdd.test.ts` 末尾的 `describe` 内：

```ts
describe('kbDocs(文档原文)', () => {
  it('存取原文与分块器版本', async () => {
    await db.putKbDoc({
      docId: '常见问答',
      content: '# 常见问答\n\nQ：防水吗？ A：不防水。',
      splitterVersion: '2.0.0',
      chunkCount: 2,
      createdAt: 1,
      updatedAt: 1,
    })
    const got = await db.getKbDoc('常见问答')
    expect(got?.content).toContain('防水吗')
    expect(got?.chunkCount).toBe(2)
  })

  it('getStaleKbDocs 只返回版本失配的文档', async () => {
    await db.putKbDoc({
      docId: '旧文档', content: 'x', splitterVersion: '1.0.0', chunkCount: 1, createdAt: 1, updatedAt: 1,
    })
    await db.putKbDoc({
      docId: '新文档', content: 'y', splitterVersion: '2.0.0', chunkCount: 1, createdAt: 1, updatedAt: 1,
    })
    const stale = await db.getStaleKbDocs('2.0.0')
    expect(stale.map((d) => d.docId)).toEqual(['旧文档'])
  })

  it('deleteKbDoc 删除', async () => {
    await db.putKbDoc({
      docId: '待删', content: 'z', splitterVersion: '2.0.0', chunkCount: 1, createdAt: 1, updatedAt: 1,
    })
    await db.deleteKbDoc('待删')
    expect(await db.getKbDoc('待删')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/db-pdd.test.ts`
Expected: FAIL —— `db.putKbDoc is not a function`

- [ ] **Step 3: 加类型**

在 `src/types/memory.ts` 的 `KnowledgeRecord` 内，`docId` 字段之后新增：

```ts
  /** 块类型:qa=问答体切出的单条;section=按标题切出的节(含长节续块) */
  chunkKind?: 'qa' | 'section'
  /** 源节在文档中的序号(0 起,文档顺序):同一节被拆成多块时这些块共享同一 sectionSeq */
  sectionSeq?: number
```

在同一文件 `KnowledgeRecord` 之后新增：

```ts
/** 知识库文档原文(kbDocs):重分块的事实源;豁免保留期 */
export interface KbDocRecord {
  /** 主键:文档名(去扩展名),与 KnowledgeRecord.docId 同口径 */
  docId: string
  /** markdown 原文,原样保存 */
  content: string
  /** 落块时的分块器版本;不等于当前 SPLITTER_VERSION → 待重分块 */
  splitterVersion: string
  /** 最近一次分块产出的块数(展示用) */
  chunkCount: number
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 4: 建表与 DAO**

`src/background/db.ts`：

**(a) 顶部 import 加 `KbDocRecord`：**

```ts
import type { ErrorLog, FolderRecord, GoldenRecord, KbDocRecord, KnowledgeRecord, QaRecord, ReplyRecord } from '../types/memory';
```

**(b) 类声明加表字段（`knowledge` 之后）：**

```ts
  kbDocs!: Table<KbDocRecord, string>;
```

**(c) constructor 末尾追加版本：**

```ts
    // 知识库文档原文:分块器版本变更时据此重新分块(块表只存结果,重切需要原文)
    this.version(5).stores({
      kbDocs: "docId, splitterVersion",
    });
```

**(d) 文件头表清单注释补一行：**

```
 *   kbDocs    — 知识库文档原文(重分块事实源)
```

**(e) 在「知识库(knowledge)」小节末尾追加 DAO：**

```ts
  // ─── 知识库文档原文(kbDocs) ───────────────────────────────────────────────────

  async putKbDoc(record: KbDocRecord): Promise<void> {
    await this.kbDocs.put(record);
  }

  async getKbDoc(docId: string): Promise<KbDocRecord | undefined> {
    return this.kbDocs.get(docId);
  }

  async deleteKbDoc(docId: string): Promise<void> {
    await this.kbDocs.delete(docId);
  }

  /** 分块器版本失配的文档(启动时重新分块) */
  async getStaleKbDocs(version: string): Promise<KbDocRecord[]> {
    return this.kbDocs.filter((d) => d.splitterVersion !== version).toArray();
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/db-pdd.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/types/memory.ts src/background/db.ts tests/unit/background/db-pdd.test.ts
git commit -m "feat: kbDocs 表存知识库文档原文 + KnowledgeRecord 加 chunkKind/sectionSeq(第四十八轮)"
```

---

### Task 3: 分块器版本常量

**Files:**
- Modify: `src/shared/mdText.ts`

**Interfaces:**
- Consumes: 无
- Produces: `SPLITTER_VERSION = '2.0.0'`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/shared/mdText.test.ts` 顶部 import 改为：

```ts
import { mdToPlainText, chunkMarkdown, SPLITTER_VERSION } from '../../../src/shared/mdText'
```

并新增：

```ts
describe('SPLITTER_VERSION', () => {
  it('问答体切分上线后版本号为 2.0.0(旧库 1.0.0 将触发重分块)', () => {
    expect(SPLITTER_VERSION).toBe('2.0.0')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/shared/mdText.test.ts`
Expected: FAIL —— `SPLITTER_VERSION is not exported`

- [ ] **Step 3: 导出常量**

`src/shared/mdText.ts` 顶部 `MdChunk` 之前新增（并更新文件头注释，说明版本号用途）：

```ts
/**
 * 分块器版本:落块时写入 KbDocRecord.splitterVersion。
 * 语义变更(切分规则调整)必须 bump —— SW 启动时据此找出失配文档重新分块。
 * 1.0.0 = 纯标题切节;2.0.0 = 新增问答体按条切分。
 */
export const SPLITTER_VERSION = '2.0.0'
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/shared/mdText.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/mdText.ts tests/unit/shared/mdText.test.ts
git commit -m "feat: SPLITTER_VERSION 常量,标记问答体切分版本(第四十八轮)"
```

---

### Task 4: importKbDocument 落原文与新字段

**Files:**
- Modify: `src/background/knowledge.ts:115-167`
- Test: `tests/unit/background/knowledge.test.ts`

**Interfaces:**
- Consumes: `SPLITTER_VERSION`（Task 3）、`db.putKbDoc`（Task 2）、`MdChunk.kind`/`sectionSeq`（Task 1）
- Produces: `importKbDocument` 返回值不变（`{ docId, chunkCount, replaced, error? }`）；副作用多一条 kbDocs 写入

- [ ] **Step 1: 写失败测试**

追加到 `tests/unit/background/knowledge.test.ts`：

```ts
describe('importKbDocument · kbDocs 原文与块元数据', () => {
  const md = [
    '# 常见问答',
    '',
    '- Q：防水吗？ A：不防水,请注意防雨防潮。',
    '',
    '- Q：充电要多久？ A：发射器约 90 分钟。',
  ].join('\n')

  it('导入后原文落库,版本为当前 SPLITTER_VERSION', async () => {
    const r = await importKbDocument({ name: '常见问答.md', content: md })
    expect(r.chunkCount).toBe(2)
    const doc = await db.getKbDoc('常见问答')
    expect(doc?.content).toBe(md)
    expect(doc?.splitterVersion).toBe(SPLITTER_VERSION)
    expect(doc?.chunkCount).toBe(2)
  })

  it('块带 chunkKind=qa 与 sectionSeq', async () => {
    await importKbDocument({ name: '常见问答.md', content: md })
    const chunks = await db.listKnowledgeByDoc('常见问答')
    expect(chunks).toHaveLength(2)
    for (const c of chunks) {
      expect(c.chunkKind).toBe('qa')
      expect(c.sectionSeq).toBe(1)
    }
    expect(chunks.map((c) => c.title).sort()).toEqual([
      '常见问答 · 充电要多久？',
      '常见问答 · 防水吗？',
    ])
  })

  it('重新上传同名文档 → 原文与块一起替换', async () => {
    await importKbDocument({ name: '常见问答.md', content: md })
    const r = await importKbDocument({ name: '常见问答.md', content: '# 常见问答\n\nQ：甲？ A：甲。\n\nQ：乙？ A：乙。' })
    expect(r.replaced).toBe(true)
    const doc = await db.getKbDoc('常见问答')
    expect(doc?.content).toContain('甲？')
    expect(doc?.chunkCount).toBe(2)
  })
})
```

（若文件顶部尚未 import `SPLITTER_VERSION` 与 `db`，一并补上：`import { SPLITTER_VERSION } from '../../../src/shared/mdText'`）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/knowledge.test.ts`
Expected: FAIL —— `db.getKbDoc(...)` 返回 undefined

- [ ] **Step 3: 改造 importKbDocument**

`src/background/knowledge.ts`：

**(a) import 加 `SPLITTER_VERSION`：**

```ts
import { SPLITTER_VERSION, chunkMarkdown } from '../shared/mdText'
```

**(b) 事务体内、`addKnowledge` 循环之后（`for` 之后、事务回调结束前）写入原文：**

```ts
    await db.putKbDoc({
      docId,
      content,
      splitterVersion: SPLITTER_VERSION,
      chunkCount: chunks.length,
      createdAt: now,
      updatedAt: now,
    })
```

**(c) `addKnowledge` 的字段对象补两个字段（紧随 `docId,` 之后）：**

```ts
        chunkKind: chunks[i].kind,
        sectionSeq: chunks[i].sectionSeq,
```

**(d) 更新文件头块注释的分块说明**，把「按标题切小节」补成「按标题切小节 + 问答体按条切分」。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/knowledge.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全量测试**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/background/knowledge.ts tests/unit/background/knowledge.test.ts
git commit -m "feat: importKbDocument 落原文到 kbDocs + 块写入 chunkKind/sectionSeq(第四十八轮)"
```

---

### Task 5: 删除条目时清理孤儿 kbDocs

**Files:**
- Modify: `src/background/knowledge.ts`（`deleteKnowledge`）
- Test: `tests/unit/background/knowledge.test.ts`

**Interfaces:**
- Consumes: `db.listKnowledgeByDoc`、`db.deleteKbDoc`（Task 2）
- Produces: `deleteKnowledge(id: string): Promise<void>` 签名不变；副作用：删掉某文档最后一块时，连带删掉 kbDocs 原文

- [ ] **Step 1: 写失败测试**

追加：

```ts
describe('deleteKnowledge · 孤儿原文清理', () => {
  const md = '# Q\n\nQ：甲？ A：甲。\n\nQ：乙？ A：乙。'

  it('删掉某文档最后一块 → 原文一并删除', async () => {
    await importKbDocument({ name: '孤儿文档.md', content: md })
    const chunks = await db.listKnowledgeByDoc('孤儿文档')
    for (const c of chunks) await deleteKnowledge(c.id)
    expect(await db.getKbDoc('孤儿文档')).toBeUndefined()
  })

  it('文档还有剩余块 → 原文保留', async () => {
    await importKbDocument({ name: '半删文档.md', content: md })
    const chunks = await db.listKnowledgeByDoc('半删文档')
    await deleteKnowledge(chunks[0].id)
    expect(await db.getKbDoc('半删文档')).toBeDefined()
  })

  it('手工条目不涉及 kbDocs', async () => {
    const r = await createKnowledge({ title: '手工条目', content: '正文' })
    await deleteKnowledge(r.id!)
    expect(await db.getKbDoc('')).toBeUndefined() // 不抛错即可
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/knowledge.test.ts`
Expected: FAIL —— 第一个用例 `getKbDoc('孤儿文档')` 仍返回记录

- [ ] **Step 3: 实现清理**

`src/background/knowledge.ts` 的 `deleteKnowledge` 改为：

```ts
/** 删除知识条目;若删掉的是某文档的最后一块,连带清掉 kbDocs 原文(防重分块时复活) */
export async function deleteKnowledge(id: string): Promise<void> {
  const existing = await db.getKnowledge(id)
  await db.deleteKnowledge(id)
  const docId = existing?.docId
  if (!docId) return
  const rest = await db.listKnowledgeByDoc(docId)
  if (rest.length === 0) await db.deleteKbDoc(docId)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/knowledge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/background/knowledge.ts tests/unit/background/knowledge.test.ts
git commit -m "fix: 删掉文档最后一块时同步清理 kbDocs 原文(防重分块复活)(第四十八轮)"
```

---

### Task 6: 版本失配自动重分块

**Files:**
- Create: `src/background/kbResplit.ts`
- Modify: `src/background/index.ts`
- Test: `tests/unit/background/kbResplit.test.ts`

**Interfaces:**
- Consumes: `db.getStaleKbDocs`、`db.putKbDoc`（Task 2）、`chunkMarkdown`/`SPLITTER_VERSION`（Task 1/3）、`importKbDocument` 的落块逻辑
- Produces: `resplitStaleKbDocs(): Promise<number>` —— 返回重分块的文档数

- [ ] **Step 1: 写失败测试**

新建 `tests/unit/background/kbResplit.test.ts`：

```ts
/**
 * 分块器版本失配 → 启动时自动重分块。
 * 场景:用户已用旧规则导入文档,升级到问答体切分后无需手动重传。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../../src/background/db'
import { importKbDocument } from '../../../src/background/knowledge'
import { resplitStaleKbDocs } from '../../../src/background/kbResplit'
import { SPLITTER_VERSION } from '../../../src/shared/mdText'

const md = '# 常见问答\n\n- Q：防水吗？ A：不防水。\n\n- Q：充电要多久？ A：约 90 分钟。'

describe('resplitStaleKbDocs', () => {
  beforeEach(async () => {
    await db.knowledge.clear()
    await db.kbDocs.clear()
  })

  it('版本失配的文档被重新分块,块数按新规则更新', async () => {
    await importKbDocument({ name: '老文档.md', content: md })
    // 模拟旧版本:把版本改回 1.0.0,并把块合并成 1 条(旧规则产物)
    const doc = await db.getKbDoc('老文档')
    await db.putKbDoc({ ...doc!, splitterVersion: '1.0.0', chunkCount: 1 })
    await db.knowledge.where('docId').equals('老文档').delete()
    await db.addKnowledge({
      id: 'old-1', title: '老文档 · 常见问答', content: md, questionHash: 'old#0',
      hasEmbedding: 0, enabled: 1, source: 'doc', docId: '老文档', createdAt: 1, updatedAt: 1,
    })

    const n = await resplitStaleKbDocs()
    expect(n).toBe(1)

    const chunks = await db.listKnowledgeByDoc('老文档')
    expect(chunks).toHaveLength(2) // 切分后每条 QA 一块
    expect(chunks.map((c) => c.chunkKind)).toEqual(['qa', 'qa'])
    const updated = await db.getKbDoc('老文档')
    expect(updated?.splitterVersion).toBe(SPLITTER_VERSION)
  })

  it('版本已是最新 → 不动', async () => {
    await importKbDocument({ name: '新文档.md', content: md })
    const n = await resplitStaleKbDocs()
    expect(n).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/background/kbResplit.test.ts`
Expected: FAIL —— 无法解析 `../../../src/background/kbResplit`

- [ ] **Step 3: 实现重分块**

新建 `src/background/kbResplit.ts`：

```ts
/**
 * 分块器版本迁移:SW 启动时把 splitterVersion 失配的文档按新规则重新分块重嵌。
 * 背景:knowledge 表只存切好的块,分块规则变更后旧块无法原地修正;
 * kbDocs 存了原文,使自动重切成为可能,用户不必手动重传文档。
 */
import { db } from "./db";
import { chunkMarkdown, SPLITTER_VERSION } from "../shared/mdText";
import { kbAnchorText } from "./kbAnchor";
import { queueEmbedding } from "./offscreen";
import { hashText } from "../shared/text";

export async function resplitStaleKbDocs(): Promise<number> {
  const stale = await db.getStaleKbDocs(SPLITTER_VERSION);
  if (stale.length === 0) return 0;

  let done = 0;
  for (const doc of stale) {
    const chunks = chunkMarkdown(doc.content);
    if (chunks.length === 0) continue;

    const now = Date.now();
    const rootId = `kbd-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const sectionSeq = new Map<string, number>();
    const pendingEmbeds: Array<{ id: string; anchor: string }> = [];

    await db.transaction("rw", db.knowledge, db.kbDocs, async () => {
      await db.deleteKnowledgeByDoc(doc.docId);
      for (let i = 0; i < chunks.length; i++) {
        const id = chunks.length === 1 ? rootId : `${rootId}-c${i}`;
        const base = chunks[i].title ? `${doc.docId} · ${chunks[i].title}` : doc.docId;
        const seq = sectionSeq.get(base) ?? 0;
        sectionSeq.set(base, seq + 1);
        const title = seq === 0 ? base : `${base} (续${seq + 1})`;
        await db.addKnowledge({
          id,
          title,
          content: chunks[i].text,
          questionHash: hashText(`${doc.docId}#${i}`),
          hasEmbedding: 0,
          enabled: 1,
          source: "doc",
          docId: doc.docId,
          chunkKind: chunks[i].kind,
          sectionSeq: chunks[i].sectionSeq,
          createdAt: now,
          updatedAt: now,
        });
        pendingEmbeds.push({
          id,
          anchor: kbAnchorText({ source: "doc", title, content: chunks[i].text }),
        });
      }
      await db.putKbDoc({ ...doc, splitterVersion: SPLITTER_VERSION, chunkCount: chunks.length, updatedAt: now });
    });

    for (const p of pendingEmbeds) queueEmbedding("knowledge", p.id, p.anchor);
    done++;
  }
  return done;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/background/kbResplit.test.ts`
Expected: PASS

- [ ] **Step 5: 挂到 SW 启动钩子**

`src/background/index.ts`：找到现有 SW 唤醒后触发 `processPendingEmbeddings()` 的位置（约 8s 启动任务），在它**之前**插入重分块调用：

```ts
// 分块器版本迁移先于补嵌:重分块会把新块标记为待嵌,由随后一批补嵌一次拉齐
try {
  await resplitStaleKbDocs();
} catch (err) {
  console.error("[PDD CS] resplit stale kb docs failed:", err);
}
```

并在文件顶部 import：`import { resplitStaleKbDocs } from "./kbResplit";`

- [ ] **Step 6: 跑全量测试**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/background/kbResplit.ts src/background/index.ts tests/unit/background/kbResplit.test.ts
git commit -m "feat: 分块器版本失配时自动重分块,用户不必重传文档(第四十八轮)"
```

---

### Task 7: 端到端验收复测

**Files:**
- Create: `scripts/_chunk-probe.mjs`（临时，验收后删除）
- Modify: `docs/specs/2026-09-17-kb-chunking-and-ai-integration-design.md`（3.2 节补落地后实测）

**Interfaces:**
- Consumes: Task 1 的 `chunkMarkdown`（通过复刻其输出而非 import，脚本是 .mjs、不编译 TS）
- Produces: 无（验收产出）

- [ ] **Step 1: 重建探针脚本**

重建 `scripts/_chunk-probe.mjs`（与设计阶段同一份，`env.localModelPath` 用 `fileURLToPath(new URL('../model/', import.meta.url))`），语料换成**经 Task 1 切分后的真实块**：把 `knowledge/常见问答.md` 原文手工按新规则拆成 11 条，逐条计算锚文本 `常见问答 · <问句>\n<答案>`（其中带 `# 常见问答` 标题的节，`sectionSeq` 不影响锚文本）。

- [ ] **Step 2: 跑复测**

Run: `node scripts/_chunk-probe.mjs`
Expected（对照设计文档 3.2 节）：

- 「防水吗」≥ 0.70（原 0.391）
- 全部查询 ≥ 0.5（原最低 0.391）
- 每条查询的 top1 命中正确的 QA

- [ ] **Step 3: 更新 spec 3.2 节**

在表格下方补一行：

```markdown
> 2026-09-17 落地后复测：各查询余弦与上表「切分后」列一致（偏差 < 0.02），「防水吗」稳定命中。
```

- [ ] **Step 4: 删除探针脚本**

```bash
rm scripts/_chunk-probe.mjs
```

- [ ] **Step 5: 提交**

```bash
git add docs/specs/2026-09-17-kb-chunking-and-ai-integration-design.md
git commit -m "docs: P1 切分修复落地复测记录(第四十八轮)"
```

---

## 验收清单（P1 完成时逐条核对）

- [ ] `npx vitest run` 全绿
- [ ] `常见问答.md` 导入后产出 11 条块（原文 11 条 QA），每条 `chunkKind === 'qa'`
- [ ] 卡片「来源」显示 `常见问答 · <问句>`，「正文」为该条答案（无其他 QA 混入）
- [ ] 「防水吗」检索命中（余弦 ≥ 0.70）
- [ ] 旧文档（版本 1.0.0）在扩展启动后自动重分块，无需手动重传
- [ ] 手工创建的知识条目行为不变
