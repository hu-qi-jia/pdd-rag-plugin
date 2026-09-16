// 覆盖层主题单测(2026-09-15 评审 设计1):聊天页覆盖层 CSS 原写死浅色令牌,
// 现抽取为纯函数 buildOverlayCss(按 ThemeTokens 生成)+ parseThemeMode(容错解析存储值)。
import { describe, it, expect } from 'vitest'
import {
  BADGE_PAD_X,
  buildOverlayCss,
  parseThemeMode,
  POPUP_W,
  THEME_STORAGE_KEY,
} from '../../../src/ui/overlay-css'
import { lightTheme, darkTheme } from '../../../src/ui/theme'

describe('buildOverlayCss:按主题令牌生成覆盖层样式', () => {
  it('浅色令牌 → 浅色面板底 + 主/次级文本色,且不混入深色文本', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain(`background: ${lightTheme.bg}`)
    // 覆盖层里出现的是面板与气泡按钮用到的令牌(text / textMuted / textTertiary);
    // **不含** btnPrimaryBg —— 主按钮只在 popup 侧,此处断它等于在断一个不存在的引用
    // (第四十一轮修正:旧断言 toContain(btnPrimaryBg) 曾因 tk.text 恰与主钮同值而"假绿")
    expect(css).toContain(`color: ${lightTheme.text}`)
    expect(css).toContain(`color: ${lightTheme.textMuted}`)
    expect(css).toContain(`color: ${lightTheme.textTertiary}`)
    expect(css).not.toContain(darkTheme.text)
  })
  it('深色令牌 → 深色面板底/中性灰控件,与浅色产物不同', () => {
    const css = buildOverlayCss(darkTheme)
    expect(css).toContain(`background: ${darkTheme.bg}`)
    expect(css).toContain(darkTheme.btnBg)
    expect(css).not.toContain(lightTheme.text)
    expect(css).not.toBe(buildOverlayCss(lightTheme))
  })
  it('轻提示 toast 两主题下都是深底白字(可读性不随主题切换)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      expect(buildOverlayCss(tk)).toContain('rgba(22,22,22,.92)')
    }
  })
})

describe('buildOverlayCss:ChatGPT 化视觉(2026-09-16 第二十五轮,1+2+3+6,不割裂)', () => {
  it('候选行去分隔线靠留白分组(无 border-bottom)', () => {
    const css = buildOverlayCss(lightTheme)
    const candRule = css.match(/\.pddcs-cand \{[^}]*\}/)![0]
    expect(candRule).not.toContain('border-bottom')
  })
  it('徽标软底 chip 化(v2.6.19 用户"明显一点"):金=琥珀软底金字,知识库=绿软底绿字,圆点移除', () => {
    const css = buildOverlayCss(lightTheme)
    const badgeRule = css.match(/\.pddcs-badge \{[^}]*\}/)![0]
    expect(badgeRule).toContain('background:') // chip 软底回归
    expect(css).not.toContain('.pddcs-badge::before') // 6px 圆点移除
    expect(css).toContain('.pddcs-badge.golden')
    expect(css).toContain('rgba(184, 134, 11, 0.14)')
    expect(css).toContain('.pddcs-badge.knowledge')
    expect(css).toContain('rgba(20, 174, 92, 0.12)')
  })
  it('页脚键位提示键帽化:.pddcs-kbd 细边框圆角灰底', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain('.pddcs-kbd')
    expect(css).toContain(`border: 1px solid ${lightTheme.border}`)
  })
  it('浮层阴影柔和双层(浅/深同构:近影 + 环境影)', () => {
    expect(lightTheme.shadow).toBe('0 1px 2px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.10)')
    expect(darkTheme.shadow).toBe('0 2px 8px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.55)')
  })
})

describe('buildOverlayCss:对话式排版与字号主次(2026-09-16 第二十六轮)', () => {
  it('回答正文为主层:13.5px(title 档)+ 1.6 行高', () => {
    const css = buildOverlayCss(lightTheme)
    const textRule = css.match(/\.pddcs-cand-text \{[^}]*\}/)![0]
    expect(textRule).toContain('font-size: 13.5px')
    expect(textRule).toContain('line-height: 1.6')
  })
  it('问题回显上置为引子:11.5px 灰字单行省略(.pddcs-cand-q);底部来源行规则移除', () => {
    const css = buildOverlayCss(lightTheme)
    const qRule = css.match(/\.pddcs-cand-q \{[^}]*\}/)![0]
    expect(qRule).toContain('font-size: 11.5px')
    expect(qRule).toContain('text-overflow: ellipsis')
    expect(css).not.toContain('.pddcs-cand-src')
  })
  it('头部小字但加粗(v2.6.19 用户指定 600;12.5px 中灰保持)', () => {
    const css = buildOverlayCss(lightTheme)
    const headRule = css.match(/\.pddcs-popup-head \{[^}]*\}/)![0]
    expect(headRule).toContain('font-size: 12.5px')
    expect(headRule).toContain('font-weight: 600')
    expect(headRule).toContain(`color: ${lightTheme.textMuted}`)
  })
  it('死规则清理:score 元素早已移除,规则不再生成', () => {
    expect(buildOverlayCss(lightTheme)).not.toContain('.pddcs-score')
  })
})

