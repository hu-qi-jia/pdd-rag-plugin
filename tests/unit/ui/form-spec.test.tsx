// 设置页口径单测(v4.0 重写)。
//
// 三条与上一版的差别:
//  · **分区不再是卡片**:`Section` 渲染成"一行小标题 + 它下面那几行",
//    都落在同一片面上(见 popup-css 的扁平化);
//  · **字段标签不再是 semibold**:iOS 设置页的行标题是常规字重,靠字号与颜色分层 ——
//    一屏十几行全加粗会糊成一片;
//  · 开关/滑杆的配色全在 CSS 里,这里只断**结构契约**(谁在哪个槽位、字号取哪一档),
//    配色契约在 popup-css.test.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Section, SettingRow, Slider, Toggle } from '../../../src/ui/components'
import { fontSize, formGap, formType } from '../../../src/ui/design'

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

// ── ① 字号规范 ────────────────────────────────────────────────────────────────

describe('设置页字号规范:分区标题 / 字段标签 / 说明文字(formType)', () => {
  it('三档取值,且字段标签 > 说明文字', () => {
    expect(formType.section.size).toBe(12)
    expect(formType.label.size).toBe(15)
    expect(formType.desc.size).toBe(12)
    expect(formType.label.size).toBeGreaterThan(formType.desc.size)
  })

  it('全部落在 v4.0 的四档字号阶梯上,没有阶梯外的临时值', () => {
    const ladder: number[] = Object.values(fontSize)
    for (const v of [formType.section.size, formType.label.size, formType.desc.size]) {
      expect(ladder).toContain(v)
    }
  })

  it('字重:分区标题 semibold;字段标签与说明都是 regular(iOS 设置页的做法)', () => {
    expect(formType.section.weight).toBe(600)
    expect(formType.label.weight).toBe(400)
    expect(formType.desc.weight).toBe(400)
  })

  it('★ Section 不再是卡片:只渲染分区标题 + 内容,没有盒子', () => {
    act(() => {
      root.render(
        <Section title="检索与填充">
          <div />
        </Section>,
      )
    })
    const section = container.querySelector('.pddcs-section') as HTMLElement
    expect(section).toBeTruthy()
    // 盒子语言(边框 / 圆角 / 底色)全部退役 —— 线条与留白交给 CSS
    expect(section.style.border).toBe('')
    expect(section.style.borderRadius).toBe('')
    expect(section.style.background).toBe('')
    const title = container.querySelector('.pddcs-section-title') as HTMLElement
    expect(title.textContent).toBe('检索与填充')
  })

  it('无标题时不渲染标题行', () => {
    act(() => {
      root.render(
        <Section>
          <div />
        </Section>,
      )
    })
    expect(container.querySelector('.pddcs-section-title')).toBeNull()
  })
})

// ── ② 间距统一 ────────────────────────────────────────────────────────────────

describe('设置页行距规范(formGap)', () => {
  it('配置项之间 16px、标签→说明 4px、标签→控件 8px', () => {
    expect(formGap.row).toBe(16)
    expect(formGap.labelDesc).toBe(4)
    expect(formGap.labelControl).toBe(8)
    expect(formGap.row).toBeGreaterThan(formGap.labelControl)
    expect(formGap.labelControl).toBeGreaterThan(formGap.labelDesc)
  })
})

// ── ③ 行结构 ──────────────────────────────────────────────────────────────────

describe('设置行:标签在左、控件在右(同一套行样式)', () => {
  it('★ Toggle 就是一行:标签 + 说明在左,开关在右,且天然带发丝线', () => {
    act(() => {
      root.render(<Toggle label="自动回复" desc="只填不发" checked={false} onChange={vi.fn()} />)
    })
    const row = container.querySelector('.pddcs-srow') as HTMLElement
    expect(row).toBeTruthy()
    expect(row.classList.contains('pddcs-hair')).toBe(true)
    // 开关是最后一个子元素 = 视觉右侧
    expect(row.lastElementChild?.getAttribute('role')).toBe('switch')
    expect(row.querySelector('.pddcs-srow-label .n')?.textContent).toBe('自动回复')
    expect(row.querySelector('.pddcs-srow-label .d')?.textContent).toBe('只填不发')
  })

  it('Toggle 的 desc 可选 —— 说不清的不如不写', () => {
    act(() => {
      root.render(<Toggle label="标准回答优先" checked onChange={vi.fn()} />)
    })
    expect(container.querySelector('.pddcs-srow-label .n')?.textContent).toBe('标准回答优先')
    expect(container.querySelector('.pddcs-srow-label .d')).toBeNull()
  })

  it('SettingRow:标签 + 说明在左,自带控件槽位', () => {
    act(() => {
      root.render(
        <SettingRow label="模型名" desc="填接口文档里的模型标识">
          <span>deepseek-chat</span>
        </SettingRow>,
      )
    })
    const row = container.querySelector('.pddcs-srow') as HTMLElement
    expect(row.querySelector('.n')?.textContent).toBe('模型名')
    expect(row.querySelector('.d')?.textContent).toBe('填接口文档里的模型标识')
    expect(row.lastElementChild?.textContent).toBe('deepseek-chat')
  })

  it('SettingRow 可以关掉发丝线(一段列表的最后一行)', () => {
    act(() => {
      root.render(<SettingRow label="最后一行" hair={false} />)
    })
    expect(container.querySelector('.pddcs-srow')!.classList.contains('pddcs-hair')).toBe(false)
  })

  it('Slider:标签与当前值同一行,取值走等宽;轨道在下方', () => {
    act(() => {
      root.render(
        <Slider
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
    expect(label.style.fontSize).toBe(`${formType.label.size}px`)
    // 当前值走等宽(数字列对齐)。等宽只从 .pddcs-num 一个入口来 ——
    // 先前是各组件自写一份内联 'ui-monospace, Consolas, monospace',
    // 与 design.ts 的 fontFamilyMono 并不是同一个栈(少了 Cascadia Code / Courier New)
    const value = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '0.60',
    ) as HTMLElement
    expect(value.classList.contains('pddcs-num')).toBe(true)
    expect(value.style.fontFamily).toBe('')
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.style.backgroundImage).toContain('50%')
  })

  it('Slider 填充走强调色、轨道走边框色', () => {
    act(() => {
      root.render(
        <Slider
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
    // 已选段走 accent(v4.0 是 ink):它表示"当前值",与开关选中同一条口径
    expect(input.style.backgroundImage).toContain('var(--pddcs-accent)')
    expect(input.style.backgroundImage).toContain('var(--pddcs-border)')
  })
})
