/**
 * 库版本升级单测(v0.16 → v7,fake-indexeddb)。
 *
 * 「撤掉一个页签」这件事在代码里是删文件,在**用户的库里**是另一回事:已经跑过 v6 的
 * 库里 `backlogIgnores` 表还在,Dexie 不会因为再没人读它就把它抹掉 —— 得显式声明删表。
 * 这里造出真实的旧库(把 v1~v6 的 schema 原样搭一遍),再用**真的** `PddDatabase` 打开,
 * 验两件事:
 *  ① v7 之后表确实没了(v6→v7 路径);
 *  ② 顺带把老库一路升到 v7 是可行的、业务数据分毫未动(v5→v7 路径,真实用户走的就是这条)。
 * 只测"新装直接建 v7"是不够的 —— 那条路 e2e 已经覆盖,而升级路只有这里能验。
 */
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'

/** 旧库 schema:照抄 db.ts 里 v1~v6 的定义(测试夹具,刻意不共用运行时定义) */
const LEGACY_VERSIONS: Array<Record<string, string>> = [
  {
    qaRecords: 'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs]',
    replies: 'id, qaId, contentHash, ts',
    goldens: 'id, folderId, questionHash, hasEmbedding',
    folders: 'id, parentId',
    knowledge: 'id, questionHash, hasEmbedding, enabled',
    errors: '++id, timestamp',
  },
  { knowledge: 'id, questionHash, hasEmbedding, enabled' },
  { knowledge: 'id, questionHash, hasEmbedding, enabled, docId' },
  {
    qaRecords:
      'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs], msgId',
    replies: 'id, qaId, contentHash, ts, msgId',
  },
  { kbDocs: 'docId, splitterVersion' },
  { metrics: 'key', backlogIgnores: 'questionHash' },
]

