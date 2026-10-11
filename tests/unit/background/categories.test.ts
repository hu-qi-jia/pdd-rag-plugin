// categories 表种子与读取(fake-indexeddb 内存实现)
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { hashText } from '../../../src/shared/text'
import type { GoldenRecord, QaRecord } from '../../../src/types/memory'
import {
  PRESET_CATEGORIES,
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_NAME,
  UNCATEGORIZED_CATEGORY_POSITION,
} from '../../../src/shared/constants'

let testDb: PddDatabase

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
  testDb = new PddDatabase()
  await testDb.open()
})

describe('categories 种子', () => {
  it('种下 6 个预置 + 未分类', async () => {
    await testDb.ensurePresetCategories()
    const all = await testDb.listCategories()
    expect(all.length).toBe(PRESET_CATEGORIES.length + 1)
    expect(all.map((c) => c.id)).toContain(UNCATEGORIZED_CATEGORY_ID)
  })

  it('预置的 kind/filterable/route 口径正确', async () => {
    await testDb.ensurePresetCategories()
    const all = await testDb.listCategories()
    for (const preset of PRESET_CATEGORIES) {
      const row = all.find((c) => c.id === preset.id)!
      expect(row.kind).toBe('preset')
      expect(row.route).toBe(preset.route)
      expect(row.criteria).toBe(preset.criteria)
      // 预置恒参与过滤(未分类不参与)
      expect(row.filterable).toBe(true)
    }
    const unc = all.find((c) => c.id === UNCATEGORIZED_CATEGORY_ID)!
    expect(unc.kind).toBe('uncategorized')
    expect(unc.filterable).toBe(false)
    expect(unc.criteria).toBe('')
  })

  it('幂等:跑两次不重复种', async () => {
    await testDb.ensurePresetCategories()
    await testDb.ensurePresetCategories()
    expect(await testDb.categories.count()).toBe(PRESET_CATEGORIES.length + 1)
  })

  it('不覆盖已改动过的 position(用户可能调过顺序)', async () => {
    await testDb.ensurePresetCategories()
    await testDb.categories.update('preset:price', { position: 42 })
    await testDb.ensurePresetCategories()
    expect((await testDb.categories.get('preset:price'))!.position).toBe(42)
  })

  it('未分类恒排最后', async () => {
    await testDb.ensurePresetCategories()
    const all = await testDb.listCategories()
    expect(all[all.length - 1].id).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(all[all.length - 1].position).toBe(UNCATEGORIZED_CATEGORY_POSITION)
  })

  it('未分类的显示名与 sort 位取自常量(不散落字面量)', async () => {
    await testDb.ensurePresetCategories()
    const unc = (await testDb.categories.get(UNCATEGORIZED_CATEGORY_ID))!
    expect(unc.name).toBe(UNCATEGORIZED_CATEGORY_NAME)
  })
})

// ─── 类型 CRUD(第五十七轮 Task 7)─────────────────────────────────────────────
//
// handler 直接单测(不经 UI)。四条硬校验各对应一个真实失败模式:
//   ① 重名 → jev 的 idByName 互相覆盖,静默错分且无报错(硬拦截);
//   ② 判定说明空白 → 空描述成为分类噪声选项,拉低**全部**类型的判断质量;
//   ③ 预置与未分类不可改名/删(D3;删预置会让已按它分类的条目再也搜不到);
//   ④ 删自定义类型时其中的标答与历史问答落回未分类且**不跟着消失**,categorySource 保持原值。

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '快递到哪了?',
    questionHash: `h-${over.id}`,
    questionTs: now,
    hasEmbedding: 0,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
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

/** 每个用例一套空库 + 预置种子(handler 与断言共用同一个 db 单例) */
async function freshCrud() {
  vi.resetModules()
  const crud = await import('../../../src/background/categories')
  const { db } = await import('../../../src/background/db')
  await db.ensurePresetCategories()
  return { ...crud, db }
}

