/**
 * 导入导出 v2 纯逻辑单测:信封构建(剥向量)/ 金标准 hash 幂等 / 文件夹 id 幂等 /
 * 记忆搬库孤儿与自检排除。设计依据:设计文档 §8(信封 v2.0)。
 */
import { describe, it, expect } from 'vitest'
import {
  EXPORT_VERSION,
  buildExportEnvelope,
  goldenImportContext,
  planCategoryImports,
  planGoldenImports,
  planFolderImports,
  planMemoryImports,
  planKnowledgeImports,
  planKbDocImports,
  resolveImportedCategory,
} from '../../../src/background/transferPlan'
import type {
  ExportedGolden,
  ExportedQa,
  ExportedReply,
  ExportedKnowledge,
  ExportedKbDoc,
} from '../../../src/types/transfer'
import { MAX_GOLDENS_PER_QUESTION, SELF_TEST_SESSION_KEY, UNCATEGORIZED_FOLDER_ID, DEFAULT_SETTINGS } from '../../../src/shared/constants'
import type { GoldenRecord, QaRecord, ReplyRecord, FolderRecord, KnowledgeRecord, KbDocRecord, CategoryRecord } from '../../../src/types/memory'
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
    // 两个 AI Key 被剥离(见下条);其余设置原样
    expect(env.settings).toEqual({ ...DEFAULT_SETTINGS, jevApiKey: undefined, llmApiKey: undefined })
    expect('jevApiKey' in env.settings).toBe(false)
    expect('llmApiKey' in env.settings).toBe(false)
  })

  it('信封剥离 API Key —— 导出文件不外发 jev/llm 的 Key(ADR-0006/0007 硬约束)', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      settings: {
        ...DEFAULT_SETTINGS,
        jevApiKey: 'sk-jev-secret',
        llmApiKey: 'sk-llm-secret',
        classifyEnabled: true,
        simThreshold: 0.42,
      },
      includeMemory: false,
      exportedAt: 1,
    })
    // 键必须**不存在**,而不是置空串 —— 置空串会在导入端把本机已存的 Key 清掉
    expect('jevApiKey' in env.settings).toBe(false)
    expect('llmApiKey' in env.settings).toBe(false)
    expect(JSON.stringify(env)).not.toContain('sk-jev-secret')
    expect(JSON.stringify(env)).not.toContain('sk-llm-secret')
    // 其余设置照常保留,导入端仍能恢复阈值等
    expect(env.settings.simThreshold).toBe(0.42)
    expect(env.settings.classifyEnabled).toBe(true)
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

// ─── v0.16:知识库文档原文与块元字段 ────────────────────────────────────────────
// 修的是真问题:旧版导出不带 kbDocs,换台机器导入后文档块无从重切,知识库页
// 常年挂着"请重新上传原文"的提示 —— 而原文一直在用户手里,只是没人告诉他要传。

describe('v0.16 导出:文档原文与块元字段', () => {
  const kbDoc = (docId: string, content = '# 标题\n正文'): KbDocRecord => ({
    docId,
    content,
    splitterVersion: '1.2.0',
    chunkCount: 3,
    createdAt: 10,
    updatedAt: 20,
  })

  it('信封携带 kbDocs(原文 + 分块器版本)', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      knowledge: [],
      kbDocs: [kbDoc('常见问答')],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    expect(env.kbDocs).toEqual([
      { docId: '常见问答', content: '# 标题\n正文', splitterVersion: '1.2.0', chunkCount: 3, createdAt: 10, updatedAt: 20 },
    ])
  })

  it('未传 kbDocs → 空数组(不是 undefined,读侧不必到处判空)', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    expect(env.kbDocs).toEqual([])
  })

  it('知识块导出时带上 chunkKind / sectionSeq(否则导入后"这段是怎么切出来的"就丢了)', () => {
    const k: KnowledgeRecord = {
      id: 'doc-c0',
      title: '文档名 · 段0',
      content: '正文',
      questionHash: 'h0',
      hasEmbedding: 1,
      enabled: 1,
      source: 'doc',
      docId: '文档名',
      chunkKind: 'section',
      sectionSeq: 2,
      createdAt: 1,
      updatedAt: 2,
    }
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      knowledge: [k],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    expect(env.knowledge?.[0].chunkKind).toBe('section')
    expect(env.knowledge?.[0].sectionSeq).toBe(2)
  })

  it('手工条目没有这两个字段时不被凭空补上(缺省即缺省)', () => {
    const k: KnowledgeRecord = {
      id: 'k1',
      title: '发票',
      content: '可以开',
      questionHash: 'h1',
      hasEmbedding: 1,
      enabled: 1,
      createdAt: 1,
      updatedAt: 2,
    }
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      knowledge: [k],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    expect(env.knowledge?.[0]).not.toHaveProperty('chunkKind')
    expect(env.knowledge?.[0]).not.toHaveProperty('sectionSeq')
  })
})

