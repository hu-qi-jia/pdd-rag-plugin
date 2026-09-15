// 导入事务性单测(fake-indexeddb;审计"其余"项:导入多个 bulkAdd 串行无事务,
// 中途失败(如手工编辑过的文件含重复 id)会留下"文件夹已建、金标准缺失"的半成品库)。
// 目标语义:导入写库阶段整体包进 Dexie 事务,任一步失败 → 全部回滚,返回 error。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { ExportEnvelope } from '../../../src/background/transferPlan'
import { hashText } from '../../../src/utils/text'
import { DEFAULT_SETTINGS } from '../../../src/types/memory'

async function freshImport() {
  vi.resetModules()
  const { importData } = await import('../../../src/background/transfer')
  const { db } = await import('../../../src/background/db')
  return { importData, db }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

function envelope(over: Partial<ExportEnvelope>): ExportEnvelope {
  return {
    version: '2.0',
    exportedAt: 1,
    settings: DEFAULT_SETTINGS,
    folders: [],
    goldens: [],
    ...over,
  }
}

describe('importData:事务性(失败整体回滚)', () => {
  it('金标准同 id 约束冲突 → 返回 error;先写入的文件夹被回滚', async () => {
    const { importData, db } = await freshImport()
    const env = envelope({
      folders: [{ id: 'fd-a', parentId: null, name: 'A', position: 0, createdAt: 1 }],
      goldens: [
        {
          id: 'g-dup',
          folderId: 'fd-a',
          question: '问题一',
          answer: '答案一',
          questionHash: hashText('问题一'),
          hasEmbedding: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          // 同 id、不同问题 → 计划不去重,入库时主键冲突
          id: 'g-dup',
          folderId: 'fd-a',
          question: '问题二',
          answer: '答案二',
          questionHash: hashText('问题二'),
          hasEmbedding: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const out = await importData({ type: 'IMPORT_DATA', payload: { envelope: env } })
    expect(out.error).toBeTruthy()
    expect(await db.folders.count()).toBe(0)
    expect(await db.goldens.count()).toBe(0)
  })

  it('成功导入不受影响:全部落库并计数', async () => {
    const { importData, db } = await freshImport()
    const env = envelope({
      folders: [{ id: 'fd-a', parentId: null, name: 'A', position: 0, createdAt: 1 }],
      goldens: [
        {
          id: 'g-1',
          folderId: 'fd-a',
          question: '问题一',
          answer: '答案一',
          questionHash: hashText('问题一'),
          hasEmbedding: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const out = await importData({ type: 'IMPORT_DATA', payload: { envelope: env } })
    expect(out.error).toBeUndefined()
    expect(out.addedFolders).toBe(1)
    expect(out.addedGoldens).toBe(1)
    expect(await db.folders.count()).toBe(1)
    expect(await db.goldens.count()).toBe(1)
  })
})
