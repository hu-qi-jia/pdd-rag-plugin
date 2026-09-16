/**
 * 设计规范(Design Tokens)— 本扩展唯一视觉真源
 *
 * 参照 Figma 编辑器工具界面(与 pddddd 控制台同一设计语言):
 *  - 中性灰画布 + 白色面板,1px 细边框分隔,层级靠明度差与字重;
 *  - 中性主色:主操作深灰底白字(v2.6.27 起 #45484D,原近黑),Figma 蓝(#0D99FF)只做焦点、品牌与状态;
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
  /** 大号浮层(聊天页推荐回复面板;v2.6.19 用户要求圆角增大,不浮动 popup 本体的 8px) */
  xxl: 12,
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

// ── 表单类页面口径(设置页)— 文字层级 + 行距 ────────────────────────────────
/**
 * 设置页/表单页的三级文字层级(2026-09-16 第四十一轮用户"设置页中的文字字号做一下规范,
 * 比如标题、配置项字段、说明文字"):
 *
 *   分组标题(13.5 semibold)> 字段标签(12.5 semibold)> 说明文字(11.5 regular)
 *
 * 三档**等差 1px**,层级由「字号 + 字重 + 颜色」共同表达(颜色在 theme.ts:
 * 标题与标签取 `tk.text`,说明取 `tk.textMuted`;本表只管字号与字重)。
 * 铁律:设置页任何文字都必须落在这三档之一 —— 禁止再出现 `fontSize.caption + 0.5`
 * 这类临时值,也禁止让分组标题小于字段标签(旧版 11.5 标题 + 12.5 标签 = 层级倒挂)。
 */
export const formType = {
  /** 卡片/分组标题(如「检索与填充」) */
  groupTitle: { size: fontSize.title, weight: fontWeight.semibold },
  /** 配置项字段名(开关 / 滑杆 / 快捷键行的标签) */
  label: { size: fontSize.body, weight: fontWeight.semibold },
  /** 说明文字(字段说明、统计行、警告句、关于正文) */
  desc: { size: fontSize.secondary, weight: fontWeight.regular },
} as const

/**
 * 表单行距(设置页唯一口径,2026-09-16 第四十一轮用户"各配置项之间间距增大,并做统一"):
 * 两个值单点决定 —— 配置项之间一律 `row`,字段标签与其说明之间一律 `labelDesc`;
 * 开关 / 滑杆 / 快捷键三种行都取同一组值,不允许各自微调。
 */
export const formGap = {
  /** 配置项之间(**卡片内行距**)与**卡片之间** —— 设置页全页共用这一条 16px 栅格 */
  row: spacing.xxl,
  /** 字段标签 → 说明文字 */
  labelDesc: spacing.xs,
  /** 字段标签 → 其下方的控件(滑杆轨道);比 labelDesc 大一档,给 14px 圆拇指留上下溢出空间 */
  labelControl: spacing.md,
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
