/**
 * P2-4 content UI 纯逻辑:买家问题合并 + UI 动作状态机(设计文档 §6.3)。
 * DOM/样式部分不可单测,只测纯函数。
 */
import { describe, it, expect } from 'vitest'
import { mergeBuyerQuery, decideUiAction } from '../../../src/utils/pddUiLogic'
import type { Suggestion } from '../../../src/types/messages'

const sug = (text: string, kind: Suggestion['kind'] = 'history'): Suggestion => ({
  kind,
  text,
  sourceQuestion: 'q',
  score: 0.9,
  sourceId: 's1',
})

describe('mergeBuyerQuery:连续买家行合并为检索 query', () => {
  it('多行按时间序换行拼接', () => {
    expect(mergeBuyerQuery(['在吗', '能开发票吗'])).toBe('在吗\n能开发票吗')
  })
  it('剔除空行', () => {
    expect(mergeBuyerQuery(['', '在吗', '  '])).toBe('在吗')
  })
  it('超长保留尾部(最近的消息是检索锚)', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `消息${i}`)
    const out = mergeBuyerQuery(lines, 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('消息49')).toBe(true)
  })
})

describe('decideUiAction:直填/弹窗状态机', () => {
  it('无候选 → none(仅提示)', () => {
    expect(decideUiAction([], false).action).toBe('none')
  })
  it('直填开关开 → 无论几条都直填最高分(下标0)', () => {
    expect(decideUiAction([sug('a'), sug('b')], true)).toEqual({ action: 'fill', fillIndex: 0 })
  })
  it('开关关 + 单候选 → 直接填充', () => {
    expect(decideUiAction([sug('a')], false)).toEqual({ action: 'fill', fillIndex: 0 })
  })
  it('开关关 + 多候选 → 弹窗展示全部候选(条数由检索侧配额决定,此处不截断)', () => {
    const items = [sug('a'), sug('b'), sug('c'), sug('d')]
    const r = decideUiAction(items, false)
    expect(r.action).toBe('popup')
    if (r.action === 'popup') expect(r.items).toEqual(items)
  })
})
