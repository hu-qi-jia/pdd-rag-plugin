/**
 * 气泡锚点解析单测 —— 覆盖 2026-09-15 用户反馈「AI回复按钮压住气泡」的根因:
 * p.msg-content-box 的 rect 右缘短掉气泡内边距,必须向上取到带背景色的气泡容器。
 * happy-dom 无布局引擎(rect 恒为 0),宽度守卫用注入的 widthOf 测。
 */
import { describe, it, expect } from 'vitest'
import {
  BUBBLE_WIDTH_TOLERANCE,
  findBubbleElement,
  isTransparentColor,
} from '../../../src/pdd/bubble-anchor'

/** 复刻真机结构:li.onemsg > .buyer-item > div[currentuid] > .msg-content > p.msg-content-box */
function mount(bubbleStyle: string, wrapStyle = ''): { box: HTMLElement; row: HTMLElement } {
  document.body.innerHTML = `
    <li class="onemsg">
      <div class="buyer-item">
        <div currentuid="123" style="${wrapStyle}">
          <div class="msg-content" style="${bubbleStyle}">
            <p class="msg-content-box">退货政策</p>
          </div>
        </div>
      </div>
    </li>`
  return {
    box: document.querySelector('.msg-content-box') as HTMLElement,
    row: document.querySelector('li.onemsg') as HTMLElement,
  }
}

const limit = () => document.querySelector('.buyer-item')

describe('isTransparentColor', () => {
  it('空值 / transparent / none / alpha=0 视为无背景', () => {
    expect(isTransparentColor('')).toBe(true)
    expect(isTransparentColor(undefined)).toBe(true)
    expect(isTransparentColor(null)).toBe(true)
    expect(isTransparentColor('transparent')).toBe(true)
    expect(isTransparentColor('none')).toBe(true)
    expect(isTransparentColor('rgba(0, 0, 0, 0)')).toBe(true)
  })
  it('实色 / 半透明有底色视为有背景', () => {
    expect(isTransparentColor('#ffffff')).toBe(false)
    expect(isTransparentColor('rgb(255, 255, 255)')).toBe(false)
    expect(isTransparentColor('rgba(255, 255, 255, 0.6)')).toBe(false)
  })
})

describe('findBubbleElement:向上吸收带背景色的气泡容器', () => {
  it('气泡底色在 .msg-content 上 → 返回 .msg-content(而非文本块 <p>)', () => {
    const { box } = mount('background-color: #ffffff')
    expect(findBubbleElement(box, limit())).toBe(document.querySelector('.msg-content'))
  })

  it('更外层容器才有底色 → 取最外层带背景者(间距从气泡真实外缘量起)', () => {
    const { box } = mount('', 'background-color: #ffffff')
    expect(findBubbleElement(box, limit())).toBe(document.querySelector('[currentuid]'))
  })

  it('整行容器的底色不计入 —— 否则按钮会被推到行外', () => {
    const { box, row } = mount('')
    ;(limit() as HTMLElement).style.backgroundColor = '#ff0000'
    row.style.backgroundColor = '#00ff00'
    expect(findBubbleElement(box, limit())).toBe(document.querySelector('.msg-content'))
  })

  it('宽度远大于文本块的祖先底色视为整行背景,不参与锚定', () => {
    const { box } = mount('', 'background-color: #ffffff')
    const widthOf = (el: HTMLElement) =>
      el === box ? 100 : el.classList.contains('msg-content') ? 120 : 800
    // [currentuid] 有底色但宽 800(整行),被宽度守卫排除 → 退到 .msg-content
    expect(findBubbleElement(box, limit(), widthOf)).toBe(document.querySelector('.msg-content'))
    // 容差边界:超出 48px 才排除
    const widthAt = (w: number) => (el: HTMLElement) => (el === box ? 100 : w)
    expect(findBubbleElement(box, limit(), widthAt(100 + BUBBLE_WIDTH_TOLERANCE))).toBe(
      document.querySelector('[currentuid]'),
    )
    expect(findBubbleElement(box, limit(), widthAt(100 + BUBBLE_WIDTH_TOLERANCE + 1))).toBe(
      document.querySelector('.msg-content'),
    )
  })

  it('整条链都无背景 → 退化为文本块直属容器(不再用 <p> 自己的内缘)', () => {
    const { box } = mount('')
    const hit = findBubbleElement(box, limit())
    expect(hit).toBe(document.querySelector('.msg-content'))
    expect(hit).not.toBe(box)
  })

  it('半透明气泡底(alpha>0)同样被吸收', () => {
    const { box } = mount('background-color: rgba(255, 255, 255, 0.8)')
    expect(findBubbleElement(box, limit())).toBe(document.querySelector('.msg-content'))
  })
})
