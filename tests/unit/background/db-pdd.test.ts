// PddCSDB schema/DAO 单元测试(fake-indexeddb 内存实现)
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import {
  UNCATEGORIZED_FOLDER_ID,
  SELF_TEST_SESSION_KEY,
  type QaRecord,
  type ReplyRecord,
} from '../../../src/types/memory'
import { hashText } from '../../../src/utils/text'

let testDb: PddDatabase

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '亲,支持七天无理由退换吗?',
    questionHash: hashText('亲,支持七天无理由退换吗?'),
    questionTs: now,
    hasEmbedding: 0,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function makeReply(over: Partial<ReplyRecord> & { id: string }): ReplyRecord {
  return {
    qaId: 'qa-1',
    text: '支持,签收后 7 天内可无理由退换。',
    contentHash: hashText('支持,签收后 7 天内可无理由退换。'),
    ts: Date.now(),
    hasEmbedding: 0,
    ...over,
  }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
  testDb = new PddDatabase()
})

describe('PddCSDB 基础 schema', () => {
  it('写入并查询问答记录与回复,回复计数正确', async () => {
    const qa = makeQa({ id: 'qa-1' })
    await testDb.addQaRecord(qa)
    const reply1 = makeReply({ id: 'r-1' })
    const reply2 = makeReply({ id: 'r-2', text: '也支持换货,运费我们承担。' })
    await testDb.addReply(reply1)
    await testDb.addReply(reply2)

    await testDb.recountReplyCount('qa-1')
    const stored = await testDb.getQaRecord('qa-1')
    expect(stored?.replyCount).toBe(2)

    const replies = await testDb.getRepliesForQa('qa-1')
    expect(replies.map((r) => r.id).sort()).toEqual(['r-1', 'r-2'])
  })

  it('问题哈希与会话内查重命中最近一条', async () => {
    const now = Date.now()
    await testDb.addQaRecord(
      makeQa({ id: 'qa-old', questionTs: now - 60_000 }),
    )
    await testDb.addQaRecord(makeQa({ id: 'qa-new' }))

    const hit = await testDb.findLatestQaByHash(
      'sess-1',
      hashText('亲,支持七天无理由退换吗?'),
    )
    expect(hit?.id).toBe('qa-new')
  })

  it('同内容回复折叠判定', async () => {
    await testDb.addQaRecord(makeQa({ id: 'qa-1' }))
    await testDb.addReply(makeReply({ id: 'r-1' }))
    const dup = await testDb.hasReplyContent(
      'qa-1',
      hashText('支持,签收后 7 天内可无理由退换。'),
    )
    expect(dup).toBe(true)
    const other = await testDb.hasReplyContent('qa-1', hashText('别的回复'))
    expect(other).toBe(false)
  })

  it('嵌入回填:向量落库并标记 hasEmbedding=1', async () => {
    await testDb.addQaRecord(makeQa({ id: 'qa-1' }))
    const vec = new Float32Array(512).fill(0.1)
    await testDb.updateQaEmbedding('qa-1', vec, 'Xenova/bge-small-zh-v1.5', '2.0.0')

    const stored = await testDb.getQaRecord('qa-1')
    expect(stored?.hasEmbedding).toBe(1)
    expect(stored?.embedding).toBeInstanceOf(Float32Array)
    expect(stored?.embedding?.length).toBe(512)
    expect(stored?.embeddingModel).toBe('Xenova/bge-small-zh-v1.5')
  })

  it('预置"默认文件夹"仅创建一次(幂等)', async () => {
    await testDb.ensurePresetFolders()
    await testDb.ensurePresetFolders()
    const folder = await testDb.folders.get(UNCATEGORIZED_FOLDER_ID)
    expect(folder?.name).toBe('默认文件夹')
    expect(folder?.parentId).toBeNull()
    expect(await testDb.folders.count()).toBe(1)
  })

  it('存量旧名"未分类"启动时迁移为"默认文件夹"(第十八轮改名)', async () => {
    // 模拟旧版本库:预置行还叫「未分类」(该夹 UI 不可改名,旧名只可能来自旧版本)
    await testDb.folders.put({
      id: UNCATEGORIZED_FOLDER_ID,
      parentId: null,
      name: '未分类',
      position: 0,
      createdAt: 1,
    })
    await testDb.ensurePresetFolders()
    const folder = await testDb.folders.get(UNCATEGORIZED_FOLDER_ID)
    expect(folder?.name).toBe('默认文件夹')
    expect(await testDb.folders.count()).toBe(1)
  })
})