describe('v0.16 导入:文档原文计划', () => {
  const incoming = (docId: string): ExportedKbDoc => ({
    docId,
    content: '原文',
    splitterVersion: '1.0.0',
    chunkCount: 1,
    createdAt: 1,
    updatedAt: 2,
  })

  it('按 docId 幂等:已存在同名原文 → 跳过(不覆盖本地可能已重传的新内容)', () => {
    const r = planKbDocImports([incoming('常见问答')], new Set(['常见问答']))
    expect(r.toAdd).toHaveLength(0)
    expect(r.skipped).toBe(1)
  })

  it('导入包内部同 docId 重复只留第一条', () => {
    const r = planKbDocImports([incoming('A'), incoming('A')], new Set())
    expect(r.toAdd).toHaveLength(1)
    expect(r.skipped).toBe(1)
  })

  it('splitterVersion 原样带入 —— 与当前版本不符时启动扫描据此自动重切', () => {
    const r = planKbDocImports([incoming('A')], new Set())
    expect(r.toAdd[0].splitterVersion).toBe('1.0.0')
  })

  it('脏数据(docId 缺失)丢弃并计数,不写进库', () => {
    const bad = { ...incoming(''), docId: '' } as ExportedKbDoc
    const r = planKbDocImports([bad, incoming('A')], new Set())
    expect(r.toAdd.map((d) => d.docId)).toEqual(['A'])
    expect(r.skipped).toBe(1)
  })

  it('导入的知识块保留 chunkKind / sectionSeq', () => {
    const k: ExportedKnowledge = {
      id: 'doc-c0',
      title: '文档名 · 段0',
      content: '正文',
      questionHash: 'h0',
      hasEmbedding: 0,
      enabled: 1,
      source: 'doc',
      docId: '文档名',
      chunkKind: 'qa',
      sectionSeq: 0,
      createdAt: 1,
      updatedAt: 2,
    }
    const r = planKnowledgeImports([k], new Set())
    expect(r.toAdd[0].chunkKind).toBe('qa')
    expect(r.toAdd[0].sectionSeq).toBe(0)
  })
})

// ─── 尺码表标记的导出往返 ──────────────────────────────────────────────────────
// 修的是真问题:stripKbDoc 是**白名单**,漏 isSizeTable → 用户标好尺码表、导出、
// 换台机器恢复后标记静默消失(该文档块重新进向量检索,尺码生成材料也没了),
// 全程无任何提示 —— 正是本计划要消灭的那类"标记没生效",只不过走的是备份/恢复这条路。

describe('尺码表标记 isSizeTable 导出往返', () => {
  const markedDoc = (docId: string, isSizeTable?: boolean): KbDocRecord => ({
    docId,
    content: '原文正文',
    splitterVersion: '1.2.0',
    chunkCount: 2,
    ...(isSizeTable ? { isSizeTable: true } : {}),
    createdAt: 10,
    updatedAt: 20,
  })

  it('标记 → 导出 → 导入:标记还在', () => {
    // 导出(白名单剥离)后字段必须被带上,否则这一条在第 2 步就会 RED
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      knowledge: [],
      kbDocs: [markedDoc('尺码表', true)],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    expect(env.kbDocs?.[0].isSizeTable).toBe(true)

    // 导入重建记录时同样要带过去
    const plan = planKbDocImports(env.kbDocs as ExportedKbDoc[], new Set())
    expect(plan.toAdd).toHaveLength(1)
    expect(plan.toAdd[0].isSizeTable).toBe(true)
  })

  it('未标记的文档往返后仍无该字段(不凭空补上)', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      knowledge: [],
      kbDocs: [markedDoc('普通文档')],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    expect(env.kbDocs?.[0]).not.toHaveProperty('isSizeTable')
    const plan = planKbDocImports(env.kbDocs as ExportedKbDoc[], new Set())
    expect(plan.toAdd[0]).not.toHaveProperty('isSizeTable')
  })
})

