/**
 * P2-4 content UI 纯逻辑:买家问题合并 + UI 动作状态机(设计文档 §6.3)。
 * DOM/样式部分不可单测,只测纯函数。
 */
import { describe, it, expect } from 'vitest'
import {
  mergeBuyerQuery,
  decideUiAction,
  moveSelection,
  isRowVisible,
  aiButtonX,
  aiButtonY,
  popupPosition,
  scrollForSelection,
} from '../../../src/pdd/ui-logic'
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
  it('开关关 + 单候选 → 仍弹面板(2026-09-15 用户反馈:开关关就不该静默直填)', () => {
    const r = decideUiAction([sug('a')], false)
    expect(r.action).toBe('popup')
    if (r.action === 'popup') expect(r.items).toHaveLength(1)
  })
  it('开关关 + 多候选 → 弹窗展示全部候选(条数由检索侧配额决定,此处不截断)', () => {
    const items = [sug('a'), sug('b'), sug('c'), sug('d')]
    const r = decideUiAction(items, false)
    expect(r.action).toBe('popup')
    if (r.action === 'popup') expect(r.items).toEqual(items)
  })
})

describe('moveSelection:面板导航键移动选中项(2026-09-16 第二十四轮:末条回绕首条)', () => {
  it('逐条下移/上移', () => {
    expect(moveSelection(0, 1, 3)).toBe(1)
    expect(moveSelection(1, -1, 3)).toBe(0)
  })
  it('循环切换:末条再按回绕到首条', () => {
    expect(moveSelection(2, 1, 3)).toBe(0)
    expect(moveSelection(0, -1, 3)).toBe(2)
  })
  it('空列表安全返回 0', () => {
    expect(moveSelection(0, 1, 0)).toBe(0)
  })
})

// ─── 覆盖层几何(第三十一轮自 pdd-ai-button.ts 内联算术提取,期望值按原式手推)───

describe('isRowVisible:行矩形在消息容器可视区内', () => {
  const cont = { top: 0, bottom: 600, left: 0, right: 400, height: 600 }
  it('容器内可见', () => {
    expect(isRowVisible({ top: 100, bottom: 140, left: 0, right: 300, height: 40 }, cont)).toBe(true)
  })
  it('高度为 0(隐藏行)不可见', () => {
    expect(isRowVisible({ top: 100, bottom: 100, left: 0, right: 300, height: 0 }, cont)).toBe(false)
  })
  it('滚出容器上沿(含 1px 容差)不可见;压线内可见', () => {
    expect(isRowVisible({ top: -40, bottom: 1, left: 0, right: 300, height: 41 }, cont)).toBe(false)
    expect(isRowVisible({ top: -38, bottom: 2, left: 0, right: 300, height: 40 }, cont)).toBe(true)
  })
  it('滚出容器下沿(含 1px 容差)不可见;压线内可见', () => {
    expect(isRowVisible({ top: 599, bottom: 639, left: 0, right: 300, height: 40 }, cont)).toBe(false)
    expect(isRowVisible({ top: 598, bottom: 638, left: 0, right: 300, height: 40 }, cont)).toBe(true)
  })
})

describe('aiButtonX:气泡右侧优先,放不下换左侧,极端夹 4px', () => {
  it('右侧放得下:气泡右缘外 gap', () => {
    expect(aiButtonX({ top: 0, bottom: 40, left: 100, right: 200, height: 40 }, 72, 1400, 12)).toBe(212)
  })
  it('右侧放不下:移到气泡左侧', () => {
    expect(aiButtonX({ top: 0, bottom: 40, left: 200, right: 280, height: 40 }, 72, 360, 12)).toBe(116)
  })
  it('左右都放不下:夹在 4px', () => {
    expect(aiButtonX({ top: 0, bottom: 40, left: 10, right: 50, height: 40 }, 72, 100, 12)).toBe(4)
  })
})

describe('aiButtonY:气泡垂直居中,夹在容器可视区内', () => {
  it('正常居中(top + h/2 - 按钮半高)', () => {
    expect(aiButtonY({ top: 100, bottom: 140, left: 0, right: 200, height: 40 }, { top: 0, bottom: 600, left: 0, right: 400, height: 600 }, 26)).toBe(107)
  })
  it('气泡高于容器:夹到容器顶 + 2', () => {
    expect(aiButtonY({ top: -50, bottom: -20, left: 0, right: 200, height: 30 }, { top: 0, bottom: 600, left: 0, right: 400, height: 600 }, 26)).toBe(2)
  })
  it('气泡低于容器:夹到容器底 - 按钮 - 2', () => {
    expect(aiButtonY({ top: 200, bottom: 240, left: 0, right: 200, height: 40 }, { top: 0, bottom: 100, left: 0, right: 400, height: 100 }, 26)).toBe(72)
  })
})

describe('popupPosition:锚右侧优先 → 左侧 → 视口回缩;y 按实高夹视口', () => {
  const anchor = { top: 200, bottom: 240, left: 100, right: 200, height: 40 }
  it('右侧放得下:x = 锚右缘 + 8;y = 锚顶 - 4', () => {
    expect(popupPosition(anchor, 300, 336, 1400, 800)).toEqual({ x: 208, y: 196 })
  })
  it('右侧放不下换左侧,左缘越界则回缩(min(视口余量, 锚左缘))', () => {
    // x 先 = 200-308=-108 < 8 → 回缩 max(8, min(510-300-8=202, 100)) = 100
    expect(popupPosition(anchor, 300, 336, 510, 800)).toEqual({ x: 100, y: 196 })
  })
  it('屏幕下方:y 夹到 视口高 - 实高 - 8', () => {
    expect(popupPosition(anchor, 300, 336, 1400, 400)).toEqual({ x: 208, y: 56 })
  })
  it('屏幕顶部:y 夹到 8', () => {
    expect(popupPosition({ ...anchor, top: 2, bottom: 42 }, 300, 336, 1400, 800)).toEqual({ x: 208, y: 8 })
  })
})

describe('scrollForSelection:选中行滚进可视区(sticky 头部实高校正)', () => {
  const cont = { top: 50, bottom: 650, left: 0, right: 300, height: 600 }
  const headH = 40
  it('选中首条:scrollTop 直接归零(回绕首条回顶)', () => {
    expect(scrollForSelection(100, cont, { top: 200, bottom: 250, left: 0, right: 300, height: 50 }, headH, 0)).toBe(0)
  })
  it('行被 sticky 头遮住:上滚差值', () => {
    expect(scrollForSelection(100, cont, { top: 60, bottom: 110, left: 0, right: 300, height: 50 }, headH, 2)).toBe(70)
  })
  it('行超出容器底:下滚差值', () => {
    expect(scrollForSelection(100, cont, { top: 600, bottom: 680, left: 0, right: 300, height: 80 }, headH, 2)).toBe(130)
  })
  it('行已在可视区:不动', () => {
    expect(scrollForSelection(100, cont, { top: 200, bottom: 250, left: 0, right: 300, height: 50 }, headH, 2)).toBe(100)
  })
})
