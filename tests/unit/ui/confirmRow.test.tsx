// 内联二次确认行(第五十一轮单点化):文件夹页与记忆页此前各有一份实现,
// 字号与按钮档位都不一致,记忆页那份还落在 `fontSize.caption + 0.5` 这个被明令禁止的临时值上。
// 本测试锁住"两份合成一份"这件事:档位固定为内联档,字号落在令牌阶梯上。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmRow } from '../../../src/ui/components'
import { controlH, fontSize } from '../../../src/ui/design'
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

function render(onOk = vi.fn(), onCancel = vi.fn()) {
  act(() => {
    root.render(
      <ConfirmRow tk={lightTheme} text="删除该问答及其全部回复?" onOk={onOk} onCancel={onCancel} />,
    )
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

  it('走内联控件档(controlH.inline),不是表单档 —— 确认行长在行内', () => {
    render()
    for (const b of Array.from(document.querySelectorAll('button'))) {
      expect(b.style.height).toBe(`${controlH.inline}px`)
    }
  })

  it('字号落在令牌阶梯上(文案与按钮同为 caption),没有 caption+0.5 这类临时值', () => {
    const { btns } = render()
    const span = container.querySelector('span')!
    expect(span.style.fontSize).toBe(`${fontSize.caption}px`)
    for (const b of btns) expect(b.style.fontSize).toBe(`${fontSize.caption}px`)
    // 反面:11px 那个"夹在两档之间"的值不允许再出现
    expect(span.style.fontSize).not.toBe(`${fontSize.caption + 0.5}px`)
  })

  /**
   * v3.1 去掉了红色:**警示靠墨色 + 加粗 + `!` 前缀**,危险按钮靠"1px 墨框 → 悬浮转实心墨底"。
   * 不靠颜色表意 —— 多一种颜色就多一个需要解释的信号,而它并不比加粗更准。
   */
  it('警示文案走墨色 + 加粗 + `!`;确认是墨框、取消是描边幽灵', () => {
    const { btns } = render()
    const [ok, cancel] = btns
    const span = container.querySelector('span')!
    expect(span.style.color).toBe(lightTheme.text)
    expect(span.style.fontWeight).toBe('600')
    expect(span.textContent).toContain('!')
    // 确认 = 墨框描边(不是红底实心)
    expect(ok.style.backgroundColor).toBe('transparent')
    expect(ok.style.border).toContain(lightTheme.dangerBorder)
    expect(ok.style.color).toBe(lightTheme.text)
    expect(cancel.style.backgroundColor).toBe('transparent')
    expect(cancel.style.color).toBe(lightTheme.textMuted)
  })
})
