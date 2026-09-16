/**
 * 导入导出 v2 纯逻辑单测:信封构建(剥向量)/ 金标准 hash 幂等 / 文件夹 id 幂等 /
 * 记忆搬库孤儿与自检排除。设计依据:设计文档 §8(信封 v2.0)。
 */
import { describe, it, expect } from 'vitest'
import {
  EXPORT_VERSION,
  buildExportEnvelope,
  goldenImportContext,
  planGoldenImports,
  planFolderImports,
  planMemoryImports,
  planKnowledgeImports,
  type ExportedGolden,
  type ExportedQa,
  type ExportedReply,
  type ExportedKnowledge,
} from '../../../src/background/transferPlan'
import type {
  GoldenRecord,
  QaRecord,
  ReplyRecord,
  FolderRecord,
  KnowledgeRecord,
} from '../../../src/types/memory'
import {
  MAX_GOLDENS_PER_QUESTION,
  SELF_TEST_SESSION_KEY,
  UNCATEGORIZED_FOLDER_ID,
} from '../../../src/types/memory'
import { DEFAULT_SETTINGS } from '../../../src/types/memory'

// ─── 造数 ──────────────────────────────────────────────────────────────────────

const golden = (
  id: string,
  question: string,
  withVec = false,
  answer = `answer-of-${id}`,
): GoldenRecord => ({
  id,
  folderId: null,
  question,
  answer,
  questionHash: `hash-${question}`,
  ...(withVec
    ? { qEmbedding: new Float32Array([0.1, 0.2]), embeddingModel: 'Xenova/bge-small-zh-v1.5', embeddingVersion: '2.0.0' }
    : {}),
  hasEmbedding: withVec ? 1 : 0,
  createdAt: 1,
  updatedAt: 2,
})

const qa = (id: string, question: string, sessionKey = 'sess-1', withVec = false): QaRecord => ({
  id,
  sessionKey,
  question,
  questionHash: `qhash-${question}`,
  questionTs: 100,
  ...(withVec
    ? { embedding: new Float32Array([0.3]), embeddingModel: 'm', embeddingVersion: 'v' }
    : {}),
  hasEmbedding: withVec ? 1 : 0,
  replyCount: 1,
  createdAt: 1,
  updatedAt: 2,
})

const reply = (id: string, qaId: string): ReplyRecord => ({
  id,
  qaId,
  text: `reply-of-${id}`,
  contentHash: `chash-${id}`,
  ts: 200,
  hasEmbedding: 0,
})

const folder = (id: string, parentId: string | null, position = 0): FolderRecord => ({
  id,
  parentId,
  name: `folder-${id}`,
  position,
  createdAt: 1,
})

// ─── buildExportEnvelope ───────────────────────────────────────────────────────

describe('buildExportEnvelope', () => {
  it('信封版本 2.0,导出时间透传,设置原样携带', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 12345,
    })
    expect(env.version).toBe(EXPORT_VERSION)
    expect(EXPORT_VERSION).toBe('2.0')
    expect(env.exportedAt).toBe(12345)
    expect(env.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('金标准剥离向量字段且 hasEmbedding 归 0(导入端统一重嵌)', () => {
    const env = buildExportEnvelope({
      goldens: [golden('g1', '问题一', true)],
      folders: [],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    const g = env.goldens[0] as ExportedGolden
    expect('qEmbedding' in g).toBe(false)
    expect('embeddingModel' in g).toBe(false)
    expect('embeddingVersion' in g).toBe(false)
    expect(g.hasEmbedding).toBe(0)
    expect(g.question).toBe('问题一')
  })

  it('includeMemory=false 不含 qaRecords/replies 字段', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      settings: DEFAULT_SETTINGS,
      qaRecords: [qa('q1', '问题')],
      replies: [reply('r1', 'q1')],
      includeMemory: false,
      exportedAt: 1,
    })
    expect('qaRecords' in env).toBe(false)
    expect('replies' in env).toBe(false)
  })

  it('includeMemory=true 携带问答与回复,同样剥离向量', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      settings: DEFAULT_SETTINGS,
      qaRecords: [qa('q1', '问题', 'sess-1', true)],
      replies: [reply('r1', 'q1')],
      includeMemory: true,
      exportedAt: 1,
    })
    const q = (env.qaRecords as ExportedQa[])[0]
    const r = (env.replies as ExportedReply[])[0]
    expect('embedding' in q).toBe(false)
    expect('embeddingModel' in q).toBe(false)
    expect(q.hasEmbedding).toBe(0)
    expect('embeddingModel' in r).toBe(false)
    expect(r.text).toBe('reply-of-r1')
  })
})

