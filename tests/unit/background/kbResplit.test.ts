// 分块器版本迁移单测(fake-indexeddb 内存实现)。
// 背景:knowledge 只存切好的块,分块规则一变旧块就无法原地修正;kbDocs 存了原文,
// 使 SW 启动时按新规则自动重切成为可能 —— 用户不必手动重传文档。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { SPLITTER_VERSION } from '../../../src/shared/mdText'

async function freshModules() {
  vi.resetModules()
  const kbResplit = await import('../../../src/background/kbResplit')
  const offscreen = await import('../../../src/background/offscreen')
  const { db } = await import('../../../src/background/db')
  return { ...kbResplit, offscreen, db }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

const QA_MD = [
  '# 常见问答',
  '',
  '- Q：防水吗？ A：不防水,请注意防雨防潮。',
  '',
  '- Q：充电要多久？ A：发射器约 90 分钟。',
].join('\n')

describe('resplitStaleKbDocs', () => {
  it('版本失配的文档按新规则重切:旧单块 → 两条 QA 块', async () => {
    const { resplitStaleKbDocs, offscreen, db } = await freshModules()
    const qSpy = vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    // 造旧版本状态:旧规则把整篇切成 1 块(kbDocs 版本记 1.0.0)
    await db.putKbDoc({
      docId: '老文档',
      content: QA_MD,
      splitterVersion: '1.0.0',
      chunkCount: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    await db.addKnowledge({
      id: 'old-1',
      title: '老文档 · 常见问答',
      content: '防水吗？ 不防水,请注意防雨防潮。 充电要多久？ 发射器约 90 分钟。',
      questionHash: 'old#0',
      hasEmbedding: 1,
      enabled: 1,
      source: 'doc',
      docId: '老文档',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(await resplitStaleKbDocs()).toBe(1)

    const chunks = await db.listKnowledgeByDoc('老文档')
    expect(chunks).toHaveLength(2)
    expect(chunks.map((c) => c.chunkKind)).toEqual(['qa', 'qa'])
    expect(chunks.map((c) => c.title).sort()).toEqual(['老文档 · 充电要多久？', '老文档 · 防水吗？'])
    // 新块必须待嵌(锚文本变了,旧向量不能复用)
    expect(chunks.every((c) => c.hasEmbedding === 0)).toBe(true)
    expect(qSpy).toHaveBeenCalledTimes(2)

    const updated = await db.getKbDoc('老文档')
    expect(updated?.splitterVersion).toBe(SPLITTER_VERSION)
    expect(updated?.chunkCount).toBe(2)
    expect(updated?.createdAt).toBe(1) // 原文本身没变,只更新版本与块数
  })

  it('版本已是最新 → 不动', async () => {
    const { resplitStaleKbDocs, offscreen, db } = await freshModules()
    const qSpy = vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    const r = await (
      await import('../../../src/background/knowledge')
    ).importKbDocument({ name: '新文档.md', content: QA_MD })
    expect(r.chunkCount).toBe(2)
    qSpy.mockClear()

    expect(await resplitStaleKbDocs()).toBe(0)
    expect(qSpy).not.toHaveBeenCalled()
    expect(await db.listKnowledgeByDoc('新文档')).toHaveLength(2)
  })

  it('多个失配文档各自重切', async () => {
    const { resplitStaleKbDocs, offscreen, db } = await freshModules()
    vi.spyOn(offscreen, 'queueEmbedding').mockImplementation(() => {})

    for (const id of ['甲', '乙']) {
      await db.putKbDoc({
        docId: id,
        content: QA_MD,
        splitterVersion: '1.0.0',
        chunkCount: 1,
        createdAt: 1,
        updatedAt: 1,
      })
    }
    expect(await resplitStaleKbDocs()).toBe(2)
    expect(await db.listKnowledgeByDoc('甲')).toHaveLength(2)
    expect(await db.listKnowledgeByDoc('乙')).toHaveLength(2)
  })

  it('无 kbDocs 记录的库(升级前上传的文档)→ 无事发生', async () => {
    const { resplitStaleKbDocs } = await freshModules()
    expect(await resplitStaleKbDocs()).toBe(0)
  })
})