describe('buildOverlayCss:面板重设计(2026-09-16 第三十二轮 v2.6.18)', () => {
  it('面板加宽至 360(CSS 与 JS 定位共用常量,单处维护)', () => {
    expect(POPUP_W).toBe(360)
  })
  it('内缩圆角软行:行带内缩 margin 与圆角,v2.6.25 为 margin 1px / padding 3px 12px;悬浮与选中共用同一软中性灰填充', () => {
    const css = buildOverlayCss(lightTheme)
    const candRule = css.match(/\.pddcs-cand \{[^}]*\}/)![0]
    expect(candRule).toContain('border-radius')
    expect(candRule).toContain('margin: 1px 8px')
    expect(candRule).toContain('padding: 3px 12px')
    const fillRule = css.match(/\.pddcs-cand:hover,[^{]*\{[^}]*\}/)![0]
    expect(fillRule).toContain(lightTheme.selectedBg)
    expect(fillRule).not.toContain('inset 3px') // 左描边属旧表格语言,移除
  })
  it('操作钮悬浮/选中才显:静止 opacity 0 + pointer-events none,悬浮或选中显现', () => {
    const css = buildOverlayCss(lightTheme)
    const actRule = css.match(/\.pddcs-cand-actions \{[^}]*\}/)![0]
    expect(actRule).toContain('opacity: 0')
    expect(actRule).toContain('pointer-events: none')
    expect(css).toMatch(/\.pddcs-cand:hover \.pddcs-cand-actions[^{]*\{[^}]*opacity: 1/)
    expect(css).toMatch(/\.pddcs-cand-selected \.pddcs-cand-actions[^{]*\{[^}]*opacity: 1/)
  })
  it('三段式壳:popup 为 flex 列只负责裁圆角,滚动移交 body,页脚常驻带 hairline', () => {
    const css = buildOverlayCss(lightTheme)
    const popupRule = css.match(/\.pddcs-popup \{[^}]*\}/)![0]
    expect(popupRule).toContain('display: flex')
    expect(popupRule).not.toContain('overflow: auto') // 滚动不再在面板根上
    const bodyRule = css.match(/\.pddcs-popup-body \{ flex: 1[^}]*\}/)![0]
    expect(bodyRule).toContain('flex: 1')
    expect(bodyRule).toContain('overflow-y: auto')
    const footRule = css.match(/\.pddcs-popup-foot \{[^}]*\}/)![0]
    expect(footRule).toContain('border-top')
  })
  it('入场动效:160ms 级淡入上移, prefers-reduced-motion 关闭', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain('@keyframes pddcs-pop-in')
    const popupRule = css.match(/\.pddcs-popup \{[^}]*\}/)![0]
    expect(popupRule).toContain('animation: pddcs-pop-in')
    expect(css).toContain('prefers-reduced-motion')
  })
})

describe('buildOverlayCss:面板细节四调(2026-09-16 第三十三轮 v2.6.19)', () => {
  it('面板圆角增大至 12px(radius.xxl 新档,不影响 popup 本体的 8px)', () => {
    const css = buildOverlayCss(lightTheme)
    const popupRule = css.match(/\.pddcs-popup \{[^}]*\}/)![0]
    expect(popupRule).toContain('border-radius: 12px')
  })
  it('同内容×n 移到徽标右侧常驻(v2.6.25 用户"同内容移动至标签的右侧"):不再 absolute/不再悬浮才显,折叠条位预留规则删除', () => {
    const css = buildOverlayCss(lightTheme)
    const foldRule = css.match(/\.pddcs-fold \{[^}]*\}/)![0]
    expect(foldRule).not.toContain('position: absolute')
    expect(foldRule).not.toContain('opacity: 0')
    expect(foldRule).toContain('white-space: nowrap')
    expect(foldRule).toContain(`color: ${lightTheme.textTertiary}`)
    // 行首行不再是右浮动覆盖物:悬浮显隐钩子与折叠条位都撤掉
    expect(css).not.toContain('.pddcs-cand:hover .pddcs-fold')
    expect(css).not.toContain('.pddcs-cand-folded')
  })
})

