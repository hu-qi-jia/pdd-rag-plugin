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

describe('Toggle:布局与滑块契约(2026-09-15 用户要求开关右置)', () => {
  it('开关在文字块之后(容器内最后一个元素 = 视觉右侧)', () => {
    renderToggle(vi.fn())
    const row = container.firstElementChild as HTMLElement
    expect(row.lastElementChild?.getAttribute('role')).toBe('switch')
    expect(row.textContent).toContain('自动捕获')
  })

  it('滑块位置由 CSS 驱动:knob 无内联 left(否则压过 :active 拉伸微交互)', () => {
    renderToggle(vi.fn())
    const knob = container.querySelector('.pddcs-switch-knob') as HTMLElement
    expect(knob).toBeTruthy()
    expect(knob.style.left).toBe('')
  })

  it('标签加粗(semibold,2026-09-15 第十七轮用户要求)', () => {
    renderToggle(vi.fn())
    const label = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === '自动捕获')
    expect(label?.style.fontWeight).toBe('600')
  })
})

// 2026-09-17 第四十八轮用户反馈:"设置中的开关只有在点击开关时才开启/关闭,
// 目前是点击对应配置文字就会触发开关"。原先整行是 <label>,点标签文字也会翻转 ——
// 而标签旁边就挨着说明文字,想选一句话复制都做不到。
describe('Toggle:只有开关本体可点(第四十八轮用户要求)', () => {
  it('点标签文字不翻转', () => {
    const onChange = vi.fn()
    renderToggle(onChange)
    const label = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '自动捕获',
    ) as HTMLElement
    act(() => {
      label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('点说明文字不翻转', () => {
    const onChange = vi.fn()
    renderToggle(onChange)
    const desc = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '说明文字',
    ) as HTMLElement
    act(() => {
      desc.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('点开关本体翻转', () => {
    const onChange = vi.fn()
    renderToggle(onChange)
    const sw = container.querySelector('[role="switch"]') as HTMLElement
    act(() => {
      sw.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('文字块不再包在 label 里(没有 label 就没有"点文字=点控件"的隐式行为)', () => {
    renderToggle(vi.fn())
    expect(container.querySelector('label')).toBeNull()
  })
})

describe('Toggle:键盘可达', () => {
  it('开关可聚焦(tabIndex=0)且 role=switch', () => {
    renderToggle(vi.fn())
    const sw = container.querySelector('[role="switch"]') as HTMLElement
    expect(sw).toBeTruthy()
    expect(sw.tabIndex).toBe(0)
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
