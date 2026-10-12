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

  it('Card 标题走分组标题档(13.5 semibold + textMuted),不再是小号灰字', () => {
    act(() => {
      root.render(
        <Card tk={lightTheme} title="检索与填充">
          <div />
        </Card>,
      )
    })
    // 取最内层元素(外层容器与分区标题行的 textContent 也含标题,按 children 为空筛掉)。
    // v3.0 起标题是 SectionHeader 里的一个 <span>(旧版是 Card 直接渲染的 div)
    const title = Array.from(container.querySelectorAll('span')).find(
      (el) => el.children.length === 0 && el.textContent === '检索与填充',
    ) as HTMLElement
    expect(title.style.fontSize).toBe('13.5px')
    expect(title.style.fontWeight).toBe('600')
    // 颜色:v3.0 第二版按用户「标题与词条颜色也做一下区分」由 `text` 改 `textMuted` ——
    // 标题与词条此前同为纯黑,只靠 1px 字号与分区线区分,在满屏条目里读起来像"又一条内容"。
    // 层级仍由**字号 + 字重 + 分区线**承担,颜色这一维改去承担"角色"(标签 vs 内容)。
    // 反面:它不能再等于 `text`,否则这次改动等于没做
    expect(colorIs(title.style.color, lightTheme.textMuted)).toBe(true)
    expect(colorIs(title.style.color, lightTheme.text)).toBe(false)
  })
})

// ── ② 间距统一 ────────────────────────────────────────────────────────────────

describe('设置页行距规范:配置项之间增大并统一(formGap)', () => {
  it('配置项之间 12px、分区之间同值、标签→说明 4px、标签→滑杆轨道 8px', () => {
    // v3.0 由 16 收到 12:复古极简要的是高信息密度,而分区现在由**一根横线**分隔而非卡片盒子 ——
    // 线已经承担了"这里是另一件事"的提示,行距不必再替它留白
    expect(formGap.row).toBe(12)
    expect(formGap.labelDesc).toBe(4)
    expect(formGap.labelControl).toBe(8)
    // 三档的**次序**才是这条规范的要害(大 > 中 > 小),具体数字可以随设计语言调
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
  it('两主题激活色:浅色近黑、深色近白,且**两色都无彩度**(v3.0 取消品牌色)', () => {
    // v3.0 前这条断的是"激活色不是 accent 蓝"(accent 当时是 Figma 蓝 #0D99FF)。
    // 现在 accent 与 controlActive **同值** —— 整站只剩一种墨色,焦点环与控件激活态
    // 共用它,不再有"品牌色 vs 控件色"这组对立。于是真正该守的不变量换成了
    // **无彩度**:强调不靠色相,靠墨的浓淡与反白(见 tests/unit/ui/overlay-css.test)
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    for (const [name, tk] of [
      ['浅色', lightTheme],
      ['深色', darkTheme],
    ] as const) {
      const [r, g, b] = channels(tk.controlActive)
      expect(new Set([r, g, b]).size, `${name} 激活色有彩度`).toBe(1)
      const [ar, ag, ab] = channels(tk.accent)
      expect(new Set([ar, ag, ab]).size, `${name} 焦点环有彩度`).toBe(1)
    }
    // 浅色近黑、深色近白:激活色必须与它所在的面拉开足够距离
    expect(luminance(lightTheme.controlActive)).toBeLessThan(0.05)
    expect(luminance(darkTheme.controlActive)).toBeGreaterThan(0.7)
    expect(lightTheme.controlActive).toBe(lightTheme.accent)
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

  it('Slider 填充色取激活色,且填充是**无彩色**(强调不靠色相)', () => {
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
    // 已填充段与未填充段是两个**色标同位置**的平涂色块(不是过渡渐变)——
    // 顺带确认这里没有混进第三个颜色
    const stops = input.style.backgroundImage.match(/#[0-9a-f]{6}/gi) ?? []
    expect(new Set(stops.map((s) => s.toLowerCase()))).toEqual(
      new Set([lightTheme.controlActive, lightTheme.inputBorder].map((s) => s.toLowerCase())),
    )
    for (const s of stops) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
      expect(new Set([r, g, b]).size, `${s} 有彩度`).toBe(1)
    }
  })
})
