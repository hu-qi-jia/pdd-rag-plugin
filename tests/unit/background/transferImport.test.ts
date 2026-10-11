// 导入事务性单测(fake-indexeddb;审计"其余"项:导入多个 bulkAdd 串行无事务,
// 中途失败(如手工编辑过的文件含重复 id)会留下"文件夹已建、金标准缺失"的半成品库)。
// 目标语义:导入写库阶段整体包进 Dexie 事务,任一步失败 → 全部回滚,返回 error。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { ExportEnvelope } from '../../../src/types/transfer'
import { buildExportEnvelope } from '../../../src/background/transferPlan'
import { hashText } from '../../../src/shared/text'
import { DEFAULT_SETTINGS } from '../../../src/shared/constants'

// chrome.storage.local 内存桩:导入会调 saveSettings,必须让设置真往返
// (与 settings.test.ts 同源的桩)。
const store: Record<string, unknown> = {}

function stubLocalStorage(): void {
  const local = chrome.storage.local as unknown as Record<string, unknown>
  local.get = (
    keys: string | string[] | null,
    cb?: (r: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> => {
    const wanted = keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]
    const out: Record<string, unknown> = {}
    for (const k of wanted) if (k in store) out[k] = store[k]
    cb?.(out)
    return Promise.resolve(out)
  }
  local.set = (items: Record<string, unknown>, cb?: () => void): Promise<void> => {
    Object.assign(store, items)
    cb?.()
    return Promise.resolve()
  }
}

async function freshImport() {
  vi.resetModules()
  stubLocalStorage()
  const { importData } = await import('../../../src/background/transfer')
  const { db } = await import('../../../src/background/db')
  const { loadSettings, saveSettings } = await import('../../../src/background/settings')
  return { importData, db, loadSettings, saveSettings }
}

beforeEach(async () => {
  for (const k of Object.keys(store)) delete store[k]
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

describe('importData:API Key 不随导出外发,导入也不冲掉本机 Key', () => {
  it('真实导出的信封缺 Key → 导入后本机已存 Key 原样保留', async () => {
    const { importData, loadSettings, saveSettings } = await freshImport()
    await saveSettings({
      jevApiKey: 'sk-jev-local',
      llmApiKey: 'sk-llm-local',
      classifyEnabled: true,
    })
    // 走真实构建路径:信封里两个 Key 字段缺席
    const env = buildExportEnvelope({
      goldens: [],
      folders: [],
      settings: await loadSettings(),
      includeMemory: false,
      exportedAt: 1,
    })
    expect('jevApiKey' in env.settings).toBe(false)
    expect('llmApiKey' in env.settings).toBe(false)

    const out = await importData({ type: 'IMPORT_DATA', payload: { envelope: env } })
    expect(out.error).toBeUndefined()

    const s = await loadSettings()
    expect(s.jevApiKey).toBe('sk-jev-local')
    expect(s.llmApiKey).toBe('sk-llm-local')
    expect(s.classifyEnabled).toBe(true)
  })
})
