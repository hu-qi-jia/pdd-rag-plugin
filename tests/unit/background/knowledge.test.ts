// 知识库文档导入单测(fake-indexeddb 内存实现)。
// 背景(2026-09-16 工程审查):importKbDocument 整篇替换是"先删旧块+逐块写新块",
// 必须同事务 —— 中途失败时旧文档不能已被删除(否则整篇丢失+半成品块)。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'

/** 重置模块注册表 → knowledge/offscreen/db 单例在已删库的 fake-indexeddb 上重建 */
async function freshModules() {
  vi.resetModules()
  const knowledge = await import('../../../src/background/knowledge')
  const offscreen = await import('../../../src/background/offscreen')
  const { db } = await import('../../../src/background/db')
  return { ...knowledge, offscreen, db }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

const TWO_CHUNKS = '## 第一节\n内容一\n\n## 第二节\n内容二'

describe('importKbDocument 整篇替换', () => {
  // 特性化测试:锁定既有成功路径行为,防止事务化改造破坏正常导入
  it('成功路径:同名旧块删除、新块写入、嵌入逐块入队', async () => {
    const { importKbDocument, offscreen, db } = await freshModules()
    // no-op 化:只统计入队次数,不真正走嵌入链路(mock 环境下必失败、徒增告警噪音)
    const qSpy = vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    const first = await importKbDocument({ name: '手册.md', content: TWO_CHUNKS })
    expect(first.docId).toBe('手册')
    expect(first.chunkCount).toBe(2)
    expect(first.replaced).toBe(false)
    expect(qSpy).toHaveBeenCalledTimes(2)

    const second = await importKbDocument({ name: '手册.md', content: '## 换版\n新内容' })
    expect(second.replaced).toBe(true)
    const rows = await db.listKnowledgeByDoc('手册')
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('新内容')
  })

  it('中途失败原子性:新块写入失败时旧文档块原样保留,且不入队任何嵌入', async () => {
    const { importKbDocument, offscreen, db } = await freshModules()
    // no-op 化拦截嵌入入队:既统计调用数,又不让 mock 环境产生嵌入失败告警
    const qSpy = vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    const first = await importKbDocument({ name: '手册.md', content: TWO_CHUNKS })
    const before = await db.listKnowledgeByDoc(first.docId!)
    expect(before).toHaveLength(2)
    const queuedAfterFirst = qSpy.mock.calls.length

    const addSpy = vi
      .spyOn(db, 'addKnowledge')
      .mockResolvedValueOnce('kbd-mock-id')
      .mockRejectedValueOnce(new Error('模拟中途失败'))

    await expect(
      importKbDocument({ name: '手册.md', content: TWO_CHUNKS }),
    ).rejects.toThrow('模拟中途失败')

    // 事务回滚:旧两块原样保留,无半成品
    const after = await db.listKnowledgeByDoc(first.docId!)
    expect(after).toHaveLength(2)
    expect(after.map((k) => k.title).sort()).toEqual(before.map((k) => k.title).sort())
    // 失败的导入不得触发任何嵌入任务(含已"成功"写入的前几块)
    expect(qSpy.mock.calls.length).toBe(queuedAfterFirst)
    expect(addSpy).toHaveBeenCalledTimes(2)
  })
})