describe('buildOverlayCss:标签放大 + 操作钮图标化 + 列表收紧(2026-09-16 第三十七轮 v2.6.24)', () => {
  it('类别徽标放大(用户"标签比例增大"):11.5px secondary 档 + 3px 9px 内边距 + 6px 圆角', () => {
    const css = buildOverlayCss(lightTheme)
    const badgeRule = css.match(/\.pddcs-badge \{[^}]*\}/)![0]
    expect(badgeRule).toContain('font-size: 11.5px')
    expect(badgeRule).toContain('padding: 3px 9px')
    expect(badgeRule).toContain('border-radius: 6px')
    // 三态配色不变(金/绿/中性灰软底)
    expect(css).toContain('.pddcs-badge.golden')
    expect(css).toContain('.pddcs-badge.knowledge')
  })
  it('三处文字左缘同基线:徽标内边距 BADGE_PAD_X 单点决定下方正文的左缩进', () => {
    const css = buildOverlayCss(lightTheme)
    const candRule = css.match(/\.pddcs-cand \{[^}]*\}/)![0]
    expect(candRule).toContain('padding: 3px 12px') // 行左右对称 12px → 徽标外框即整行左缘
    const topRule = css.match(/\.pddcs-cand-top \{[^}]*\}/)![0]
    expect(topRule).not.toContain('padding-left') // 徽标所在行不得再加缩进
    // v2.6.26 口径:正文对齐徽标**内文字**左缘 → 缩进量 = 徽标的水平内边距,同一个常量
    expect(BADGE_PAD_X).toBe(9)
    expect(css.match(/\.pddcs-badge \{[^}]*\}/)![0]).toContain(`padding: 3px ${BADGE_PAD_X}px`)
    expect(css.match(/\.pddcs-cand-q \{[^}]*\}/)![0]).toContain(`padding-left: ${BADGE_PAD_X}px`)
    expect(css.match(/\.pddcs-cand-text \{[^}]*\}/)![0]).toContain(`padding-left: ${BADGE_PAD_X}px`)
  })
  it('操作钮图标化:文字迷你钮规则移除,改 24px 图标钮(星标/复制)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).not.toContain('.pddcs-mini')
    const btnRule = css.match(/\.pddcs-icon-btn \{[^}]*\}/)![0]
    expect(btnRule).toContain('width: 24px')
    expect(btnRule).toContain('height: 24px')
    expect(btnRule).toContain('color:') // currentColor 继承,图标 SVG 不写死颜色
    // 星标三态:未设悬浮金、已设实心金
    expect(css).toContain('.pddcs-icon-btn-star:hover')
    expect(css).toContain('.pddcs-icon-btn-golden')
    expect(css).toContain('rgba(184, 134, 11, 0.14)')
    // 在途转圈(替代「设置中…」文字)
    expect(css).toContain('.pddcs-icon-btn-busy svg')
    expect(css).toContain('@keyframes pddcs-spin')
  })
  it('图标钮颜色随主题走令牌(深色取深色 textTertiary),金色星态主题无关(semantic)', () => {
    const dark = buildOverlayCss(darkTheme)
    expect(dark.match(/\.pddcs-icon-btn \{[^}]*\}/)![0]).toContain(
      `color: ${darkTheme.textTertiary}`,
    )
    expect(dark).toContain('.pddcs-icon-btn-golden { color: #b8860b; }')
  })
  it('按钮右移:操作钮组负外边距 6px,从行内边距推向面板右缘', () => {
    const css = buildOverlayCss(lightTheme)
    const actRule = css.match(/\.pddcs-cand-actions \{[^}]*\}/)![0]
    expect(actRule).toContain('margin-right: -6px')
    expect(actRule).toContain('margin-left: auto')
  })
})

describe('buildOverlayCss:词条留白重配 + 折叠数归位(2026-09-16 第三十八轮 v2.6.25)', () => {
  it('留白重配(用户"标签/原问题/回答间距各 +2px,词条反而要更矮"):两处行内间距 4px、上下 padding 压到 3px', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css.match(/\.pddcs-cand-top \{[^}]*\}/)![0]).toContain('margin-bottom: 4px')
    expect(css.match(/\.pddcs-cand-q \{[^}]*\}/)![0]).toContain('margin-bottom: 4px')
    expect(css.match(/\.pddcs-cand \{[^}]*\}/)![0]).toContain('padding: 3px 12px')
    expect(css.match(/\.pddcs-popup-body \{ flex: 1[^}]*\}/)![0]).toContain('padding: 1px 0 3px')
  })
  it('文字左缘基线不受重配影响(行左右 padding 仍 12px;引子/正文缩进 = 徽标内边距)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css.match(/\.pddcs-cand \{[^}]*\}/)![0]).toContain('padding: 3px 12px')
    expect(css.match(/\.pddcs-cand-top \{[^}]*\}/)![0]).not.toContain('padding-left')
    expect(css.match(/\.pddcs-cand-q \{[^}]*\}/)![0]).toContain(`padding-left: ${BADGE_PAD_X}px`)
    expect(css.match(/\.pddcs-cand-text \{[^}]*\}/)![0]).toContain(`padding-left: ${BADGE_PAD_X}px`)
  })
  it('同内容×n 在徽标右侧常驻:不再 absolute/悬浮才显,折叠条位预留规则整体删除', () => {
    const css = buildOverlayCss(lightTheme)
    const foldRule = css.match(/\.pddcs-fold \{[^}]*\}/)![0]
    expect(foldRule).not.toContain('position: absolute')
    expect(foldRule).not.toContain('opacity: 0')
    expect(foldRule).toContain('white-space: nowrap')
    expect(foldRule).toContain(`color: ${lightTheme.textTertiary}`)
    expect(css).not.toContain('.pddcs-cand:hover .pddcs-fold')
    expect(css).not.toContain('.pddcs-cand-folded') // 折叠与否不再改变词条高度
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
