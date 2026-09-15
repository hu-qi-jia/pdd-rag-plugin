// Slider 组件单测(2026-09-15 用户要求更换滑轨组件):
// 自定义滑轨 = 填充进度渐变(accent 到已过值,未填充段走轨道色)+ CSS 拇指钮。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Slider } from '../../../src/ui/components'
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

function renderSlider(onChange: (v: number) => void, value = 0.5) {
  act(() => {
    root.render(
      <Slider
        tk={lightTheme}
        label="历史相似度阈值"
        value={value}
        min={0.3}
        max={0.9}
        step={0.05}
        onChange={onChange}
        format={(v) => v.toFixed(2)}
      />,
    )
  })
}

describe('Slider:自定义滑轨', () => {
  it('渲染标签与格式化后的当前值', () => {
    renderSlider(vi.fn())
    expect(container.textContent).toContain('历史相似度阈值')
    expect(container.textContent).toContain('0.50')
  })

  it('轨道按值填充:背景渐变在 (value-min)/(max-min) 处硬切', () => {
    renderSlider(vi.fn(), 0.6) // (0.6-0.3)/(0.9-0.3) = 50%
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(input.style.backgroundImage).toContain('linear-gradient')
    expect(input.style.backgroundImage).toContain('50%')
  })

  it('拖动触发 onChange 并携带数值', () => {
    const onChange = vi.fn()
    renderSlider(onChange)
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    act(() => {
      // React 对 range 的 onChange 监听 input 事件,且须用原生 value setter 绕过值去重
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '0.7')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith(0.7)
  })
})
