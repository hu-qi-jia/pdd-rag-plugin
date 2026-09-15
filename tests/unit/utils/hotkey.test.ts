/**
 * 快捷键纯逻辑单测:展示格式与按键匹配共用同一口径。
 * (2026-09-15:推荐回复快捷键,默认 Ctrl+Enter,可在设置中录入自定义组合。)
 */
import { describe, it, expect } from 'vitest'
import { formatHotkey, isModifierOnly, matchesHotkey } from '../../../src/utils/hotkey'
import { DEFAULT_HOTKEY } from '../../../src/types/memory'

const ev = (p: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; key: string }) => ({
  ctrlKey: p.ctrlKey ?? false,
  altKey: p.altKey ?? false,
  shiftKey: p.shiftKey ?? false,
  key: p.key,
})

describe('formatHotkey', () => {
  it('默认 Ctrl+Enter', () => {
    expect(formatHotkey(DEFAULT_HOTKEY)).toBe('Ctrl + Enter')
  })
  it('单字母主键转大写;多修饰键按 Ctrl/Alt/Shift 顺序', () => {
    expect(formatHotkey({ ctrl: true, alt: true, shift: false, key: 'k' })).toBe('Ctrl + Alt + K')
    expect(formatHotkey({ ctrl: false, alt: false, shift: true, key: 'ArrowDown' })).toBe(
      'Shift + ArrowDown',
    )
  })
})

describe('matchesHotkey', () => {
  it('Ctrl+Enter 精确匹配(修饰键必须一致)', () => {
    expect(matchesHotkey(ev({ ctrlKey: true, key: 'Enter' }), DEFAULT_HOTKEY)).toBe(true)
    expect(matchesHotkey(ev({ key: 'Enter' }), DEFAULT_HOTKEY)).toBe(false)
    expect(matchesHotkey(ev({ ctrlKey: true, shiftKey: true, key: 'Enter' }), DEFAULT_HOTKEY)).toBe(
      false,
    )
  })
  it('主键按小写比较(大小写锁定不漏匹配)', () => {
    expect(matchesHotkey(ev({ ctrlKey: true, key: 'k' }), { ctrl: true, alt: false, shift: false, key: 'K' })).toBe(true)
  })
  it('命名键不区分大小写', () => {
    expect(
      matchesHotkey(ev({ ctrlKey: true, key: 'ENTER' }), { ctrl: true, alt: false, shift: false, key: 'Enter' }),
    ).toBe(true)
  })
})

describe('isModifierOnly', () => {
  it('修饰键单独按下返回 true', () => {
    expect(isModifierOnly('Control')).toBe(true)
    expect(isModifierOnly('Shift')).toBe(true)
    expect(isModifierOnly('Alt')).toBe(true)
    expect(isModifierOnly('Meta')).toBe(true)
  })
  it('主键返回 false', () => {
    expect(isModifierOnly('Enter')).toBe(false)
    expect(isModifierOnly('k')).toBe(false)
  })
})
