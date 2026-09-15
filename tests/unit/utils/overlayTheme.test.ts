// 覆盖层主题单测(2026-09-15 评审 设计1):聊天页覆盖层 CSS 原写死浅色令牌,
// 现抽取为纯函数 buildOverlayCss(按 ThemeTokens 生成)+ parseThemeMode(容错解析存储值)。
// 第十四轮增补:面板重设计(入场动效/悬浮填充钮/检索依据行/键帽脚注)+ AI 钮蓝色主钮化。
import { describe, it, expect } from 'vitest'
import { buildOverlayCss, parseThemeMode, THEME_STORAGE_KEY } from '../../../src/utils/overlayTheme'
import { lightTheme, darkTheme } from '../../../src/ui/theme'

describe('buildOverlayCss:按主题令牌生成覆盖层样式', () => {
  it('浅色令牌 → 浅色面板底/蓝色主钮', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain(`background: ${lightTheme.bg}`)
    expect(css).toContain(`background: ${lightTheme.btnPrimaryBg}`) // 主钮直接实心蓝
    expect(css).toContain(`color: ${lightTheme.text}`)
  })
  it('深色令牌 → 深色面板底/蓝色控件,与浅色产物不同', () => {
    const css = buildOverlayCss(darkTheme)
    expect(css).toContain(`background: ${darkTheme.bg}`)
    expect(css).toContain(darkTheme.btnBg)
    expect(css).not.toBe(buildOverlayCss(lightTheme))
  })
  it('AI回复按钮 = 实心主钮(蓝底白字,悬浮走 btnPrimaryHover)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      const css = buildOverlayCss(tk)
      expect(css).toContain(`.pddcs-ai-btn { position: fixed`)
      expect(css).toContain(`background: ${tk.btnPrimaryBg}; color: ${tk.btnPrimaryText}`)
      expect(css).toContain(`.pddcs-ai-btn:hover { background: ${tk.btnPrimaryHover}`)
    }
  })
  it('轻提示 toast 两主题下都是深底白字(可读性不随主题切换)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      expect(buildOverlayCss(tk)).toContain('rgba(22,22,22,.92)')
    }
  })
})

describe('buildOverlayCss:推荐回复面板重设计(第十四轮)', () => {
  it('面板有入场动效(pop-in 关键帧 + animation),候选行错峰进入(row-in + 延迟)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain('@keyframes pddcs-pop-in')
    expect(css).toContain('@keyframes pddcs-row-in')
    expect(css).toMatch(/\.pddcs-popup \{[^}]*animation: pddcs-pop-in/)
    expect(css).toMatch(/\.pddcs-cand \{[^}]*animation: pddcs-row-in/)
    expect(css).toContain('animation-delay')
  })
  it('候选行悬浮:中性提亮底 + 左侧蓝色指示条(inset 蓝条,零布局位移)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      const css = buildOverlayCss(tk)
      expect(css).toContain(`.pddcs-cand:hover { background: ${tk.borderLight}; box-shadow: inset 2px 0 0 ${tk.accent}`)
    }
  })
  it('悬浮「填入」钮:默认隐藏,行悬浮/聚焦时显现(蓝底白字可点目标)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain('.pddcs-fill {')
    expect(css).toMatch(/\.pddcs-fill \{[^}]*opacity: 0/)
    expect(css).toContain('.pddcs-cand:hover .pddcs-fill')
    expect(css).toContain('.pddcs-cand:focus-within .pddcs-fill')
  })
  it('脚注带键帽样式(.pddcs-kbd),吸附面板底部(滚动时提示不消失)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain('.pddcs-kbd {')
    expect(css).toMatch(/\.pddcs-popup-foot \{[^}]*position: sticky/)
  })
  it('「设置标准回答」迷你钮为蓝色强调态(.pddcs-mini-accent),取消态保持危险红', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain(`.pddcs-mini-accent { color: ${lightTheme.accent}`)
    expect(css).toContain('.pddcs-mini-danger')
  })
  it('面板内滚动条与 popup 同款(细滑块悬浮显现,面板超长时不再用系统粗滚动条)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toMatch(/\.pddcs-popup \{[^}]*scrollbar-width: thin/)
    expect(css).toContain('.pddcs-popup::-webkit-scrollbar-thumb')
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
