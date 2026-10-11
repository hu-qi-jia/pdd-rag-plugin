// 预置问题类型的自检:它是 jev 的 criteria 来源,写坏了分类质量整体下降,
// 所以尺寸、唯一性、非空这些结构性质要有断言兜着。
import { describe, it, expect } from 'vitest'
import { PRESET_CATEGORIES, UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'

describe('预置问题类型', () => {
  it('恰好六个', () => {
    expect(PRESET_CATEGORIES.length).toBe(6)
  })

  it('id 唯一,且不与未分类冲突', () => {
    const ids = PRESET_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(UNCATEGORIZED_CATEGORY_ID)
  })

  it('id 一律带 preset: 前缀(迁移来的自定义类型用 legacy:,不会被撞上)', () => {
    for (const c of PRESET_CATEGORIES) expect(c.id.startsWith('preset:')).toBe(true)
  })

  it('恰好一个是 size 路由,其余都是 retrieve', () => {
    const sizes = PRESET_CATEGORIES.filter((c) => c.route === 'size')
    expect(sizes.length).toBe(1)
    expect(sizes[0].id).toBe('preset:size')
  })

  it('判定说明非空且互不相同', () => {
    const texts = PRESET_CATEGORIES.map((c) => c.criteria)
    for (const t of texts) expect(t.trim().length).toBeGreaterThan(0)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('判定说明足够具体 —— 过短的描述会让 jev 在相邻类型间摇摆', () => {
    for (const c of PRESET_CATEGORIES) expect(c.criteria.length).toBeGreaterThan(20)
  })
})
