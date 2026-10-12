// 分类导航(ui/CategoryNav.tsx)的契约:
//
//  - **单行**:flexWrap nowrap + overflowX auto(用户:「导航为一行,鼠标滚轮控制滑动」);
//  - **两态 = 实心黑 vs 灰字**(v3.1 §二):选中 = 反白实心(墨底 + 面板底色字);
//    未选中 = 灰字 + 无描边 + 透明底 —— 一排描边方块会把导航变成一列盒子,而它只承担
//    "现在在哪" 这一个信息,反白已经说完了;
//  - **盒高靠 lineHeight + 对称 padding 撑**(§六:固定 height 与 baseline 混用会贴容器顶部);
//  - **锚点**:data-category-id 挂在导航按钮上(单测/验收脚本按它找,不按文字找);
//  - **滚轮横移**:wheel deltaY 映射为 scrollLeft,可滚动时 preventDefault 拦住页面滚动。
//
// 计数与筛选同源的口径在 memoryCategory / goldenCategory / categoryGrouping 里,那里不重复。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const { CategoryNav } = await import('../../../src/ui/CategoryNav')
const { lightTheme: tk } = await import('../../../src/ui/theme')
const { categoryNav } = await import('../../../src/ui/design')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const ITEMS = [
  { id: 'all', name: '全部', count: 13 },
  { id: 'preset:size', name: '尺码', count: 3 },
  { id: 'preset:logistics', name: '订单物流', count: 0 },
]

async function render(active = 'all', onSelect = vi.fn()) {
  await act(async () => {
    root.render(<CategoryNav tk={tk} items={ITEMS} active={active} onSelect={onSelect} />)
  })
  await act(async () => {})
  return container.querySelector('nav')!
}

const navBtn = (id: string): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>(`[data-category-id="${id}"]`)

/** 把容器 mock 成"横向可滚动"(happy-dom 不做布局,scrollWidth 恒 0) */
function mockScrollable(nav: HTMLElement, scrollWidth = 500, clientWidth = 200) {
  Object.defineProperty(nav, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(nav, 'clientWidth', { value: clientWidth, configurable: true })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('CategoryNav:单行 + 矩形双态', () => {
  it('★ 单行不换行,横向滚动;滚动条由 .pddcs-catnav 规则隐藏(类名必须挂着)', async () => {
    const nav = await render()
    expect(nav.style.flexWrap).toBe('nowrap')
    expect(nav.style.overflowX).toBe('auto')
    expect(nav.className).toContain('pddcs-catnav')
  })

  /**
   * v3.1 §二把两态改回「**实心黑 vs 灰字**」:
   * 未选中**不用描边块** —— 一排描边方块会把这条导航变成一列盒子,
   * 而它承担的只是"现在在哪"这一个信息,反白已经说完了。
   */
  it('★ 未选中 = 灰字无框;选中 = 反白实心(墨底 + 面板底色字)', async () => {
    await render('preset:size')
    const on = navBtn('preset:size')!
    const off = navBtn('all')!
    // 选中:实心反白
    expect(on.getAttribute('aria-current')).toBe('true')
    expect(on.style.backgroundColor).toBe(tk.text)
    expect(on.style.color).toBe(tk.bg)
    // 未选中:透明底、无描边、灰字
    expect(off.getAttribute('aria-current')).toBeNull()
    expect(off.style.backgroundColor).toBe('transparent')
    expect(off.style.borderStyle).toBe('none')
    expect(off.style.color).toBe(tk.textTertiary)
  })

  it('★ 盒高靠 lineHeight + 对称 padding 撑,不写死 height(§六:height 与 baseline 混用会贴顶)', async () => {
    await render('all')
    const b = navBtn('all')!
    expect(b.style.height).toBeFalsy()
    expect(b.style.paddingTop).toBe(b.style.paddingBottom)
    expect(b.style.lineHeight).toBe(`${categoryNav.lineHeight}px`)
  })

  it('★ 顺序即传入顺序(全部恒第一),点击回调携带档位 id', async () => {
    const onSelect = vi.fn()
    await render('all', onSelect)
    const ids = Array.from(container.querySelectorAll('[data-category-id]')).map((el) =>
      el.getAttribute('data-category-id'),
    )
    expect(ids).toEqual(['all', 'preset:size', 'preset:logistics'])
    await act(async () => {
      navBtn('preset:size')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith('preset:size')
  })

  it('★ 展示全部分类,含 0 条的(计数照写)', async () => {
    await render()
    expect(navBtn('preset:logistics')!.textContent).toContain('订单物流')
    expect(navBtn('preset:logistics')!.textContent).toContain('0')
  })

  it('★ 滚轮纵移映射为横移:可滚动时消费事件(scrollLeft 前进)', async () => {
    const nav = await render()
    mockScrollable(nav)
    const ev = new Event('wheel', { cancelable: true })
    ;(ev as Event & { deltaY: number }).deltaY = 120
    await act(async () => {
      nav.dispatchEvent(ev)
    })
    expect(nav.scrollLeft).toBe(120)
  })

  it('★ 不可滚动时滚轮放行(不消费,页面照常滚)', async () => {
    const nav = await render()
    // happy-dom 默认 scrollWidth = clientWidth = 0,即不可滚动
    const ev = new Event('wheel', { cancelable: true })
    ;(ev as Event & { deltaY: number }).deltaY = 120
    await act(async () => {
      nav.dispatchEvent(ev)
    })
    expect(nav.scrollLeft).toBe(0)
  })

  it('★ 可滚动且未到头时,未到头的一侧渐隐(mask);滚到头则取消', async () => {
    const nav = await render()
    mockScrollable(nav)
    // 初始 scrollLeft = 0:右端还有 → 右侧渐隐
    await act(async () => {
      nav.dispatchEvent(new Event('scroll'))
    })
    expect(nav.style.maskImage).toContain('linear-gradient')
    // 滚到最右:右侧渐隐取消
    Object.defineProperty(nav, 'scrollLeft', { value: 300, configurable: true })
    await act(async () => {
      nav.dispatchEvent(new Event('scroll'))
    })
    expect(nav.style.maskImage).not.toContain('calc(100% - 14px)')
  })
})
