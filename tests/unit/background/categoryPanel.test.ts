// UPDATE_GOLDEN_CATEGORY 落库语义单测(第五十七轮 Task 6)。
//
// 这条消息是「机器永不许覆盖用户手工摆放」的落点:移动完成后 categorySource 必须变成
// 'manual',补分类的候选判据(isBackfillCandidate)对 manual 一律跳过。所以本文件里
// 最重要的一条不是"categoryId 写对了",而是"写过之后机器再也不能动它"。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { hashText } from '../../../src/shared/text'
import { UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'
import type { GoldenRecord } from '../../../src/types/memory'

/** 重置模块注册表 → panel.ts(及其单例 db / 检索缓存)在已删库的 fake-indexeddb 上重建 */
async function fresh() {
  vi.resetModules()
  const { updateGoldenCategory } = await import('../../../src/background/panel')
  const { db } = await import('../../../src/background/db')
  const { getRetrievalEntries } = await import('../../../src/background/retrievalCache')
  return { updateGoldenCategory, db, getRetrievalEntries }
}

function makeGolden(over: Partial<GoldenRecord> & { id: string }): GoldenRecord {
  const now = Date.now()
  return {
    folderId: null,
    question: '能开发票吗?',
    answer: '可以,支持电子发票。',
    questionHash: hashText('能开发票吗?'),
    hasEmbedding: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

const msg = (id: string, categoryId: string) =>
  ({ type: 'UPDATE_GOLDEN_CATEGORY', payload: { id, categoryId } }) as const

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('UPDATE_GOLDEN_CATEGORY', () => {
  it('把标答移到一个存在的类型上', async () => {
    const { updateGoldenCategory, db } = await fresh()
    await db.ensurePresetCategories()
    await db.goldens.add(makeGolden({ id: 'g1', categoryId: UNCATEGORIZED_CATEGORY_ID }))

    const out = await updateGoldenCategory(msg('g1', 'preset:price'))
    expect(out).toEqual({ success: true })
    expect((await db.goldens.get('g1'))?.categoryId).toBe('preset:price')
  })

  it('★ 移动后 categorySource 变成 manual —— 补分类从此不许再动它', async () => {
    const { updateGoldenCategory, db } = await fresh()
    await db.ensurePresetCategories()
    // 机器打过的旧标:categoryAt 是过去时刻,移动后必须被覆盖成 manual + 当下的时间
    await db.goldens.add(
      makeGolden({
        id: 'g1',
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        categorySource: 'jev',
        categoryAt: 1,
      }),
    )
    // 未分类 → 是补分类的候选
    expect((await db.countBackfillCandidates()).golden).toBe(1)

    const before = Date.now()
    const out = await updateGoldenCategory(msg('g1', 'preset:aftersale'))
    expect(out).toEqual({ success: true })

    const g = await db.goldens.get('g1')
    expect(g?.categorySource).toBe('manual')
    expect(g?.categoryAt).toBeGreaterThanOrEqual(before)

    // ★ 用户手工摆过之后,补分类的候选里再也不会出现它(见 db#isBackfillCandidate)
    expect((await db.countBackfillCandidates()).golden).toBe(0)
  })

  it('目标类型不存在 → 报错,不改动', async () => {
    const { updateGoldenCategory, db } = await fresh()
    await db.ensurePresetCategories()
    await db.goldens.add(
      makeGolden({ id: 'g1', categoryId: 'preset:price', categorySource: 'jev' }),
    )

    const out = await updateGoldenCategory(msg('g1', 'preset:nope'))
    expect(out.success).toBe(false)
    expect(out.error).toBe('目标类型不存在')

    const g = await db.goldens.get('g1')
    expect(g?.categoryId).toBe('preset:price')
    expect(g?.categorySource).toBe('jev')
  })

  it('移到 uncategorized 也合法(等于手动取消分类)', async () => {
    const { updateGoldenCategory, db } = await fresh()
    await db.ensurePresetCategories()
    await db.goldens.add(makeGolden({ id: 'g1', categoryId: 'preset:price' }))

    const out = await updateGoldenCategory(msg('g1', UNCATEGORIZED_CATEGORY_ID))
    expect(out).toEqual({ success: true })
    const g = await db.goldens.get('g1')
    expect(g?.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(g?.categorySource).toBe('manual')
  })

  it('不存在的标答 → 报错', async () => {
    const { updateGoldenCategory, db } = await fresh()
    await db.ensurePresetCategories()

    const out = await updateGoldenCategory(msg('g-gone', 'preset:price'))
    expect(out.success).toBe(false)
    expect(out.error).toBe('标准回答不存在')
  })

  it('人工写入永远生效:已经是 manual 也能再摆一次', async () => {
    const { updateGoldenCategory, db } = await fresh()
    await db.ensurePresetCategories()
    await db.goldens.add(
      makeGolden({ id: 'g1', categoryId: 'preset:price', categorySource: 'manual', categoryAt: 1 }),
    )

    const out = await updateGoldenCategory(msg('g1', 'preset:aftersale'))
    expect(out).toEqual({ success: true })
    expect((await db.goldens.get('g1'))?.categoryId).toBe('preset:aftersale')
  })

  it('定点同步缓存(不作废、不重建):数组引用不变,但那条的类型跟着变', async () => {
    const { updateGoldenCategory, db, getRetrievalEntries } = await fresh()
    await db.ensurePresetCategories()
    await db.goldens.add(
      makeGolden({
        id: 'g1',
        hasEmbedding: 1,
        qEmbedding: new Float32Array([1, 0]),
        categoryId: UNCATEGORIZED_CATEGORY_ID,
      }),
    )

    const before = await getRetrievalEntries()
    expect(before).toHaveLength(1)

    await updateGoldenCategory(msg('g1', 'preset:price'))

    const after = await getRetrievalEntries()
    // 缓存未被作废:仍是同一个数组引用(作废会整表重建出新的数组)
    expect(after).toBe(before)
    // ……但类型已定点同步(第五十八轮:分类进检索,缓存必须跟库一致)
    expect(after[0].source.categoryId).toBe('preset:price')
  })
})

// ─── 机器写入的 manual 守卫(第五十七轮 Task 6 修复轮 2/5)──────────────────────
//
// 「机器永不许覆盖用户手工摆放」不能只靠 isBackfillCandidate 的**快照期**排除:
// 挑候选之后用户仍可能手工移动某条(补分类运行期间),手工新建的打标也会在用户
// 摆完之后才回来。守卫必须落在**写入那一刻**的收口点(db#updateGoldenCategory)。

describe('db#updateGoldenCategory:机器写入的 manual 守卫', () => {
  it('标答是 manual 时,机器写入不改动 categoryId(保持 manual 不动)', async () => {
    const { db } = await fresh()
    await db.goldens.add(
      makeGolden({ id: 'g1', categoryId: 'preset:price', categorySource: 'manual', categoryAt: 1 }),
    )

    const n = await db.updateGoldenCategory('g1', { categoryId: 'preset:stock', confidence: 0.99 })
    expect(n).toBe(0) // 跳过写入
    const g = await db.goldens.get('g1')
    expect(g?.categoryId).toBe('preset:price')
    expect(g?.categorySource).toBe('manual')
    expect(g?.categoryAt).toBe(1)
  })

  it('标答是 jev 或没有来源时,机器写入正常生效', async () => {
    const { db } = await fresh()
    await db.goldens.add(
      makeGolden({ id: 'g-jev', categoryId: 'preset:price', categorySource: 'jev' }),
    )
    await db.goldens.add(makeGolden({ id: 'g-bare' })) // 缺省 source

    expect(await db.updateGoldenCategory('g-jev', { categoryId: 'preset:stock', confidence: 0.8 })).toBe(1)
    const jev = await db.goldens.get('g-jev')
    expect(jev?.categoryId).toBe('preset:stock')
    expect(jev?.categorySource).toBe('jev')

    expect(await db.updateGoldenCategory('g-bare', null)).toBe(1)
    const bare = await db.goldens.get('g-bare')
    expect(bare?.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(bare?.categorySource).toBe('jev')
  })
})
