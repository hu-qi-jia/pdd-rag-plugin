/**
 * 聊天页推荐面板样式单测。
 *
 * **v3.0 改版说明(重要)**:本文件此前记录的是 v2.7.0「Apple 式毛玻璃材料」那一版的契约
 * (半透明底 + backdrop-filter、无描边、轮廓靠 0.5px 亮环、同心圆角行、全圆端小控件)。
 * 那次改版被 v3.0「复古极简 + 极客工具风」整体推翻,与之冲突的断言**随之重写**,
 * 而不是删掉了事 —— 旧断言守的那些不变量里,有一部分跨版本仍然成立,这一版逐条保留:
 *
 *   仍然成立(原样保留):三段式外壳、滚动只在 body、键盘面板悬浮守卫、
 *     面板字型三档/两档、AI 整合行的六条结构口径、prefers-reduced-motion、
 *     parseThemeMode 容错、toast 不随主题、若干"死规则不得复活"的反向断言。
 *
 *   已被推翻(改为断言新口径):材料 → 不透明面色;**描边从无到有**(且是结构线那一档);
 *     圆角 20/24 → **全线 0**;全圆端小控件 → 直角;行内缩留白 → **满幅 + 发丝线**;
 *     徽标软底 chip → **方括号标签**;标题条无色 → **反白**;选中软灰底 → **整行反白**;
 *     文字缩进 9px → **一个等宽字符格 `1ch`**。
 */
import { describe, it, expect } from 'vitest'
import {
  buildOverlayCss,
  PANEL_PAD_X,
  parseThemeMode,
  POPUP_W,
  ROW_GAP_Y,
  ROW_INSET_X,
  ROW_PAD_X,
  ROW_PAD_Y,
  ROW_RADIUS,
  THEME_STORAGE_KEY,
} from '../../../src/ui/overlay-css'
import { lightTheme, darkTheme } from '../../../src/ui/theme'
import {
  controlH,
  fontSize,
  fontWeight,
  panelType,
  radius,
  spacing,
  stroke,
} from '../../../src/ui/design'

/**
 * 从样式表里抠出一条规则(uuid 选择器用正则给)。
 *
 * **锚定行首是必须的**:v3.0 的选中态改口规则写成了
 * `.pddcs-cand-selected .pddcs-cand-text { color: inherit; }` —— 它**包含**子串
 * `.pddcs-cand-text {`,不加锚的话 `.match(/\.pddcs-cand-text \{[^}]*\}/)` 会先命中的是
 * 这条只有一行 `color` 的覆盖规则,于是"正文字号是不是 13.5"这类断言拿到的是错的规则体,
 * 报出来的失败信息还特别有迷惑性(说正文没有 font-size)。
 */
