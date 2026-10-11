// categories 表种子与读取(fake-indexeddb 内存实现)
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
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
