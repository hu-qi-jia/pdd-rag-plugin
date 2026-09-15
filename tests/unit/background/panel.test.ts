// 面板数据编排单测(fake-indexeddb 内存实现):getMemoryList 的金标徽标回带。
// 背景(2026-09-15 评审 PM1):「已设为标准回答」原是会话级 state,重开 popup 即丢;
// 现改为 GET_MEMORY_LIST 按 goldens.sourceReplyId 回带 goldenId,前端从数据派生徽标。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { QaRecord, ReplyRecord, GoldenRecord } from '../../../src/types/memory'
import { hashText } from '../../../src/utils/text'

/** 重置模块注册表 → panel.ts(及其单例 db)在已删库的 fake-indexeddb 上重建 */
async function freshPanel() {
  vi.resetModules()
  const { getMemoryList } = await import('../../../src/background/panel')
  const { db } = await import('../../../src/background/db')
  return { getMemoryList, db }
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

function makeReply(over: Partial<ReplyRecord> & { id: string }): ReplyRecord {
  const text = over.text ?? '可以,支持电子发票。'
  return {
    qaId: 'qa-1',
    text,
    contentHash: hashText(text),
    ts: Date.now(),
    hasEmbedding: 0,
    ...over,
  }
}

function makeGolden(over: Partial<GoldenRecord> & { id: string }): GoldenRecord {
  const now = Date.now()
  return {
    folderId: null,
    question: '能开发票吗?',
    answer: '可以,支持电子发票。',
    questionHash: hashText('能开发票吗?'),
    hasEmbedding: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('getMemoryList:金标徽标持久化(goldenId 回带)', () => {
  it('回复若被提升为标准回答(sourceReplyId 命中)→ 回带 goldenId', async () => {
    const { getMemoryList, db } = await freshPanel()
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addReply(makeReply({ id: 'r-1' }))
    await db.addReply(makeReply({ id: 'r-2', text: '换个说法:支持开票。' }))
    await db.goldens.add(
      makeGolden({ id: 'g-1', sourceRecordId: 'qa-1', sourceReplyId: 'r-1' }),
    )

    const { items } = await getMemoryList({ type: 'GET_MEMORY_LIST' })
    const replies = items.find((i) => i.id === 'qa-1')!.replies
    expect(replies.find((r) => r.id === 'r-1')?.goldenId).toBe('g-1')
    // 未提升的回复不带 goldenId
    expect(replies.find((r) => r.id === 'r-2')?.goldenId).toBeUndefined()
  })

  it('手工新建的金标准(无来源溯源)不影响任何回复的徽标', async () => {
    const { getMemoryList, db } = await freshPanel()
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addReply(makeReply({ id: 'r-1' }))
    await db.goldens.add(makeGolden({ id: 'g-manual' }))

    const { items } = await getMemoryList({ type: 'GET_MEMORY_LIST' })
    const replies = items.find((i) => i.id === 'qa-1')!.replies
    expect(replies.find((r) => r.id === 'r-1')?.goldenId).toBeUndefined()
  })
})