describe('类型 CRUD', () => {
  // 空库由文件级 beforeEach 负责(删库重建);此处 handler 与断言共用同一个 db 单例。

  it('新建:名字与判定说明都合法时,filterable 为 true、position 排在自定义段末尾', async () => {
    const { createCategory, db } = await freshCrud()
    const first = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: ' 发票 ', criteria: '买家询问能不能开发票、开票抬头、发票类型或开票时间。' },
    })
    expect(first.error).toBeUndefined()
    const row = (await db.categories.get(first.id!))!
    expect(row.name).toBe('发票') // trim 过
    expect(row.kind).toBe('custom')
    expect(row.filterable).toBe(true) // 新建恒参与分类
    expect(row.criteria).toBe('买家询问能不能开发票、开票抬头、发票类型或开票时间。')
    // 排在 6 个预置(position 0..5)之后、未分类(9999)之前
    expect(row.position).toBeGreaterThan(PRESET_CATEGORIES.length - 1)
    expect(row.position).toBeLessThan(UNCATEGORIZED_CATEGORY_POSITION)

    const second = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: '开发票方式', criteria: '买家询问发票是电子还是纸质、怎么开具、何时寄出。' },
    })
    expect((await db.categories.get(second.id!))!.position).toBe(row.position + 1)
  })

  it('★ 重名(含 trim 后重名、与预置重名)→ 拒绝并给出理由', async () => {
    const { createCategory, renameCategory, db } = await freshCrud()
    const created = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: '发票', criteria: '买家询问开发票相关事宜。' },
    })

    // trim 后重名(带空格也算同一个名字)
    const dup = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: ' 发票 ', criteria: '另一段描述。' },
    })
    expect(dup.id).toBeUndefined()
    expect(dup.error).toContain('已存在')

    // 与预置类型重名(预置名同样是硬拦截)
    const presetDup = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: PRESET_CATEGORIES[0].name, criteria: '另一段描述。' },
    })
    expect(presetDup.id).toBeUndefined()
    expect(presetDup.error).toContain('已存在')

    // 改名撞已有名字也要挡(改名是同一个唯一性约束)
    const renamed = await renameCategory({
      type: 'RENAME_CATEGORY',
      payload: { id: created.id!, name: PRESET_CATEGORIES[1].name },
    })
    expect(renamed.success).toBe(false)
    expect(renamed.error).toContain('已存在')
    expect((await db.categories.get(created.id!))!.name).toBe('发票')
    // 重名的那次新建没有落库
    expect((await db.listCategories()).filter((c) => c.kind === 'custom')).toHaveLength(1)
  })

  it('★ 判定说明为空白 → 拒绝(空描述会拉低全部类型的判断质量)', async () => {
    const { createCategory, db } = await freshCrud()
    const out = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: '发票', criteria: '   ' },
    })
    expect(out.id).toBeUndefined()
    expect(out.error).toContain('判定说明')
    expect((await db.listCategories()).filter((c) => c.kind === 'custom')).toHaveLength(0)
  })

  it('★ 改名预置类型 → 拒绝', async () => {
    const { renameCategory, db } = await freshCrud()
    const out = await renameCategory({
      type: 'RENAME_CATEGORY',
      payload: { id: 'preset:size', name: '想改名' },
    })
    expect(out.success).toBe(false)
    expect(out.error).toContain('不可改名')
    expect((await db.categories.get('preset:size'))!.name).toBe('尺码推荐')
  })

  it('★ 删除预置类型 → 拒绝', async () => {
    const { deleteCategory, db } = await freshCrud()
    const out = await deleteCategory({ type: 'DELETE_CATEGORY', payload: { id: 'preset:size' } })
    expect(out.success).toBe(false)
    expect(out.error).toContain('不可删除')
    expect(await db.categories.get('preset:size')).toBeTruthy()
  })

  it('删除自定义类型:其中的标答落回未分类,不跟着消失', async () => {
    const { createCategory, deleteCategory, db } = await freshCrud()
    const created = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: '发票', criteria: '买家询问开发票相关事宜。' },
    })
    await db.goldens.add(
      makeGolden({ id: 'g-manual', categoryId: created.id!, categorySource: 'manual' }),
    )
    await db.goldens.add(
      makeGolden({ id: 'g-jev', categoryId: created.id!, categorySource: 'jev', categoryAt: 1 }),
    )

    const out = await deleteCategory({ type: 'DELETE_CATEGORY', payload: { id: created.id! } })
    expect(out.success).toBe(true)
    expect(await db.categories.get(created.id!)).toBeUndefined()

    // 标答保留,只是落回未分类 —— 删类型不能把标答一起带走
    const manual = (await db.goldens.get('g-manual'))!
    expect(manual.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(manual.categorySource).toBe('manual') // 手工摆过的仍是 manual,不许被重置
    const jev = (await db.goldens.get('g-jev'))!
    expect(jev.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(jev.categorySource).toBe('jev')
  })

  it('★ 删除自定义类型:历史问答也落回未分类,不留指向已删类型的悬空 id', async () => {
    const { createCategory, deleteCategory, db } = await freshCrud()
    const created = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: '发票', criteria: '买家询问开发票相关事宜。' },
    })
    await db.qaRecords.add(
      makeQa({ id: 'qa-manual', categoryId: created.id!, categorySource: 'manual', categoryAt: 1 }),
    )
    await db.qaRecords.add(
      makeQa({ id: 'qa-jev', categoryId: created.id!, categorySource: 'jev', categoryAt: 1 }),
    )
    await db.qaRecords.add(makeQa({ id: 'qa-other', categoryId: UNCATEGORIZED_CATEGORY_ID }))

    const out = await deleteCategory({ type: 'DELETE_CATEGORY', payload: { id: created.id! } })
    expect(out.success).toBe(true)

    const manual = (await db.qaRecords.get('qa-manual'))!
    expect(manual.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(manual.categorySource).toBe('manual') // 来源原值保留,不许被重置
    const jev = (await db.qaRecords.get('qa-jev'))!
    expect(jev.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
    expect(jev.categorySource).toBe('jev')
    // 不相干的行不受影响
    expect((await db.qaRecords.get('qa-other'))?.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID)
  })

  it('改名未分类 → 拒绝;删除未分类 → 拒绝', async () => {
    const { renameCategory, deleteCategory } = await freshCrud()
    const ren = await renameCategory({
      type: 'RENAME_CATEGORY',
      payload: { id: UNCATEGORIZED_CATEGORY_ID, name: '想改名' },
    })
    expect(ren.success).toBe(false)
    expect(ren.error).toContain('不可改名')
    const del = await deleteCategory({
      type: 'DELETE_CATEGORY',
      payload: { id: UNCATEGORIZED_CATEGORY_ID },
    })
    expect(del.success).toBe(false)
    expect(del.error).toContain('不可删除')
  })

  it('新建的名字为空白 → 拒绝', async () => {
    const { createCategory, db } = await freshCrud()
    const out = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: '   ', criteria: '一段正经的描述。' },
    })
    expect(out.id).toBeUndefined()
    expect(out.error).toContain('类型名')
    expect((await db.listCategories()).filter((c) => c.kind === 'custom')).toHaveLength(0)
  })

  it('改名自定义类型:合法路径落库,且不要求重填判定说明', async () => {
    const { createCategory, renameCategory, db } = await freshCrud()
    const created = await createCategory({
      type: 'CREATE_CATEGORY',
      payload: { name: '发票', criteria: '买家询问开发票相关事宜。' },
    })
    const out = await renameCategory({
      type: 'RENAME_CATEGORY',
      payload: { id: created.id!, name: ' 发票与开票 ' },
    })
    expect(out.success).toBe(true)
    const row = (await db.categories.get(created.id!))!
    expect(row.name).toBe('发票与开票')
    expect(row.criteria).toBe('买家询问开发票相关事宜。') // 改名不碰判定说明
  })

  it('删除不存在的类型 → 报错', async () => {
    const { deleteCategory } = await freshCrud()
    const out = await deleteCategory({ type: 'DELETE_CATEGORY', payload: { id: 'cat-gone' } })
    expect(out.success).toBe(false)
    expect(out.error).toContain('不存在')
  })

  it('改名不存在的类型 → 报错', async () => {
    const { renameCategory } = await freshCrud()
    const out = await renameCategory({
      type: 'RENAME_CATEGORY',
      payload: { id: 'cat-gone', name: '新名' },
    })
    expect(out.success).toBe(false)
    expect(out.error).toContain('不存在')
  })
})
