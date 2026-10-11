// 检索源内存缓存单测(fake-indexeddb 内存实现)。
// 背景(2026-09-15 评审 工程5 后半):searchSuggestions 每次检索全量 toArray 三表含向量,
// 几万条后劣化 —— 改为 SW 内存缓存,首读建缓存、后续命中,db 写路径自动失效。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { QaRecord, GoldenRecord, KnowledgeRecord } from '../../../src/types/memory'
import { hashText } from '../../../src/shared/text'
import { kbAnchorText } from '../../../src/background/kbAnchor'
import { UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'

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

// ─── 检索源携带问题类型 + 定点更新(第五十八轮 Task 1)─────────────────────────────
//
// 分类进检索的前置:三源投影必须把 categoryId 带出,且**在缓存边界归一**
// (库里缺省 / null → 这里的 null;知识库恒 null)。归一不是洁癖:`undefined !== null`,
// 若让它以 undefined 流到下游,任何 `!== null` 的类型判断都会把"没分类"当成"有分类"
// (裁决 I2 的教训)。
//
// updateCachedCategory 是分类写回的定点同步口:分类是一条一条写的,整体失效会让
// "写一条 + 紧接着搜一次"白重建一遍;而这里条目没增没减、只改一个字段,定点更新安全
// (与文件头部反对的"增删场景增量维护"不矛盾)。

describe('检索源携带类型', () => {
  it('三源都带 categoryId,缺省归一成 null', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    const vec = new Float32Array([1])
    await db.addQaRecord(makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: vec }))
    await db.goldens.add(
      makeGolden({ id: 'g-1', hasEmbedding: 1, qEmbedding: vec, categoryId: 'preset:order' }),
    )
    await db.knowledge.add(makeKb({ id: 'kb-1', hasEmbedding: 1, qEmbedding: vec }))

    const entries = await getRetrievalEntries()
    const byId = (id: string) => entries.find((e) => e.source.id === id)!
    expect(byId('qa-1').source.categoryId).toBeNull() // 历史缺省 → null,不是 undefined
    expect(byId('g-1').source.categoryId).toBe('preset:order')
    expect(byId('kb-1').source.categoryId).toBeNull() // 知识库不分类
  })

  it('历史与标答的 categoryId 原样带出(含显式 uncategorized)', async () => {
    const { getRetrievalEntries, db } = await freshCache()
    const vec = new Float32Array([1])
    await db.addQaRecord(
      makeQa({ id: 'qa-typed', hasEmbedding: 1, embedding: vec, categoryId: 'preset:price' }),
    )
    await db.addQaRecord(
      makeQa({
        id: 'qa-unc',
        hasEmbedding: 1,
        embedding: vec,
        categoryId: UNCATEGORIZED_CATEGORY_ID,
      }),
    )
    await db.goldens.add(
      makeGolden({ id: 'g-typed', hasEmbedding: 1, qEmbedding: vec, categoryId: 'preset:aftersale' }),
    )

    const entries = await getRetrievalEntries()
    const byId = (id: string) => entries.find((e) => e.source.id === id)!
    expect(byId('qa-typed').source.categoryId).toBe('preset:price')
    expect(byId('qa-unc').source.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(byId('g-typed').source.categoryId).toBe('preset:aftersale')
  })
})

describe('updateCachedCategory 定点更新', () => {
  it('★ 改一条的类型,不重建整份缓存', async () => {
    const { getRetrievalEntries, updateCachedCategory, db } = await freshCache()
    const vec = new Float32Array([1])
    await db.addQaRecord(makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: vec }))
    await db.addQaRecord(makeQa({ id: 'qa-2', hasEmbedding: 1, embedding: vec }))
    const before = await getRetrievalEntries()
    expect(before).toHaveLength(2)

    updateCachedCategory('qa-1', 'preset:price')

    const after = await getRetrievalEntries()
    // 引用相同 = 没走重建路径(重建经 Promise.all 生成新数组)。
    // 若实现退化成 invalidateRetrievalCache + 重建,这里会取到新数组 → 断言失败;
    // 而且重建会从库读(库未改),categoryId 仍是 null → 下一条断言也会失败。
    expect(after).toBe(before)
    expect(after.find((e) => e.source.id === 'qa-1')!.source.categoryId).toBe('preset:price')
    expect(after.find((e) => e.source.id === 'qa-2')!.source.categoryId).toBeNull()
  })

  it('改不存在的 id 是空操作,不抛错', async () => {
    const { getRetrievalEntries, updateCachedCategory, db } = await freshCache()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: new Float32Array([1]) }),
    )
    const before = await getRetrievalEntries()

    expect(() => updateCachedCategory('nope', 'preset:price')).not.toThrow()
    expect(await getRetrievalEntries()).toBe(before)
    expect(before[0].source.categoryId).toBeNull()
  })

  it('归一到 null 也生效', async () => {
    const { getRetrievalEntries, updateCachedCategory, db } = await freshCache()
    await db.addQaRecord(
      makeQa({
        id: 'qa-1',
        hasEmbedding: 1,
        embedding: new Float32Array([1]),
        categoryId: 'preset:order',
      }),
    )
    const before = await getRetrievalEntries()
    expect(before[0].source.categoryId).toBe('preset:order')

    updateCachedCategory('qa-1', null)

    const after = await getRetrievalEntries()
    expect(after).toBe(before)
    expect(after[0].source.categoryId).toBeNull()
  })
})
