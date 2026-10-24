// 圆角规范(2026-10-24 收口)。
//
// 为什么值得单独一份:圆角是"看起来对了就不会再看"的参数 —— 没有人会盯着 14 和 16 的
// 差别,于是它最容易在后续改动里悄悄长出新档位(13、15、17 这种"凑一个")。一旦出现,
// "谁裹着谁"的空间语言就散了:读者读不出哪一层在上一层的里面。
//
// 这里钉的是**规则**,不是某个具体像素值:令牌可以整体上调(2026-10-24 就上调过一次:
// 13/15/18 → 14/16/20),但四档结构、档差、比例、内缩关系必须一直成立。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { controlH, listGap, pageGap, radius } from '../../../src/ui/design'
import { POPUP_CSS } from '../../../src/ui/popup-css'
import { BADGE_RADIUS, buildOverlayCss } from '../../../src/ui/overlay-css'
import { lightTheme } from '../../../src/ui/theme'

const overlay = buildOverlayCss(lightTheme, 'light')

describe('圆角规范①:四档是唯一来源', () => {
  it('档位齐全且严格递增 —— 浮层 > 卡片 > 控件 > 0', () => {
    expect(radius.control).toBeGreaterThan(0)
    expect(radius.card).toBeGreaterThan(radius.control)
    expect(radius.panel).toBeGreaterThan(radius.card)
    expect(radius.pill).toBe(9999)
  })

  it('★ 相邻档差 2–5px —— 差 1 读不出层级,差 6 以上像两套语言', () => {
    const gaps = [radius.card - radius.control, radius.panel - radius.card]
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(2)
      expect(g).toBeLessThanOrEqual(5)
    }
  })
})

describe('圆角规范②:比例关系', () => {
  it('★ 控件圆角跟控件高度走(0.38–0.48)—— 否则「胶囊」与「方块」之间漂移', () => {
    const ratio = radius.control / controlH.form
    expect(ratio).toBeGreaterThanOrEqual(0.38)
    expect(ratio).toBeLessThanOrEqual(0.48)
  })

  it('★ 卡片 ≤ 列表内缩 = 页面左右内边距 —— 三者的竖线是一条', () => {
    expect(listGap.inset).toBeGreaterThanOrEqual(radius.card)
    expect(listGap.inset).toBe(pageGap.x)
  })
})

describe('圆角规范③:样式表里只许出现令牌与两处例外', () => {
  it('popup 只出现 card / control / pill / 50% / 0', () => {
    const values = [...POPUP_CSS.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim())
    for (const v of values) {
      expect([`${radius.card}px`, `${radius.control}px`, `${radius.pill}px`, '50%', '0']).toContain(v)
    }
  })

  it('聊天页覆盖层同理,另加来源标签的 4px(显式例外)', () => {
    const values = [...overlay.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(values.length).toBeGreaterThan(0)
    for (const v of values) {
      expect([
        `${radius.panel}px`,
        `${radius.card}px`,
        `${radius.control}px`,
        `${radius.pill}px`,
        `${BADGE_RADIUS}px`,
        '50%',
        '0',
      ]).toContain(v)
    }
  })
})

describe('圆角规范④:源码里不许硬编码圆角', () => {
  /** 递归收集 src 下的 .ts/.tsx */
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return walk(full)
      return /\.tsx?$/.test(name) ? [full] : []
    })

  /** CSS 里的 border-radius 与 JSX 里的 borderRadius,取值不得是字面数字 */
  const offenders = (): string[] => {
    const bad: string[] = []
    for (const file of walk('src')) {
      // 注释行不参与(文档里会写"13px 那种临时值")
      const text = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n')
      for (const m of text.matchAll(/(?:border-radius|borderRadius)\s*:\s*([^;,\n}]+)/g)) {
        const value = m[1].trim()
        // 允许:令牌插值(${...})、内联令牌(radius.*)、CSS 变量、正圆、直角、命名常量
        const allowed =
          value.includes('${') ||
          value.startsWith('radius.') ||
          value.startsWith('var(') ||
          value === '0' ||
          value === '50%' ||
          value.startsWith('BADGE_RADIUS')
        if (!allowed) bad.push(`${file}: ${m[0].trim()}`)
      }
    }
    return bad
  }

  it('★ 只许引用 design.ts 的令牌(以及 50% / 0 / BADGE_RADIUS)', () => {
    expect(offenders()).toEqual([])
  })
})
