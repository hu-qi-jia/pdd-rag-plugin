// processPendingEmbeddings 补嵌循环测试(fake-indexeddb + offscreen mock)。
// 重点:失败(-1)记录在下次运行重试;同一次运行内失败者不重复入批(循环必须终止)。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'

vi.mock('../../../src/background/embedding', () => ({
  MODEL_NAME: 'test-model',
  EMBEDDING_VERSION: 'test-1',
}))

const { embedBatchMock } = vi.hoisted(() => ({ embedBatchMock: vi.fn() }))

vi.mock('../../../src/background/offscreen', () => ({
  embedBatchViaOffscreen: (...args: unknown[]) => embedBatchMock(...args),
  queueEmbedding: vi.fn(),
}))

import { db } from '../../../src/background/db'
import { processPendingEmbeddings } from '../../../src/background/syncEmbeddings'
import { hashText } from '../../../src/shared/text'
import type { QaRecord } from '../../../src/types/memory'
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

beforeEach(async () => {
  embedBatchMock.mockReset()
  // 单例 db:删库重开,保证测试隔离
  await db.delete()
  await db.open()
})

describe('processPendingEmbeddings', () => {
  it('★ 回归:标记 -1 的失败记录应在下次运行重试(旧代码只查 =0,失败即永久丢弃)', async () => {
    await db.addQaRecord(makeQa({ id: 'qa-1' }))

    // 第一轮:整批失败 → -1
    embedBatchMock.mockResolvedValue([null])
    await processPendingEmbeddings()
    expect((await db.getQaRecord('qa-1'))?.hasEmbedding).toBe(-1)

    // 第二轮(模拟下次 SW 启动):模型就绪 → 重试成功置 1
    embedBatchMock.mockResolvedValue([new Float32Array(4)])
    await processPendingEmbeddings()
    const stored = await db.getQaRecord('qa-1')
    expect(stored?.hasEmbedding).toBe(1)
    expect(embedBatchMock).toHaveBeenCalledTimes(2)
  })

  it('同一次运行内失败记录不重复入批:整批失败后循环仍终止', async () => {
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addQaRecord(
      makeQa({ id: 'qa-2', question: 'q2', questionHash: hashText('q2') }),
    )

    embedBatchMock.mockResolvedValue([null, null])
    await processPendingEmbeddings() // 若把 -1 纳入查询却不排除本轮失败者,这里会死循环

    expect(embedBatchMock).toHaveBeenCalledTimes(1)
    expect((await db.getQaRecord('qa-1'))?.hasEmbedding).toBe(-1)
    expect((await db.getQaRecord('qa-2'))?.hasEmbedding).toBe(-1)
  })

  it('批量异常(EMBED_BATCH reject)同样终止并标记 -1,下轮重试', async () => {
    await db.addQaRecord(makeQa({ id: 'qa-1' }))

    embedBatchMock.mockRejectedValue(new Error('EMBED_BATCH failed'))
    await processPendingEmbeddings()
    expect((await db.getQaRecord('qa-1'))?.hasEmbedding).toBe(-1)

    embedBatchMock.mockResolvedValue([new Float32Array(4)])
    await processPendingEmbeddings()
    expect((await db.getQaRecord('qa-1'))?.hasEmbedding).toBe(1)
  })
})
