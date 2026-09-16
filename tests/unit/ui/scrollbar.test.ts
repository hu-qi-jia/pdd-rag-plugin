/**
 * 细滚动条公共生成器(2026-09-16 第二十三轮):popup RESET_CSS 与聊天页覆盖层
 * buildOverlayCss 必须共用同一份规格 —— 改宽度/滑块最小高只动一处。
 */
import { describe, it, expect } from 'vitest'
import { thinScrollbarCss, SCROLLBAR_WIDTH } from '../../../src/ui/scrollbar'
import { buildOverlayCss } from '../../../src/utils/overlayTheme'
import { lightTheme } from '../../../src/ui/theme'

describe('thinScrollbarCss:统一规格生成', () => {
  it('生成选中器命名的 hover 显现式细滚动条,宽度取公共常量', () => {
    const css = thinScrollbarCss('.foo-scroll', 'var(--thumb)')
    expect(css).toContain('.foo-scroll::-webkit-scrollbar { width: 6px')
    expect(css).toContain('.foo-scroll:hover::-webkit-scrollbar-thumb')
    expect(css).toContain('var(--thumb)')
    expect(SCROLLBAR_WIDTH).toBe(6)
  })
  it('支持直接内插颜色令牌(覆盖层场景,无 CSS 变量桥)', () => {
    const css = thinScrollbarCss('.bar', 'rgba(0,0,0,0.16)')
    expect(css).toContain('rgba(0,0,0,0.16)')
  })
})

describe('buildOverlayCss × thinScrollbarCss:聊天页推荐面板复用同一规格', () => {
  it('面板滚动条走公共生成器(6px 细轨,滑块色 = scrollThumb 令牌)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain('.pddcs-popup::-webkit-scrollbar { width: 6px')
    expect(css).toContain(lightTheme.scrollThumb)
  })
})
