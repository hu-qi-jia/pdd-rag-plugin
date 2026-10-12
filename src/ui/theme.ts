/** 主题模式;定义在令牌层(theme),上下文与覆盖层共用,避免 UI 层互相倒挂 */
export type ThemeMode = 'light' | 'dark'

/**
 * 设计令牌 — **复古极简主义 + 极客工具风**(v3.1)。
 *
 * 参照系:BIOS 设置屏、Norton Commander、Teenage Engineering 面板、Raycast、Linear。
 * 一句话:**线、反白、等宽字**。没有圆角、没有阴影、没有渐变、没有背景模糊、没有任何装饰性彩色。
 *
 * 三条硬约束:
 *  1. **5 级墨 + 1 语义色**。层级只由墨的浓度表达:`text` 标题/结构线/选中实心块 →
 *     `textMuted` 正文 → `textTertiary` 次级说明 → `textFaint` 元信息/占位。
 *     **全站唯一的彩色是 `goldenText`(琥珀 #8a6a16)**,且只用于「已设标准 / 金标」这一个语义。
 *     知识库的绿、错误的红**都已删除** —— 错误改用「墨色 + 加粗 + `!` 前缀」表达,
 *     知识库降为灰方括号。多一种颜色就多一个需要解释的信号,而它并不比字重更准。
 *  2. **灰阶即层级,线重即层级**。线三档:`borderStrong`(外框/结构线)> `border`(分区线)
 *     > `borderLight`(行分隔发丝线)。三档**都是 1px**,靠深浅分档。
 *  3. **禁用阴影**。唯一例外是 `rowHoverBar` 那个 `inset` 墨条 —— 它用 box-shadow 实现
 *     **零位移**的左缘 2px 竖条(用 border 或额外元素都会让行内容横移 2px,悬浮时抖一下)。
 *
 * 两套主题是**同一张版面的正片与负片**:浅色 = 纸白终端,深色 = CRT 屏。几何、字号、
 * 间距完全共用(design.ts),切换主题只有颜色在换。
 */
export interface ThemeTokens {
  bg: string
  bgSecondary: string
  bgCard: string
  /** 标题 / 结构线 / 选中实心块 */
  text: string
  /** 正文 */
  textMuted: string
  /** 次级说明 */
  textTertiary: string
  /** 元信息 / 占位符(第 4 级墨) */
  textFaint: string
  /** 分区线、控件描边 */
  border: string
  /** 行分隔发丝线 */
  borderLight: string
  /** 结构分隔线(与 borderLight 同值;保留令牌名以免调用点散落两处口径) */
  separator: string
  /** **外框 / 结构线**:窗口外框、导航栏右缘、页面标题下缘 */
  borderStrong: string
  accent: string
  accentHover: string
  /** 列表行选中底色(列表行悬浮另见 `rowHoverBg`) */
  selectedBg: string
  /** **列表行的悬浮浅底**(#fafaf8)—— 比通用 `bgSecondary` 更暖一点点,与左缘墨条配套 */
  rowHoverBg: string
  /**
   * **列表行悬浮的左缘 2px 墨条**,以 `box-shadow: inset` 实现。
   *
   * 这是全站唯一允许的 box-shadow。为什么必须用 inset 而不是 border/额外元素:
   * 那两种都会把行内容向右推 2px,悬浮时整行文字横向抖一下 ——
   * 而 inset 只画在盒子内侧,零位移。
   */
  rowHoverBar: string
  btnBg: string
  btnBorder: string
  btnHoverBg: string
  btnPrimaryBg: string
  btnPrimaryHover: string
  btnPrimaryText: string
  /**
   * 结果提示底(成功/失败**共用**同一档浅底)。v3.1 起提示不再靠颜色分成功失败 ——
   * 全部是墨色文字,失败多加粗与 `!` 前缀。
   *
   * **它必须比 `knowledgeSurface` 深一档**(浅色 #ececec vs #f5f5f5,深色 #242424 vs #1c1c1c):
   * 面板里 AI 整合行常驻 `knowledgeSurface`,失败态整行转 `noticeBg` ——
   * 两者同值的话"这一行出错了"就只剩左色条与字重两个信号,底色那一重白给。
   */
  noticeBg: string
  /** 危险按钮描边(1px 墨框;悬停转实心墨底) */
  dangerBorder: string
  inputBg: string
  inputBorder: string
  /** 开关未选中轨道色 */
  switchTrack: string
  /** 开关未选中轨道悬浮色 */
  switchTrackHover: string
  /** 控件激活色:开关**选中**轨道、滑杆**已填充**段 */
  controlActive: string
  /** 控件激活色的悬浮态 */
  controlActiveHover: string
  /** 控件「柄」底色(开关滑块、滑杆拇指):与激活色**反相**,同色即柄消失 */
  controlKnobBg: string
  /** 滚动条滑块(悬浮显现);暗色下必须是浅色 */
  scrollThumb: string
  /** 静默填充(关闭钮、图标钮这类无描边小控件的静止底) */
  fillQuiet: string
  /** 静默填充的悬浮态 */
  fillQuietHover: string
  /**
   * 知识库语义色文字 —— v3.1 起**降为灰**(不再是绿)。
   * 保留令牌名是因为"知识库是一个语义"这件事没变,变的是它不再占一种颜色。
   */
  knowledgeText: string
  /** 知识库动作面(AI 整合行的软底)—— 同样降为中性浅底 */
  knowledgeSurface: string
  /** 知识库动作面的悬浮态 */
  knowledgeSurfaceHover: string
  /** **全站唯一的彩色**:标准回答的琥珀 #8a6a16 */
  goldenText: string
  /** 琥珀压在**反白底**上的提亮档(图标钮 hover 时底色转墨,琥珀要提亮才读得出) */
  goldenBright: string
  /** 琥珀软底(徽标底、星标钮悬浮底)—— 同一个琥珀的极淡一档 */
  goldenSurface: string
}

