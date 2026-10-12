/** 主题模式;定义在令牌层(theme),上下文与覆盖层共用,避免 UI 层互相倒挂 */
export type ThemeMode = 'light' | 'dark'

/**
 * 设计令牌 — **复古极简主义 + 极客工具风**(v3.0)。
 *
 * 两套主题是**同一张版面的正片与负片**,不是两种风格:
 *   - 浅色 = **纸白终端**(打印出来的清单):纯白纸 + 纯黑墨,层级靠灰阶;
 *   - 深色 = **CRT 屏**:底与字整体对调,结构线由黑转白,灰阶同步反相。
 * 两边的几何、字号、间距**完全共用**(design.ts),切换主题只有颜色在换 ——
 * 这是"两边都是纯黑白灰"这条口径的直接后果:没有哪一色需要在暗底下重新调色相。
 *
 * 三条硬约束:
 *  1. **近似无色** —— 全部中性灰阶。唯一的彩色是两枚**印刷油墨级**语义色
 *     (`goldenText` 暗琥珀 / `knowledgeText` 暗墨绿),它们只出现在徽标与 AI 整合行上,
 *     作为"这是什么"的功能信号;任何装饰性用色都属违规。
 *  2. **灰阶即层级** —— 文本三档(text / textMuted / textTertiary)、线三档
 *     (`borderStrong` 结构线 / `border` 描边 / `borderLight` 行线)各自单点决定,
 *     页面不得另取中间值。
 *  3. **无阴影、无模糊、无渐变** —— 本接口**不再有** `shadow` / `surfaceOverlay` 令牌。
 *     浮层与页面之间那条边由 `borderStrong` 的 1px 实线给出,不靠投影。
 *     (旧版的毛玻璃材料令牌随 v3.0 整体删除;若将来要恢复材质,先读 docs/DESIGN.md §二。)
 */
export interface ThemeTokens {
  bg: string
  bgSecondary: string
  bgCard: string
  text: string
  textMuted: string
  textTertiary: string
  /** 控件与分区的常规描边(按钮、输入框、分区线) */
  border: string
  /** 行分隔细线(比 border 再浅一档:同一屏里几十条,不能和控件描边一样重) */
  borderLight: string
  /** 结构分隔线(当前与 borderLight 同值;保留令牌名以免调用点散落两处口径) */
  separator: string
  /**
   * **结构硬线**(v3.0 新增):窗口外框、导航栏右缘、页面标题下缘、分区标题下缘。
   *
   * 这是本设计语言里唯一的"重线",浅色下是纯黑、深色下是纯白。它与 `border` / `borderLight`
   * 构成**三档线重**,而线重本身就是层级信息 —— 读到一根黑线就知道"这里换了另一件事",
   * 不必再靠留白或盒子来表达从属关系。用错档位(比如给行分隔线取 strong)会让整屏噪起来。
   */
  borderStrong: string
  accent: string
  accentHover: string
  /** 列表/面板行选中底色(中性灰软底) */
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
  /** 危险钮悬浮底色(比 errorBg 深一档) */
  errorHoverBg: string
  errorText: string
  inputBg: string
  inputBorder: string
  /** 开关未选中轨道色(比 inputBorder 深一档,可辨但不抢眼) */
  switchTrack: string
  /** 开关未选中轨道悬浮色 */
  switchTrackHover: string
  /** 控件激活色:开关**选中**轨道、滑杆**已填充**段 */
  controlActive: string
  /** 控件激活色的悬浮态 */
  controlActiveHover: string
  /**
   * 控件「柄」底色(开关滑块、滑杆拇指):与激活色**反相**取色 ——
   * 浅色白柄压在黑轨道上、深色黑柄压在白轨道上。
   * 反相是硬约束而非审美选择:柄与轨道同色即柄消失。
   */
  controlKnobBg: string
  /** 滚动条滑块(悬浮显现);暗色下必须是浅色,否则在深底上不可见 */
  scrollThumb: string
  /** 静默填充(关闭钮、图标钮这类无描边小控件的静止底) */
  fillQuiet: string
  /** 静默填充的悬浮态(同上,提亮一档) */
  fillQuietHover: string
  /** 知识库语义色文字(暗墨绿)—— 徽标、AI 整合行动作名、成功态 */
  knowledgeText: string
  /** 知识库语义色软底(AI 整合行的动作面、知识库徽标底) */
  knowledgeSurface: string
  /** 知识库动作面的悬浮态(同色加深一档) */
  knowledgeSurfaceHover: string
  /** 标准回答语义色文字(暗琥珀)—— 金色徽标、已设标准回答的星标 */
  goldenText: string
  /** 标准回答语义色软底(徽标底、星标钮悬浮底) */
  goldenSurface: string
}