describe('统计与自检数据隔离', () => {
  it('getStats 排除自检会话记录', async () => {
    await testDb.addQaRecord(makeQa({ id: 'qa-1' }))
    await testDb.addReply(makeReply({ id: 'r-1' }))
    await testDb.addQaRecord(
      makeQa({ id: 'st-1', sessionKey: SELF_TEST_SESSION_KEY }),
    )
    await testDb.addReply(makeReply({ id: 'st-r-1', qaId: 'st-1' }))
    await testDb.addGolden({
      id: 'g-1',
      folderId: UNCATEGORIZED_FOLDER_ID,
      question: '标准问题?',
      answer: '标准回复。',
      questionHash: hashText('标准问题?'),
      hasEmbedding: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const stats = await testDb.getStats()
    expect(stats.qaCount).toBe(1)
    expect(stats.replyCount).toBe(2)
    expect(stats.goldenCount).toBe(1)

    const removed = await testDb.clearSelfTestRecords()
    expect(removed).toBe(1)
    expect(await testDb.qaRecords.count()).toBe(1) // qa-1 仍在
  })
})

describe('待嵌扫描(含失败重试)', () => {
  it('★ 回归:getPending* 应同时返回 hasEmbedding=0 与 -1(失败记录可被重试)', async () => {
    const now = Date.now()
    await testDb.addQaRecord(makeQa({ id: 'qa-p' })) // 待嵌
    await testDb.addQaRecord(makeQa({ id: 'qa-f', hasEmbedding: -1 })) // 失败
    await testDb.addQaRecord(makeQa({ id: 'qa-d', hasEmbedding: 1 })) // 已嵌,不参与
    const got = await testDb.getPendingQaEmbeddings(100)
    expect(got.map((r) => r.id).sort()).toEqual(['qa-f', 'qa-p'])

    await testDb.addGolden({
      id: 'g-f',
      folderId: null,
      question: 'q',
      answer: 'a',
      questionHash: hashText('q'),
      hasEmbedding: -1,
      createdAt: now,
      updatedAt: now,
    })
    const gotGolden = await testDb.getPendingGoldenEmbeddings(100)
    expect(gotGolden.map((r) => r.id)).toEqual(['g-f'])

    await testDb.addKnowledge({
      id: 'k-f',
      title: 't',
      content: 'c',
      questionHash: hashText('t'),
      hasEmbedding: -1,
      enabled: 1,
      createdAt: now,
      updatedAt: now,
    })
    const gotKb = await testDb.getPendingKnowledgeEmbeddings(100)
    expect(gotKb.map((r) => r.id)).toEqual(['k-f'])
  })

  it('getPending* 支持 excludeIds 排除(同一次补嵌运行内已失败者不重复入批)', async () => {
    await testDb.addQaRecord(makeQa({ id: 'qa-p' }))
    await testDb.addQaRecord(makeQa({ id: 'qa-f', hasEmbedding: -1 }))
    const got = await testDb.getPendingQaEmbeddings(100, new Set(['qa-p']))
    expect(got.map((r) => r.id)).toEqual(['qa-f'])
  })
})

describe('msgId 库级幂等查询(Dexie v4 索引)', () => {
  it('findQaByMsgId / findReplyByMsgId 按索引命中已入库记录', async () => {
    await testDb.addQaRecord(makeQa({ id: 'qa-1', msgId: 'b-100' }))
    await testDb.addReply(makeReply({ id: 'r-1', msgId: 'a-200' }))

    expect((await testDb.findQaByMsgId('b-100'))?.id).toBe('qa-1')
    expect((await testDb.findReplyByMsgId('a-200'))?.id).toBe('r-1')
    expect(await testDb.findQaByMsgId('missing')).toBeUndefined()
    expect(await testDb.findReplyByMsgId('missing')).toBeUndefined()
  })
})

describe('保留期清理(TTL)', () => {
  it('仅删除早于 cutoff 的问答及其回复,金标准不受影响', async () => {
    const now = Date.now()
    // 过期:60 天前;新近:今天
    await testDb.addQaRecord(
      makeQa({ id: 'qa-old', questionTs: now - 60 * 86_400_000 }),
    )
    await testDb.addQaRecord(makeQa({ id: 'qa-new' }))
    await testDb.addReply(makeReply({ id: 'r-old', qaId: 'qa-old' }))
    await testDb.addReply(makeReply({ id: 'r-new', qaId: 'qa-new' }))
    await testDb.addGolden({
      id: 'g-1',
      folderId: null,
      question: '老问题',
      answer: '老回复',
      questionHash: hashText('老问题'),
      hasEmbedding: 0,
      createdAt: now - 60 * 86_400_000,
      updatedAt: now - 60 * 86_400_000,
    })

    const removed = await testDb.purgeExpired(now, 30)
    expect(removed).toBe(1)
    expect(await testDb.qaRecords.get('qa-old')).toBeUndefined()
    expect(await testDb.replies.get('r-old')).toBeUndefined()
    expect(await testDb.qaRecords.get('qa-new')).toBeDefined()
    expect(await testDb.replies.get('r-new')).toBeDefined()
    expect(await testDb.goldens.get('g-1')).toBeDefined()
  })
})
