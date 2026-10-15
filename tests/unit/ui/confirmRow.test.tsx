// 内联二次确认行(第五十一轮单点化;v3.0 改为 CSS 变量 + 组件不吃 tk)。
//
// 本测试锁住"全站只有一份确认行实现"这件事:警示文案走语义红、确认是危险钮、
// 取消是幽灵钮 —— 样式分别落在 RESET_CSS 的 `.pddcs-btn[data-variant=...]` 上,
// 组件只负责结构。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmRow } from '../../../src/ui/components'

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

function render(onOk = vi.fn(), onCancel = vi.fn()) {
  act(() => {
    root.render(<ConfirmRow text="删除该问答及其全部回复?" onOk={onOk} onCancel={onCancel} />)
  })
  const btns = Array.from(container.querySelectorAll('button'))
  return { onOk, onCancel, text: container.textContent ?? '', btns }
}

const textBtn = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label)

describe('ConfirmRow:警示文案 + 确认/取消', () => {
  it('文案照传,两个按钮齐备', () => {
    const { text, btns } = render()
    expect(text).toContain('删除该问答及其全部回复?')
    expect(btns.map((b) => b.textContent)).toEqual(['确认', '取消'])
  })

  it('确认/取消各回调一次,不互相串', () => {
    const { onOk, onCancel } = render()
    act(() => textBtn('确认')!.click())
    expect(onOk).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    act(() => textBtn('取消')!.click())
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onOk).toHaveBeenCalledTimes(1)
  })

  it('警示文案走语义红(v3.0 起经 CSS 变量取色,不再 prop-drill tk)', () => {
    render()
    expect((container.querySelector('span') as HTMLElement).style.color).toBe(
      'var(--pddcs-danger)',
    )
  })

  it('确认 = danger 变体、取消 = ghost 变体 —— 颜色交给 RESET_CSS 单一处决定', () => {
    const { btns } = render()
    const [ok, cancel] = btns
    expect(ok.getAttribute('data-variant')).toBe('danger')
    expect(cancel.getAttribute('data-variant')).toBe('ghost')
    // 两个都是同一款按钮(只有变体不同),全站不再有第二套确认行实现
    expect(ok.classList.contains('pddcs-btn')).toBe(true)
    expect(cancel.classList.contains('pddcs-btn')).toBe(true)
  })
})
