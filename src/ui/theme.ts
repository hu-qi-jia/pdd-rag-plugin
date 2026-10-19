/**
 * 主题令牌 — v5.0「暖纸」。
 *
 * ── 与 v4.0「无彩黑灰白」的关系:这是一次**有意的反悔** ────────────────────
 *
 * v4.0 写了三条纪律,本版推翻了其中两条,第三条(对比度)反而被强化。
 * 逐条交代,免得后来者以为是随手改的:
 *
 * ① **「一套中性,不掺温度」→ 改成整套暖调。**
 *    v4.0 的理由是"不出现暖灰与冷灰混用"。本版不再混用 —— 是**全部转暖**,
 *    混用那条纪律仍然成立。动机是把 UI 从"工具感"往"纸感"挪:客服一天要开合
 *    这个 popup 几百次,纯白面在亮环境下眩光明显。代价是**层阶预算被吃掉**
 *    (见第 ③ 条)。
 *
 * ② **「只有一个面,没有 surface」→ 重新引入 `surface`。**
 *    v4.0 当时的理由记着用户原话:「由一个一个块组成,有点奇怪」。
 *    那是针对 v3.0 的 **iOS inset grouped**(灰底 + 白卡,每组独立)。
 *    本版走的是**另一种**分块:v3.0 是"分组的卡片",本版是"每一行一张卡",
 *    行距 6px、无分组、无 inset —— 用户看过第六十七轮设计稿后确认要这个。
 *    ⚠️ 如果将来又想退回连续列表,删掉 `surface` 会牵动 popup-css 的行/卡两条规则,
 *    不是删一个变量就完事。
 *
 * ③ **「三级文字过 AA」→ 保留,而且更严。**
 *    暖底把这一条逼到了极限:米白底 `#F1EEE8` 亮度只有 0.857(白面是 1.0),
 *    留给定级灰度对比的空间更少。取值是按 4.5:1 反解出来的,不是挑的好看颜色:
 *      - `textTertiary` 必须 ≥ 4.5:1 **同时**压在页底与卡片面上(两处都要过);
 *      - 于是 `textSecondary` 被迫下探到 7.57:1 —— 因为
 *        `theme-contrast.test.ts` 还要求二级与三级之间拉开 ≥ 1.5。
 *        **改任何一个都要重跑那组断言**,别凭手感调。
 *
 * ── 新增的四个强调色令牌 ──────────────────────────────────────────────────
 * v4.0 **没有**强调色(只有 danger 是彩色的)。本版引入赭陶一系,四个令牌各司其职,
 * 不要互相顶替:
 *   - `accent`      实心填充用(主按钮底、开关选中、滑杆已选段)
 *   - `onAccent`    压在 accent 上的字
 *   - `accentText`  强调色**当文字**用(灰标、当前项文字、数值)
 *   - `accentSoft`  强调色的软底(当前项底、徽章底、整合行动作卡)
 *
 * `accent` 与 `accentText` **必须是两个值**:实心底要够浅才压得住白字(4.61:1),
 * 而当文字要够深才压得住软底(5.92:1)。同一个值做两件事,必有一头不达标 ——
 * 这是本版算出来的,不是设计偏好。
 */
export type ThemeMode = 'light' | 'dark'

export interface ThemeTokens {
  /** 页面底 —— 暖米白纸。卡片与行浮在它上面 */
  bg: string
  /**
   * **卡片 / 行 / 主面板**的底色。
   * 比页底亮一档(浅色下是纯白),1.16:1 的面差 —— 不靠阴影就能读出"这是一张卡"。
   */
  surface: string
  /** 控件底(按钮、搜索框、分类 chip)与行悬浮底 */
  fill: string

  /** 主文本 */
  text: string
  /** 次级文本:说明、回复正文 */
  textSecondary: string
  /**
   * 三级文本:元信息、计数、时间戳、占位。
   *
   * **取值受对比度约束,不是纯手感**:这一档承载的全是 12px 小字,WCAG AA
   * 要求 ≥ 4.5:1。暖底比白底更难达标 —— 该值对**页底与卡片面同时**满足,
   * 见 `theme-contrast.test.ts`。改前请先跑那组断言。
   */
  textTertiary: string
  /** 禁用态文字 */
  textDisabled: string

  /**
   * 卡**内**的分隔线(如展开区里逐条回复之间)。卡与卡之间不用线,用 6px 行距。
   */
  separator: string
  /** 卡片描边与控件描边 */
  border: string

  /**
   * 中性选中底 / 悬浮底。
   *
   * 刻意**不**用 `accentSoft` —— 悬浮是"手滑过",不是"这里被选中了"。
   * 全屏每处悬浮都泛赭陶色会让强调色失效(强调色一旦到处都是,就不再强调)。
   */
  selection: string

