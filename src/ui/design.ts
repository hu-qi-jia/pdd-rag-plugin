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
  /** popup 外框(固定高度,不允许内容撑开;2026-09-15 400→420,文件夹树层级需要更宽) */
  popupWidth: 420,
  popupHeight: 560,
  railWidth: 52,
  /** 图标导航按钮 */
  railBtn: 36,
  /** 拨杆开关(v2.6.7 重设计:36×20 轨道 + 16 滑块,按压可拉伸) */
  toggleWidth: 36,
  toggleHeight: 20,
  toggleKnob: 16,
} as const

// ── 控件高度(px)──────────────────────────────────────────────────────────────
// 铁律:同一行内的输入框与按钮必须取同一档,否则出现几像素的高低错位
// (2026-09-15 用户反馈:新建子文件夹的输入框比「创建/取消」高 3px)。
// 用显式 height 而不是靠 padding+line-height 撑,避免行高/字体微调时再次错位。
export const controlH = {
  /** 行内小控件:行悬浮操作钮、图标钮、内联二次确认行 */
  inline: 24,
  /** 表单与工具栏控件:输入框与其同排的主/次按钮(等高核心场景) */
  form: 26,
} as const

// ── 动效 ─────────────────────────────────────────────────────────────────────
export const motion = {
  fast: '0.12s ease',
  normal: '0.15s ease',
  /** 强调动效(2026-09-15 v2.6.7):减速曲线,用于开关滑块等"有分量"的位移 */
  emphasized: '0.2s cubic-bezier(0.2, 0, 0, 1)',
} as const

// ── 语义色(与主题无关的固定色,仅用于徽标等品牌时刻)─────────────────────
export const semantic = {
  golden: '#b8860b',
  goldenBg: '#fdf6e3',
  knowledge: '#14ae5c',
  knowledgeBg: 'rgba(20,174,92,0.09)',
} as const