// ─── 分类往返(第五十八轮引入 categories,导出曾长期漏带)───────────────────────
//
// 这一组钉的是"一次导出→换机器导入之后,用户看得见的分类还在不在"。
// 漏带的代价不是少个字段:手工摆好的分类会静默消失,记录重新变回补分类候选,
// 再白烧一轮 jev 额度。

const cat = (
  id: string,
  name: string,
  over: Partial<CategoryRecord> = {},
): CategoryRecord => ({
  id,
  name,
  criteria: `criteria-${name}`,
  kind: 'custom',
  route: 'retrieve',
  filterable: true,
  position: 100,
  createdAt: 1,
  updatedAt: 2,
  ...over,
})

describe('分类:导出侧', () => {
  it('★ 信封始终携带类型表(与 includeMemory 无关)', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      categories: [cat('preset:size', '尺码推荐', { kind: 'preset', route: 'size' })],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    expect(env.categories).toHaveLength(1)
    expect(env.categories?.[0].id).toBe('preset:size')
    // 旧导出文件没有这个字段 → 导入端按空数组处理,故不能是 undefined
    const noCats = buildExportEnvelope({
      goldens: [],
      folders: [],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    expect(noCats.categories).toEqual([])
  })

  it('★ 金标准带上分类四字段', () => {
    const env = buildExportEnvelope({
      goldens: [
        {
          ...golden('g1', 'q1'),
          categoryId: 'preset:size',
          categorySource: 'inherit',
          categoryAt: 123,
          categoryConfidence: 0.42,
        },
      ],
      folders: [],
      settings: DEFAULT_SETTINGS,
      includeMemory: false,
      exportedAt: 1,
    })
    const g = env.goldens[0]
    expect(g.categoryId).toBe('preset:size')
    expect(g.categorySource).toBe('inherit')
    expect(g.categoryAt).toBe(123)
    expect(g.categoryConfidence).toBe(0.42)
  })

  it('★ 没分类的记录**不带**这四个字段(缺席而非 null)—— 旧形状不被凭空补字段', () => {
    const env = buildExportEnvelope({
      goldens: [golden('g1', 'q1')],
      folders: [],
      settings: DEFAULT_SETTINGS,
      includeMemory: true,
      qaRecords: [qa('qa1', 'q1')],
      exportedAt: 1,
    })
    for (const k of ['categoryId', 'categorySource', 'categoryAt', 'categoryConfidence']) {
      expect(env.goldens[0]).not.toHaveProperty(k)
      expect(env.qaRecords?.[0]).not.toHaveProperty(k)
    }
  })

  it('问答的 categorySource 只可能是 jev/manual —— inherit 是金标准独有的', () => {
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      settings: DEFAULT_SETTINGS,
      includeMemory: true,
      qaRecords: [{ ...qa('qa1', 'q1'), categoryId: 'x', categorySource: 'manual' }],
      exportedAt: 1,
    })
    expect(env.qaRecords?.[0].categorySource).toBe('manual')
  })
})

describe('planCategoryImports:三条判据', () => {
  it('① 按 id 命中 → 复用本地那条(预置类型走这条,id 是写死的)', () => {
    const local = [cat('preset:size', '尺码推荐', { kind: 'preset', route: 'size' })]
    const plan = planCategoryImports([cat('preset:size', '尺码推荐')], local)
    expect(plan.toAdd).toHaveLength(0)
    expect(plan.skipped).toBe(1)
    expect(plan.idMap.get('preset:size')).toBe('preset:size')
  })

  it('★ ② 按名字命中 → 映射到本地 id(换机器时自定义类型 id 不可能相等)', () => {
    const local = [cat('local-uuid', '发票咨询')]
    const plan = planCategoryImports([cat('other-machine-uuid', '发票咨询')], local)
    expect(plan.toAdd).toHaveLength(0)
    // 这一条是整组测试的重点:不映射的话导入的记录会挂着本地不存在的 id
    expect(plan.idMap.get('other-machine-uuid')).toBe('local-uuid')
  })

  it('③ 都没有 → 新建,id 原样沿用', () => {
    const plan = planCategoryImports([cat('new-uuid', '全新类型')], [])
    expect(plan.toAdd).toHaveLength(1)
    expect(plan.toAdd[0].id).toBe('new-uuid')
    expect(plan.idMap.get('new-uuid')).toBe('new-uuid')
  })

  it('★ 包内重名 → 只建第一条,后一条映射到它(同名会让 jev 在两者间摇摆)', () => {
    const plan = planCategoryImports(
      [cat('u1', '同名'), cat('u2', '同名')],
      [],
    )
    expect(plan.toAdd).toHaveLength(1)
    expect(plan.toAdd[0].id).toBe('u1')
    expect(plan.idMap.get('u2')).toBe('u1')
    expect(plan.skipped).toBe(1)
  })

  it('空包(旧导出文件)→ 不新建、映射为空', () => {
    const plan = planCategoryImports([], [cat('a', '甲')])
    expect(plan.toAdd).toHaveLength(0)
    expect(plan.idMap.size).toBe(0)
  })
})

