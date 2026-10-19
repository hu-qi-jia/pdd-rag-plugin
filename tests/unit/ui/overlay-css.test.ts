// 聊天页覆盖层样式(v4.0 重写)。
//
// 面板是**唯一该用毛玻璃的地方** —— popup 是原生窗口、背后没内容,在那儿做 glass
// 是白做的;而面板压在 PDD 页面上,后面有东西可透。iOS 自己就是这么分的。
// 行内部则与 popup 同源:缩进的发丝线、淡底选中、方括号灰标、无彩。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BADGE_H,
  BADGE_PAD_X,
  BADGE_RADIUS,
  HAIR_IN,
  PANEL_PAD_X,
  POPUP_W,
  ROW_INSET_X,
  ROW_PAD_X,
  ROW_PAD_Y,
  buildOverlayCss,
  panelSurface,
  parseThemeMode,
} from '../../../src/ui/overlay-css'
import { controlH, panelType, radius } from '../../../src/ui/design'
import { darkTheme, lightTheme } from '../../../src/ui/theme'

const light = buildOverlayCss(lightTheme, 'light')
const dark = buildOverlayCss(darkTheme, 'dark')

/** 取某条**独立规则**的块(选择器必须落在行首,到第一个右花括号) */
const block = (css: string, selector: string): string => {
  const i = css.indexOf(`\n${selector}`)
  expect(i, `找不到独立规则:${selector}`).toBeGreaterThanOrEqual(0)
  return css.slice(i, css.indexOf('}', i))
}

