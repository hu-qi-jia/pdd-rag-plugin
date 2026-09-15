import type { ThemeMode } from './theme-context'

/**
 * 设计令牌 — 飞书蓝工具风(2026-09-15 第十四轮,用户指定主题色 = 飞书蓝 #3370FF)。
 *
 * 原则:
 *  - 中性灰画布(#F5F5F5 系)+ 白色面板,1px 细边框,层级靠明度与字重 —— 延续工具风骨架;
 *  - 蓝色主色:主操作实心蓝底白字,次级操作浅蓝底蓝字(飞书"主/次按钮"同款层级),
 *    焦点、开关、滑杆等状态一律蓝色;危险操作保持红色(安全语义,永不蓝化);
 *  - 按钮亮暗规范(同构映射,切换主题不跳色):
 *    default = 蓝染色底 + 蓝字,悬浮染色加深一档;primary = 品牌蓝底白字,
 *    浅色悬浮压暗一档、深色悬浮提亮一档(与面色系按钮同一"向界面明度靠拢"的方向)。
 */
export interface ThemeTokens {
  bg: string
  bgSecondary: string
  bgCard: string
  text: string
  textMuted: string
  textTertiary: string
  border: string
  borderLight: string
  separator: string
  accent: string
  accentHover: string
  btnBg: string
  btnBorder: string
  btnHoverBg: string
  /** default 按钮/迷你操作的字色(蓝) */
  btnText: string
  btnPrimaryBg: string
  btnPrimaryHover: string
  btnPrimaryText: string
  /** 实心主钮的染色投影(阴影带主色,不用纯黑) */
  btnPrimaryShadow: string
  successBg: string
  successText: string
  errorBg: string
  /** 危险钮悬浮底色(比 errorBg 深一档;2026-09-15 设计6) */
  errorHoverBg: string
  errorText: string
  inputBg: string
  inputBorder: string
  shadow: string
  /** 滚动条滑块(悬浮显现);暗色下必须是浅色,否则在深底上不可见 */
  scrollThumb: string
  /** 开关未选中轨道(与输入框描边区分:轨道需要更实,暗色下用浅色透明层) */
  switchTrack: string
  /** 开关未选中轨道悬浮态 */
  switchTrackHover: string
}

/** 浅色 — 白面板 + 飞书蓝主色:主钮 #3370FF 实心,次级钮浅蓝底蓝字 */
export const lightTheme: ThemeTokens = {
  bg: '#ffffff',
  bgSecondary: '#fafafa',
  bgCard: '#ffffff',
  text: '#161616',
  textMuted: '#5c5c5c',
  textTertiary: '#8c8c8c',
  border: '#e5e5e5',
  borderLight: '#efefef',
  separator: '#e5e5e5',
  accent: '#3370ff',
  accentHover: '#2856c9',
  btnBg: '#eef3ff',
  btnBorder: '#dce6ff',
  btnHoverBg: '#dfe9ff',
  btnText: '#3370ff',
  btnPrimaryBg: '#3370ff',
  btnPrimaryHover: '#2856c9',
  btnPrimaryText: '#ffffff',
  btnPrimaryShadow: '0 1px 4px rgba(51,112,255,0.30)',
  successBg: 'rgba(20,174,92,0.09)',
  successText: '#14ae5c',
  errorBg: '#fef1ee',
  errorHoverBg: '#fde3dc',
  errorText: '#f24822',
  inputBg: '#ffffff',
  inputBorder: '#d4d4d4',
  shadow: '0 4px 16px rgba(0,0,0,0.08)',
  scrollThumb: 'rgba(0,0,0,0.16)',
  switchTrack: '#d0d3da',
  switchTrackHover: '#bfc5cf',
}

/** 深色 — 画布 #1E1F21;品牌蓝在深底上同构复用,悬浮整体提亮一档 */
export const darkTheme: ThemeTokens = {
  bg: '#1e1f21',
  bgSecondary: '#1a1b1d',
  bgCard: '#2c2c2c',
  text: '#e6e6e6',
  textMuted: '#9b9da2',
  textTertiary: '#6f7175',
  border: '#3b3d40',
  borderLight: 'rgba(255,255,255,0.06)',
  separator: 'rgba(255,255,255,0.10)',
  accent: '#5c8dff',
  accentHover: '#7ba6ff',
  btnBg: 'rgba(51,112,255,0.14)',
  btnBorder: 'rgba(51,112,255,0.32)',
  btnHoverBg: 'rgba(51,112,255,0.22)',
  btnText: '#8fb3ff',
  // 历史沿革:近白(过亮)→ Figma 蓝/中性灰往返 → 2026-09-15 用户拍板全量蓝色(飞书蓝)
  btnPrimaryBg: '#3370ff',
  btnPrimaryHover: '#4c84ff',
  btnPrimaryText: '#ffffff',
  btnPrimaryShadow: '0 1px 6px rgba(0,0,0,0.45)',
  successBg: 'rgba(10,207,131,0.14)',
  successText: '#0acf83',
  errorBg: 'rgba(255,114,98,0.14)',
  errorHoverBg: 'rgba(255,114,98,0.22)',
  errorText: '#ff7262',
  inputBg: '#2c2c2c',
  inputBorder: '#3b3d40',
  shadow: '0 12px 40px rgba(0,0,0,0.60), 0 2px 8px rgba(0,0,0,0.35)',
  scrollThumb: 'rgba(255,255,255,0.24)',
  switchTrack: 'rgba(255,255,255,0.16)',
  switchTrackHover: 'rgba(255,255,255,0.24)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