  /** 实心块(聊天页 toast、焦点环兜底)。v4.0 的主钮/导航当前项已改走 accent */
  ink: string
  /** 压在 `ink` 之上的字色。**必须与 ink 反相**,同色即字消失 */
  onInk: string

  /** 强调色 —— **实心填充**:主按钮底、开关选中轨、滑杆已选段 */
  accent: string
  /** 压在 `accent` 上的字 */
  onAccent: string
  /** 强调色**当文字**用:灰标、当前项文字、设置页数值。比 accent 更深 */
  accentText: string
  /** 强调色的软底:分类 chip 选中、标准回答徽章、AI 整合行 */
  accentSoft: string

  /**
   * 「知识库」来源标签的文字色(绿)。
   *
   * 推荐回复面板按来源给三个色:标准回答 = `accentText`(赭陶)、知识库 = 本令牌、
   * 历史 = `textTertiary`(中性灰)。绿不是为了装饰 —— 三类标签并排时,颜色比
   * 逐字读「标准回答 / 知识库 / 历史」快得多。取值同样受 4.5:1 约束。
   */
  infoText: string
  /** 知识库标签的矩形底色,与 `infoText` 成对使用 */
  infoSoft: string

  /** 错误 / 危险。与 accent 同为暖色,故字重与底色都要拉开(见对比度测试) */
  danger: string
  /** 危险软底(提示条、失败行) */
  dangerSoft: string

  /** 滚动条滑块 */
  scrollThumb: string
}

/**
 * 浅色 —— 暖纸。
 *
 * 层级链(全部是实测值,不是估计):主 12.66 / 二级 7.57 / 三级 4.98 / 禁用 2.65。
 * 三级那 4.98 是**下限附近**的取值 —— 再浅一格就跌破 AA。
 */
export const lightTheme: ThemeTokens = {
  bg: '#F1EEE8',
  surface: '#FFFFFF',
  fill: '#F5F1EA',

  text: '#2B2825',
  // 7.57:1。不是"好看的深灰",是被三级(4.98)和"级差 ≥1.5"两条一起逼出来的
  textSecondary: '#4F4A44',
  // 4.98:1(页底)/ 5.77:1(卡片面)。两项都必须在线上
  textTertiary: '#6B655C',
  textDisabled: '#9B9285',

  separator: '#E8E2D6',
  border: '#DCD4C6',

  selection: '#EFE9E0',

  // 近黑而非纯黑:按下/悬浮还要有"再深一点"的余地
  ink: '#2B2825',
  onInk: '#FBF8F5',

  accent: '#B4553A',
  // 4.61:1 于 accent 实心底上 —— 与 accentText 分家,见文件头
  onAccent: '#FBF8F5',
  // 5.92:1 于 accentSoft 上、6.92:1 于白卡上
  accentText: '#93412C',
  accentSoft: '#F7EBE5',

  // 6.08:1 于白卡、5.48:1 于页底 —— 只用作 12px 标签文字
  infoText: '#356B4A',
  infoSoft: '#E7F0E9',

  danger: '#A0342A',
  dangerSoft: '#FAEAE7',

  scrollThumb: 'rgba(43,40,37,0.24)',
}

/**
 * 深色 —— 暖褐。
 *
 * 不是浅色反相,而是同一套规则换一组取值:底面暖黑、`ink` 翻成暖白、
 * `accent` 提亮到能在暗底上做文字(6.20:1)。于是所有"实心块 + 反相字"的部件
 * 自动成立,不必为主题写分支。
 *
 * 注意 `accentText` 与 `accent` **在深色下取值相同**:暗底上强调色本来就够亮,
 * 做填充(要压深色字)与做文字(要压暗底)都够格,不必再分两档 ——
 * 浅色下分家是**被对比度逼的**,不是为了对称。
 */
export const darkTheme: ThemeTokens = {
  bg: '#1A1714',
  surface: '#232019',
  fill: '#2B2721',

  text: '#F2EDE4',
  textSecondary: '#B5AC9E',
  // 5.33:1(页底)/ 4.85:1(卡片面)。暗底上卡片反而更亮,故卡面才是卡口
  textTertiary: '#958B7D',
  textDisabled: '#5C554B',

  separator: '#332E27',
  border: '#423B31',

  selection: '#332C25',

  ink: '#F2EDE4',
  onInk: '#1A1714',

  accent: '#E08A6B',
  // 6.53:1 于 accent 上
  onAccent: '#2A1710',
  accentText: '#E08A6B',
  accentSoft: '#2E211B',

  // 8.06:1 于面板面 —— 暗底上提亮一档,与琥珀、灰都拉得开
  infoText: '#93C2A1',
  infoSoft: '#22302A',

  danger: '#E08A80',
  dangerSoft: '#3A2320',

  scrollThumb: 'rgba(242,237,228,0.28)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
