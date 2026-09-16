/**
 * 快捷键纯逻辑(格式化 / 匹配,单测覆盖)。
 * 匹配与展示共用一套口径:修饰键取布尔相等,主键按小写比较
 * (KeyboardEvent.key 对字母受大小写影响,Enter 等命名键不受影响)。
 */
import type { HotkeyConfig } from '../types/memory'
type KeyEventLike = Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'key'>

export function formatHotkey(hk: HotkeyConfig): string {
  const parts: string[] = []
  if (hk.ctrl) parts.push('Ctrl')
  if (hk.alt) parts.push('Alt')
  if (hk.shift) parts.push('Shift')
  parts.push(hk.key.length === 1 ? hk.key.toUpperCase() : hk.key)
  return parts.join(' + ')
}

export function matchesHotkey(ev: KeyEventLike, hk: HotkeyConfig): boolean {
  return (
    ev.ctrlKey === hk.ctrl &&
    ev.altKey === hk.alt &&
    ev.shiftKey === hk.shift &&
    ev.key.toLowerCase() === hk.key.toLowerCase()
  )
}

/** 仅修饰键按下(还没按到主键):录入快捷键时用来等待主键 */
export function isModifierOnly(key: string): boolean {
  return ['Control', 'Shift', 'Alt', 'Meta'].includes(key)
}
