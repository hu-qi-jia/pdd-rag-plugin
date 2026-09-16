/** 主题模式;定义在令牌层(theme),上下文与覆盖层共用,避免 UI 层互相倒挂 */
export type ThemeMode = 'light' | 'dark'

/**
 * 设计令牌 — 对齐 Figma 编辑器工具界面配色(与 pddddd 控制台同一体系)。
 *
 * 原则:
 *  - 中性灰画布(#F5F5F5)+ 白色面板,1px 细边框(#E5E5E5),层级靠明度与字重;
 *  - 中性主色:主操作深灰底白字(v2.6.27 用户指定 #45484D,原为近黑 #161616),
 *    正文主文本 v2.6.27 同步软化为 #2B2B2B(原 #161616);
 *    Figma 蓝(#0D99FF)只做焦点、品牌与状态;
 *  - 按钮亮暗规范(2026-09-15 用户指定,参照示例图):两种主题同构 ——
 *    default = 面色底 + 边框,悬浮提亮一档;primary = 主色底白字,悬浮再提亮一档。
 *    浅色主色 v2.6.27 起为**中性深灰(#45484D)**,与深色主色同值 —— 两主题映射完全同构,
 *    不再使用 Figma 蓝(蓝只保留给焦点/开关/滑杆等状态),保证亮暗切换时按钮
 *    遵循同一映射规则,不出现"黑色↔蓝色"式的跳色。
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
  /** 列表/面板行选中底色(中性灰软底;v2.6.14 用户指定弃用蓝色软底;
   *  v2.6.18 起同时用作候选行悬浮底,左描边令牌 selectedBar 随重设计移除) */
  selectedBg: string
  btnBg: string
  btnBorder: string
  btnHoverBg: string
  btnPrimaryBg: string
  btnPrimaryHover: string
  btnPrimaryText: string
  successBg: string
  successText: string
  errorBg: string
  /** 危险钮悬浮底色(比 errorBg 深一档;2026-09-15 设计6) */
  errorHoverBg: string
  errorText: string
  inputBg: string
  inputBorder: string
  /** 开关未选中轨道色(比 inputBorder 深一档,可辨但不抢眼;2026-09-15 v2.6.7) */
  switchTrack: string
  /** 开关未选中轨道悬浮色 */
  switchTrackHover: string
  shadow: string
  /** 滚动条滑块(悬浮显现);暗色下必须是浅色,否则在深底上不可见 */
  scrollThumb: string
}

/** 浅色 — 工具风:白面板,次级表面 #FAFAFA,悬浮 #EFEFEF,描边 #E5E5E5,主操作深灰底白字 */
export const lightTheme: ThemeTokens = {
  bg: '#ffffff',
  bgSecondary: '#fafafa',
  bgCard: '#ffffff',
  // v2.6.27(第四十轮)用户"主面板的文字颜色换成 #2B2B2B":近黑 #161616 → 略软的深灰
  text: '#2b2b2b',
  textMuted: '#5c5c5c',
  textTertiary: '#8c8c8c',
  border: '#e5e5e5',
  borderLight: '#efefef',
  separator: '#e5e5e5',
  accent: '#0d99ff',
  accentHover: '#0b87e0',
  selectedBg: 'rgba(0,0,0,0.06)',
  btnBg: '#ffffff',
  btnBorder: '#d4d4d4',
  btnHoverBg: '#fafafa',
  // v2.6.27(第四十轮)用户"按钮的颜色修改为深灰色":近黑 #161616 → 中性深灰
  // (取深色主题主钮同值,两主题映射到此完全同构);悬浮仍按规范"再提亮一档"
  btnPrimaryBg: '#45484d',
  btnPrimaryHover: '#53565b',
  btnPrimaryText: '#ffffff',
  successBg: 'rgba(20,174,92,0.09)',
  successText: '#14ae5c',
  errorBg: '#fef1ee',
  errorHoverBg: '#fde3dc',
  errorText: '#f24822',
  inputBg: '#ffffff',
  inputBorder: '#d4d4d4',
  switchTrack: '#c6c8cc',
  switchTrackHover: '#b3b6bc',
  // v2.6.16(第二十五轮):柔和双层阴影(近影定轮廓 + 环境影托浮起),ChatGPT 式"轻浮层";
  // popup 与聊天页面板共用本令牌,两表面同构不割裂
  shadow: '0 1px 2px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.10)',
  scrollThumb: 'rgba(0,0,0,0.16)',
}

/** 深色 — 画布 #1E1F21,表面 #2C2C2C;主按钮中性深灰白字(面色系提亮一档,悬浮再提亮) */
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
  selectedBg: 'rgba(255,255,255,0.10)',
  btnBg: '#2c2c2c',
  btnBorder: '#3b3d40',
  btnHoverBg: '#383b3d',
  // v2.6 按钮亮暗规范:深色主按钮 = 面色系(#2C2C2C)提亮一档的中性深灰 + 白字,
  // 悬浮再提亮一档。历史沿革:近白底黑字过亮(2026-09-15"暗色模式下为白色")
  // → Figma 蓝底白字(与界面中性色系脱节,2026-09-15 示例图定稿改灰)
  btnPrimaryBg: '#45484d',
  btnPrimaryHover: '#53565b',
  btnPrimaryText: '#ffffff',
  successBg: 'rgba(10,207,131,0.14)',
  successText: '#0acf83',
  errorBg: 'rgba(255,114,98,0.14)',
  errorHoverBg: 'rgba(255,114,98,0.22)',
  errorText: '#ff7262',
  inputBg: '#2c2c2c',
  inputBorder: '#3b3d40',
  switchTrack: 'rgba(255,255,255,0.16)',
  switchTrackHover: 'rgba(255,255,255,0.24)',
  // 与浅色同构的近影→环境影顺序(小→大),仅加大不透明度保深底可辨
  shadow: '0 2px 8px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.55)',
  scrollThumb: 'rgba(255,255,255,0.24)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
