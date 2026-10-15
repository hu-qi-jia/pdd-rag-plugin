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

// ─── 分类随导入往返(计划层单测在 transfer.test.ts,这里只钉 DB 接线)───────────
//
// 计划层测不出"忘了把 db.categories 加进事务""忘了在建类型之前 resolve"这类接线错误 ——
// 那一类错误的表现恰恰是"计划对了、库里没有"。

const catRec = (id: string, name: string) => ({
  id,
  name,
  criteria: `criteria-${name}`,
  kind: 'custom' as const,
  route: 'retrieve' as const,
  filterable: true,
  position: 100,
  createdAt: 1,
  updatedAt: 2,
})

describe('importData:分类往返', () => {
  it('★ 类型表落库,记录的 categoryId 换成**本地** id', async () => {
    const { importData, db } = await freshImport()
    const env = envelope({
      categories: [catRec('src-uuid', '发票咨询')],
      goldens: [
        {
          id: 'g-1',
          folderId: null,
          question: '问题一',
          answer: '答案一',
          questionHash: hashText('问题一'),
          hasEmbedding: 0,
          categoryId: 'src-uuid',
          categorySource: 'manual',
          categoryAt: 7,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const out = await importData({ type: 'IMPORT_DATA', payload: { envelope: env } })
    expect(out.error).toBeUndefined()
    expect(out.addedCategories).toBe(1)
    expect(await db.categories.count()).toBe(1)
    const g = await db.goldens.get('g-1')
    expect(g?.categoryId).toBe('src-uuid')
    // ★ 人工标注必须活下来:丢了它,机器补分类会覆盖用户的手工摆放
    expect(g?.categorySource).toBe('manual')
  })

  it('★ 本地已有同名类型 → 不重复建,记录挂到本地那条上', async () => {
    const { importData, db } = await freshImport()
    await db.categories.put(catRec('dst-uuid', '发票咨询'))

    const env = envelope({
      categories: [catRec('src-uuid', '发票咨询')],
      goldens: [
        {
          id: 'g-1',
          folderId: null,
          question: '问题一',
          answer: '答案一',
          questionHash: hashText('问题一'),
          hasEmbedding: 0,
          categoryId: 'src-uuid',
          categorySource: 'jev',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const out = await importData({ type: 'IMPORT_DATA', payload: { envelope: env } })
    expect(out.addedCategories).toBe(0)
    expect(out.skippedCategories).toBe(1)
    // 只在导入前那条,没有多出一条同名
    expect(await db.categories.count()).toBe(1)
    expect((await db.goldens.get('g-1'))?.categoryId).toBe('dst-uuid')
  })

  it('★ 悬空 categoryId → 记录落未分类,不留残骸', async () => {
    const { importData, db } = await freshImport()
    const env = envelope({
      // 信封里没有类型表,记录的 categoryId 指向一个不存在的 id
      goldens: [
        {
          id: 'g-1',
          folderId: null,
          question: '问题一',
          answer: '答案一',
          questionHash: hashText('问题一'),
          hasEmbedding: 0,
          categoryId: 'nowhere',
          categorySource: 'jev',
          categoryConfidence: 0.9,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const out = await importData({ type: 'IMPORT_DATA', payload: { envelope: env } })
    expect(out.error).toBeUndefined()
    const g = await db.goldens.get('g-1')
    expect(g).not.toHaveProperty('categoryId')
    expect(g).not.toHaveProperty('categorySource')
    expect(g).not.toHaveProperty('categoryConfidence')
  })

  it('旧导出文件(信封里没有 categories 字段)→ 不建类型,行为与从前一致', async () => {
    const { importData, db } = await freshImport()
    const env = envelope({
      goldens: [
        {
          id: 'g-1',
          folderId: null,
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
    expect(out.addedCategories).toBe(0)
    expect(await db.categories.count()).toBe(0)
    expect(await db.goldens.get('g-1')).not.toHaveProperty('categoryId')
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
