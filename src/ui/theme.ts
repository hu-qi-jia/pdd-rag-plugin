import type { ThemeMode } from './theme-context'

/**
 * 设计令牌 — 对齐 Figma 编辑器工具界面配色(与 pddddd 控制台同一体系)。
 *
 * 原则:
 *  - 中性灰画布(#F5F5F5)+ 白色面板,1px 细边框(#E5E5E5),层级靠明度与字重;
 *  - 黑白主色:主操作黑底白字(#161616),Figma 蓝(#0D99FF)只做焦点、品牌与状态;
 *  - 深色主题反转主按钮(白底黑字),表面 #2C2C2C,蓝提亮保证对比。
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
  btnPrimaryBg: string
  btnPrimaryHover: string
  btnPrimaryText: string
  successBg: string
  successText: string
  errorBg: string
  errorText: string
  inputBg: string
  inputBorder: string
  shadow: string
  /** 滚动条滑块(悬浮显现);暗色下必须是浅色,否则在深底上不可见 */
  scrollThumb: string
}

/** 浅色 — 工具风:白面板,次级表面 #FAFAFA,悬浮 #EFEFEF,描边 #E5E5E5,主操作黑底白字 */
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
  accent: '#0d99ff',
  accentHover: '#0b87e0',
  btnBg: '#ffffff',
  btnBorder: '#d4d4d4',
  btnHoverBg: '#fafafa',
  btnPrimaryBg: '#161616',
  btnPrimaryHover: '#333333',
  btnPrimaryText: '#ffffff',
  successBg: 'rgba(20,174,92,0.09)',
  successText: '#14ae5c',
  errorBg: '#fef1ee',
  errorText: '#f24822',
  inputBg: '#ffffff',
  inputBorder: '#d4d4d4',
  shadow: '0 4px 16px rgba(0,0,0,0.08)',
  scrollThumb: 'rgba(0,0,0,0.16)',
}

/** 深色 — 画布 #1E1F21,表面 #2C2C2C;主按钮反转为白底黑字(黑白主色逻辑不变) */
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
  accent: '#4cb3ff',
  accentHover: '#6bc4ff',
  btnBg: '#2c2c2c',
  btnBorder: '#3b3d40',
  btnHoverBg: '#383b3d',
  btnPrimaryBg: '#e6e6e6',
  btnPrimaryHover: '#ffffff',
  btnPrimaryText: '#161616',
  successBg: 'rgba(10,207,131,0.14)',
  successText: '#0acf83',
  errorBg: 'rgba(255,114,98,0.14)',
  errorText: '#ff7262',
  inputBg: '#2c2c2c',
  inputBorder: '#3b3d40',
  shadow: '0 12px 40px rgba(0,0,0,0.60), 0 2px 8px rgba(0,0,0,0.35)',
  scrollThumb: 'rgba(255,255,255,0.24)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
