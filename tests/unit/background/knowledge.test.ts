// 知识库文档导入单测(fake-indexeddb 内存实现)。
// 背景(2026-09-16 工程审查):importKbDocument 整篇替换是"先删旧块+逐块写新块",
// 必须同事务 —— 中途失败时旧文档不能已被删除(否则整篇丢失+半成品块)。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { SPLITTER_VERSION } from '../../../src/shared/mdText'

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

const QA_DOC = [
  '# 常见问答',
  '',
  '- Q：防水吗？ A：不防水,请注意防雨防潮。',
  '',
  '- Q：充电要多久？ A：发射器约 90 分钟。',
].join('\n')

describe('importKbDocument · kbDocs 原文与块元数据', () => {
  it('导入后原文落库,版本为当前 SPLITTER_VERSION', async () => {
    const { importKbDocument, db, offscreen } = await freshModules()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    const r = await importKbDocument({ name: '常见问答.md', content: QA_DOC })
    expect(r.chunkCount).toBe(2)

    const doc = await db.getKbDoc('常见问答')
    expect(doc?.content).toBe(QA_DOC)
    expect(doc?.splitterVersion).toBe(SPLITTER_VERSION)
    expect(doc?.chunkCount).toBe(2)
  })

  it('块带 chunkKind=qa 与 sectionSeq,标题为「文档名 · 问句」', async () => {
    const { importKbDocument, db, offscreen } = await freshModules()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    await importKbDocument({ name: '常见问答.md', content: QA_DOC })
    const chunks = await db.listKnowledgeByDoc('常见问答')
    expect(chunks).toHaveLength(2)
    for (const c of chunks) {
      expect(c.chunkKind).toBe('qa')
      expect(c.sectionSeq).toBe(1) // 第 0 节是 H1 之前的空节
    }
    expect(chunks.map((c) => c.title).sort()).toEqual(['常见问答 · 充电要多久？', '常见问答 · 防水吗？'])
    expect(chunks.find((c) => c.title.endsWith('防水吗？'))?.content).toBe('不防水,请注意防雨防潮。')
  })

  it('重新上传同名文档 → 原文与块一起替换', async () => {
    const { importKbDocument, db, offscreen } = await freshModules()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    await importKbDocument({ name: '常见问答.md', content: QA_DOC })
    const r = await importKbDocument({
      name: '常见问答.md',
      content: '# 常见问答\n\nQ：甲？ A：甲。\n\nQ：乙？ A：乙。',
    })
    expect(r.replaced).toBe(true)
    const doc = await db.getKbDoc('常见问答')
    expect(doc?.content).toContain('甲？')
    expect(doc?.chunkCount).toBe(2)
    const chunks = await db.listKnowledgeByDoc('常见问答')
    expect(chunks).toHaveLength(2)
    expect(chunks.every((c) => c.chunkKind === 'qa')).toBe(true)
  })

  it('非问答体文档块 chunkKind=section', async () => {
    const { importKbDocument, db, offscreen } = await freshModules()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    await importKbDocument({ name: '手册.md', content: TWO_CHUNKS })
    const chunks = await db.listKnowledgeByDoc('手册')
    expect(chunks.every((c) => c.chunkKind === 'section')).toBe(true)
  })
})

describe('deleteKnowledge · 孤儿原文清理', () => {
  it('删掉某文档最后一块 → 原文一并删除', async () => {
    const { importKbDocument, deleteKnowledge, db, offscreen } = await freshModules()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    await importKbDocument({ name: '孤儿文档.md', content: QA_DOC })
    const chunks = await db.listKnowledgeByDoc('孤儿文档')
    for (const c of chunks) await deleteKnowledge(c.id)
    expect(await db.getKbDoc('孤儿文档')).toBeUndefined()
  })

  it('文档还有剩余块 → 原文保留', async () => {
    const { importKbDocument, deleteKnowledge, db, offscreen } = await freshModules()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    await importKbDocument({ name: '半删文档.md', content: QA_DOC })
    const chunks = await db.listKnowledgeByDoc('半删文档')
    await deleteKnowledge(chunks[0].id)
    expect(await db.getKbDoc('半删文档')).toBeDefined()
  })

  it('手工条目不涉及 kbDocs,删除不抛错', async () => {
    const { createKnowledge, deleteKnowledge, db } = await freshModules()
    const r = await createKnowledge({ title: '手工条目', content: '正文' })
    await expect(deleteKnowledge(r.id!)).resolves.toBeUndefined()
    expect(await db.listKnowledgeByDoc('')).toHaveLength(0)
  })
})
