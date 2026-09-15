/**
 * 设计规范(Design Tokens)— 本扩展唯一视觉真源
 *
 * 参照 Figma 编辑器工具界面(与 pddddd 控制台同一设计语言):
 *  - 中性灰画布 + 白色面板,1px 细边框分隔,层级靠明度差与字重;
 *  - 黑白主色:主操作黑底白字,Figma 蓝(#0D99FF)只做焦点、品牌与状态;
 *  - 小圆角(4/6/8px)、小字号高密度、克制阴影。
 *
 * 任何页面/组件不得硬编码字号、圆角、间距、颜色,一律引用本文件与 theme.ts。
 * 配色令牌见 theme.ts(ThemeTokens),本文件负责几何与字型。
 */

// ── 字体栈 — Segoe UI / 雅黑优先(Windows 控制台同款);不联网加载字体 ──
export const fontFamily =
  '"Segoe UI", "Microsoft YaHei", -apple-system, "PingFang SC", sans-serif'

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

// ── 圆角(px)— 小圆角工具风(4/6/8),胶囊仅保留给开关与圆点 ────────────────
export const radius = {
  /** 微型元素:徽标、图标按钮、行悬浮块 */
  sm: 4,
  /** 按钮、输入框、提示条 */
  md: 6,
  /** 卡片 / 分区 */
  lg: 8,
  /** 弹窗 / popup 外框 */
  xl: 8,
  /** 拨杆开关、圆形计数徽标、圆点 */
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
  golden: '#b8860b',
  goldenBg: '#fdf6e3',
  knowledge: '#14ae5c',
  knowledgeBg: 'rgba(20,174,92,0.09)',
} as const
