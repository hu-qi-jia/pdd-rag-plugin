// 标准回答的继承与手建打标(第五十六轮)
import 'fake-indexeddb/auto'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'
import { hashText } from '../../../src/shared/text'
import type { QaRecord } from '../../../src/types/memory'

// goldens.ts 会排队重嵌 —— 测试不关心嵌入实现
vi.mock('../../../src/background/offscreen', () => ({ queueEmbedding: vi.fn() }))

// 打标本身在 classify.test.ts 里测;这里只验 goldens 这一侧的接线
vi.mock('../../../src/background/classify', () => ({
  classifyRecord: vi.fn(async () => null),
}))

import { classifyRecord } from '../../../src/background/classify'

async function freshGoldens() {
  vi.resetModules()
  const mod = await import('../../../src/background/goldens')
  return mod.addGoldenFromSuggestion
}

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '快递到哪了?',
    questionHash: hashText('快递到哪了?'),
    questionTs: now,
    hasEmbedding: 1,
    replyCount: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

describe('标准回答的分类', () => {
  let testDb: PddDatabase

  beforeEach(async () => {
    vi.mocked(classifyRecord).mockReset()
    vi.mocked(classifyRecord).mockResolvedValue(null)
    await Dexie.delete('PddCSDB')
    testDb = new PddDatabase()
    await testDb.open()
    await testDb.ensurePresetCategories()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('来源问答已有类型 → 直接继承,且一次请求都不发', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await testDb.qaRecords.add(
      makeQa({ id: 'qa-1', categoryId: 'preset:order', categorySource: 'jev', categoryAt: 1 }),
    )
    const addGolden = await freshGoldens()
    const r = await addGolden({
      question: '快递到哪了?',
      answer: '亲,48 小时内发出哦',
      sourceRecordId: 'qa-1',
    })
    expect(r.error).toBeUndefined()
    expect(await testDb.goldens.get(r.id!)).toMatchObject({
      categoryId: 'preset:order',
      categorySource: 'inherit',
    })
    // 同一个问题重跑一次 jev 是白花钱外加多一次外发
    expect(classifyRecord).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('来源问答是未分类 → 新标答也是未分类,且不重复发请求', async () => {
    await testDb.qaRecords.add(
      makeQa({
        id: 'qa-2',
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        categorySource: 'jev',
        categoryAt: 1,
      }),
    )
    const addGolden = await freshGoldens()
    const r = await addGolden({
      question: '快递到哪了?',
      answer: '亲,48 小时内发出哦',
      sourceRecordId: 'qa-2',
    })
    expect(await testDb.goldens.get(r.id!)).toMatchObject({
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      categorySource: 'inherit',
    })
    // 有来源就交给补分类统一处理,这里不重复发
    expect(classifyRecord).not.toHaveBeenCalled()
  })

  it('没有来源(手工新建) → 补一次打标', async () => {
    vi.mocked(classifyRecord).mockResolvedValue({ categoryId: 'preset:price', confidence: 0.77 })
    const addGolden = await freshGoldens()
    const r = await addGolden({ question: '能便宜点吗?', answer: '亲,已经是活动价了哦' })
    // 等**可观察的写入**,而不是等调用次数:调用计数可能早于另一条 Dexie 连接上
    // fire-and-forget 的 updateGoldenCategory 提交,随后读库会读到写入前的状态(flake)
    await vi.waitFor(async () =>
      expect((await testDb.goldens.get(r.id!))?.categoryId).toBe('preset:price'),
    )
    expect(classifyRecord).toHaveBeenCalledTimes(1)
    expect(vi.mocked(classifyRecord).mock.calls[0][0]).toBe('能便宜点吗?')
    expect(await testDb.goldens.get(r.id!)).toMatchObject({
      categoryId: 'preset:price',
      categorySource: 'jev',
    })
  })

  it('手工新建时打标判不准 → 落未分类,不抛错', async () => {
    vi.mocked(classifyRecord).mockResolvedValue(null)
    const addGolden = await freshGoldens()
    const r = await addGolden({ question: '能便宜点吗?', answer: '亲,已经是活动价了哦' })
    // 同上:等落库结果可见,别在写入提交前读库
    await vi.waitFor(async () =>
      expect((await testDb.goldens.get(r.id!))?.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID),
    )
  })
})
