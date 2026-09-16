// 检索源内存缓存单测(fake-indexeddb 内存实现)。
// 背景(2026-09-15 评审 工程5 后半):searchSuggestions 每次检索全量 toArray 三表含向量,
// 几万条后劣化 —— 改为 SW 内存缓存,首读建缓存、后续命中,db 写路径自动失效。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { QaRecord, GoldenRecord, KnowledgeRecord } from '../../../src/types/memory'
import { hashText } from '../../../src/shared/text'
import { kbAnchorText } from '../../../src/background/kbAnchor'

/** 重置模块注册表 → retrievalCache + db 单例在已删库的 fake-indexeddb 上重建 */
async function freshCache() {
  vi.resetModules()
  const cache = await import('../../../src/background/retrievalCache')
  const { db } = await import('../../../src/background/db')
  return { ...cache, db }
}

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '能开发票吗?',
    questionHash: hashText('能开发票吗?'),
    questionTs: now,
    hasEmbedding: 0,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function makeGolden(over: Partial<GoldenRecord> & { id: string }): GoldenRecord {
  const now = Date.now()
  return {
    folderId: null,
    question: '退货政策是什么?',
    answer: '7 天无理由退货。',
    questionHash: hashText('退货政策是什么?'),
    hasEmbedding: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function makeKb(over: Partial<KnowledgeRecord> & { id: string }): KnowledgeRecord {
  const now = Date.now()
  return {
    title: '运费说明',
    content: '满 49 元包邮。',
    questionHash: hashText('运费说明'),
    hasEmbedding: 0,
    enabled: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('getRetrievalEntries:三源合并', () => {
  it('已嵌三源进缓存:kind/锚文本/时间戳/向量正确;知识库锚走 kbAnchorText', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    const vec = new Float32Array([1, 2, 3])
    const now = Date.now()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: vec, questionTs: 111 }),
    )
    await db.goldens.add(
      makeGolden({ id: 'g-1', hasEmbedding: 1, qEmbedding: vec, updatedAt: 222 }),
    )
    const kb = makeKb({ id: 'kb-1', hasEmbedding: 1, qEmbedding: vec, updatedAt: 333 })
    await db.knowledge.add(kb)

    const entries = await getRetrievalEntries()
    expect(entries).toHaveLength(3)

    const qaEntry = entries.find((e) => e.source.id === 'qa-1')!
    expect(qaEntry.source.kind).toBe('history')
    expect(qaEntry.source.questionTs).toBe(111)
    // 向量经 IndexedDB 结构化克隆后必为新实例,断言内容相等即可
    expect(qaEntry.vec).toStrictEqual(vec)

    const gEntry = entries.find((e) => e.source.id === 'g-1')!
    expect(gEntry.source.kind).toBe('golden')
    expect(gEntry.source.questionTs).toBe(222)

    const kbEntry = entries.find((e) => e.source.id === 'kb-1')!
    expect(kbEntry.source.kind).toBe('knowledge')
    // 手工条目锚 = 标题;文档块锚 = 标题+正文(嵌入/BM25 同源)
    expect(kbEntry.source.question).toBe(kbAnchorText(kb))
    expect(kbEntry.source.questionTs).toBe(333)
  })

  it('未嵌/失败/停用的记录不入缓存', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    await db.addQaRecord(makeQa({ id: 'qa-0', hasEmbedding: 0 }))
    await db.addQaRecord(makeQa({ id: 'qa-neg', hasEmbedding: -1 }))
    await db.goldens.add(makeGolden({ id: 'g-0', hasEmbedding: 0 }))
    await db.knowledge.add(makeKb({ id: 'kb-off', hasEmbedding: 1, enabled: 0 }))
    await db.knowledge.add(makeKb({ id: 'kb-0', hasEmbedding: 0, enabled: 1 }))

    const entries = await getRetrievalEntries()
    expect(entries).toHaveLength(0)
  })
})

describe('缓存命中与手动失效', () => {
  it('第二次调用命中缓存:不再读库', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: new Float32Array([1]) }),
    )
    const spy = vi.spyOn(db, 'getEmbeddedQaRecords')
    await getRetrievalEntries()
    await getRetrievalEntries()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('invalidateRetrievalCache 后重读:新数据可见', async () => {
    const { getRetrievalEntries, invalidateRetrievalCache, db } = await freshCache()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: new Float32Array([1]) }),
    )
    expect(await getRetrievalEntries()).toHaveLength(1)

    await db.addQaRecord(
      makeQa({ id: 'qa-2', hasEmbedding: 1, embedding: new Float32Array([2]) }),
    )
    invalidateRetrievalCache()
    expect(await getRetrievalEntries()).toHaveLength(2)
  })
})

