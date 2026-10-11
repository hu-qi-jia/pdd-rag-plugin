// 批量补存量:候选口径、跳过规则、并发上限、单条失败不阻塞(第五十六轮)
import 'fake-indexeddb/auto'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'
import { runBackfill, type BackfillProgress } from '../../../src/background/classify'
import { hashText } from '../../../src/shared/text'
import type { GoldenRecord, QaRecord } from '../../../src/types/memory'

const OPTIONS = [{ id: 'preset:order', name: '订单物流', criteria: '发货时间、催发货…' }]
const CONFIG = {
  baseUrl: 'https://api.example.com',
  apiKey: 'k',
  model: 'jev-latest',
  timeoutMs: 3000,
}

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '快递到哪了?',
    questionHash: hashText('快递到哪了?'),
    questionTs: now,
    hasEmbedding: 1,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function makeGolden(over: Partial<GoldenRecord> & { id: string }): GoldenRecord {
  const now = Date.now()
  return {
    folderId: 'uncategorized',
    question: '快递到哪了?',
    answer: '48 小时内发出',
    questionHash: `h-${over.id}`,
    hasEmbedding: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function okResponse(): Response {
  return new Response(
    JSON.stringify({
      answers: {
        category: { type: 'choice', choice: '订单物流', probabilities: { 订单物流: 0.9 }, confidence: 0.8 },
      },
    }),
    { status: 200 },
  )
}

// ─── Group A:候选口径(真库) ───────────────────────────────────────────────────

describe('补分类候选口径', () => {
  let testDb: PddDatabase

  beforeEach(async () => {
    await Dexie.delete('PddCSDB')
    testDb = new PddDatabase()
    await testDb.open()
    await testDb.ensurePresetCategories()
  })

  it('只算「待分类 + 重跑」,不含 manual 与 inherit', async () => {
    const cat = (await testDb.categories.get('preset:order'))!
    await testDb.qaRecords.bulkAdd([
      makeQa({ id: 'a' }), // categoryId 缺失 → 待分类
      makeQa({ id: 'b', categoryId: UNCATEGORIZED_CATEGORY_ID }), // 未分类 → 待分类
      makeQa({ id: 'c', categoryId: 'preset:order', categorySource: 'manual' }), // 跳过
      makeQa({
        id: 'd',
        categoryId: 'preset:order',
        categorySource: 'jev',
        categoryAt: cat.updatedAt - 1, // 类型定义改过 → 重跑
      }),
      makeQa({
        id: 'e',
        categoryId: 'preset:order',
        categorySource: 'jev',
        categoryAt: cat.updatedAt + 1, // 打标晚于类型定义 → 不算
      }),
    ])
    const snap = await testDb.snapshotBackfillCandidates()
    expect(snap.history.map((r) => r.id).sort()).toEqual(['a', 'b', 'd'])
  })

  it('manual 的条目不在快照里 —— 机器永不许覆盖', async () => {
    await testDb.qaRecords.add(
      makeQa({ id: 'm', categoryId: 'preset:order', categorySource: 'manual', categoryAt: 1 }),
    )
    expect((await testDb.snapshotBackfillCandidates()).history).toHaveLength(0)
  })

  it('inherit 且已归类 → 两边都不进', async () => {
    await testDb.goldens.add(
      makeGolden({ id: 'g1', categoryId: 'preset:order', categorySource: 'inherit', categoryAt: 1 }),
    )
    expect((await testDb.snapshotBackfillCandidates()).golden).toHaveLength(0)
  })

  it('inherit 但没归类出来 → 仍要补(「继承不出来」和「不用补」是两回事)', async () => {
    await testDb.goldens.add(
      makeGolden({
        id: 'g2',
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        categorySource: 'inherit',
        categoryAt: 1,
      }),
    )
    expect((await testDb.snapshotBackfillCandidates()).golden.map((r) => r.id)).toEqual(['g2'])
  })

  it('快照只带 id 与问题文本,不带向量(几万条时内存才扛得住)', async () => {
    await testDb.qaRecords.add(
      makeQa({ id: 'v1', embedding: Float32Array.from([1, 2, 3]), categoryId: null }),
    )
    const row = (await testDb.snapshotBackfillCandidates()).history[0]
    expect(Object.keys(row).sort()).toEqual(['id', 'question'])
  })

  it('countBackfillCandidates 与快照同口径', async () => {
    await testDb.qaRecords.bulkAdd([makeQa({ id: 'a' }), makeQa({ id: 'b' })])
    const counts = await testDb.countBackfillCandidates()
    const snap = await testDb.snapshotBackfillCandidates()
    expect(counts.history).toBe(snap.history.length)
    expect(counts.golden).toBe(snap.golden.length)
    expect(counts.history).toBe(2)
  })
})

// ─── Group B:批量执行编排(注入 deps,不触库不触网) ────────────────────────────

describe('runBackfill', () => {
  /**
   * 造一个可控环境。**刻意用注入的 snapshot / write 而不是真库** ——
   * 这组测的是编排(并发、重试、中断、计数),掺进真的 Dexie 只会让失败原因变模糊。
   */
  function harness(opts: {
    count: number
    /** 带上真实请求体 —— 要按**问题内容**决定成败,不能按调用序号(见下) */
    fetch: (url: string, init: RequestInit) => Promise<Response>
    shouldStop?: () => boolean
    write?: (id: string, hit: { categoryId: string; confidence: number } | null) => Promise<void>
  }) {
    const fetchMock = vi.fn(opts.fetch)
    vi.stubGlobal('fetch', fetchMock)
    const written: Array<{ id: string; hit: { categoryId: string; confidence: number } | null }> = []
    const items = Array.from({ length: opts.count }, (_, i) => ({
      id: `qa-${i}`,
      question: `问题${i}`,
    }))
    const progress: BackfillProgress[] = []
    const write =
      opts.write ??
      (async (id: string, hit: { categoryId: string; confidence: number } | null) => {
        written.push({ id, hit })
      })
    const promise = runBackfill({
      onProgress: (p) => progress.push({ ...p }),
      shouldStop: opts.shouldStop ?? (() => false),
      deps: {
        config: CONFIG,
        categories: OPTIONS,
        threshold: 0.2,
        snapshot: async () => ({ history: items, golden: [] }),
        writeHistory: write,
        writeGolden: async () => undefined,
      },
    })
    return { promise, fetchMock, written, progress }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('全部成功 → ok === total,每条都写回', async () => {
    const h = harness({ count: 10, fetch: async () => okResponse() })
    const p = await h.promise
    expect(p).toMatchObject({ total: 10, ok: 10, failed: 0, skipped: 0, done: 10 })
    expect(h.written).toHaveLength(10)
  })

  it('单条 jev 失败不阻塞整批,失败的以 hit=null 写回(落未分类)', async () => {
    const h = harness({
      count: 5,
      // 按**问题内容**判成败,不按调用序号:5 个 worker 并发跑,
      // "第 N 次调用"属于哪个条目是不确定的,按序号写的测试会时绿时红。
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body as string)
        return body.state === '问题2' ? new Response('{}', { status: 500 }) : okResponse()
      },
    })
    const p = await h.promise
    // 问题2 重试 2 次后放弃,以 hit=null 写回;其余四条成功
    expect(p).toMatchObject({ total: 5, ok: 4, failed: 1, done: 5 })
    expect(h.written.find((w) => w.hit === null)?.id).toBe('qa-2')
  })

  it('失败重试 2 次后才放弃(单条共 3 次请求)', async () => {
    const h = harness({ count: 1, fetch: async () => new Response('{}', { status: 500 }) })
    await h.promise
    expect(h.fetchMock).toHaveBeenCalledTimes(3)
  })

  it('并发峰值不超过 5', async () => {
    let inFlight = 0
    let peak = 0
    const h = harness({
      count: 30,
      fetch: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 0))
        inFlight--
        return okResponse()
      },
    })
    await h.promise
    expect(peak).toBeLessThanOrEqual(5)
    expect(peak).toBeGreaterThan(1) // 没并发起来的话上面那条断言毫无意义
  })

  it('shouldStop 提前停下,已完成的结果照常写回', async () => {
    let calls = 0
    const h = harness({
      count: 50,
      fetch: async () => {
        calls++
        return okResponse()
      },
      shouldStop: () => calls > 3,
    })
    const p = await h.promise
    expect(p.done).toBeLessThan(50)
    expect(p.done).toBeGreaterThan(0)
    expect(h.written.length).toBe(p.done)
  })

  it('写回抛错(记录已被 TTL 清掉)计入 skipped,不中断整批', async () => {
    const h = harness({
      count: 4,
      fetch: async () => okResponse(),
      write: async (id) => {
        if (id === 'qa-1') throw new Error('gone')
      },
    })
    const p = await h.promise
    expect(p).toMatchObject({ total: 4, done: 4, skipped: 1, ok: 3 })
  })

  it('进度回调按完成数递增,最后一次 done === total', async () => {
    const h = harness({ count: 7, fetch: async () => okResponse() })
    await h.promise
    expect(h.progress[0]).toMatchObject({ done: 0, total: 7 })
    expect(h.progress[h.progress.length - 1]).toMatchObject({ done: 7, total: 7 })
    for (let i = 1; i < h.progress.length; i++) {
      expect(h.progress[i].done).toBeGreaterThanOrEqual(h.progress[i - 1].done)
    }
  })

  it('没有候选 → 直接返回,一次请求都不发', async () => {
    const h = harness({ count: 0, fetch: async () => okResponse() })
    const p = await h.promise
    expect(p.total).toBe(0)
    expect(h.fetchMock).not.toHaveBeenCalled()
  })
})
