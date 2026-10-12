// 分区标题装置(v3.0 引入,第二版按用户反馈调整)。
//
// 用户在第一版改版后提了两条:
//   ①「标题前的竖线删除」—— 第一版的 SectionHeader 是 `▌标题 ────`,那根 3×12 竖标记被删掉。
//      与"盒子退场"同一条思路:能靠线说清的事就不再叠一枚符号;删掉之后标题文字左缘正好落在
//      x=0,与它管着的那些行的文字同线,不再需要任何补偿量。
//   ②「问题分类和问题要区分开」—— 根因不是字号差得不够,而是**整页都是 600**。
//      分区线随之由 `border`(控件描边档)提到 **`borderStrong`(结构线档)**:
//      行与行之间画的是 `borderLight` 发丝线,两档深浅差得足够远,
//      "标题那一行"与"内容行"就有了线重 + 字重两重区分。
//
// 这个文件锁的就是这两条 —— 它们是判断"改回旧观感"的唯一依据。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SectionHeader } from '../../../src/ui/components'
import { lightTheme, darkTheme } from '../../../src/ui/theme'
import { formType } from '../../../src/ui/design'

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

function render(props: Parameters<typeof SectionHeader>[0]) {
  act(() => {
    root.render(<SectionHeader {...props} />)
  })
}

/** 那条向右延伸的分区线:容器里唯一带背景色、且不含文字的 span */
const rule = (): HTMLElement => {
  const spans = Array.from(container.querySelectorAll('span'))
  const found = spans.find((s) => s.children.length === 0 && !s.textContent && s.style.backgroundColor)
  expect(found, '找不到分区线').toBeTruthy()
  return found as HTMLElement
}

const titleSpan = (): HTMLElement =>
  Array.from(container.querySelectorAll('span')).find((s) => s.textContent === '物流 · 3') as HTMLElement

describe('SectionHeader:标题前不再有竖标记', () => {
  it('★ 整行只有「标题 + 分区线」两件东西,没有第三枚装饰元素', () => {
    render({ tk: lightTheme, title: '物流 · 3' })
    const row = container.firstElementChild as HTMLElement
    expect(row.children).toHaveLength(2)
  })

  it('★ 任何一枚元素都不是"细高竖条"(3×12 那根标记的指纹)', () => {
    render({ tk: lightTheme, title: '物流 · 3' })
    for (const el of Array.from(container.querySelectorAll('*'))) {
      const s = (el as HTMLElement).style
      expect(s.width === '3px' && s.height === '12px', '竖标记又回来了').toBe(false)
    }
  })

  it('标题文字站在容器最左缘(没有标记推它,就不需要补偿量)', () => {
    render({ tk: lightTheme, title: '物流 · 3' })
    expect(titleSpan()).toBeTruthy()
    // 标题是行内第一个元素 —— 行内没有 left 偏移
    expect(titleSpan().style.paddingLeft).toBe('')
    expect(titleSpan().style.marginLeft).toBe('')
  })
})

describe('SectionHeader:分区线取结构线档(标题与行能被一眼分开)', () => {
  it('★ 线的颜色是 `borderStrong`,不是控件描边那一档', () => {
    render({ tk: lightTheme, title: '物流 · 3' })
    expect(rule().style.backgroundColor).toBe(lightTheme.borderStrong)
    expect(rule().style.backgroundColor).not.toBe(lightTheme.border)
  })

  it('两主题各自取各自的结构线(深色下是近白,不是黑)', () => {
    render({ tk: darkTheme, title: '物流 · 3' })
    expect(rule().style.backgroundColor).toBe(darkTheme.borderStrong)
  })

  it('结构线与行分隔线必须是两个色 —— 同色就等于没有层级', () => {
    for (const tk of [lightTheme, darkTheme]) {
      expect(tk.borderStrong, '结构线与行分隔线撞色了').not.toBe(tk.borderLight)
    }
  })

  it('标题走分组标题档(13.5 / 600),比行内容高一档', () => {
    render({ tk: lightTheme, title: '物流 · 3' })
    expect(titleSpan().style.fontSize).toBe(`${formType.groupTitle.size}px`)
    expect(titleSpan().style.fontWeight).toBe(String(formType.groupTitle.weight))
  })

  it('★ 标题取 `textMuted`,与纯黑的词条在**颜色**上分开(用户第三条反馈)', () => {
    // 「标题与词条颜色也做一下区分」—— 此前两者同为纯黑,只靠 1px 字号区分。
    // 灰标题不是"弱化标题",是**角色区分**:分区名是一枚标签,它管着的那些行才是内容。
    for (const tk of [lightTheme, darkTheme]) {
      render({ tk, title: '物流 · 3' })
      expect(titleSpan().style.color).toBe(tk.textMuted)
      expect(titleSpan().style.color).not.toBe(tk.text)
      // 与说明文字同色是允许的(两者都是"标签"),但**不得**与行分隔线同色 —— 那会让人以为标题只是一段灰字
      expect(tk.textMuted).not.toBe(tk.borderLight)
    }
  })
})

describe('SectionHeader:右端附加物与可折叠', () => {
  it('extra 渲染在分区线**之后**(靠右端)', () => {
    render({ tk: lightTheme, title: '物流 · 3', extra: <span>×</span> })
    const row = container.firstElementChild as HTMLElement
    expect(row.lastElementChild?.textContent).toBe('×')
  })

  it('传 onClick 时整行是可折叠按钮,并声明 aria-expanded', () => {
    const onClick = vi.fn()
    render({ tk: lightTheme, title: '物流 · 3', onClick, expanded: false })
    const btn = container.querySelector('button') as HTMLButtonElement
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('不传 onClick 时不是按钮(普通分区标题不该有可点语义)', () => {
    render({ tk: lightTheme, title: '物流 · 3' })
    expect(container.querySelector('button')).toBeNull()
  })
})