describe('db 写路径自动失效', () => {
  it('updateQaEmbedding:待嵌问答补嵌完成后入缓存', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    expect(await getRetrievalEntries()).toHaveLength(0)

    await db.updateQaEmbedding('qa-1', new Float32Array([1]), 'm', 'v1')
    expect(await getRetrievalEntries()).toHaveLength(1)
  })

  it('deleteQaWithReplies:已嵌问答删除后出缓存', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: new Float32Array([1]) }),
    )
    expect(await getRetrievalEntries()).toHaveLength(1)

    await db.deleteQaWithReplies('qa-1')
    expect(await getRetrievalEntries()).toHaveLength(0)
  })

  it('updateKnowledge 启停:停用出缓存,重新启用回缓存', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    await db.knowledge.add(
      makeKb({ id: 'kb-1', hasEmbedding: 1, qEmbedding: new Float32Array([1]) }),
    )
    expect(await getRetrievalEntries()).toHaveLength(1)

    await db.updateKnowledge('kb-1', { enabled: 0 })
    expect(await getRetrievalEntries()).toHaveLength(0)

    await db.updateKnowledge('kb-1', { enabled: 1 })
    expect(await getRetrievalEntries()).toHaveLength(1)
  })

  it('deleteKnowledge:删除后出缓存', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    await db.knowledge.add(
      makeKb({ id: 'kb-1', hasEmbedding: 1, qEmbedding: new Float32Array([1]) }),
    )
    expect(await getRetrievalEntries()).toHaveLength(1)

    await db.deleteKnowledge('kb-1')
    expect(await getRetrievalEntries()).toHaveLength(0)
  })

  it('updateGolden:编辑问题出缓存(重嵌完成前旧锚不参与检索)', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    await db.goldens.add(
      makeGolden({ id: 'g-1', hasEmbedding: 1, qEmbedding: new Float32Array([1]) }),
    )
    expect(await getRetrievalEntries()).toHaveLength(1)

    // 编辑问题实质变更:hasEmbedding 置 0 待重嵌,缓存里的旧问题锚+旧向量必须立即失效
    await db.updateGolden('g-1', {
      question: '退货政策是什么(修改版)?',
      questionHash: hashText('退货政策是什么(修改版)?'),
      hasEmbedding: 0,
    })
    expect(await getRetrievalEntries()).toHaveLength(0)
  })

  it('deleteGolden:标准回答删除后出缓存', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    await db.goldens.add(
      makeGolden({ id: 'g-1', hasEmbedding: 1, qEmbedding: new Float32Array([1]) }),
    )
    expect(await getRetrievalEntries()).toHaveLength(1)

    await db.deleteGolden('g-1')
    expect(await getRetrievalEntries()).toHaveLength(0)
  })

  it('purgeExpired:过期问答清除后出缓存', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    const day = 86_400_000
    await db.addQaRecord(
      makeQa({
        id: 'qa-old',
        hasEmbedding: 1,
        embedding: new Float32Array([1]),
        questionTs: Date.now() - 91 * day,
      }),
    )
    await db.addQaRecord(
      makeQa({
        id: 'qa-new',
        hasEmbedding: 1,
        embedding: new Float32Array([2]),
        questionTs: Date.now(),
      }),
    )
    expect(await getRetrievalEntries()).toHaveLength(2)

    await db.purgeExpired(Date.now(), 90)
    const entries = await getRetrievalEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].source.id).toBe('qa-new')
  })

  it('clearSelfTestRecords:自检数据清除后出缓存', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    const { SELF_TEST_SESSION_KEY } = await import('../../../src/shared/constants')
    await db.addQaRecord(
      makeQa({
        id: 'qa-st',
        sessionKey: SELF_TEST_SESSION_KEY,
        hasEmbedding: 1,
        embedding: new Float32Array([1]),
      }),
    )
    expect(await getRetrievalEntries()).toHaveLength(1)

    await db.clearSelfTestRecords()
    expect(await getRetrievalEntries()).toHaveLength(0)
  })
})
