// 检索编排层单测(编排层原是测试盲区,评审"其余"项点名)。
// searchSuggestions 的 IO/装配在 search.ts,纯逻辑在 retrieval.ts(已有单测);
// 此处 mock 掉 offscreen 嵌入,用确定性向量锁住编排行为:
// 阈值门控 → 候选展开 → 折叠配额,以及工程5b 缓存接线后"写入即失效"的端到端语义。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { QaRecord, ReplyRecord, GoldenRecord } from '../../../src/types/memory'
import { hashText } from '../../../src/shared/text'

// offscreen 依赖 chrome.runtime 消息通道:编排测试不关心嵌入实现,
// mock 为确定性函数 —— 含"发票"→[1,0],否则→[0,1](正交 ⇒ 余弦 0/1 可预测)。
vi.mock('../../../src/background/offscreen', () => ({
  embedViaOffscreen: vi.fn(async (text: string) =>
    text.includes('发票') ? Float32Array.from([1, 0]) : Float32Array.from([0, 1]),
  ),
  queueEmbedding: vi.fn(),
}))

async function freshSearch() {
  vi.resetModules()
  const { searchSuggestions } = await import('../../../src/background/search')
  const { db } = await import('../../../src/background/db')
  return { searchSuggestions, db }
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

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('searchSuggestions:编排行为', () => {
  it('历史源:问题过阈 → 展开回复为历史候选', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: Float32Array.from([1, 0]) }),
    )
    await db.addReply(makeReply({ id: 'r-1', qaId: 'qa-1', text: '可以,支持电子发票。' }))

    const out = await searchSuggestions('能开发票吗?')
    expect(out.error).toBeUndefined()
    expect(out.suggestions.some((s) => s.kind === 'history' && s.text.includes('电子发票'))).toBe(
      true,
    )
  })

  it('金标准源:过阈 → 返回标准回答正文', async () => {
    const { searchSuggestions, db } = await freshSearch()
    const now = Date.now()
    await db.goldens.add({
      id: 'g-1',
      folderId: null,
      question: '退货政策是什么?',
      answer: '7 天无理由退货,邮费我们承担。',
      questionHash: hashText('退货政策是什么?'),
      qEmbedding: Float32Array.from([0, 1]),
      hasEmbedding: 1,
      createdAt: now,
      updatedAt: now,
    } satisfies GoldenRecord)

    // 查询"退货"不含"发票" → [0,1],与金标准向量余弦 1,过 goldenThreshold 0.4
    const out = await searchSuggestions('退货政策是什么?')
    expect(out.suggestions.some((s) => s.kind === 'golden' && s.text.includes('7 天无理由'))).toBe(
      true,
    )
  })

  it('正交向量不过阈 → 无候选(阈值门控生效)', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: Float32Array.from([1, 0]) }),
    )
    // "退货"查询 → [0,1],与 qa 向量余弦 0,低于 history 阈值 0.5
    const out = await searchSuggestions('退货政策')
    expect(out.suggestions).toHaveLength(0)
  })
})

describe('searchSuggestions × 检索缓存(工程5b):写入即失效', () => {
  it('补嵌完成后的下一次检索能看到新记录(缓存被写路径失效)', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addReply(makeReply({ id: 'r-1', qaId: 'qa-1', text: '支持电子发票。' }))

    // 未嵌:无候选,同时缓存以"空集"建立
    const before = await searchSuggestions('能开发票吗?')
    expect(before.suggestions).toHaveLength(0)

    // 补嵌完成(走 db 写路径 → 必须失效缓存)
    await db.updateQaEmbedding('qa-1', Float32Array.from([1, 0]), 'mock-model', 'v1')

    const after = await searchSuggestions('能开发票吗?')
    expect(after.suggestions.some((s) => s.text.includes('电子发票'))).toBe(true)
  })

  it('删除问答后的下一次检索不再返回其回复', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: Float32Array.from([1, 0]) }),
    )
    await db.addReply(makeReply({ id: 'r-1', qaId: 'qa-1', text: '支持电子发票。' }))
    expect((await searchSuggestions('能开发票吗?')).suggestions).toHaveLength(1)

    await db.deleteQaWithReplies('qa-1')
    expect((await searchSuggestions('能开发票吗?')).suggestions).toHaveLength(0)
  })
})
