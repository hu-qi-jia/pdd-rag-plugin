// Toggle 键盘可达性单测(2026-09-15 评审 设计6):
// role=switch 但不可聚焦、键盘无法操作 —— 现补 tabIndex + Enter/Space 触发 + 焦点环。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Toggle } from '../../../src/ui/components'
import { lightTheme } from '../../../src/ui/theme'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderToggle(onChange: (v: boolean) => void) {
  act(() => {
    root.render(
      <Toggle tk={lightTheme} label="自动捕获" desc="说明文字" checked={false} onChange={onChange} />,
    )
  })
}

describe('Toggle:键盘可达', () => {
  it('开关可聚焦(tabIndex=0)且 role=switch', () => {
    renderToggle(vi.fn())
    const sw = container.querySelector('[role="switch"]') as HTMLElement
    expect(sw).toBeTruthy()
    expect(sw.tabIndex).toBe(0)
  })

  it('滑块几何由 CSS 驱动(knob 无内联 left,按 aria-checked 在样式层定位)', () => {
    renderToggle(vi.fn())
    const knob = container.querySelector('.pddcs-switch-knob') as HTMLElement
    expect(knob).toBeTruthy()
    expect(knob.style.left).toBe('')
  })

  it('聚焦后按 Enter 触发 onChange(true)', () => {
    const onChange = vi.fn()
    renderToggle(onChange)
    const sw = container.querySelector('[role="switch"]') as HTMLElement
    act(() => {
      sw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('聚焦后按 Space 触发 onChange 且不滚动页面', () => {
    const onChange = vi.fn()
    renderToggle(onChange)
    const sw = container.querySelector('[role="switch"]') as HTMLElement
    const evt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    act(() => {
      sw.dispatchEvent(evt)
    })
    expect(onChange).toHaveBeenCalledWith(true)
    expect(evt.defaultPrevented).toBe(true)
  })

  it('其他按键不触发', () => {
    const onChange = vi.fn()
    renderToggle(onChange)
    const sw = container.querySelector('[role="switch"]') as HTMLElement
    act(() => {
      sw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
