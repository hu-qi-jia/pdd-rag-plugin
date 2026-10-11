// 尺码表标记 + 整篇原文作材料单测(fake-indexeddb 内存实现)。
//
// 尺码路由(设计 spec §八)的底座:
//   · 标记落在 **kbDocs 记录** 上(isSizeTable)—— 文档级,一份,不往每个块复制。
//   · 被标记文档的块**不进检索缓存**(尺码表不做向量检索;检索会只命中 M 那行、
//     漏掉相邻的 L 行,而正确答案常在边界上)。
//   · 材料 = 所有被标记文档的**整篇原文**(kbDocs.content),不走分块、不走向量。
//   · 回复正文/标准回答正文**永不**进材料:材料只读 kbDocs。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { SPLITTER_VERSION } from '../../../src/shared/mdText'
import { MAX_MATERIAL_CHARS } from '../../../src/background/aiMaterials'
import type { KbDocRecord, QaRecord, ReplyRecord, GoldenRecord } from '../../../src/types/memory'

/** 重置模块注册表 → db / retrievalCache / knowledge / aiMaterials 在已删库上重建 */
async function fresh() {
  vi.resetModules()
  const knowledge = await import('../../../src/background/knowledge')
  const aiMaterials = await import('../../../src/background/aiMaterials')
  const retrievalCache = await import('../../../src/background/retrievalCache')
  const kbResplit = await import('../../../src/background/kbResplit')
  const offscreen = await import('../../../src/background/offscreen')
  const { db } = await import('../../../src/background/db')
  return { ...knowledge, ...aiMaterials, ...retrievalCache, ...kbResplit, offscreen, db }
}

