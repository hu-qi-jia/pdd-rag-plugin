// 「低置信」判据单测。
//
// 为什么值得单独钉:这个判据决定记录上要不要出现复核提示,而它**有三类必须排除**的
// 情况 —— 排错了就会把"确定的分类"标成"可能错的",那比不标更糟(用户会开始怀疑
// 所有 `[已指定]` 的条目)。
import { describe, it, expect } from 'vitest'
import {
  LOW_CONFIDENCE_LINE,
  isLowConfidenceCategory,
} from '../../../src/shared/constants'

describe('isLowConfidenceCategory', () => {
  it('机器打的标 + 概率低于复核线 → 算低置信', () => {
    expect(isLowConfidenceCategory({ categorySource: 'jev', categoryConfidence: 0.21 })).toBe(true)
    expect(isLowConfidenceCategory({ categorySource: 'jev', categoryConfidence: 0.49 })).toBe(true)
  })

  it('机器打的标 + 概率够高 → 不算', () => {
    expect(isLowConfidenceCategory({ categorySource: 'jev', categoryConfidence: 0.95 })).toBe(false)
  })

  it('恰好等于复核线 → **不算**(线是「低于」,不是「不高于」)', () => {
    expect(
      isLowConfidenceCategory({ categorySource: 'jev', categoryConfidence: LOW_CONFIDENCE_LINE }),
    ).toBe(false)
  })

  it('★ 人工摆放(`manual`)永远不算 —— 那是用户自己定的,不存在"判得准不准"', () => {
    // 人工路径本来就不写 confidence(见 db.setGoldenCategoryManual),这里连
    // "万一写了"的情况一起挡掉:来源是人工就不可能低置信
    expect(isLowConfidenceCategory({ categorySource: 'manual' })).toBe(false)
    expect(isLowConfidenceCategory({ categorySource: 'manual', categoryConfidence: 0.05 })).toBe(false)
  })

  it('★ 继承(`inherit`)永远不算 —— 它是从来源问答照搬的确定结果', () => {
    expect(isLowConfidenceCategory({ categorySource: 'inherit' })).toBe(false)
    expect(isLowConfidenceCategory({ categorySource: 'inherit', categoryConfidence: 0.05 })).toBe(false)
  })

  it('★ 没有概率值不算 —— 旧数据(打标功能之前入库的、或概率字段引入前写的)', () => {
    // 不挡这条的话,所有"有来源无概率"的历史记录会在一夜之间全变成低置信
    expect(isLowConfidenceCategory({ categorySource: 'jev' })).toBe(false)
    expect(isLowConfidenceCategory({})).toBe(false)
  })

  it('概率是 0 也算低置信(0 是合法取值,不是"没有值")', () => {
    expect(isLowConfidenceCategory({ categorySource: 'jev', categoryConfidence: 0 })).toBe(true)
  })
})