const ruleOf = (css: string, sel: RegExp): string => {
  const anchored = new RegExp(`(?:^|\\n)${sel.source}`, sel.flags)
  const m = css.match(anchored)
  expect(m, `未匹配到规则 ${sel}`).toBeTruthy()
  return m![0]
}
/** 剥掉 CSS 注释:注释里会**提到**某些类名(说明它为什么被删),那不是活规则 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('buildOverlayCss:按主题令牌生成覆盖层样式', () => {
  // 这两条以前是拿"颜色字符串互斥"来断主题隔离的(`浅色产物不含深色文本色`)。
  // v3.0 两主题成了**正负片**,同一个十六进制值在两个主题里各有所指
  // (浅色的主文本色 #0a0a0a 恰好就是深色的面板底),互斥断言于是变成一条恒假的噪声。
  // 现在改成**正面断言**各自的令牌都落到位,主题隔离由"两个产物不同"来兜底
  it('浅色令牌 → 浅色面板底 + 主/次级文本色', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain(`background: ${lightTheme.bg}`)
    // 覆盖层里出现的是面板与气泡按钮用到的令牌(text / textMuted / textTertiary)
    expect(css).toContain(`color: ${lightTheme.text}`)
    expect(css).toContain(`color: ${lightTheme.textMuted}`)
    expect(css).toContain(`color: ${lightTheme.textTertiary}`)
    // 标题条是**反白**的:浅色下底取纯黑
    expect(css).toContain(`background: ${lightTheme.text}`)
  })
  it('深色令牌 → 深色面板底/中性灰控件,与浅色产物不同', () => {
    const css = buildOverlayCss(darkTheme)
    expect(css).toContain(`background: ${darkTheme.bg}`)
    expect(css).toContain(darkTheme.btnBg)
    expect(css).not.toContain(`background: ${lightTheme.bg}`)
    expect(css).not.toBe(buildOverlayCss(lightTheme))
  })
  it('轻提示 toast 两主题下都是深底白字(可读性不随主题切换)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      expect(buildOverlayCss(tk)).toContain('rgba(22,22,22,.94)')
    }
  })
})

describe('v3.0 面板 = 一块带框的直角纸/屏(推翻 v2.7.0 的毛玻璃材料)', () => {
  const css = buildOverlayCss(lightTheme)
  const popup = ruleOf(css, /\.pddcs-popup \{[^}]*\}/)

  it('面板挂**结构线**描边(borderStrong):与页面之间那条硬边由实线给出,不靠投影', () => {
    expect(popup).toContain(`border: ${stroke.strong}px solid ${lightTheme.borderStrong}`)
    // 结构线必须是本主题里最重的一档线,否则"这是一块面板"立不住
    expect(lightTheme.borderStrong).not.toBe(lightTheme.border)
    expect(darkTheme.borderStrong).not.toBe(darkTheme.border)
  })

  it('没有阴影、没有背景模糊:整屏不许出现这两样(v3.0 的核心禁令)', () => {
    // 反向断言,防的是"下次改版手一滑又加回一层柔光"
    expect(stripComments(css)).not.toContain('box-shadow')
    expect(stripComments(css)).not.toContain('backdrop-filter')
    expect(stripComments(css)).not.toContain('-webkit-backdrop-filter')
  })

  it('圆角令牌全线归零,且 `radius.pill` 已退役(全圆端属于精致控件语言)', () => {
    for (const [name, v] of Object.entries(radius)) {
      expect(v, `${name} 应为直角`).toBe(0)
    }
    expect(Object.keys(radius)).not.toContain('pill')
    expect(popup).toContain(`border-radius: ${radius.xl}px`)
    // 与行圆角的同心关系仍是减法(两个减数现在都是 0,公式没被绕过)
    expect(ROW_RADIUS).toBe(radius.xl - ROW_INSET_X)
  })

  it('入场动效只有 opacity,**不得含 transform**(这条防的是一个已修掉的真 bug)', () => {
    // 面板按 getBoundingClientRect().height 夹在视口内,而 rect 返回的是**变换后**的矩形:
    // v2.7.0 的动效带 translateY + scale(0.98),量到的高度比终值矮一圈(385.78 → 378),
    // 定位按矮的那版算,动画结束回到原尺寸时底边就压出视口(实测 bottom 798.78 > 792)。
    // 改成纯 opacity 后布局盒不受影响,那段"量高期间关掉 animation"的绕法也随之删除。
    // 所以这里禁的不是审美,是**几何正确性的前提**
    const keyframes = ruleOf(css, /@keyframes pddcs-pop-in \{[^}]*\}[^}]*\}/)
    expect(keyframes).toContain('opacity: 0')
    expect(keyframes).not.toContain('transform')
    expect(popup).toContain(`animation: pddcs-pop-in .1s linear`)
    expect(css).toContain(
      '@media (prefers-reduced-motion: reduce) { .pddcs-popup { animation: none; } }',
    )
  })

  it('三段式壳:popup 为 flex 列,滚动只在 body,页脚常驻', () => {
    expect(popup).toContain('display: flex')
    expect(popup).not.toContain('overflow: auto')
    const body = ruleOf(css, /\.pddcs-popup-body \{ flex: 1[^}]*\}/)
    expect(body).toContain('flex: 1')
    expect(body).toContain('overflow-y: auto')
    expect(ruleOf(css, /\.pddcs-popup-foot \{[^}]*\}/)).toContain('flex: 0 0 auto')
  })

  it('面板加宽至 380(等宽字比比例字宽,CSS 与 JS 定位共用常量)', () => {
    expect(POPUP_W).toBe(380)
  })
})

describe('v3.0 标题条 = 反白条(面板唯一的重色块)', () => {
  const css = buildOverlayCss(lightTheme)
  const head = ruleOf(css, /\.pddcs-popup-head \{[^}]*\}/)

  it('底取主文本色、字取面板底色 —— 黑白互换,两个主题下自动成立', () => {
    expect(head).toContain(`background: ${lightTheme.text}`)
    expect(head).toContain(`color: ${lightTheme.bg}`)
    const darkHead = ruleOf(buildOverlayCss(darkTheme), /\.pddcs-popup-head \{[^}]*\}/)
    expect(darkHead).toContain(`background: ${darkTheme.text}`)
    expect(darkHead).toContain(`color: ${darkTheme.bg}`)
  })

  it('子元素一律 color: inherit —— 反白是**整条**的属性,亮度差用 opacity 表达', () => {
    // 每个孩子各自挑颜色,就会出现"深色主题下某个孩子还是浅色主题的配色"这类漏网
    for (const sel of [/\.pddcs-popup-title \{[^}]*\}/, /\.pddcs-popup-count \{[^}]*\}/, /\.pddcs-popup-close \{[^}]*\}/]) {
      expect(ruleOf(css, sel)).toContain('color: inherit')
    }
    expect(ruleOf(css, /\.pddcs-popup-count \{[^}]*\}/)).toContain('opacity:')
  })

  it('面板名与计数分属两档字号(15 半粗 vs 11.5 辅助),容器自身不设字号', () => {
    // 头容器只做布局与配色,字号下沉到两个文字档,否则 title/count 的字号会被容器盖住
    expect(head).not.toContain('font-size')
    const title = ruleOf(css, /\.pddcs-popup-title \{[^}]*\}/)
    expect(title).toContain(`font-size: ${panelType.title.size}px`)
    expect(title).toContain(`font-weight: ${panelType.title.weight}`)
    const count = ruleOf(css, /\.pddcs-popup-count \{[^}]*\}/)
    expect(count).toContain(`font-size: ${panelType.meta.size}px`)
    expect(count).toContain(`font-weight: ${panelType.meta.weight}`)
    expect(panelType.title.size).toBeGreaterThan(panelType.meta.size)
  })

  it('等宽字禁止负字距(那是比例字收紧字偶距的手法)', () => {
    expect(stripComments(buildOverlayCss(lightTheme))).not.toContain('letter-spacing: -')
  })

  it('关闭钮:反白条上的裸 ×,命中区不缩水(视觉 26px 可点范围不变)', () => {
    const close = ruleOf(css, /\.pddcs-popup-close \{[^}]*\}/)
    expect(close).toContain('background: transparent')
    expect(close).toContain(`width: ${controlH.form}px`)
    expect(close).toContain(`height: ${controlH.form}px`)
    // 悬浮回执:一层中性灰(半透明白/黑都看得见),不引入第三种颜色
    expect(ruleOf(css, /\.pddcs-popup-close:hover \{[^}]*\}/)).toContain('rgba(128,128,128,.35)')
  })
})

describe('v3.0 选中 = 真反白(终端菜单的记法)', () => {
  const css = buildOverlayCss(lightTheme)

  it('整行反相:底取主文本色、字取面板底色', () => {
    const sel = ruleOf(css, /\.pddcs-cand-selected, \.pddcs-cand-selected:hover \{[^}]*\}/)
    expect(sel).toContain(`background: ${lightTheme.text}`)
    expect(sel).toContain(`color: ${lightTheme.bg}`)
  })

  it('行内**每个自带颜色的孩子**都显式改口(徽标/折叠数/引子/正文/图标钮)', () => {
    // 少写一条,那一处就会是"灰底上的旧色"叠在反白条上 —— 整行反白立刻破功
    for (const child of [
      'cand-text',
      'cand-q',
      'fold',
      'icon-btn',
      'badge',
    ]) {
      expect(css, `${child} 缺反白改口`).toContain(`.pddcs-cand-selected .pddcs-${child}`)
    }
    // 三态徽标(含 golden / knowledge)在反白行上一律继承,不保留语义色 ——
    // 反相行里没有"金色"这回事,整行只有一种前景色
    expect(css).toContain('.pddcs-cand-selected .pddcs-badge.golden')
    expect(css).toContain('.pddcs-cand-selected .pddcs-badge.knowledge')
    expect(css).toContain('.pddcs-cand-selected .pddcs-icon-btn-golden')
  })

  it('悬浮必须排除已选中行,否则浅灰会盖掉反白(选择器特异度不够)', () => {
    const hover = ruleOf(
      css,
      /\.pddcs-popup:not\(\.pddcs-popup-keyboard\) \.pddcs-cand:not\(\.pddcs-cand-selected\):hover \{[^}]*\}/,
    )
    expect(hover).toContain(lightTheme.selectedBg)
  })
})

describe('v3.0 行 = 满幅 + 发丝线(不是内缩圆角软块)', () => {
  const css = buildOverlayCss(lightTheme)
  const cand = ruleOf(css, /\.pddcs-cand \{[^}]*\}/)

  it('行满幅:内缩归零,中段左右不留内边距(分隔线才能横贯整块面板)', () => {
    expect(ROW_INSET_X).toBe(0)
    expect(ruleOf(css, /\.pddcs-popup-body \{ flex: 1[^}]*\}/)).toContain(
      `padding: 0 ${ROW_INSET_X}px`,
    )
    expect(cand).toContain(`padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px`)
  })

  it('行与行靠**发丝线**分隔,不再靠边距留白,也没有左描边(那属旧表格语言)', () => {
    expect(cand).toContain(`border-bottom: ${stroke.hairline}px solid ${lightTheme.borderLight}`)
    expect(cand).not.toContain('margin:')
    expect(cand).not.toContain('inset 3px')
    // 最后一行不再补线 —— 它下面就是页脚那条常驻 hairline,否则两道线贴一起
    expect(css).toContain('.pddcs-cand:last-child { border-bottom: none; }')
  })

  it('行线比控件描边浅一档(一屏几十条,不能和输入框描边一样重)', () => {
    expect(lightTheme.borderLight).not.toBe(lightTheme.border)
    expect(cand).not.toContain(lightTheme.border + ';')
  })

  it('行内两处纵向节奏与行距同取 RowGapY(列表的疏与内文的疏是一套)', () => {
    expect(ruleOf(css, /\.pddcs-cand-top \{[^}]*\}/)).toContain(`margin-bottom: ${ROW_GAP_Y}px`)
    expect(ruleOf(css, /\.pddcs-cand-q \{[^}]*\}/)).toContain(`margin-bottom: ${ROW_GAP_Y}px`)
    expect(ROW_GAP_Y).toBeGreaterThan(0)
    expect(ROW_PAD_Y).toBeGreaterThan(ROW_GAP_Y)
  })

  it('操作钮悬浮/选中才显:静止 opacity 0 + pointer-events none', () => {
    const act = ruleOf(css, /\.pddcs-cand-actions \{[^}]*\}/)
    expect(act).toContain('opacity: 0')
    expect(act).toContain('pointer-events: none')
    expect(css).toMatch(/\.pddcs-popup:not\(\.pddcs-popup-keyboard\) \.pddcs-cand:hover \.pddcs-cand-actions[^{]*\{[^}]*opacity: 1/)
    expect(css).toMatch(/\.pddcs-cand-selected \.pddcs-cand-actions[^{]*\{[^}]*opacity: 1/)
    // 按钮组右推 6px 顶向面板右缘
    expect(act).toContain('margin-left: auto')
    expect(act).toContain('margin-right: -6px')
  })

  it('图标钮 24px 方钮 + 直角,颜色由 currentColor 继承', () => {
    const btn = ruleOf(css, /\.pddcs-icon-btn \{[^}]*\}/)
    expect(btn).toContain(`width: ${controlH.inline}px`)
    expect(btn).toContain(`height: ${controlH.inline}px`)
    expect(btn).toContain(`border-radius: ${radius.sm}px`)
    expect(btn).toContain('color:')
    expect(css).toContain('.pddcs-icon-btn-star:hover')
    expect(css).toContain('.pddcs-icon-btn-golden')
    expect(css).toContain('.pddcs-icon-btn-busy svg')
    expect(css).toContain('@keyframes pddcs-spin')
  })

  it('图标钮与星标走主题令牌(不硬编码色值)', () => {
    const dark = buildOverlayCss(darkTheme)
    expect(ruleOf(dark, /\.pddcs-icon-btn \{[^}]*\}/)).toContain(`color: ${darkTheme.textTertiary}`)
    expect(css).toContain(`.pddcs-icon-btn-golden { color: ${lightTheme.goldenText}; }`)
    expect(dark).toContain(`.pddcs-icon-btn-golden { color: ${darkTheme.goldenText}; }`)
  })

  it('同内容×n 常驻在徽标右侧:不 absolute、不悬浮才显,也不随折叠改行高', () => {
    const fold = ruleOf(css, /\.pddcs-fold \{[^}]*\}/)
    expect(fold).not.toContain('position: absolute')
    expect(fold).not.toContain('opacity: 0')
    expect(fold).toContain('white-space: nowrap')
    expect(fold).toContain(`color: ${lightTheme.textTertiary}`)
    expect(css).not.toContain('.pddcs-cand:hover .pddcs-fold')
    expect(css).not.toContain('.pddcs-cand-folded')
  })

  it('死规则不得复活:score / mini 钮 / ✦ 图标', () => {
    const noComments = stripComments(css)
    expect(noComments).not.toContain('.pddcs-score')
    expect(noComments).not.toContain('.pddcs-mini')
    expect(noComments).not.toContain('.pddcs-ai-icon')
    expect(noComments).not.toContain('✦')
  })
})

describe('v3.0 徽标 = 方括号标签(替掉彩色软底 chip)', () => {
  const css = buildOverlayCss(lightTheme)
  const badge = ruleOf(css, /\.pddcs-badge \{[^}]*\}/)

  it('方括号由伪元素给出:JS 侧只写类别名,形态完全由样式决定', () => {
    expect(css).toContain("content: '['")
    expect(css).toContain("content: ']'")
  })

  it('左括号**挂出去**(absolute + right:100%),不占正文横向空间', () => {
    // 这是"三处文字左缘同一条线"的成立方式:徽标盒左缘 = 徽标文字左缘,
    // 于是正文只要不缩进就和它对齐。挂出去的括号落在行内边距(12px)里,充作标签栏线
    expect(ruleOf(css, /\.pddcs-badge \{[^}]*\}/)).toContain('position: relative')
    const before = ruleOf(css, /\.pddcs-badge::before \{[^}]*\}/)
    expect(before).toContain('position: absolute')
    expect(before).toContain('right: 100%')
  })

  it('无填充、无内边距、直角 —— 旧版那块软底是整屏最响的三个色块', () => {
    expect(badge).toContain('background: transparent')
    expect(badge).not.toContain('padding:')
    expect(badge).toContain(`border-radius: ${radius.sm}px`)
    expect(badge).toContain(`font-size: ${panelType.meta.size}px`)
    expect(badge).toContain(`font-weight: ${fontWeight.semibold}`)
  })

  it('语义色仍在(功能信号,不是装饰):标准回答暗琥珀 / 知识库暗墨绿', () => {
    expect(css).toContain(`.pddcs-badge.golden { color: ${lightTheme.goldenText}; }`)
    expect(css).toContain(`.pddcs-badge.knowledge { color: ${lightTheme.knowledgeText}; }`)
    const dark = buildOverlayCss(darkTheme)
    expect(dark).toContain(`.pddcs-badge.golden { color: ${darkTheme.goldenText}; }`)
    expect(dark).toContain(`.pddcs-badge.knowledge { color: ${darkTheme.knowledgeText}; }`)
    // 两枚语义色都必须是"印刷油墨"级的暗色,不能是高饱和的荧光色 ——
    // 高饱和色在白纸上是一个墨点,会把整屏黑白灰的节奏打断
    const sat = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      return (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b)
    }
    expect(sat(lightTheme.goldenText)).toBeLessThan(0.9)
    expect(parseInt(lightTheme.goldenText.slice(1, 3), 16)).toBeLessThan(0xa0)
    expect(parseInt(lightTheme.knowledgeText.slice(1, 3), 16)).toBeLessThan(0x60)
  })
})

describe('v3.0 文字左缘对齐:左括号挂出去,内容一律不缩进', () => {
  const css = buildOverlayCss(lightTheme)

  it('正文/引子/整合行文字都不缩进 —— 对齐由构造保证,不靠"算一个缩进量"', () => {
    // 这里曾经写过 `padding-left: 1ch`,理由是"等宽字下 1ch 就是字符进宽"。
    // 那是错的:`ch` 按元素**自身**的 font-size 解析 —— 引子 11.5px 算出 6.9px、
    // 正文 13.5px 算出 8.1px,同一份 CSS 得到两个缩进量,实测差 1.16px,永远对不齐。
    // 现在左括号挂出去、内容不缩进,没有任何需要"算"的东西,与字体进宽彻底无关
    for (const sel of [
      /\.pddcs-cand-q \{[^}]*\}/,
      /\.pddcs-cand-text \{[^}]*\}/,
      /\.pddcs-ai-main \{[^}]*\}/,
      /\.pddcs-ai-hint \{[^}]*\}/,
      /\.pddcs-ai-draft \{[^}]*\}/,
    ]) {
      expect(ruleOf(css, sel), `${sel} 不应再缩进`).not.toContain('padding-left')
    }
    // 整个样式表里不该再有 `ch` 单位(它一旦回来,就意味着又有人想"按字符格算缩进")
    expect(css).not.toContain('1ch')
  })

  it('行首行自身不加缩进(左括号即整行左缘)', () => {
    expect(ruleOf(css, /\.pddcs-cand-top \{[^}]*\}/)).not.toContain('padding-left')
  })

  it('面板名与页脚站在列表内容那条竖线上(面板内缩 + 行内边距)', () => {
    expect(PANEL_PAD_X).toBe(ROW_INSET_X + ROW_PAD_X)
    expect(ruleOf(css, /\.pddcs-popup-head \{[^}]*\}/)).toContain(
      `padding: ${spacing.md}px ${PANEL_PAD_X}px`,
    )
    expect(ruleOf(css, /\.pddcs-popup-foot \{[^}]*\}/)).toContain(
      `padding: ${spacing.sm}px ${PANEL_PAD_X}px`,
    )
  })

  it('页脚是**左对齐**的状态条 + 一条 hairline(不再是居中飘着的一行小字)', () => {
    const foot = ruleOf(css, /\.pddcs-popup-foot \{[^}]*\}/)
    expect(foot).toContain('text-align: left')
    expect(foot).toContain(`border-top: ${stroke.hairline}px solid ${lightTheme.borderLight}`)
    expect(foot).toContain(`color: ${lightTheme.textTertiary}`)
  })

  it('键帽与全站等宽字体栈同源,不再自写一份 monospace 栈', () => {
    const kbd = ruleOf(css, /\.pddcs-kbd \{[^}]*\}/)
    expect(kbd).toContain('font-family: inherit')
    expect(kbd).toContain(`border: ${stroke.hairline}px solid ${lightTheme.border}`)
  })
})

describe('buildOverlayCss:字号主次(面板只有三档)', () => {
  const css = buildOverlayCss(lightTheme)

  it('回答正文为主层:13.5px(title 档)+ 1.6 行高', () => {
    const text = ruleOf(css, /\.pddcs-cand-text \{[^}]*\}/)
    expect(text).toContain('font-size: 13.5px')
    expect(text).toContain('line-height: 1.6')
  })

  it('问题回显上置为引子:11.5px 灰字单行省略', () => {
    const q = ruleOf(css, /\.pddcs-cand-q \{[^}]*\}/)
    expect(q).toContain('font-size: 11.5px')
    expect(q).toContain('text-overflow: ellipsis')
    expect(css).not.toContain('.pddcs-cand-src')
  })

  it('面板内每一条规则的字号都落在三档、字重都落在两档之内', () => {
    const sizes = new Set<number>([
      panelType.title.size,
      panelType.content.size,
      panelType.meta.size,
      fontSize.heading, // 关闭钮的 × 走 heading 档(纯符号,不参与文字层级)
    ])
    const weights = new Set<number>([
      panelType.title.weight,
      panelType.content.weight,
      panelType.meta.weight,
    ])
    // `.pddcs-ai-btn` 是**页面上那枚按钮**、`.pddcs-toast` 是独立轻提示,都不属于面板,
    // 各自沿用 popup 的按钮语言与 HUD 口径 —— 本规范只管面板,故从扫描范围里排掉
    const panelRules = (css.match(/\.pddcs-(popup|cand|ai|badge|fold|kbd)[^{]*\{[^}]*\}/g) ?? [])
      .filter((r) => !r.startsWith('.pddcs-ai-btn'))
    expect(panelRules.length).toBeGreaterThan(10)
    for (const r of panelRules) {
      const size = r.match(/font-size: ([\d.]+)px/)
      if (size) expect(sizes.has(Number(size[1])), `${r} 字号越档`).toBe(true)
      const weight = r.match(/font-weight: (\d+)/)
      if (weight) expect(weights.has(Number(weight[1])), `${r} 字重越档`).toBe(true)
    }
  })
})

describe('buildOverlayCss:AI 整合行(六条结构口径,跨版本不变)', () => {
  // 用户原话:「高度太小了,修改为和词条高度类似,视觉效果要和词条区分开」。
  // 这组用例把"类似"和"区分"各自拆成可断言的不变量:
  //   类似 = 与候选行同一套盒子 + 同一套两层结构(主行 + 第二块);
  //   区分 = 候选行静止无底,整合行是常驻知识库色软底 + 一条左色条(动作,不是素材)。
  const css = buildOverlayCss(lightTheme)
  const aiRow = ruleOf(css, /\.pddcs-cand\.pddcs-ai-row \{[^}]*\}/)

  it('五块组件齐备(主行 / 说明行 / 正文 / 重试钮),纵向排布由 JS 决定显隐', () => {
    expect(css).toContain('.pddcs-cand.pddcs-ai-row {')
    expect(css).toContain('.pddcs-ai-main {')
    expect(css).toContain('.pddcs-ai-hint {')
    expect(css).toContain('.pddcs-ai-draft {')
    expect(css).toContain('.pddcs-ai-retry {')
    expect(aiRow).toContain('flex-direction: column')
    expect(aiRow).toContain(`gap: ${ROW_GAP_Y}px`)
  })

  it('高度同族:盒子的外边距与圆角全从 .pddcs-cand 继承,自己不再写一遍', () => {
    expect(aiRow).not.toContain('margin:')
    expect(aiRow).not.toContain('border-radius:')
    expect(aiRow).not.toContain(`padding: ${ROW_PAD_Y}px`)
  })

  it('内容左缘与候选行重合:左色条那 3px 必须从内边距里扣掉(否则文字右移 3px)', () => {
    // 这是"描边行内容左缘补偿"那条老规矩在 v3.0 的落点:加一条边就要按边宽校准一次,
    // 量的始终是 rect.left + paddingLeft + borderWidth,不是 CSS 里写的数字
    expect(aiRow).toContain(`padding-left: ${ROW_PAD_X - 3}px`)
    expect(aiRow).toContain('border-left: 3px solid')
    expect(ROW_PAD_X - 3 + 3).toBe(ROW_PAD_X)
  })

  it('两层结构撑起高度:主行顶 24px 行内控件档(不靠 padding 虚撑)', () => {
    expect(ruleOf(css, /\.pddcs-ai-main \{[^}]*\}/)).toContain(`min-height: ${controlH.inline}px`)
  })

  it('视觉区分靠"有没有底 + 有没有色条",候选行静止时完全无底', () => {
    expect(aiRow).toContain(`background: ${lightTheme.knowledgeSurface}`)
    expect(aiRow).toContain(`border-left: 3px solid ${lightTheme.knowledgeText}`)
    const cand = ruleOf(css, /\.pddcs-cand \{[^}]*\}/)
    expect(cand).not.toContain('background:') // 只禁"设了底色",不禁 transition 里的 background-color
    expect(cand).not.toContain('border-left')
    // 整合行不挂类别徽标:它是一次动作,不是一个类别
    expect(css).not.toContain('.pddcs-ai-row .pddcs-badge')
  })

  it('动作面按主题走令牌(不硬编码色值),悬浮态是同色加深', () => {
    const dark = buildOverlayCss(darkTheme)
    expect(ruleOf(dark, /\.pddcs-cand\.pddcs-ai-row \{[^}]*\}/)).toContain(
      `background: ${darkTheme.knowledgeSurface}`,
    )
    expect(aiRow).not.toContain(lightTheme.selectedBg)
    const hover = ruleOf(
      css,
      /\.pddcs-popup:not\(\.pddcs-popup-keyboard\) \.pddcs-cand\.pddcs-ai-row:not\(\.pddcs-cand-selected\):hover \{[^}]*\}/,
    )
    expect(hover).toContain(lightTheme.knowledgeSurfaceHover)
    expect(hover).not.toContain(`background: ${lightTheme.selectedBg}`)
  })

  it('悬浮/选中态显式补写(双类选择器会盖过单类的 .pddcs-cand 规则)', () => {
    expect(css).toContain('.pddcs-cand.pddcs-ai-row:not(.pddcs-cand-selected):hover')
    expect(css).toContain('.pddcs-cand.pddcs-ai-row.is-error:not(.pddcs-cand-selected):hover')
  })

  it('只有 idle 态整行可点(idle 才给手型),其余态的整行不再是触发器', () => {
    expect(aiRow).toContain('cursor: default')
    expect(ruleOf(css, /\.pddcs-cand\.pddcs-ai-row\.is-idle \{[^}]*\}/)).toContain('cursor: pointer')
  })

  it('主文案走知识库语义色,取动作档(与候选正文同字号,靠字重与颜色区分)', () => {
    const label = ruleOf(css, /\.pddcs-ai-label \{[^}]*\}/)
    expect(label).toContain(`color: ${lightTheme.knowledgeText}`)
    expect(label).toContain(`font-size: ${panelType.action.size}px`)
    expect(label).toContain(`font-weight: ${panelType.action.weight}`)
    expect(panelType.action.size).toBe(panelType.content.size)
    expect(ruleOf(css, /\.pddcs-cand-text \{[^}]*\}/)).toContain(
      `font-size: ${panelType.action.size}px`,
    )
  })

  it('失败态:文案转红 + 整行转红软底 + 左色条转红(三处同时说,不靠文案里的"失败"二字)', () => {
    expect(ruleOf(css, /\.pddcs-ai-row\.is-error \.pddcs-ai-label \{[^}]*\}/)).toContain(
      `color: ${lightTheme.errorText}`,
    )
    const surface = ruleOf(css, /\.pddcs-cand\.pddcs-ai-row\.is-error \{[^}]*\}/)
    expect(surface).toContain(`background: ${lightTheme.errorBg}`)
    expect(surface).toContain(`border-left-color: ${lightTheme.errorText}`)
    expect(surface).not.toContain(lightTheme.knowledgeSurface)
    // 红底比绿底更实:失败是更少见的、更需要被注意的状态
    const alpha = (s: string) => Number(s.match(/([\d.]+)\)$/)![1])
    expect(alpha(lightTheme.errorBg)).toBeGreaterThan(alpha(lightTheme.knowledgeSurface))
  })

  it('生成结果按候选正文口径排版(同字号同截断行数),流式时行高不跳', () => {
    const draft = ruleOf(css, /\.pddcs-ai-draft \{[^}]*\}/)
    const text = ruleOf(css, /\.pddcs-cand-text \{[^}]*\}/)
    for (const decl of [`font-size: ${fontSize.title}px`, 'line-height: 1.6']) {
      expect(draft).toContain(decl)
      expect(text).toContain(decl)
    }
    expect(draft).toContain('white-space: pre-wrap')
    expect(draft).toContain('word-break: break-word')
    expect(draft.match(/-webkit-line-clamp: (\d+)/)![1]).toBe(
      text.match(/-webkit-line-clamp: (\d+)/)![1],
    )
  })

  it('说明行与生成结果同档同排版(小字和生成后的文字字号不能不同)', () => {
    const hint = ruleOf(css, /\.pddcs-ai-hint \{[^}]*\}/)
    const draft = ruleOf(css, /\.pddcs-ai-draft \{[^}]*\}/)
    for (const decl of [`font-size: ${panelType.content.size}px`, 'line-height: 1.6']) {
      expect(hint).toContain(decl)
      expect(draft).toContain(decl)
    }
    expect(hint).toContain(`color: ${lightTheme.textMuted}`)
    expect(draft).toContain(`color: ${lightTheme.text}`)
    // 认语义换行(idle 的"什么出去 / 什么留下"各占一行),但**不用省略号截断** ——
    // 截掉的正是要用户看清的那半句边界声明
    expect(hint).toContain('white-space: pre-line')
    expect(hint).not.toContain('text-overflow')
    expect(hint).not.toContain('line-clamp')
  })

  it('重试钮在主行右端、按 24px 行内控件档等高,直角 + 安静填充', () => {
    const retry = ruleOf(css, /\.pddcs-ai-retry \{[^}]*\}/)
    expect(retry).toContain(`height: ${controlH.inline}px`)
    expect(retry).toContain('margin-left: auto')
    expect(retry).toContain('box-sizing: border-box') // 覆盖层注入平台页面,不享受 popup 的全局重置
    expect(retry).toContain(`border-radius: ${radius.sm}px`)
    expect(retry).toContain(`background: ${lightTheme.fillQuiet}`)
    expect(retry).not.toContain('border: 1px')
  })
})

describe('buildOverlayCss:快捷键面板鼠标不可控', () => {
  const css = buildOverlayCss(lightTheme)
  /**
   * 行级 `:hover` 选择器逐条抽出(选择器组按逗号拆开,组内跨行也算一条)。
   * 选中态 `.pddcs-cand-selected*` 是豁免项:键盘面板里它才是唯一高亮源,两种面板都要保留。
   * 其余每一条都必须挂 `:not(.pddcs-popup-keyboard)` 守卫。
   *
   * 注意豁免判据是 `startsWith`:v3.0 起悬浮规则自身也引用了 `.pddcs-cand-selected`
   * (写在 `:not(...)` 里,用来防止浅灰盖掉反白),用 `includes` 会把守卫规则一起误杀。
   */
  const rowHoverSelectors = () =>
    // 先去掉注释:注释里也会出现 ":hover" 这个词,留着会被当成一条选择器
    [...stripComments(css).matchAll(/([^{}]*\.pddcs-cand[^{}]*:hover[^{}]*)\{/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.includes('.pddcs-cand') &&
          s.includes(':hover') &&
          !s.startsWith('.pddcs-cand-selected'),
      )

  it('候选行的悬浮底色只在鼠标面板生效(选中态不守,两种面板都有)', () => {
    expect(css).toMatch(
      /\.pddcs-popup:not\(\.pddcs-popup-keyboard\) \.pddcs-cand:not\(\.pddcs-cand-selected\):hover/,
    )
    expect(css).toContain('.pddcs-cand-selected, .pddcs-cand-selected:hover')
  })

  it('悬浮显现操作钮同样被挡住;选中态显现照旧(键盘面板靠它够到星标/复制)', () => {
    const rule = css.match(/[^\n]*\.pddcs-cand:hover \.pddcs-cand-actions[^{]*\{[^}]*\}/)![0]
    expect(rule).toContain('.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand:hover')
    expect(css).toMatch(/\.pddcs-cand-selected \.pddcs-cand-actions[^{]*\{[^}]*opacity: 1/)
  })

  it('整合行的悬浮底色(含失败态)被挡住,常驻绿底/红底不因此变形', () => {
    const aiHover = css.match(/[^\n]*\.pddcs-cand\.pddcs-ai-row:not[^{]*:hover[^{]*\{[^}]*\}/)![0]
    expect(aiHover).toContain('.pddcs-popup:not(.pddcs-popup-keyboard)')
    expect(aiHover).toContain(lightTheme.knowledgeSurfaceHover)
    expect(
      css.match(/[^\n]*\.pddcs-cand\.pddcs-ai-row\.is-error:not[^{]*:hover[^{]*\{[^}]*\}/)![0],
    ).toContain('.pddcs-popup:not(.pddcs-popup-keyboard)')
  })

  it('结构不变量:表里每一条行级悬浮规则都带守卫(日后新增悬浮规则不会漏网)', () => {
    const selectors = rowHoverSelectors()
    // 候选行底色 / 操作钮显现 / 整合行底色 / 整合行失败态底色 —— 四条都在
    expect(selectors.length).toBe(4)
    for (const sel of selectors) {
      expect(sel, `${sel} 缺键盘面板守卫`).toContain('.pddcs-popup:not(.pddcs-popup-keyboard)')
    }
  })
})

describe('parseThemeMode:存储值容错解析', () => {
  it("有效值 'light'/'dark' 原样返回", () => {
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('dark')).toBe('dark')
  })
  it('非法/缺失值回退浅色', () => {
    expect(parseThemeMode(undefined)).toBe('light')
    expect(parseThemeMode('blue')).toBe('light')
    expect(parseThemeMode(1)).toBe('light')
  })
  it('存储键与 popup 主题上下文一致(pddcs:theme)', () => {
    expect(THEME_STORAGE_KEY).toBe('pddcs:theme')
  })
})