function kbDoc(over: Partial<KbDocRecord> & { docId: string; content: string }): KbDocRecord {
  return {
    splitterVersion: SPLITTER_VERSION,
    chunkCount: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

/** 直接落一条"已嵌且启用"的文档块(免去 offscreen 嵌入链路) */
async function addEmbeddedChunk(
  db: Awaited<ReturnType<typeof fresh>>['db'],
  id: string,
  docId: string,
  content: string,
): Promise<void> {
  await db.knowledge.add({
    id,
    title: id,
    content,
    questionHash: id,
    hasEmbedding: 1,
    enabled: 1,
    qEmbedding: new Float32Array([1]),
    source: 'doc',
    docId,
    chunkKind: 'section',
    sectionSeq: 0,
    createdAt: 1,
    updatedAt: 1,
  })
}

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '165cm 50kg 穿什么码?',
    questionHash: 'qhash-1',
    questionTs: now,
    hasEmbedding: 0,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('尺码表标记', () => {
  it('标记后写进 kbDocs.isSizeTable;取消标记写回 false', async () => {
    const { setKbDocSizeTable, db } = await fresh()
    await db.putKbDoc(kbDoc({ docId: '尺码表', content: 'S M L' }))

    await setKbDocSizeTable('尺码表', true)
    expect((await db.getKbDoc('尺码表'))!.isSizeTable).toBe(true)

    await setKbDocSizeTable('尺码表', false)
    expect((await db.getKbDoc('尺码表'))!.isSizeTable).toBe(false)
  })

  it('原文不存在时报错返回,不静默写空记录', async () => {
    const { setKbDocSizeTable, db } = await fresh()
    const out = await setKbDocSizeTable('不存在', true)
    expect(out.success).toBe(false)
    expect(out.error).toBeTruthy()
    expect(await db.getKbDoc('不存在')).toBeUndefined()
  })

  it('★ 标记后,该文档的块不再进检索缓存', async () => {
    const { db, getRetrievalEntries, setKbDocSizeTable } = await fresh()
    await db.putKbDoc(kbDoc({ docId: '尺码表', content: 'S M L' }))
    await addEmbeddedChunk(db, 'size-c0', '尺码表', 'S M L')
    await addEmbeddedChunk(db, 'other-c0', '其它文档', '别的内容')

    expect((await getRetrievalEntries()).map((e) => e.source.id).sort()).toEqual([
      'other-c0',
      'size-c0',
    ])

    await setKbDocSizeTable('尺码表', true)

    // 标记一改,池子就变:该文档的块从缓存里消失,别的文档照旧
    expect((await getRetrievalEntries()).map((e) => e.source.id)).toEqual(['other-c0'])
  })

  it('★ 取消标记后,块回到检索缓存', async () => {
    const { db, getRetrievalEntries, setKbDocSizeTable } = await fresh()
    await db.putKbDoc(kbDoc({ docId: '尺码表', content: 'S M L' }))
    await addEmbeddedChunk(db, 'size-c0', '尺码表', 'S M L')

    await setKbDocSizeTable('尺码表', true)
    expect(await getRetrievalEntries()).toHaveLength(0)

    await setKbDocSizeTable('尺码表', false)
    expect((await getRetrievalEntries()).map((e) => e.source.id)).toEqual(['size-c0'])
  })

  it('★ putKbDoc 会作废检索缓存(标记一改,池子就变)', async () => {
    const { db, getRetrievalEntries } = await fresh()
    // 直接以"重建次数"为证:缓存命中时不再读库,失效后才会再读一次
    const spy = vi.spyOn(db, 'getEmbeddedQaRecords')

    await getRetrievalEntries()
    expect(spy).toHaveBeenCalledTimes(1)

    await db.putKbDoc(kbDoc({ docId: '新文档', content: '随便' }))
    await getRetrievalEntries()

    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('重新上传文档分块不会丢掉标记', async () => {
    const { importKbDocument, setKbDocSizeTable, db, offscreen } = await fresh()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    await importKbDocument({ name: '尺码表.md', content: '## 尺码表\nS M L' })
    await setKbDocSizeTable('尺码表', true)

    // 整篇替换重写 kbDocs 记录:标记是文档级的,必须跟着这篇文档活下来
    await importKbDocument({ name: '尺码表.md', content: '## 尺码表\nS M L XL' })

    expect((await db.getKbDoc('尺码表'))!.isSizeTable).toBe(true)
  })

  it('分块器版本失配自动重切,标记同样不丢', async () => {
    const { db, setKbDocSizeTable, resplitStaleKbDocs, offscreen } = await fresh()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    await db.putKbDoc(
      kbDoc({ docId: '尺码表', content: '## 甲\n内容', splitterVersion: '旧版本' }),
    )
    await setKbDocSizeTable('尺码表', true)

    await resplitStaleKbDocs()

    const after = await db.getKbDoc('尺码表')
    expect(after!.splitterVersion).toBe(SPLITTER_VERSION)
    expect(after!.isSizeTable).toBe(true)
  })

  it('listSizeTableDocIds 只返回被标记的那些', async () => {
    const { db, setKbDocSizeTable } = await fresh()
    await db.putKbDoc(kbDoc({ docId: '甲', content: 'A' }))
    await db.putKbDoc(kbDoc({ docId: '乙', content: 'B' }))
    await db.putKbDoc(kbDoc({ docId: '丙', content: 'C' }))
    await setKbDocSizeTable('乙', true)

    expect(await db.listSizeTableDocIds()).toEqual(new Set(['乙']))
  })

  it('没有任何标记时,知识库块照常进缓存(未标记 = 今天的行为)', async () => {
    const { db, getRetrievalEntries } = await fresh()
    await db.putKbDoc(kbDoc({ docId: '甲', content: 'A' }))
    await addEmbeddedChunk(db, 'a-c0', '甲', 'A')

    expect((await getRetrievalEntries()).map((e) => e.source.id)).toEqual(['a-c0'])
  })
})

describe('collectSizeTableMaterials', () => {
  it('★ 取整篇原文,不走分块、不走向量', async () => {
    const { db, setKbDocSizeTable, collectSizeTableMaterials } = await fresh()
    const full = '# 尺码表\n身高 165 → M\n身高 170 → L'
    await db.putKbDoc(kbDoc({ docId: '尺码表', content: full }))
    await setKbDocSizeTable('尺码表', true)
    // 与知识块无关:即便一条块都没有,整篇原文照样进材料
    expect(await db.listKnowledgeByDoc('尺码表')).toHaveLength(0)

    expect(await collectSizeTableMaterials()).toEqual([full])
  })

  it('没有标记的尺码表 → 空数组', async () => {
    const { db, collectSizeTableMaterials } = await fresh()
    await db.putKbDoc(kbDoc({ docId: '普通文档', content: '正文' }))
    expect(await collectSizeTableMaterials()).toEqual([])
  })

  it('多篇被标记 → 全取,按 docId 稳定排序', async () => {
    const { db, setKbDocSizeTable, collectSizeTableMaterials } = await fresh()
    await db.putKbDoc(kbDoc({ docId: 'chima-c', content: 'C 表' }))
    await db.putKbDoc(kbDoc({ docId: 'chima-a', content: 'A 表' }))
    await db.putKbDoc(kbDoc({ docId: 'chima-b', content: 'B 表' }))
    await db.putKbDoc(kbDoc({ docId: 'chima-d', content: 'D 表' }))
    for (const id of ['chima-c', 'chima-a', 'chima-b']) await setKbDocSizeTable(id, true)

    expect(await collectSizeTableMaterials()).toEqual(['A 表', 'B 表', 'C 表'])
  })

  it('超长单篇:截到预算内最后一个完整行,绝不发半行', async () => {
    const { db, setKbDocSizeTable, collectSizeTableMaterials } = await fresh()
    const lines = Array.from(
      { length: 300 },
      (_, i) => `身高${150 + i}cm 体重${40 + i}kg → ${i % 2 ? 'L' : 'M'}`,
    )
    const full = lines.join('\n') // 远超 3000 字
    await db.putKbDoc(kbDoc({ docId: '大表', content: full }))
    await setKbDocSizeTable('大表', true)

    const m = await collectSizeTableMaterials()
    expect(m).toHaveLength(1) // 没有把尾巴拼成第二段
    const out = m[0]
    expect(out.length).toBeLessThanOrEqual(MAX_MATERIAL_CHARS)
    // 原文以整行收尾的**行级前缀**:后面紧跟一个换行,而不是切在 `165cm 50` 之类半行中间
    expect(full.startsWith(out + '\n')).toBe(true)
    expect(out.split('\n').length).toBeGreaterThan(1)
  })

  it('越界且预算内放不下任何完整行 → 整篇丢弃,不发残片', async () => {
    const { db, setKbDocSizeTable, collectSizeTableMaterials } = await fresh()
    // 无换行的一整行:切点落在行内,回退不到任何行边界 → 直接丢弃
    const oneLine = '甲'.repeat(MAX_MATERIAL_CHARS + 500)
    await db.putKbDoc(kbDoc({ docId: '大表', content: oneLine }))
    await setKbDocSizeTable('大表', true)

    expect(await collectSizeTableMaterials()).toEqual([])
  })

  it('多篇时后一篇越界 → 同样按行边界截,不为塞缝发几个残字', async () => {
    const { db, setKbDocSizeTable, collectSizeTableMaterials } = await fresh()
    const a = 'A 表'
    const lines = Array.from({ length: 300 }, (_, i) => `第${i}行:身高${150 + i}cm`)
    const b = lines.join('\n')
    await db.putKbDoc(kbDoc({ docId: 'aa', content: a }))
    await db.putKbDoc(kbDoc({ docId: 'bb', content: b }))
    await setKbDocSizeTable('aa', true)
    await setKbDocSizeTable('bb', true)

    const m = await collectSizeTableMaterials()
    expect(m).toHaveLength(2)
    expect(m[0]).toBe(a)
    expect(b.startsWith(m[1] + '\n')).toBe(true) // 后一篇也是整行收尾
    expect(m.join('').length).toBeLessThanOrEqual(MAX_MATERIAL_CHARS)
  })

  it('后一篇的剩余额度过小、连一行都放不下 → 丢弃它而非截成几个字符', async () => {
    const { db, setKbDocSizeTable, collectSizeTableMaterials } = await fresh()
    const a = '甲'.repeat(2900) // 单行 2900 字,先占掉预算
    const b = '乙'.repeat(2000) // 单行 2000 字,剩余 100 字放不下 → 丢
    await db.putKbDoc(kbDoc({ docId: 'aa', content: a }))
    await db.putKbDoc(kbDoc({ docId: 'bb', content: b }))
    await setKbDocSizeTable('aa', true)
    await setKbDocSizeTable('bb', true)

    expect(await collectSizeTableMaterials()).toEqual([a])
  })

  it('★ 多篇排序用码点序,与 locale 无关 —— 顺序决定超预算时先截哪篇', async () => {
    const { db, setKbDocSizeTable, collectSizeTableMaterials } = await fresh()
    // 码点序:'Z'(U+005A) < 'a'(U+0061) → Zebra 在前;localeCompare 会因大小写折叠给出相反次序
    await db.putKbDoc(kbDoc({ docId: 'apple', content: '小写表' }))
    await db.putKbDoc(kbDoc({ docId: 'Zebra', content: '大写表' }))
    await setKbDocSizeTable('apple', true)
    await setKbDocSizeTable('Zebra', true)

    expect(await collectSizeTableMaterials()).toEqual(['大写表', '小写表'])
  })

  it('★ 材料里只有尺码表原文(不含任何回复正文)', async () => {
    const { db, setKbDocSizeTable, collectSizeTableMaterials } = await fresh()
    const sizeTable = 'S/M/L 尺码原文'
    await db.putKbDoc(kbDoc({ docId: '尺码表', content: sizeTable }))
    await setKbDocSizeTable('尺码表', true)

    // 历史问答的回复正文、标准回答正文 —— 统统不得进入材料
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addReply({
      id: 'r-1',
      qaId: 'qa-1',
      text: '亲,建议您选 M 码哦',
      contentHash: 'h1',
      ts: 1,
      hasEmbedding: 0,
    } satisfies ReplyRecord)
    await db.goldens.add({
      id: 'g-1',
      folderId: null,
      question: '尺码怎么选',
      answer: '标准回答正文:165 选 M',
      questionHash: 'gh1',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    } satisfies GoldenRecord)

    const m = await collectSizeTableMaterials()
    expect(m).toEqual([sizeTable])
    expect(m.join('')).not.toContain('亲,建议您选')
    expect(m.join('')).not.toContain('标准回答正文')
  })
})
