// 配色令牌的**可读性**契约(v4.1)。
//
// 为什么要有这个文件:v4.0 的色板是按"黑灰白"的手感定的,谁都没算过对比度 ——
// 结果三级文字(#8A8A8F / #6E6E75)在白面与近黑底上分别只有 3.44:1 与 3.89:1,
// 而这一档承载的全是 12px 小字(时间戳、计数、说明、占位)。手感说不出"4.5:1",
// 这条断言才说得出。
//
// 口径:WCAG 2.1 相对亮度 + 对比度公式,AA 正文阈值 4.5:1。
// 浅色底取白面(令牌 bg),深色底取近黑(bg)—— 三级文字最常落在这两个面上。
import { describe, it, expect } from 'vitest'
import { darkTheme, lightTheme, type ThemeTokens } from '../../../src/ui/theme'

/** sRGB 通道 → 线性(sRGB 反伽马),WCAG 2.1 §relative luminance 的第一步 */
function toLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** `#RRGGBB` → 相对亮度 */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`只支持 #RRGGBB,收到:${hex}`)
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** 两色对比度(1:1 ~ 21:1) */
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const AA_NORMAL = 4.5

describe('配色令牌:三级文字必须过 AA', () => {
  for (const [name, tk] of [
    ['浅色', lightTheme],
    ['深色', darkTheme],
  ] as [string, ThemeTokens][]) {
    it(`${name}:textTertiary 在页面底上 ≥ ${AA_NORMAL}:1(它承载的全是 12px 小字)`, () => {
      const ratio = contrast(tk.textTertiary, tk.bg)
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL)
    })

    it(`${name}:层级没被压平 —— 三级仍然明显弱于二级`, () => {
      // 把三级调到达标最容易矫枉过正(直接调成二级的灰):那样"四级墨"只剩三级,
      // 一屏里所有次要文字同权。这条守住两者的对比度仍然拉得开
      const t3 = contrast(tk.textTertiary, tk.bg)
      const t2 = contrast(tk.textSecondary, tk.bg)
      expect(t2).toBeGreaterThan(t3)
      expect(t2 - t3).toBeGreaterThanOrEqual(1.5)
    })
  }

  it('★ 回归:浅色三级曾是 #8A8A8F(3.44:1)、深色曾是 #6E6E75(3.89:1)', () => {
    expect(contrast('#8A8A8F', '#FFFFFF')).toBeLessThan(AA_NORMAL)
    expect(contrast('#6E6E75', '#0B0B0C')).toBeLessThan(AA_NORMAL)
    // 现行取值确实跨过了这条线(不写死具体色值,免得锁死后续微调)
    expect(contrast(lightTheme.textTertiary, lightTheme.bg)).toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrast(darkTheme.textTertiary, darkTheme.bg)).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('主/次文字两个主题下都远高于 AA(它们不是这次要动的那一档)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      expect(contrast(tk.text, tk.bg)).toBeGreaterThanOrEqual(7)
      expect(contrast(tk.textSecondary, tk.bg)).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  it('ink 与 onInk 反相(同色即字消失)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      expect(contrast(tk.ink, tk.onInk)).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })
})

// ── v5.0 新增:卡片面与强调色一系 ────────────────────────────────────────────
//
// 暖底把上面的"三级文字"逼到了极限(米白页底亮度只有 0.857,白面是 1.0),
// 于是连带影响两件事,都必须一起钉住:
//   ① 文字现在**也落在卡片面**上(`surface`),不再只落在页底 —— 两个面都要过;
//   ② 强调色一系是全新的,四枚令牌各有各的对面,少钉一条就会有某处读不出来。
describe('配色令牌:卡片面(暖底之上多出来的一层)', () => {
  for (const [name, tk] of [
    ['浅色', lightTheme],
    ['深色', darkTheme],
  ] as [string, ThemeTokens][]) {
    it(`${name}:三级文字在**卡片面**上也过 AA`, () => {
      // 页底过了不代表卡面过了:深色下卡片比页底**更亮**,反而卡面才是卡口
      expect(contrast(tk.textTertiary, tk.surface)).toBeGreaterThanOrEqual(AA_NORMAL)
    })

    it(`${name}:二级文字在卡片面上也过 AA`, () => {
      expect(contrast(tk.textSecondary, tk.surface)).toBeGreaterThanOrEqual(AA_NORMAL)
    })

    it(`${name}:★ 卡片面与页底可分辨 —— 卡片结构成立的前提`, () => {
      // 不是可读性阈值,是"看得见结构"的阈值。取 1.05:再低就只剩一条
      // 需要屏息才能看见的色差,卡片读起来就是"页面脏了一块"
      expect(contrast(tk.surface, tk.bg)).toBeGreaterThanOrEqual(1.05)
    })
  }
})

describe('配色令牌:强调色一系(四枚令牌各司其职,不许互相顶替)', () => {
  for (const [name, tk] of [
    ['浅色', lightTheme],
    ['深色', darkTheme],
  ] as [string, ThemeTokens][]) {
    it(`${name}:onAccent 压得住 accent 实心底(主按钮)`, () => {
      expect(contrast(tk.onAccent, tk.accent)).toBeGreaterThanOrEqual(AA_NORMAL)
    })

    it(`${name}:★ accentText 压得住 accentSoft 软底(徽章、当前项)`, () => {
      // 这一条是 accent 与 accentText 必须分家的**原因**:浅色下 accent(#B4553A)
      // 压在 accentSoft 上只有 4.18 —— 不达标。当文字用的那一枚要更深
      expect(contrast(tk.accentText, tk.accentSoft)).toBeGreaterThanOrEqual(AA_NORMAL)
    })

    it(`${name}:accent 当文字压在卡片面上也过 AA(灰标、当前项)`, () => {
      expect(contrast(tk.accentText, tk.surface)).toBeGreaterThanOrEqual(AA_NORMAL)
    })

    it(`${name}:焦点环用的 accent 与页底、卡面都分得开`, () => {
      // 焦点环必须与它所在的**两种面**都比得出来 —— 键盘用户走到哪里都要看得见
      expect(contrast(tk.accent, tk.bg)).toBeGreaterThanOrEqual(3)
      expect(contrast(tk.accent, tk.surface)).toBeGreaterThanOrEqual(3)
    })

    it(`${name}:danger 在页底与软底上都过 AA`, () => {
      expect(contrast(tk.danger, tk.bg)).toBeGreaterThanOrEqual(AA_NORMAL)
      expect(contrast(tk.danger, tk.dangerSoft)).toBeGreaterThanOrEqual(AA_NORMAL)
    })
  }
})