/** 浅色 — **纸白终端**:纯白纸 + 纯黑墨,灰阶表达层级,线三档定结构 */
export const lightTheme: ThemeTokens = {
  bg: '#ffffff',
  bgSecondary: '#f5f5f5',
  bgCard: '#ffffff',
  text: '#111111',
  textMuted: '#444444',
  textTertiary: '#777777',
  textFaint: '#9a9a9a',
  border: '#e5e5e5',
  borderLight: '#f0f0f0',
  separator: '#f0f0f0',
  borderStrong: '#111111',
  // 焦点环取纯黑:极客工具风里"当前在哪"是一个硬信号,不是品牌色时刻
  accent: '#111111',
  accentHover: '#333333',
  selectedBg: '#f5f5f5',
  rowHoverBg: '#fafaf8',
  rowHoverBar: '#111111',
  btnBg: '#ffffff',
  btnBorder: '#e5e5e5',
  btnHoverBg: '#f5f5f5',
  // 主按钮 = 反白(黑底白字)。本系统里权重最高的一档,
  // 与导航选中项、面板选中行共用同一种语言。悬浮**不变色**,走 opacity(见 §五.5)
  btnPrimaryBg: '#111111',
  btnPrimaryHover: '#111111',
  btnPrimaryText: '#ffffff',
  noticeBg: '#ececec',
  dangerBorder: '#111111',
  inputBg: '#ffffff',
  inputBorder: '#e5e5e5',
  switchTrack: '#c9c9c9',
  switchTrackHover: '#a8a8a8',
  controlActive: '#111111',
  controlActiveHover: '#333333',
  controlKnobBg: '#ffffff',
  scrollThumb: 'rgba(17,17,17,0.30)',
  fillQuiet: 'rgba(17,17,17,0.05)',
  fillQuietHover: 'rgba(17,17,17,0.12)',
  knowledgeText: '#777777',
  knowledgeSurface: '#f5f5f5',
  knowledgeSurfaceHover: '#ececec',
  goldenText: '#8a6a16',
  goldenBright: '#e2c56e',
  goldenSurface: 'rgba(138,106,22,0.10)',
}

/**
 * 深色 — **CRT 屏**:黑玻璃 + 白/灰荧光,与浅色逐项对调。
 *
 * 灰阶按**感知**重排而非简单 `255 - x`(后者会让中间灰在中段挤成一片):
 * 浅色 #444(正文)在黑底上对应 #b4b4b4,#777(次级说明)对应 #8f8f8f,#9a9a9a(元信息)对应 #6b6b6b。
 * 琥珀在近黑底上要提亮一档才读得出,但仍保持"暗琥珀"的油墨感(#c9a24a)。
 */
export const darkTheme: ThemeTokens = {
  bg: '#0d0d0d',
  bgSecondary: '#161616',
  bgCard: '#0d0d0d',
  text: '#f0f0f0',
  textMuted: '#b4b4b4',
  textTertiary: '#8f8f8f',
  textFaint: '#6b6b6b',
  border: '#2e2e2e',
  borderLight: '#1f1f1f',
  separator: '#1f1f1f',
  borderStrong: '#f0f0f0',
  accent: '#f0f0f0',
  accentHover: '#ffffff',
  selectedBg: '#1c1c1c',
  rowHoverBg: '#141414',
  rowHoverBar: '#f0f0f0',
  btnBg: '#161616',
  btnBorder: '#2e2e2e',
  btnHoverBg: '#1f1f1f',
  btnPrimaryBg: '#f0f0f0',
  btnPrimaryHover: '#f0f0f0',
  btnPrimaryText: '#0d0d0d',
  noticeBg: '#242424',
  dangerBorder: '#f0f0f0',
  inputBg: '#161616',
  inputBorder: '#2e2e2e',
  switchTrack: '#3a3a3a',
  switchTrackHover: '#4d4d4d',
  controlActive: '#f0f0f0',
  controlActiveHover: '#ffffff',
  controlKnobBg: '#0d0d0d',
  scrollThumb: 'rgba(240,240,240,0.30)',
  fillQuiet: 'rgba(240,240,240,0.08)',
  fillQuietHover: 'rgba(240,240,240,0.16)',
  knowledgeText: '#8f8f8f',
  knowledgeSurface: '#1c1c1c',
  knowledgeSurfaceHover: '#242424',
  goldenText: '#c9a24a',
  goldenBright: '#e2c56e',
  goldenSurface: 'rgba(201,162,74,0.14)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
