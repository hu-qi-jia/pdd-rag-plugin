/**
 * 使用统计落库单测(v0.16,fake-indexeddb)。
 *
 * 两条最容易悄悄坏掉的约定在这里钉住:
 *  ① 计数写入**不得**使检索缓存失效 —— 否则每次检索都白重建一次全表缓存;
 *  ② 条目删除时它的逐条用量键跟着走 —— 否则库里攒一堆查不到主人的孤儿计数。
 */
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { getRetrievalEntries } from '../../../src/background/retrievalCache'
import { itemMetricKey } from '../../../src/shared/metrics'
import type { GoldenRecord, KnowledgeRecord } from '../../../src/types/memory'

let testDb: PddDatabase

function makeGolden(id: string, question: string, embedding: Float32Array): GoldenRecord {
  return {
    id,
    folderId: null,
    question,
    answer: `answer-${id}`,
    questionHash: `h-${id}`,
    qEmbedding: embedding,
    hasEmbedding: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeKnowledge(id: string, embedding: Float32Array): KnowledgeRecord {
  return {
    id,
    title: `title-${id}`,
    content: `content-${id}`,
    questionHash: `h-${id}`,
    qEmbedding: embedding,
    hasEmbedding: 1,
    enabled: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
  testDb = new PddDatabase()
  // 检索缓存是模块级单例:上一个用例留下的条目会污染下一个(每个用例各自 delete 库)
  const { invalidateRetrievalCache } = await import('../../../src/background/retrievalCache')
  invalidateRetrievalCache()
})

describe('bumpMetrics 计数', () => {
  it('键不存在则建,重复自增累加', async () => {
    await testDb.bumpMetrics(['search.total'])
    await testDb.bumpMetric('search.total')
    await testDb.bumpMetrics(['search.total', 'search.miss'])
    const snapshot = await testDb.listMetrics()
    const byKey = new Map(snapshot.map((r) => [r.key, r.count]))
    expect(byKey.get('search.total')).toBe(3)
    expect(byKey.get('search.miss')).toBe(1)
  })

  it('updatedAt 随每次自增刷新(排查僵尸键用)', async () => {
    await testDb.bumpMetric('fill.golden')
    const first = (await testDb.listMetrics())[0].updatedAt
    await new Promise((r) => setTimeout(r, 2))
    await testDb.bumpMetric('fill.golden')
    const second = (await testDb.listMetrics())[0].updatedAt
    expect(second).toBeGreaterThanOrEqual(first)
  })

  it('空键列表直接返回,不写库', async () => {
    await testDb.bumpMetrics([])
    expect(await testDb.listMetrics()).toHaveLength(0)
  })
})

describe('listItemUsage 逐条用量', () => {
  it('按条目 id 归并金标准与知识库两侧的计数', async () => {
    await testDb.bumpMetrics([
      itemMetricKey('golden', 'g1'),
      itemMetricKey('golden', 'g1'),
      itemMetricKey('knowledge', 'k1'),
    ])
    expect(await testDb.listItemUsage()).toEqual({ g1: 2, k1: 1 })
  })

  it('全局事件键不会被误认成条目 id', async () => {
    await testDb.bumpMetrics(['search.total', 'panel.open.click'])
    expect(await testDb.listItemUsage()).toEqual({})
  })
})

describe('clearMetrics 重置', () => {
  it('清空全部计数并返回清掉的键数(业务数据不动)', async () => {
    await testDb.addGolden(makeGolden('g1', 'q', new Float32Array([1, 0])))
    await testDb.bumpMetrics(['search.total', itemMetricKey('golden', 'g1')])
    expect(await testDb.clearMetrics()).toBe(2)
    expect(await testDb.listMetrics()).toHaveLength(0)
    expect(await testDb.goldens.count()).toBe(1)
  })
})

describe('条目删除带走它的用量键', () => {
  it('删金标准 → 该条目的用量键一并删除', async () => {
    await testDb.addGolden(makeGolden('g1', 'q', new Float32Array([1, 0])))
    await testDb.bumpMetric(itemMetricKey('golden', 'g1'))
    await testDb.deleteGolden('g1')
    expect(await testDb.listItemUsage()).toEqual({})
  })

  it('整篇删除文档 → 其下所有块的用量键一并删除;别篇文档的计数不受牵连', async () => {
    const chunk = (id: string, docId: string): KnowledgeRecord => ({
      ...makeKnowledge(id, new Float32Array([1, 0])),
      docId,
      source: 'doc',
    })
    await testDb.knowledge.bulkPut([chunk('d1', 'kb-doc'), chunk('d2', 'kb-doc'), chunk('d3', 'other')])
    await testDb.bumpMetrics(
      ['d1', 'd2', 'd3'].map((id) => itemMetricKey('knowledge', id)),
    )

    expect(await testDb.deleteKnowledgeByDoc('kb-doc')).toBe(2)
    expect(await testDb.listItemUsage()).toEqual({ d3: 1 })
  })
})

describe('埋点不拖累检索', () => {
  it('写计数不会使检索缓存失效(否则每次检索都白重建一次全表缓存)', async () => {
    await testDb.addGolden(makeGolden('g1', 'q', new Float32Array([1, 0])))
    const first = await getRetrievalEntries()
    expect(first).toHaveLength(1)

    await testDb.bumpMetrics(['search.total', itemMetricKey('golden', 'g1')])

    // 同一个数组引用 = 缓存仍然生效(失效会被置为 null,下次重新构建出新数组)
    expect(await getRetrievalEntries()).toBe(first)
  })
})

describe('待沉淀忽略项', () => {
  it('按下问题哈希幂等写入与删除', async () => {
    await testDb.ignoreBacklog('h1', '怎么退货')
    await testDb.ignoreBacklog('h1', '怎么退货') // 重复忽略:仍是同一条
    expect(await testDb.listBacklogIgnores()).toHaveLength(1)

    await testDb.unignoreBacklog('h1')
    expect(await testDb.listBacklogIgnores()).toHaveLength(0)
  })
})