describe('resolveImportedCategory:悬空时四个字段一起清', () => {
  it('映射得到 → 换成 本地 id', () => {
    const rec: ExportedGolden = { ...golden('g1', 'q1'), categoryId: 'remote', categorySource: 'jev' }
    resolveImportedCategory(rec, new Map([['remote', 'local']]))
    expect(rec.categoryId).toBe('local')
    expect(rec.categorySource).toBe('jev')
  })

  it('★ 悬空 → 四个字段**一起**清掉,不留"有来源没类型"的残骸', () => {
    const rec: ExportedGolden = {
      ...golden('g1', 'q1'),
      categoryId: 'dangling',
      categorySource: 'jev',
      categoryAt: 9,
      categoryConfidence: 0.9,
    }
    resolveImportedCategory(rec, new Map())
    expect(rec).not.toHaveProperty('categoryId')
    expect(rec).not.toHaveProperty('categorySource')
    expect(rec).not.toHaveProperty('categoryAt')
    expect(rec).not.toHaveProperty('categoryConfidence')
  })

  it('原本就没分类(null)→ 不动它', () => {
    const rec: ExportedGolden = { ...golden('g1', 'q1'), categoryId: null }
    resolveImportedCategory(rec, new Map())
    expect(rec.categoryId).toBeNull()
  })
})

describe('分类往返:导出 → 换机器导入', () => {
  it('★ 金标准与问答的分类在往返后仍然指向**本地**类型', () => {
    // 源机器:自定义类型 uuid 是 src-uuid
    const env = buildExportEnvelope({
      goldens: [{ ...golden('g1', 'q1'), categoryId: 'src-uuid', categorySource: 'manual', categoryAt: 7 }],
      folders: [],
      categories: [cat('src-uuid', '发票咨询')],
      settings: DEFAULT_SETTINGS,
      includeMemory: true,
      qaRecords: [{ ...qa('qa1', 'q1'), categoryId: 'src-uuid', categorySource: 'jev' }],
      exportedAt: 1,
    })

    // 目标机器:已经有一条同名的本地类型(不同 id)
    const localCats = [cat('dst-uuid', '发票咨询')]
    const catPlan = planCategoryImports(env.categories as CategoryRecord[], localCats)
    expect(catPlan.toAdd).toHaveLength(0) // 同名 → 不重复建

    const goldenPlan = planGoldenImports(env.goldens, goldenImportContext([]), MAX_GOLDENS_PER_QUESTION)
    for (const g of goldenPlan.toAdd) resolveImportedCategory(g, catPlan.idMap)
    const memPlan = planMemoryImports(env.qaRecords as ExportedQa[], [], new Set(), new Set())
    for (const q of memPlan.toAddQa) resolveImportedCategory(q, catPlan.idMap)

    expect(goldenPlan.toAdd[0].categoryId).toBe('dst-uuid')
    expect(goldenPlan.toAdd[0].categorySource).toBe('manual')
    expect(goldenPlan.toAdd[0].categoryAt).toBe(7)
    expect(memPlan.toAddQa[0].categoryId).toBe('dst-uuid')
    expect(memPlan.toAddQa[0].categorySource).toBe('jev')
  })

  it('★ 旧导出文件(没有 categories 字段)→ 类型不新建,记录落回未分类', () => {
    const catPlan = planCategoryImports([], [])
    const goldenPlan = planGoldenImports(
      [{ ...golden('g1', 'q1') } as ExportedGolden],
      goldenImportContext([]),
      MAX_GOLDENS_PER_QUESTION,
    )
    for (const g of goldenPlan.toAdd) resolveImportedCategory(g, catPlan.idMap)
    // 旧文件本来就没带 categoryId,import 后仍然没有 —— 与从前行为逐字节一致
    expect(catPlan.toAdd).toHaveLength(0)
    expect(goldenPlan.toAdd[0]).not.toHaveProperty('categoryId')
  })
})
