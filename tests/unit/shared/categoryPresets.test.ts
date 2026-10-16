// 预置问题类型的自检:它是 jev 的 criteria 来源,写坏了分类质量整体下降,
// 所以尺寸、唯一性、非空这些结构性质要有断言兜着。
import { describe, it, expect } from 'vitest'
import { PRESET_CATEGORIES, UNCATEGORIZED_CATEGORY_ID } from '../../../src/shared/constants'

describe('预置问题类型', () => {
  it('恰好九条:八个记录级 + 一条尺码', () => {
    expect(PRESET_CATEGORIES.length).toBe(9)
  })

  it('记录级八条的 route 全是 retrieve,唯一的 size 是 preset:size', () => {
    const sizes = PRESET_CATEGORIES.filter((c) => c.route === 'size')
    expect(sizes.map((c) => c.id)).toEqual(['preset:size'])
    expect(PRESET_CATEGORIES.filter((c) => c.route === 'retrieve')).toHaveLength(8)
  })

  it('id 顺序即 售前→售中→售后→其他→尺码', () => {
    expect(PRESET_CATEGORIES.map((c) => c.id)).toEqual([
      'preset:attribute', 'preset:price', 'preset:stock', 'preset:payment',
      'preset:order', 'preset:aftersale', 'preset:quality', 'preset:other',
      'preset:size',
    ])
  })

  it('「其他」的判定说明必须含出口提示,且不得鼓励当垃圾场', () => {
    const other = PRESET_CATEGORIES.find((c) => c.id === 'preset:other')!
    expect(other.name).toBe('其他')
    expect(other.criteria).toContain('不属于上面任何一类')
    expect(other.criteria).toContain('仅仅因为你没把握而选它是错的')
  })

  it('id 唯一,且不与未分类冲突', () => {
    const ids = PRESET_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(UNCATEGORIZED_CATEGORY_ID)
  })

  it('id 一律带 preset: 前缀(迁移来的自定义类型用 legacy:,不会被撞上)', () => {
    for (const c of PRESET_CATEGORIES) expect(c.id.startsWith('preset:')).toBe(true)
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
