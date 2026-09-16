// 设置页口径单测(2026-09-16 第四十一轮,用户三条要求):
//  ① 设置页文字字号规范:标题 / 配置项字段 / 说明文字 三级
//  ② 各配置项之间间距增大并统一
//  ③ 开关与滑杆改用灰色和白色(亮色主题 / 暗色主题),原 accent 蓝退出这两个组件
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Card, Slider, Toggle } from '../../../src/ui/components'
import { darkTheme, lightTheme } from '../../../src/ui/theme'
import { formGap, formType } from '../../../src/ui/design'

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

// ── 颜色比较:jsdom 会把内联 #rrggbb 归一化成 rgb(r, g, b),两种写法都认 ──

const norm = (c: string) => c.replace(/\s+/g, '').toLowerCase()

function hexOf(c: string): string | null {
  const n = norm(c)
  const hex = n.match(/^#([0-9a-f]{6})$/)
  if (hex) return hex[1]
  const rgb = n.match(/^rgb\((\d+),(\d+),(\d+)\)$/)
  if (rgb) return [1, 2, 3].map((i) => Number(rgb[i]).toString(16).padStart(2, '0')).join('')
  return null
}

/** 两色是否同色(容忍 hex / rgb() 两种书写形式) */
function colorIs(actual: string, expected: string): boolean {
  const a = hexOf(actual)
  const b = hexOf(expected)
  if (a && b) return a === b
  return norm(actual) === norm(expected)
}

/** 相对亮度(WCAG);用于验证"柄与轨道必须可辨"这条反相硬约束 */
function luminance(color: string): number {
  let hex = hexOf(color)
  if (!hex) {
    // rgba(r,g,b,a) 需先按 alpha 叠到给定底面上,再由调用方传入合成色
    throw new Error(`luminance 只接受不透明色,收到:${color}`)
  }
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(hex!.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** rgba(r,g,b,a) 叠到 base 上的合成色(开关未选中轨道是半透明白) */
function blendOver(color: string, base: string): string {
  const m = norm(color).match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/)
  if (!m) return color
  const alpha = Number(m[4])
  const b = hexOf(base)!.match(/../g)!.map((x) => parseInt(x, 16))
  const out = [1, 2, 3].map((i) =>
    Math.round(Number(m[i]) * alpha + b[i - 1] * (1 - alpha))
      .toString(16)
      .padStart(2, '0'),
  )
  return `#${out.join('')}`
}

// ── ① 字号规范 ────────────────────────────────────────────────────────────────

describe('设置页字号规范:标题 > 配置项字段 > 说明文字(formType)', () => {
  it('三档等差 1px,且严格递减', () => {
    expect(formType.groupTitle.size).toBe(13.5)
    expect(formType.label.size).toBe(12.5)
    expect(formType.desc.size).toBe(11.5)
    expect(formType.groupTitle.size - formType.label.size).toBe(1)
    expect(formType.label.size - formType.desc.size).toBe(1)
  })

  it('层级不倒挂:分组标题必须大于字段标签(旧版 11.5 标题 + 12.5 标签是反的)', () => {
    expect(formType.groupTitle.size).toBeGreaterThan(formType.label.size)
    expect(formType.label.size).toBeGreaterThan(formType.desc.size)
  })

  it('字重:标题与字段 semibold,说明 regular', () => {
    expect(formType.groupTitle.weight).toBe(600)
    expect(formType.label.weight).toBe(600)
    expect(formType.desc.weight).toBe(400)
  })

  it('Card 标题走分组标题档(13.5 semibold),不再是小号灰字', () => {
    act(() => {
      root.render(
        <Card tk={lightTheme} title="检索与填充">
          <div />
        </Card>,
      )
    })
    // 取最内层元素(外层卡片容器的 textContent 也含标题,按 children 为空筛掉)
    const title = Array.from(container.querySelectorAll('div')).find(
      (el) => el.children.length === 0 && el.textContent === '检索与填充',
    ) as HTMLElement
    expect(title.style.fontSize).toBe('13.5px')
    expect(title.style.fontWeight).toBe('600')
    expect(colorIs(title.style.color, lightTheme.text)).toBe(true)
  })
})

// ── ② 间距统一 ────────────────────────────────────────────────────────────────

describe('设置页行距规范:配置项之间增大并统一(formGap)', () => {
  it('配置项之间 16px(原 10px)、卡片之间同值、标签→说明 4px、标签→滑杆轨道 8px', () => {
    expect(formGap.row).toBe(16)
    expect(formGap.labelDesc).toBe(4)
    expect(formGap.labelControl).toBe(8)
    expect(formGap.row).toBeGreaterThan(formGap.labelControl)
    expect(formGap.labelControl).toBeGreaterThan(formGap.labelDesc)
  })

  it('Toggle:标签走字段档、说明走说明档,两者间距取 labelDesc', () => {
    act(() => {
      root.render(
        <Toggle tk={lightTheme} label="自动回复" desc="开:直接填充第一条" checked={false} onChange={vi.fn()} />,
      )
    })
    const spans = Array.from(container.querySelectorAll('span'))
    const label = spans.find((el) => el.textContent === '自动回复') as HTMLElement
    const desc = spans.find((el) => el.textContent === '开:直接填充第一条') as HTMLElement
    expect(label.style.fontSize).toBe(`${formType.label.size}px`)
    expect(label.style.fontWeight).toBe('600')
    expect(desc.style.fontSize).toBe(`${formType.desc.size}px`)
    expect(desc.style.fontWeight).toBe('400')
    expect(desc.style.marginTop).toBe(`${formGap.labelDesc}px`)
    expect(desc.style.color).toBe(lightTheme.textMuted)
  })

  it('Slider:标签同字段档,填充渐变在阈值处硬切(与值比例一致)', () => {
    act(() => {
      root.render(
        <Slider
          tk={lightTheme}
          label="历史相似度阈值"
          value={0.6}
          min={0.3}
          max={0.9}
          step={0.05}
          onChange={vi.fn()}
          format={(v) => v.toFixed(2)}
        />,
      )
    })
    const label = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '历史相似度阈值',
    ) as HTMLElement
    // 字号在"标签 + 当前值"这一行的容器上(标签与值同档),字重在标签自身
    expect((label.parentElement as HTMLElement).style.fontSize).toBe(`${formType.label.size}px`)
    expect(label.style.fontWeight).toBe('600')
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(input.style.backgroundImage).toContain('50%')
  })
})

// ── ③ 开关 / 滑杆:灰白配色 ──────────────────────────────────────────────────

describe('开关与滑杆改用灰白:激活色浅色深灰 / 深色白,柄与轨道反相', () => {
  it('两主题激活色:浅色中性深灰 #45484d,深色纯白;均不再是 accent 蓝', () => {
    expect(lightTheme.controlActive).toBe('#45484d')
    expect(darkTheme.controlActive).toBe('#ffffff')
    expect(norm(lightTheme.accent)).not.toBe(norm(lightTheme.controlActive))
    expect(norm(darkTheme.accent)).not.toBe(norm(darkTheme.controlActive))
  })

  it('柄色与激活色不同(反相),且两主题方向相反:浅色柄更亮、深色柄更暗', () => {
    expect(colorIs(lightTheme.controlKnobBg, lightTheme.controlActive)).toBe(false)
    expect(colorIs(darkTheme.controlKnobBg, darkTheme.controlActive)).toBe(false)
    expect(luminance(lightTheme.controlKnobBg)).toBeGreaterThan(luminance(lightTheme.controlActive))
    expect(luminance(darkTheme.controlKnobBg)).toBeLessThan(luminance(darkTheme.controlActive))
  })

  it('柄在"选中轨道"和"未选中轨道"上都可辨(亮度差 ≥ 0.03;同色 = 柄消失)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      const on = tk.controlActive
      // 未选中轨道是半透明白/灰,须先叠到它实际所在的表面(卡片)上再比亮度
      const off = blendOver(tk.switchTrack, tk.bgCard)
      const knob = luminance(tk.controlKnobBg)
      expect(Math.abs(knob - luminance(on))).toBeGreaterThanOrEqual(0.03)
      expect(Math.abs(knob - luminance(off))).toBeGreaterThanOrEqual(0.03)
    }
  })

  it('Toggle 选中轨道取激活色、未选中仍走 switchTrack(悬浮各提一档)', () => {
    const render = (checked: boolean, tk = lightTheme) => {
      act(() => {
        root.render(
          <Toggle tk={tk} label="自动回复" desc="说明" checked={checked} onChange={vi.fn()} />,
        )
      })
      return container.querySelector('[role="switch"]') as HTMLElement
    }
    expect(colorIs(render(true).style.backgroundColor, lightTheme.controlActive)).toBe(true)
    expect(colorIs(render(true, darkTheme).style.backgroundColor, darkTheme.controlActive)).toBe(true)
    expect(colorIs(render(false).style.backgroundColor, lightTheme.switchTrack)).toBe(true)
    expect(colorIs(render(false, darkTheme).style.backgroundColor, darkTheme.switchTrack)).toBe(true)
  })

  it('Slider 填充色取激活色(不再是 accent 蓝)', () => {
    act(() => {
      root.render(
        <Slider
          tk={lightTheme}
          label="保留期天数"
          value={90}
          min={30}
          max={365}
          step={5}
          onChange={vi.fn()}
          format={(v) => `${v} 天`}
        />,
      )
    })
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(input.style.backgroundImage).toContain(lightTheme.controlActive)
    expect(input.style.backgroundImage).not.toContain(lightTheme.accent)
  })
})
