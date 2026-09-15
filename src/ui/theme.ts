import type { ThemeMode } from './theme-context'

/**
 * 设计令牌 — 对齐 Figma 官网(figma.com)配色体系。
 *
 * 原则(取自 Figma 设计语言):
 *  - 白画布 + 浅灰表面(#F5F5F5)+ 细边框(#E6E6E6),层级靠明度与字重;
 *  - 唯一强调色 Figma 蓝(#0D99FF),只用于主操作、焦点与品牌时刻;
 *  - 深色主题对齐 Figma dark UI(#1E1F21 画布 / #2C2C2C 表面),蓝提亮保证对比。
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
}

/** 浅色 — Figma 官网:画布纯白,表面 #F5F5F5,描边 #E6E6E6,主操作 Figma 蓝底白字 */
export const lightTheme: ThemeTokens = {
  bg: '#ffffff',
  bgSecondary: '#f5f5f5',
  bgCard: '#f5f5f5',
  text: '#1e1f21',
  textMuted: '#575b66',
  textTertiary: '#8a8d91',
  border: '#e6e6e6',
  borderLight: '#f0f0f0',
  separator: '#e6e6e6',
  accent: '#0d99ff',
  accentHover: '#0b87e0',
  btnBg: '#ffffff',
  btnBorder: '#e6e6e6',
  btnHoverBg: '#f5f5f5',
  btnPrimaryBg: '#0d99ff',
  btnPrimaryHover: '#0b87e0',
  btnPrimaryText: '#ffffff',
  successBg: 'rgba(20,174,92,0.10)',
  successText: '#0e8a50',
  errorBg: 'rgba(242,72,34,0.10)',
  errorText: '#d93511',
  inputBg: '#ffffff',
  inputBorder: '#e6e6e6',
  shadow: '0 8px 24px rgba(30,31,33,0.10), 0 2px 6px rgba(30,31,33,0.05)',
}

/** 深色 — Figma dark UI:画布 #1E1F21,表面 #2C2C2C,蓝提亮 #4CB3FF */
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
  btnPrimaryBg: '#0d99ff',
  btnPrimaryHover: '#2fa9ff',
  btnPrimaryText: '#ffffff',
  successBg: 'rgba(10,207,131,0.14)',
  successText: '#0acf83',
  errorBg: 'rgba(255,114,98,0.14)',
  errorText: '#ff7262',
  inputBg: '#2c2c2c',
  inputBorder: '#3b3d40',
  shadow: '0 12px 40px rgba(0,0,0,0.60), 0 2px 8px rgba(0,0,0,0.35)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