/** 建一个"跑过 v6"的旧库,并塞进一条金标准、一条统计、一条待沉淀忽略标记 */
async function seedLegacyDb(versions: number): Promise<void> {
  const legacy = new Dexie('PddCSDB')
  for (let i = 0; i < versions; i++) legacy.version(i + 1).stores(LEGACY_VERSIONS[i])
  await legacy.open()
  await legacy.table('goldens').add({
    id: 'g-old',
    folderId: null,
    question: '旧库里就有的问题',
    answer: '旧库里就有的回答',
    questionHash: 'h-old',
    hasEmbedding: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  if (versions >= 6) {
    await legacy.table('metrics').add({ key: 'search.total', count: 7, updatedAt: 1 })
    await legacy.table('backlogIgnores').add({
      questionHash: 'h-ignored',
      question: '不想再看到的问题',
      createdAt: 1,
    })
  }
  legacy.close()
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('库升级到 v7', () => {
  it('v6 → v7:显式删表,孤儿表不再存在', async () => {
    await seedLegacyDb(6)

    const db = new PddDatabase()
    await db.open()
    const names = db.tables.map((t) => t.name)
    db.close()

    expect(names).not.toContain('backlogIgnores')
    expect(names).toContain('metrics')
  })

  it('v5 → v7:老库照常升上来,业务数据分毫未动', async () => {
    await seedLegacyDb(5)

    const db = new PddDatabase()
    await db.open()
    const golden = await db.goldens.get('g-old')
    const tables = db.tables.map((t) => t.name)
    db.close()

    expect(golden?.question).toBe('旧库里就有的问题')
    // v0.15.1 的库里本来就没有 metrics(它在 v6 才加),升级后空表可用即可
    expect(tables).toEqual(expect.arrayContaining(['metrics', 'kbDocs']))
  })

  it('升级不吞掉 v6 才有的表:metrics 数据照常读得到', async () => {
    await seedLegacyDb(6)

    const db = new PddDatabase()
    await db.open()
    const metric = await db.metrics.get('search.total')
    // 删的是 backlogIgnores,不是"顺手把 v6 加的表一起清了"
    expect(metric?.count).toBe(7)
    db.close()
  })
})

// ─── v7 → v8:旧文件夹转自定义类型 ─────────────────────────────────────────────
//
// 这一步的失败模式是"用户以为数据丢了":如果迁移把原本挂在「双十一」夹里的标准回答
// 落进未分类,用户打开面板会认为手工整理白做了。所以三条断言必须同时成立 ——
// 文件夹名还在、归属还对、且被标成人工的(机器不许再动)。

/** v7 的完整 schema(v1~v7 原样搭一遍,刻意不共用运行时定义) */
const LEGACY_V7: Array<Record<string, string | null>> = [
  {
    qaRecords: 'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs]',
    replies: 'id, qaId, contentHash, ts',
    goldens: 'id, folderId, questionHash, hasEmbedding',
    folders: 'id, parentId',
    errors: '++id, timestamp',
  },
  { knowledge: 'id, questionHash, hasEmbedding, enabled' },
  { knowledge: 'id, questionHash, hasEmbedding, enabled, docId' },
  {
    qaRecords:
      'id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs], msgId',
    replies: 'id, qaId, contentHash, ts, msgId',
  },
  { kbDocs: 'docId, splitterVersion' },
  { metrics: 'key', backlogIgnores: 'questionHash' },
  { backlogIgnores: null },
]

/** 造一个"跑过 v7"的库:两个文件夹、两条标答(一条在夹里、一条没入夹) */
async function seedLegacyV7(): Promise<void> {
  const legacy = new Dexie('PddCSDB')
  LEGACY_V7.forEach((stores, i) => {
    legacy.version(i + 1).stores(stores)
  })
  await legacy.open()
  await legacy.table('folders').bulkAdd([
    { id: 'uncategorized', parentId: null, name: '默认文件夹', position: 0, createdAt: 1000 },
    { id: 'f-hot', parentId: null, name: '双十一', position: 1, createdAt: 2000 },
  ])
  await legacy.table('goldens').bulkAdd([
    {
      id: 'gd-in-folder',
      folderId: 'f-hot',
      question: '能便宜点吗',
      answer: '亲,已经是最低价啦',
      questionHash: 'h1',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'gd-no-folder',
      folderId: null,
      question: '多久发货',
      answer: '48 小时内发出',
      questionHash: 'h2',
      hasEmbedding: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  legacy.close()
}

describe('v7 → v8 旧文件夹迁移', () => {
  beforeEach(async () => {
    await Dexie.delete('PddCSDB')
  })

  it('每个旧文件夹转成一条 filterable=false 的自定义类型', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()

    const hot = await upgraded.categories.get('legacy:f-hot')
    expect(hot).toBeDefined()
    expect(hot!.name).toBe('双十一')
    expect(hot!.kind).toBe('custom')
    expect(hot!.filterable).toBe(false)
    expect(hot!.criteria).toBe('')

    const presetDefault = await upgraded.categories.get('legacy:uncategorized')
    expect(presetDefault!.name).toBe('默认文件夹')
    upgraded.close()
  })

  it('标准回答的归属跟着搬,且标成人工的(机器永不许覆盖)', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()

    const inFolder = (await upgraded.goldens.get('gd-in-folder'))!
    expect(inFolder.categoryId).toBe('legacy:f-hot')
    expect(inFolder.categorySource).toBe('manual')

    const noFolder = (await upgraded.goldens.get('gd-no-folder'))!
    expect(noFolder.categoryId).toBeNull()
    expect(noFolder.categorySource).toBeUndefined()
    upgraded.close()
  })

  it('业务数据分毫未动:问题与答案原文还在', async () => {
    await seedLegacyV7()
    const upgraded = new PddDatabase()
    await upgraded.open()
    const g = (await upgraded.goldens.get('gd-in-folder'))!
    expect(g.question).toBe('能便宜点吗')
    expect(g.answer).toBe('亲,已经是最低价啦')
    expect(g.folderId).toBe('f-hot')
    upgraded.close()
  })

  it('新装(没有旧库)直接建 v8,不跑迁移也不报错', async () => {
    const fresh = new PddDatabase()
    await fresh.open()
    await fresh.ensurePresetCategories()
    expect(await fresh.categories.count()).toBe(7)
    fresh.close()
  })
})