/** 浅色 — **纸白终端**:纯白纸 + 纯黑墨,灰阶表达层级,线三档定结构 */
export const lightTheme: ThemeTokens = {
  bg: '#ffffff',
  bgSecondary: '#f2f2f2',
  bgCard: '#ffffff',
  text: '#0a0a0a',
  textMuted: '#4f4f4f',
  textTertiary: '#8a8a8a',
  border: '#bfbfbf',
  borderLight: '#e2e2e2',
  separator: '#e2e2e2',
  borderStrong: '#0a0a0a',
  // 焦点环取纯黑:极客工具风里"当前在哪"是一个硬信号,不是品牌色时刻。
  // (旧版这里是 Figma 蓝 —— 彩色焦点环与"近似无色"直接冲突)
  accent: '#0a0a0a',
  accentHover: '#3d3d3d',
  selectedBg: 'rgba(10,10,10,0.08)',
  btnBg: '#ffffff',
  btnBorder: '#bfbfbf',
  btnHoverBg: '#ededed',
  // 主按钮 = 反白(纯黑底白字)。这是本设计语言里"权重最高"的一档,
  // 与导航栏选中项、面板选中行共用同一种反白语言。
  btnPrimaryBg: '#0a0a0a',
  btnPrimaryHover: '#2e2e2e',
  btnPrimaryText: '#ffffff',
  successBg: 'rgba(47,107,60,0.10)',
  successText: '#2f6b3c',
  // 0.10 而非 0.08:失败面要**比知识库动作面(0.09)更实** —— 失败是更少见、更需要被注意的状态,
  // 底色比那个常驻的绿还淡就说不过去了(这条有单测盯着,见 overlay-css.test「失败态」)
  errorBg: 'rgba(163,34,34,0.10)',
  errorHoverBg: 'rgba(163,34,34,0.18)',
  // 危险色取"印刷红"而非荧光橙红(#F24822):高饱和的橙红在白纸上是个墨点,
  // 会把整屏的黑白灰节奏打断。深砖红同样"一眼是错误",但不抢戏。
  errorText: '#a32222',
  inputBg: '#ffffff',
  inputBorder: '#bfbfbf',
  switchTrack: '#c9c9c9',
  switchTrackHover: '#a8a8a8',
  controlActive: '#0a0a0a',
  controlActiveHover: '#2e2e2e',
  controlKnobBg: '#ffffff',
  scrollThumb: 'rgba(10,10,10,0.30)',
  fillQuiet: 'rgba(10,10,10,0.06)',
  fillQuietHover: 'rgba(10,10,10,0.14)',
  knowledgeText: '#2f6b3c',
  knowledgeSurface: 'rgba(47,107,60,0.09)',
  knowledgeSurfaceHover: 'rgba(47,107,60,0.17)',
  goldenText: '#8a6a16',
  goldenSurface: 'rgba(138,106,22,0.10)',
}

/**
 * 深色 — **CRT 屏**:黑玻璃 + 白/灰荧光,与浅色逐项对调。
 *
 * 灰阶的取法不是简单 `255 - x`(那会让中间灰在中段挤成一片),而是**按感知重排**:
 * 浅色的 #4f4f4f(次级文本)在黑底上对应的亮度档是 #a8a8a8,#8a8a8a(辅助)对应 #6e6e6e。
 * 线三档同样重排:结构线由纯黑翻为纯白(#ededed 而非 #ffffff,纯白线在近黑底上会发光),
 * 描边 #3a3a3a,行线 #242424。
 */
export const darkTheme: ThemeTokens = {
  bg: '#0a0a0a',
  bgSecondary: '#151515',
  bgCard: '#101010',
  text: '#ededed',
  textMuted: '#a8a8a8',
  textTertiary: '#6e6e6e',
  border: '#3a3a3a',
  borderLight: '#242424',
  separator: '#242424',
  borderStrong: '#ededed',
  accent: '#ededed',
  accentHover: '#ffffff',
  selectedBg: 'rgba(237,237,237,0.12)',
  btnBg: '#141414',
  btnBorder: '#3a3a3a',
  btnHoverBg: '#212121',
  // 深色下主按钮同样**反白**,方向与浅色相反:浅色黑底白字 → 深色白底黑字。
  // 两主题彼此是正负片,但"主按钮 = 最高权重 = 反白"这条映射完全同构,切换不跳色。
  btnPrimaryBg: '#ededed',
  btnPrimaryHover: '#ffffff',
  btnPrimaryText: '#0a0a0a',
  successBg: 'rgba(108,174,128,0.16)',
  successText: '#6cae80',
  errorBg: 'rgba(208,135,135,0.18)',
  errorHoverBg: 'rgba(208,135,135,0.28)',
  // 深砖红在近黑底上不可读,反相为"褪色红"—— 保持"这是错误"的语义,不提饱和
  errorText: '#d08787',
  inputBg: '#141414',
  inputBorder: '#3a3a3a',
  switchTrack: '#3a3a3a',
  switchTrackHover: '#4d4d4d',
  controlActive: '#ededed',
  controlActiveHover: '#ffffff',
  controlKnobBg: '#0a0a0a',
  scrollThumb: 'rgba(237,237,237,0.30)',
  fillQuiet: 'rgba(237,237,237,0.10)',
  fillQuietHover: 'rgba(237,237,237,0.20)',
  knowledgeText: '#6cae80',
  knowledgeSurface: 'rgba(108,174,128,0.16)',
  knowledgeSurfaceHover: 'rgba(108,174,128,0.26)',
  goldenText: '#c2a24a',
  goldenSurface: 'rgba(194,162,74,0.16)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
