// 升级前上传的文档识别单测(fake-indexeddb 内存实现)。
//
// 背景(第四十八轮自查更正):kbDocs 是本轮新增的表,升级前上传的文档没有对应行,
// 于是 resplitStaleKbDocs 的 getStaleKbDocs 只查 kbDocs —— 这些文档被**静默跳过**,
// 而它们的块正是旧规则切的(整篇一块,向量被多主题平均稀释),检索永远命中不到。
// 唯一出路是用户拿原文重新上传,所以必须先能把它们认出来。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { KnowledgeRecord } from '../../../src/types/memory'

async function fresh() {
  vi.resetModules()
  const { db } = await import('../../../src/background/db')
  const panel = await import('../../../src/background/panel')
  return { db, ...panel }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

function docChunk(over: Partial<KnowledgeRecord> & { id: string; docId: string }): KnowledgeRecord {
  return {
    title: `${over.docId} · 段1`,
    content: '正文',
    questionHash: `${over.docId}#0`,
    hasEmbedding: 1,
    enabled: 1,
    source: 'doc',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function manual(over: Partial<KnowledgeRecord> & { id: string }): KnowledgeRecord {
  return {
    title: '退货政策',
    content: '七天无理由',
    questionHash: 'h1',
    hasEmbedding: 1,
    enabled: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('getLegacyDocIds:有块无原文 = 升级前上传的文档', () => {
  it('装了扩展后上传的文档(有 kbDocs 行)→ 不算旧文档', async () => {
    const { db } = await fresh()
    await db.putKbDoc({
      docId: '常见问答',
      content: '# 常见问答',
      splitterVersion: '2.0.0',
      chunkCount: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    await db.addKnowledge(docChunk({ id: 'c1', docId: '常见问答' }))
    expect(await db.getLegacyDocIds()).toEqual([])
  })

  it('升级前上传的文档(只有块、没有 kbDocs 行)→ 被认出', async () => {
    const { db } = await fresh()
    await db.addKnowledge(docChunk({ id: 'c1', docId: '常见问答' }))
    await db.addKnowledge(docChunk({ id: 'c2', docId: '常见问答', questionHash: 'q#1' }))
    // 同文档多块只报一次名 —— 用户要重传的是文档,不是块
    expect(await db.getLegacyDocIds()).toEqual(['常见问答'])
  })

  it('新旧混存:只报旧的那篇', async () => {
    const { db } = await fresh()
    await db.putKbDoc({
      docId: '新文档',
      content: '# 新文档',
      splitterVersion: '2.0.0',
      chunkCount: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    await db.addKnowledge(docChunk({ id: 'n1', docId: '新文档' }))
    await db.addKnowledge(docChunk({ id: 'o1', docId: '老文档' }))
    expect(await db.getLegacyDocIds()).toEqual(['老文档'])
  })

  it('手工条目没有 docId,不会被误报成文档', async () => {
    const { db } = await fresh()
    await db.addKnowledge(manual({ id: 'm1' }))
    await db.addKnowledge(manual({ id: 'm2', title: '发货时间', questionHash: 'h2' }))
    expect(await db.getLegacyDocIds()).toEqual([])
  })

  it('重新上传后提示自行消失(同名整篇替换会写下 kbDocs 行)', async () => {
    const { db } = await fresh()
    await db.addKnowledge(docChunk({ id: 'c1', docId: '常见问答' }))
    expect(await db.getLegacyDocIds()).toEqual(['常见问答'])

    // 用户按提示重传同名文件的结果:块换成新的 + 原文落库
    await db.deleteKnowledgeByDoc('常见问答')
    await db.putKbDoc({
      docId: '常见问答',
      content: '# 常见问答',
      splitterVersion: '2.0.0',
      chunkCount: 2,
      createdAt: 2,
      updatedAt: 2,
    })
    await db.addKnowledge(docChunk({ id: 'new1', docId: '常见问答' }))
    expect(await db.getLegacyDocIds()).toEqual([])
  })

  it('文档块被删光 → 不再值得提示(没有块就没有可修复的检索)', async () => {
    const { db } = await fresh()
    await db.addKnowledge(docChunk({ id: 'c1', docId: '常见问答' }))
    await db.deleteKnowledgeByDoc('常见问答')
    expect(await db.getLegacyDocIds()).toEqual([])
  })

  it('库为空 → 空数组,不抛', async () => {
    const { db } = await fresh()
    expect(await db.getLegacyDocIds()).toEqual([])
  })
})

describe('getPanelData:把旧文档名单带给面板', () => {
  it('带 legacyDocs 字段(面板据此提示重新上传)', async () => {
    const { db, getPanelData } = await fresh()
    await db.addKnowledge(docChunk({ id: 'c1', docId: '常见问答' }))
    const data = await getPanelData({ type: 'GET_PANEL_DATA' })
    expect(data.legacyDocs).toEqual(['常见问答'])
    expect(data.knowledge).toHaveLength(1) // 旧块照样列出,不是藏起来
  })

  it('无旧文档 → 空数组(面板据此不提示)', async () => {
    const { getPanelData } = await fresh()
    const data = await getPanelData({ type: 'GET_PANEL_DATA' })
    expect(data.legacyDocs).toEqual([])
  })
})