describe('buildOverlayCss:面板是一张材料(唯一该用 glass 的地方)', () => {
  it('半透明底 + 背景模糊 + 描边 + 三段阴影', () => {
    const popup = block(light, '.pddcs-popup {')
    expect(popup).toContain(`background: ${panelSurface('light')}`)
    expect(popup).toContain('backdrop-filter: saturate(140%) blur(18px)')
    expect(popup).toContain(`border-radius: ${radius.panel}px`)
    expect(popup).toContain('box-shadow')
  })

  it('★ v5.0 收紧毛玻璃:不透明度提高、模糊与饱和度收敛', () => {
    // 2026 的设计口径对毛玻璃是负面评价,理由**不是审美而是对比度不可控** ——
    // 半透明底的最终对比度取决于背后那张页面,那是我们管不了的。
    // 这条断言钉住"没有悄悄退回 0.72/24px 那种重玻璃"
    for (const mode of ['light', 'dark'] as const) {
      const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(panelSurface(mode))?.[1] ?? 0)
      expect(alpha).toBeGreaterThanOrEqual(0.88)
    }
    expect(light).toContain('blur(18px)')
    expect(light).not.toContain('blur(24px)')
  })

  it('★ 面板有 1px 实边框 —— 半透明底也能读的兜底', () => {
    // 边框在"背后恰好是张浅色图"这种最坏情况下把面板边界钉住,
    // 面板因此**有确定的边界**,而不是"一块糊在那儿的半透明区域"
    expect(block(light, '.pddcs-popup {')).toContain('border: 1px solid')
  })

  it('★ 引擎不支持模糊 / 用户要求降透明时退回不透明面色', () => {
    expect(light).toContain('@supports not')
    expect(light).toContain('@media (prefers-reduced-transparency: reduce)')
    // 退回值必须是**不透明**的,否则"半透明 + 无模糊"比纯色更糟
    const fallback = light.slice(light.indexOf('@supports not'))
    expect(fallback).toContain(`background: ${lightTheme.bg};`)
  })

  it('★ 材料底色 CSS 与内联兜底同源(panelSurface 单点)', () => {
    expect(light).toContain(panelSurface('light'))
    expect(dark).toContain(panelSurface('dark'))
    // 兜底值必须与 CSS 一致,否则会把毛玻璃一脚踩成不透明板
    expect(panelSurface('light')).not.toBe(panelSurface('dark'))
  })

  it('★ 行的**悬浮**填充仍是 rgba —— 否则玻璃被踩成实心板', () => {
    const cand = block(light, '.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand:hover {')
    expect(cand).toContain('rgba(')
  })

  it('★ 行的**选中**填充走强调色软底(不透明是刻意的,不是漏改)', () => {
    // v4.0 里选中与悬浮共用同一组 rgba —— 那时"选中"只是比悬浮深一点的灰。
    // v5.0 的选中带了语义(选哪一条),软底在花哨页面上才压得住;
    // 面板已提到 0.90 不透明,一条实心行不会破坏材料语言。
    // 另配一道 3px 内阴影竖条做第二重保险。
    const cand = block(light, '.pddcs-cand-selected, .pddcs-cand-selected:hover {')
    expect(cand).toContain('background: #F7EBE5')
    expect(light).toContain('inset 3px 0 0')
  })

  it('宽度与定位口径不变(单点常量 POPUP_W)', () => {
    expect(POPUP_W).toBe(380)
    expect(block(light, '.pddcs-popup {')).toContain(`width: ${POPUP_W}px`)
  })

  it('主题切换只换取值,不换结构', () => {
    const sel = (css: string) => [...css.matchAll(/(^|\n)([.#][^\n{]+)\{/g)].map((m) => m[2].trim())
    expect(sel(light)).toEqual(sel(dark))
    expect(light).toContain(panelSurface('light'))
    expect(dark).toContain(panelSurface('dark'))
  })
})

describe('buildOverlayCss:行与 popup 同源', () => {
  it('★ 行的分隔线是**缩进**的伪元素,不是通栏 border-bottom', () => {
    const hair = block(light, '.pddcs-cand::after {')
    expect(hair).toContain('position: absolute')
    expect(hair).toContain(`left: ${HAIR_IN}px`)
  })

  it('列表最后一行不画线', () => {
    expect(light).toContain('.pddcs-popup-body > *:last-child::after')
  })

  it('头部与页脚是**通栏**线 —— 导航栏与列表行的两种线分开', () => {
    expect(block(light, '.pddcs-popup-head {')).toContain('border-bottom')
    expect(block(light, '.pddcs-popup-foot {')).toContain('border-top')
  })

  it('行不内缩(通铺),内容靠自身内边距', () => {
    const cand = block(light, '.pddcs-cand {')
    expect(cand).toContain(`padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px`)
    expect(cand).not.toContain('border-radius')
  })
})

describe('buildOverlayCss:★ 键盘面板的悬浮守卫仍在', () => {
  it('由悬浮驱动的候选行选择器一律带 not(.pddcs-popup-keyboard)', () => {
    const guard = '.pddcs-popup:not(.pddcs-popup-keyboard)'
    // 先把注释与换行抹平 —— 选择器是跨行写的,按行抓会把同一条规则的后半段漏掉。
    // 再切成"选择器 + 规则体",只看**由悬浮驱动、且作用在候选行上**的那些选择器段:
    // `.pddcs-cand-selected:hover` 不在此列(选中态在悬浮时保持不变,两种面板都该有),
    // 整条一起判会把它误伤成"未加守卫"
    const flat = light.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ')
    const parts = flat
      .split('}')
      // 切出每条规则的选择器部分(选择器里不含花括号,故取最后一个 { 之前)
      .map((chunk) => chunk.slice(0, chunk.lastIndexOf('{')).trim())
      .filter((sel) => sel.includes('.pddcs-cand:hover'))
      // **先拆逗号再过滤** —— 一条规则常并列多个选择器段,整条一起过滤会把
      // 带守卫的那段连同不带守卫的选中态段一起丢掉
      .flatMap((sel) => sel.split(','))
      .map((x) => x.trim())
      .filter((x) => x.includes('.pddcs-cand:hover') && !x.includes('.pddcs-cand-selected'))
    expect(parts.length).toBeGreaterThanOrEqual(2)
    for (const x of parts) {
      expect(x, `未加键盘守卫的候选行 hover 选择器:${x}`).toContain(guard)
    }
  })
})

describe('buildOverlayCss:来源标签(矩形 chip)', () => {
  it('★ 矩形标签:有底色、有圆角、有内边距,**不再画方括号**', () => {
    const tag = block(light, '.pddcs-tag {')
    expect(tag).toContain(`padding: 0 ${BADGE_PAD_X}px`)
    expect(tag).toContain(`height: ${BADGE_H}px`)
    expect(tag).toContain(`border-radius: ${BADGE_RADIUS}px`)
    // 底色由三条 data-kind 规则分别给(见下一条),这里不再要求基类带背景
    // 用户明确要"矩形标签,不是 [历史] 这种"
    expect(light).not.toContain('.pddcs-tag::before')
    expect(light).not.toContain('.pddcs-tag::after')
  })

  it('★ 三类来源各有"底色 + 文字色",且三者两两可分', () => {
    // 2026-10-19 用户实测要求:三个标签要在扫一眼时分得清,不再靠逐字读
    expect(block(light, ".pddcs-tag[data-kind='golden'] {")).toContain(
      `color: ${lightTheme.accentText}`,
    )
    expect(block(light, ".pddcs-tag[data-kind='golden'] {")).toContain(
      `background: ${lightTheme.accentSoft}`,
    )
    expect(block(light, ".pddcs-tag[data-kind='knowledge'] {")).toContain(
      `color: ${lightTheme.infoText}`,
    )
    expect(block(light, ".pddcs-tag[data-kind='knowledge'] {")).toContain(
      `background: ${lightTheme.infoSoft}`,
    )
    expect(block(light, ".pddcs-tag[data-kind='history'] {")).toContain(
      `color: ${lightTheme.textSecondary}`,
    )
    expect(block(light, ".pddcs-tag[data-kind='history'] {")).toContain(
      `background: ${lightTheme.selection}`,
    )
    // 三个背景色必须两两不同 —— 否则"不同颜色"只是字面上的
    expect(
      new Set([lightTheme.accentSoft, lightTheme.infoSoft, lightTheme.selection]).size,
    ).toBe(3)
  })

  it('★ 不再有 v3.0 的单一 data-tone 规则(形态与配色均按来源)', () => {
    expect(light).not.toContain(".pddcs-tag[data-tone='strong']")
    // 旧版三个色值也不该借尸还魂
    expect(light).not.toContain('#14ae5c') // 知识库绿
    expect(light).not.toContain('#0d99ff') // Figma 蓝
    expect(light).not.toContain('#8a6a16') // 琥珀
  })

  it('已设标准的星走强调色(v4.0 是主文本色 —— 那时除 danger 外全无彩)', () => {
    expect(block(light, '.pddcs-icon-btn-golden {')).toContain(
      `color: ${lightTheme.accent}`,
    )
  })
})

describe('buildOverlayCss:字号与控件档', () => {
  it('图标钮 28×28(取自 controlH.icon 单点),与 popup 同档', () => {
    const btn = block(light, '.pddcs-icon-btn {')
    expect(btn).toContain(`width: ${controlH.icon}px; height: ${controlH.icon}px`)
  })

  it('正文 = 面板唯一主层(15px),引子/计数/脚注同为 meta 档 12px', () => {
    expect(block(light, '.pddcs-cand-text {')).toContain(`font-size: ${panelType.content.size}px`)
    expect(block(light, '.pddcs-cand-q {')).toContain(`font-size: ${panelType.meta.size}px`)
    expect(panelType.meta.size).toBe(12)
  })

  it('数字一律等宽', () => {
    expect(block(light, '.pddcs-popup-count {')).toContain('ui-monospace')
  })
})

describe('buildOverlayCss:AI 整合行', () => {
  it('★ 靠底色区分,不靠描边(v4.0 把框去掉了)', () => {
    const ai = block(light, '.pddcs-cand.pddcs-ai-row {')
    expect(ai).toContain('background:')
    expect(ai).not.toContain('border:')
  })

  it('失败态转语义红(不靠文案里的"失败"二字表意)', () => {
    expect(block(light, '.pddcs-cand.pddcs-ai-row.is-error {')).toContain(lightTheme.dangerSoft)
    expect(block(light, '.pddcs-cand.pddcs-ai-row.is-error .pddcs-ai-label {')).toContain(
      lightTheme.danger,
    )
  })

  it('说明行与生成结果同档同排版,区分只靠颜色', () => {
    expect(block(light, '.pddcs-ai-hint {')).toContain(`font-size: ${panelType.content.size}px`)
    expect(block(light, '.pddcs-ai-draft {')).toContain(`font-size: ${panelType.content.size}px`)
  })
})

describe('buildOverlayCss:其他', () => {
  it('AI回复按钮是填充式控件(圆角 + 描边),悬浮转强调色', () => {
    const btn = block(light, '.pddcs-ai-btn {')
    expect(btn).toContain(`border-radius: ${radius.control}px`)
    const hover = block(light, '.pddcs-ai-btn:hover {')
    expect(hover).toContain(lightTheme.accent)
    // 字色必须跟着换到 onAccent:留在 text 上会变成深字压深底
    expect(hover).toContain(lightTheme.onAccent)
  })

  it('★ 滚动容器**不留槽位** —— 留槽会在带底色的面板右侧空出一条竖带', () => {
    // 2026-10-19 用户实测:选中行的软底到不了右缘,看起来像卡片缺了一块。
    // 代价是滚动条出现/消失时内容宽度会变 6px;面板只在行数超出时才滚,
    // 常驻空带比这点抖动更糟。
    expect(light).not.toMatch(/\.pddcs-popup-body \{[^}]*scrollbar-gutter/)
  })

  it('键帽:控件档圆角 + 等宽(与设置页那枚键帽同源)', () => {
    const kbd = block(light, '.pddcs-kbd {')
    // 曾经写死 5px(设置页写的是 6px)—— 同一件东西两个值,正是各自绕开了令牌
    expect(kbd).toContain(`border-radius: ${radius.control}px`)
    expect(kbd).toContain('ui-monospace')
  })

  it('面板内边距与行左缘同线:标题左缘 = 行内容左缘', () => {
    expect(PANEL_PAD_X).toBe(ROW_INSET_X + ROW_PAD_X)
  })
})

/**
 * 内联兜底的**取值来源**。
 *
 * 这一条为什么只能对着源码断:兜底写在内容脚本 `openPopup` 里(纯 DOM,不引 React,
 * 单测环境也进不去那条路径),而它恰恰是"材料单源"最容易被破坏的一环 ——
 * 内联 `background-color` 优先级高于类规则,CSS 那边写的是半透明材料,兜底这边
 * 只要写成不透明的 `tk.bg`,毛玻璃就会被**原地踩成一块实心白板**
 * (backdrop-filter 还在,后面却没东西可透)。这个坑犯过两次(v2.7 与 v4.0),
 * 每次都是"CSS 单测全绿、实机面板是白板"。
 */
describe('内容脚本的内联兜底必须与 CSS 同源', () => {
  // 相对 cwd 读(等于仓库根):这台机器的仓库路径带中文,fileURLToPath 在 Windows 上
  // 会先 percent-编码一道,反而不如直接给相对路径
  const src = readFileSync('src/contents/pdd-ai-button.ts', 'utf8')

  it('★ 面板内联背景取 panelSurface(而不是某个不透明令牌)', () => {
    expect(src).toContain('el.style.backgroundColor = panelSurface(currentTheme)')
  })

  it('★ 不得再出现"用不透明令牌当面板底"的写法', () => {
    expect(src).not.toContain('el.style.backgroundColor = getThemeTokens(currentTheme).bg')
    // 开面板与切主题两条路径都落到同一个函数上
    expect(src).toContain('popupEl.style.backgroundColor = panelSurface(theme)')
  })
})

describe('parseThemeMode:存储值容错', () => {
  it('只有字符串 dark 认作深色,其余一律浅色', () => {
    expect(parseThemeMode('dark')).toBe('dark')
    for (const v of ['light', undefined, null, 1, {}, 'DARK']) {
      expect(parseThemeMode(v)).toBe('light')
    }
  })
})
