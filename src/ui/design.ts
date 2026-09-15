/**
 * 设计规范(Design Tokens)— 本扩展唯一视觉真源
 *
 * 参照 Figma 官网(figma.com)设计语言:
 *  - 白画布 + 浅灰表面,细边框分隔,层级靠明度差与字重;
 *  - 唯一强调色 Figma 蓝(#0D99FF),只出现在状态与主操作;
 *  - 胶囊控件、大圆角卡片、克制的层级字号;字体 Inter 优先(离线回退系统字体)。
 *
 * 任何页面/组件不得硬编码字号、圆角、间距、颜色,一律引用本文件与 theme.ts。
 * 配色令牌见 theme.ts(ThemeTokens),本文件负责几何与字型。
 */

// ── 字体栈 — Figma 官网同款 Inter 优先;不联网加载字体,缺 Inter 时回退系统字体 ──
export const fontFamily =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif'

// ── 字号(px)— 三层信息层级 + 辅助 ──────────────────────────────────────────
export const fontSize = {
  /** 辅助信息:时间戳、来源、脚注 */
  caption: 10.5,
  /** 次级文本:回复正文、描述 */
  secondary: 11.5,
  /** 正文默认:问题标题、条目标题、按钮 */
  body: 12.5,
  /** 页签标题 / 弹窗标题 */
  title: 13.5,
  /** 页面标题 */
  heading: 15,
} as const

// ── 字重 ──────────────────────────────────────────────────────────────────────
export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  /** 仅页面标题 */
  heading: 650,
} as const

// ── 圆角(px)— 胶囊控件优先,卡片大圆角 ────────────────────────────────────
export const radius = {
  /** 微型元素:徽标内嵌图标块 */
  sm: 8,
  /** 输入框、提示条 */
  md: 12,
  /** 卡片 */
  lg: 14,
  /** 弹窗 / popup 外框 */
  xl: 16,
  /** 胶囊按钮、徽标、开关 */
  pill: 9999,
} as const

// ── 间距(px)— 4 的倍数栅格 ─────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
} as const

// ── 尺寸 ─────────────────────────────────────────────────────────────────────
export const size = {
  /** popup 外框(固定高度,不允许内容撑开) */
  popupWidth: 400,
  popupHeight: 560,
  railWidth: 52,
  /** 图标导航按钮 */
  railBtn: 36,
  /** 拨杆开关 */
  toggleWidth: 32,
  toggleHeight: 19,
  toggleKnob: 15,
} as const

// ── 动效 ─────────────────────────────────────────────────────────────────────
export const motion = {
  fast: '0.12s ease',
  normal: '0.15s ease',
} as const

// ── 语义色(与主题无关的固定色,仅用于徽标等品牌时刻)─────────────────────
export const semantic = {
  golden: '#b45309',
  goldenBg: 'rgba(245,158,11,0.15)',
  knowledge: '#0e8a50',
  knowledgeBg: 'rgba(20,174,92,0.12)',
} as const
