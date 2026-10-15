// 覆盖层图标单测(2026-09-16 第三十七轮;v4.1 尺寸档对齐):候选行操作钮由文字改图标 ——
// 覆盖层是纯 DOM(不引 React),故图标以 SVG 字符串导出;此处锁住几个关键约定:
// 渲染尺寸与 popup 的 IconBtn **严格同档**(28px 钮 / 16px 图标,两者都取自 design.ts 单点)、
// currentColor 继承(颜色只由 CSS 决定)、已设态为实心(fill=currentColor)。
import { describe, it, expect } from 'vitest'
import {
  COPY_ICON,
  ICON_BTN_SIZE,
  ICON_SIZE,
  LOADER_ICON,
  STAR_FILLED_ICON,
  STAR_ICON,
} from '../../../src/ui/overlay-icons'
import { controlH, size } from '../../../src/ui/design'

describe('overlay-icons:覆盖层 SVG 图标字面量', () => {
  it('尺寸与 popup 图标钮同档(16px 图标 / 28px 钮),且都取自 design.ts 单点', () => {
    // 判据是**容器**:长在 .pddcs-icon-btn 里的图标取 iconBtn 档(与 popup 的 IconBtn 同)
    expect(ICON_SIZE).toBe(size.iconBtn)
    expect(ICON_BTN_SIZE).toBe(controlH.icon)
    expect(ICON_SIZE).toBe(16)
    expect(ICON_BTN_SIZE).toBe(28)
    // 那 6px 盒内留白是候选行操作组 margin-right:-6px 的依据,尺寸一改它就偏了
    expect((ICON_BTN_SIZE - ICON_SIZE) / 2).toBe(6)
    for (const icon of [STAR_ICON, STAR_FILLED_ICON, COPY_ICON, LOADER_ICON]) {
      expect(icon).toContain(`width="${ICON_SIZE}" height="${ICON_SIZE}"`)
      expect(icon).toContain('viewBox="0 0 24 24"')
    }
  })

  it('颜色一律 currentColor(由 .pddcs-icon-btn 决定,不在 SVG 里写死色值)', () => {
    for (const icon of [STAR_ICON, STAR_FILLED_ICON, COPY_ICON, LOADER_ICON]) {
      expect(icon).toContain('stroke="currentColor"')
      expect(icon).toContain('stroke-width="2"')
      expect(icon).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    }
  })

  it('星标两态:未设 = 描边(fill none),已设 = 实心(fill currentColor)', () => {
    expect(STAR_ICON).toContain('fill="none"')
    expect(STAR_FILLED_ICON).toContain('fill="currentColor"')
  })

  it('图标本身对读屏隐藏(语义由按钮的 aria-label 承载)', () => {
    for (const icon of [STAR_ICON, STAR_FILLED_ICON, COPY_ICON, LOADER_ICON]) {
      expect(icon).toContain('aria-hidden="true"')
    }
  })
})
