// 覆盖层主题单测(2026-09-15 评审 设计1):聊天页覆盖层 CSS 原写死浅色令牌,
// 现抽取为纯函数 buildOverlayCss(按 ThemeTokens 生成)+ parseThemeMode(容错解析存储值)。
import { describe, it, expect } from 'vitest'
import {
  buildOverlayCss,
  parseThemeMode,
  POPUP_W,
  THEME_STORAGE_KEY,
} from '../../../src/ui/overlay-css'
import { lightTheme, darkTheme } from '../../../src/ui/theme'

describe('buildOverlayCss:按主题令牌生成覆盖层样式', () => {
  it('浅色令牌 → 浅色面板底/黑主钮', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain(`background: ${lightTheme.bg}`)
    expect(css).toContain(lightTheme.btnPrimaryBg) // #161616(浅色主钮不直接出现,主钮样式在面板卡;断言含令牌即可)
    expect(css).toContain(`color: ${lightTheme.text}`)
  })
  it('深色令牌 → 深色面板底/中性灰控件,与浅色产物不同', () => {
    const css = buildOverlayCss(darkTheme)
    expect(css).toContain(`background: ${darkTheme.bg}`)
    expect(css).toContain(darkTheme.btnBg)
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
  it('内缩圆角软行:行带内缩 margin 与圆角,v2.6.20 收紧为 8px 行内 padding;悬浮与选中共用同一软中性灰填充', () => {
    const css = buildOverlayCss(lightTheme)
    const candRule = css.match(/\.pddcs-cand \{[^}]*\}/)![0]
    expect(candRule).toContain('border-radius')
    expect(candRule).toContain('margin: 2px 8px')
    expect(candRule).toContain('padding: 8px 12px')
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
  it('同内容×n 移至行右下角悬浮才显(absolute 定位 + 静止透明);折叠行预留条位不压正文', () => {
    const css = buildOverlayCss(lightTheme)
    const foldRule = css.match(/\.pddcs-fold \{[^}]*\}/)![0]
    expect(foldRule).toContain('position: absolute')
    expect(foldRule).toContain('right: 10px')
    expect(foldRule).toContain('bottom: 6px')
    expect(foldRule).toContain('opacity: 0')
    expect(css).toMatch(/\.pddcs-cand:hover \.pddcs-fold[^{]*\{[^}]*opacity: 1/)
    expect(css).toContain('.pddcs-cand-folded')
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
