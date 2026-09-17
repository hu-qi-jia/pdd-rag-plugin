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
  /**
   * 控件激活色:开关**选中**轨道、滑杆**已填充**段
   * (2026-09-16 第四十一轮用户"将开关组件和滑动条组件的颜色修改为灰色和白色")——
   * 浅色 = 中性深灰(与主按钮同值 #45484D),深色 = 白;原为 accent 蓝,
   * 自此 accent 在控件里只留给焦点环("蓝只做状态不做大色块"的既定口径)。
   */
  controlActive: string
  /** 控件激活色的悬浮态:浅色再提亮一档;深色已是纯白,反向压暗一档 —— 方向不同,同样"悬浮有反馈" */
  controlActiveHover: string
  /**
   * 控件「柄」底色(开关滑块、滑杆拇指):与激活色**反相**取色 ——
   * 浅色白柄压在深灰轨道上、深色深灰柄压在白轨道上。
   * 反相是硬约束而非审美选择:柄与轨道同色即柄消失(深色下"白轨白柄"是已踩过的坑)。
   */
  controlKnobBg: string
  shadow: string
  /** 滚动条滑块(悬浮显现);暗色下必须是浅色,否则在深底上不可见 */
  scrollThumb: string
  /**
   * 浮层材料底色(v2.7.0 第四十九轮)—— 聊天页推荐面板的**半透明**底,
   * 与 `bg` 的区别是"要不要让平台页透过 `backdrop-filter` 的模糊参与成像"。
   *
   * 两条硬约束:
   *  - **不透明度 ≥ 0.75**:再低就是"看得见后面文字"的半透明(用户反馈过的观感),
   *    材料感来自模糊半径,不靠把面板做虚;
   *  - **只给浮层用**,popup 是原生窗口、没有"后面",用它是白费一层合成。
   *  引擎不支持 backdrop-filter 时退回 `bg`(判断在 overlay-css#panelSurface,单点)。
   */
  surfaceOverlay: string
  /** 静默填充(关闭钮、图标钮这类无描边小控件的静止底;比 selectedBg 再轻一档) */
  fillQuiet: string
  /** 静默填充的悬浮态(同上,提亮一档) */
  fillQuietHover: string
  /**
   * 知识库绿的动作面(推荐面板「根据知识库内容整合并回复」整行的底色)。
   *
   * 为什么不直接用 `semantic.knowledgeBg`:那是**压在实心面上**的软底(白 popup、白卡片),
   * 一个固定 alpha 就够。而这一行现在压在**浮层材料**上 —— 材料本身是半透明的,
   * 深色主题下合成出来是中灰而非近黑,同一份 9% 绿在中灰上只剩一点色偏,
   * "这是本面板唯一的动作"这条就立不住了。故按主题各给一档:
   * 浅色与 `semantic.knowledgeBg` 同值(白面上原样可用),深色提到能一眼看出是绿。
   */
  knowledgeSurface: string
  /** 知识库动作面的悬浮态(同色加深一档) */
  knowledgeSurfaceHover: string
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
  // v2.6.28(第四十一轮)开关/滑杆改灰白:激活色 = 中性深灰(与主钮同值),柄 = 白
  controlActive: '#45484d',
  controlActiveHover: '#53565b',
  controlKnobBg: '#ffffff',
  // v2.6.16(第二十五轮):柔和双层阴影(近影定轮廓 + 环境影托浮起),ChatGPT 式"轻浮层"。
  // v2.6.32 起**仅聊天页推荐面板(overlay-css)使用**:popup 是原生窗口,挂阴影只会在
  // 24px 圆角切出的四角露出一圈渐变(见 DESIGN §九),popup 不再消费本令牌。
  // v2.7.0(第四十九轮):改"0.5px 亮环 + 近影 + 大范围环境影"三段 —— 毛玻璃面板没有描边,
  // 那圈 0.5px 环就是它与页面之间唯一的一条硬边(Apple 浮层的做法)
  shadow: '0 0 0 0.5px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.16)',
  // v2.7.0(第四十九轮)浮层材料:#fcfcfc 的 0.8 —— 面板不再是"一块白",而是让平台页
  // 透过 blur(20px) 参与成像的磨砂面。0.8 是本主题"不透明度 ≥ 0.75"下限之上留的余量
  surfaceOverlay: 'rgba(252,252,252,0.80)',
  fillQuiet: 'rgba(0,0,0,0.05)',
  fillQuietHover: 'rgba(0,0,0,0.10)',
  // 浅色与 semantic.knowledgeBg 同值 —— 白面上的那一档本来就没问题,换的是"谁来决定"
  knowledgeSurface: 'rgba(20,174,92,0.09)',
  knowledgeSurfaceHover: 'rgba(20,174,92,0.16)',
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
  // v2.6.28(第四十一轮)开关/滑杆改灰白:激活色 = 白(与浅色主题反相),柄 = 卡片面色系深灰
  // (#2c2c2c 比未选中轨道 rgba(255,255,255,.16)→≈#4e4e4e 更暗,未选中态也能看清柄;
  //  若改白,白柄压白轨 = 柄消失)
  controlActive: '#ffffff',
  controlActiveHover: '#e3e5e9',
  controlKnobBg: '#2c2c2c',
  // 与浅色同构的"亮环 → 近影 → 环境影"三段,仅加大不透明度保深底可辨;
  // 深底上的环取**白**而非黑 —— 黑环在深色页面上等于没画
  shadow:
    '0 0 0 0.5px rgba(255,255,255,0.10), 0 2px 8px rgba(0,0,0,0.40), 0 12px 40px rgba(0,0,0,0.55)',
  // 深色材料:Apple 深色浮层的 #1c1c1e,0.78(同样守住"不透明度 ≥ 0.75"下限)
  surfaceOverlay: 'rgba(28,28,30,0.78)',
  fillQuiet: 'rgba(255,255,255,0.10)',
  fillQuietHover: 'rgba(255,255,255,0.18)',
  // 深色面板压在浅色平台页上合成出的是**中灰**(0.78×28 + 0.22×255 ≈ 78),不是近黑 ——
  // 9% 的绿到那上面只剩一点色偏,故提亮到 0.22 / 悬浮 0.30
  knowledgeSurface: 'rgba(20,174,92,0.22)',
  knowledgeSurfaceHover: 'rgba(20,174,92,0.30)',
  scrollThumb: 'rgba(255,255,255,0.24)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