// ─── planGoldenImports ─────────────────────────────────────────────────────────

describe('planGoldenImports', () => {
  const ctx = (existing: GoldenRecord[] = []) => goldenImportContext(existing)

  it('已存在 (问题+答案) 跳过并计数;全新记录入列', () => {
    const incoming = [
      golden('g1', '问题一', false, '同一答复'),
      golden('g2', '问题二'),
    ]
    const existing = [golden('old', '问题一', false, '同一答复')]
    const plan = planGoldenImports(incoming, ctx(existing), MAX_GOLDENS_PER_QUESTION)
    expect(plan.toAdd.map((g) => g.id)).toEqual(['g2'])
    expect(plan.skipped).toBe(1)
  })

  it('同问题同答案但答案文本归一化后相同(空白差异)→ 视为重复跳过', () => {
    const incoming = [golden('g1', '问题一', false, '  同一答复 ')]
    const existing = [golden('old', '问题一', false, '同一答复')]
    const plan = planGoldenImports(incoming, ctx(existing), MAX_GOLDENS_PER_QUESTION)
    expect(plan.toAdd).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('同问题不同答案可一并导入(同问题可多条)', () => {
    const incoming = [golden('g1', '问题一', false, '答复甲'), golden('g2', '问题一', false, '答复乙')]
    const plan = planGoldenImports(incoming, ctx(), MAX_GOLDENS_PER_QUESTION)
    expect(plan.toAdd.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(plan.skipped).toBe(0)
  })

  it('导入包内部同 (问题+答案) 重复只留第一条', () => {
    const incoming = [
      golden('g1', '问题一', false, '同一答复'),
      golden('g1-dup', '问题一', false, '同一答复'),
    ]
    const plan = planGoldenImports(incoming, ctx(), MAX_GOLDENS_PER_QUESTION)
    expect(plan.toAdd.map((g) => g.id)).toEqual(['g1'])
    expect(plan.skipped).toBe(1)
  })

  it('目标问题已达上限 → 跳过并计入 limited', () => {
    const existing = [
      golden('e1', '问题一', false, 'a'),
      golden('e2', '问题一', false, 'b'),
      golden('e3', '问题一', false, 'c'),
    ]
    const incoming = [golden('g1', '问题一', false, 'd'), golden('g2', '问题二')]
    const plan = planGoldenImports(incoming, ctx(existing), MAX_GOLDENS_PER_QUESTION)
    expect(plan.toAdd.map((g) => g.id)).toEqual(['g2'])
    expect(plan.limited).toBe(1)
  })

  it('入列记录强制 hasEmbedding=0(待重嵌)', () => {
    const plan = planGoldenImports([golden('g1', '问题一', true)], ctx(), MAX_GOLDENS_PER_QUESTION)
    expect(plan.toAdd[0].hasEmbedding).toBe(0)
    expect(plan.toAdd[0].qEmbedding).toBeUndefined()
  })
})

// ─── planFolderImports ─────────────────────────────────────────────────────────

describe('planFolderImports', () => {
  it('已存在 id 与预置默认文件夹恒跳过', () => {
    const incoming = [folder(UNCATEGORIZED_FOLDER_ID, null), folder('f1', null), folder('f2', null)]
    const plan = planFolderImports(incoming, new Set(['f1']))
    expect(plan.toAdd.map((f) => f.id)).toEqual(['f2'])
    expect(plan.skipped).toBe(2)
  })

  it('悬空 parentId(不在已有集与导入包内)→ 置为根层 null', () => {
    const incoming = [folder('f1', null), folder('sub', 'ghost-parent', 1)]
    const plan = planFolderImports(incoming, new Set())
    expect(plan.toAdd.find((f) => f.id === 'sub')?.parentId).toBeNull()
    expect(plan.toAdd.find((f) => f.id === 'f1')?.parentId).toBeNull()
  })

  it('父夹在导入包内 → 父子关系保留', () => {
    const incoming = [folder('f1', null), folder('sub', 'f1', 1)]
    const plan = planFolderImports(incoming, new Set())
    expect(plan.toAdd.find((f) => f.id === 'sub')?.parentId).toBe('f1')
  })
})

// ─── planMemoryImports ─────────────────────────────────────────────────────────

describe('planMemoryImports', () => {
  it('已存在 id 跳过;回复按 qa 归属校验', () => {
    const plan = planMemoryImports(
      [qa('q1', '问题一'), qa('q2', '问题二')],
      [reply('r1', 'q1'), reply('r2', 'q9-ghost')],
      new Set(['q1']),
      new Set(),
    )
    expect(plan.toAddQa.map((q) => q.id)).toEqual(['q2'])
    expect(plan.skippedQa).toBe(1)
    expect(plan.toAddReplies.map((r) => r.id)).toEqual(['r1'])
    expect(plan.skippedReplies).toBe(1)
  })

  it('回复 id 已存在 → 跳过计数', () => {
    const plan = planMemoryImports([qa('q1', '问题一')], [reply('r1', 'q1')], new Set(), new Set(['r1']))
    expect(plan.toAddReplies).toHaveLength(0)
    expect(plan.skippedReplies).toBe(1)
  })

  it('自检示例问答不参与导入,其回复视为孤儿', () => {
    const plan = planMemoryImports(
      [qa('st1', '示例', SELF_TEST_SESSION_KEY), qa('q1', '正常')],
      [reply('r-st', 'st1'), reply('r1', 'q1')],
      new Set(),
      new Set(),
    )
    expect(plan.toAddQa.map((q) => q.id)).toEqual(['q1'])
    expect(plan.skippedQa).toBe(1)
    expect(plan.toAddReplies.map((r) => r.id)).toEqual(['r1'])
    expect(plan.skippedReplies).toBe(1)
  })

  it('导入问答强制 hasEmbedding=0(待重嵌)', () => {
    const plan = planMemoryImports([qa('q1', '问题', 'sess-1', true)], [], new Set(), new Set())
    expect(plan.toAddQa[0].hasEmbedding).toBe(0)
    expect(plan.toAddQa[0].embedding).toBeUndefined()
  })
})

// ─── 知识库导出/导入计划(P4-KB v1)────────────────────────────────────────────

const kb = (id: string, title: string, enabled = 1, withVec = false): KnowledgeRecord => ({
  id,
  title,
  content: `content-of-${id}`,
  questionHash: `kbhash-${title}`,
  ...(withVec
    ? { qEmbedding: new Float32Array([0.5]), embeddingModel: 'Xenova/bge-small-zh-v1.5', embeddingVersion: '2.0.0' }
    : {}),
  hasEmbedding: withVec ? 1 : 0,
  enabled,
  createdAt: 1,
  updatedAt: 2,
})

describe('知识库导出(信封携带)', () => {
  it('信封始终携带 knowledge(与 includeMemory 无关),向量剥离 hasEmbedding=0', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      knowledge: [kb('k1', '退货政策', 1, true)],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    const k = (env.knowledge as ExportedKnowledge[])[0]
    expect('qEmbedding' in k).toBe(false)
    expect('embeddingModel' in k).toBe(false)
    expect(k.hasEmbedding).toBe(0)
    expect(k.enabled).toBe(1)
    expect(k.title).toBe('退货政策')
  })

  it('includeMemory=true 时 knowledge 照常携带且不重复', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      knowledge: [kb('k1', '标题', 0)],
      settings: DEFAULT_SETTINGS,
      qaRecords: [qa('q1', '问题')],
      replies: [],
      includeMemory: true,
      exportedAt: 1,
    })
    expect(env.knowledge).toHaveLength(1)
    expect(env.knowledge![0].enabled).toBe(0)
  })
})

describe('planKnowledgeImports', () => {
  it('titleHash 已存在跳过;包内重复只留第一条', () => {
    const plan = planKnowledgeImports(
      [kb('k1', '退货政策'), kb('k1-dup', '退货政策'), kb('k2', '发货时间')],
      new Set(['kbhash-退货政策']),
    )
    expect(plan.toAdd.map((k) => k.id)).toEqual(['k2'])
    expect(plan.skipped).toBe(2)
  })

  it('入列记录显式挑字段:强制 hasEmbedding=0、enabled 保留、无多余字段', () => {
    const plan = planKnowledgeImports([kb('k1', '标题', 0, true)], new Set())
    const k = plan.toAdd[0]
    expect(k.hasEmbedding).toBe(0)
    expect(k.qEmbedding).toBeUndefined()
    expect(k.enabled).toBe(0)
    expect(Object.keys(k).sort()).toEqual(
      ['content', 'createdAt', 'enabled', 'hasEmbedding', 'id', 'questionHash', 'title', 'updatedAt'],
    )
  })
})
