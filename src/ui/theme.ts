/**
 * 主题令牌 — v5.1「石墨蓝灰」。
 *
 * ── 与 v5.0「暖纸」的关系:只换色板,结构一行没动 ──────────────────────────
 *
 * v5.0 立起来的结构 —— 浮动图标栏 + 主面板、分区标题在卡外、每行一张卡、
 * 6px 行距、四档圆角 —— 全部保留。本次只把"暖"换成"冷":
 *
 * ① **暖米白 + 赭陶 → 冷石墨 + 靛蓝。**
 *    动机不是审美疲劳,是使用场景:客服一天要开合这个 popup 几百次,
 *    暖橙占的面积虽小,但每一次"当前项"都在抢注意力。冷灰蓝把强调色的
 *    心理音量压下去,同时保留"一眼看到在哪一页"的对比度(焦点环 ≥ 3:1)。
 *    代价:v5.0 文件头里"整套转暖、不混暖冷"那条纪律作废 —— 本版**整套转冷**,
 *    "不混用"本身仍然成立,别再往里掺暖色。
 *
 * ② **结构不变(`surface` 仍然存在)。**
 *    这里记着 v4.0 的教训:「只有一个面」在 v5.0 被推翻是因为"每行一张卡"
 *    需要卡片面。⚠️ 如果将来又想退回连续列表,删掉 `surface` 会牵动
 *    popup-css 的行/卡两条规则,不是删一个变量就完事。
 *
 * ③ **「三级文字过 AA」照旧,而且仍是逼出来的值。**
 *    取值按 4.5:1 反解,不是挑的好看颜色:
 *      - `textTertiary` 必须 ≥ 4.5:1 **同时**压在页底、卡片面与控件面上;
 *      - `textSecondary` 被迫停在 7.04:1 —— 因为 `theme-contrast.test.ts`
 *        还要求二级与三级之间拉开 ≥ 1.5。
 *        **改任何一个都要重跑那组断言**,别凭手感调。
 *
 * ── 四个强调色令牌各司其职,不要互相顶替 ──────────────────────────────────
 *   - `accent`      实心填充用(主按钮底、开关选中、滑杆已选段)
 *   - `onAccent`    压在 accent 上的字
 *   - `accentText`  强调色**当文字**用(灰标、当前项文字、数值)
 *   - `accentSoft`  强调色的软底(当前项底、徽章底、整合行动作卡)
 *
 * 浅色下 `accent` 与 `accentText` **必须是两个值**:实心底要够浅才压得住白字(6.04:1),
 * 而当文字要够深才压得住软底(7.05:1)。同一个值做两件事,必有一头不达标 ——
 * 这是算出来的,不是设计偏好。深色下两者可以合一(见 darkTheme 注释)。
 */
export type ThemeMode = 'light' | 'dark'

export interface ThemeTokens {
  /** 页面底 —— 冷灰纸。卡片与行浮在它上面 */
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
   * 要求 ≥ 4.5:1。该值对**页底、卡片面与控件面同时**满足,
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
   * 全屏每处悬浮都泛靛蓝色会让强调色失效(强调色一旦到处都是,就不再强调)。
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
   * 推荐回复面板按来源给三个色:标准回答 = `accentText`(靛蓝)、知识库 = 本令牌、
   * 历史 = `textTertiary`(中性灰)。绿不是为了装饰 —— 三类标签并排时,颜色比
   * 逐字读「标准回答 / 知识库 / 历史」快得多。取值同样受 4.5:1 约束。
   */
  infoText: string
  /** 知识库标签的矩形底色,与 `infoText` 成对使用 */
  infoSoft: string

  /** 错误 / 危险。与 accent 分属冷暖两族,靠 dangerSoft 与字重再拉开一档(见对比度测试) */
  danger: string
  /** 危险软底(提示条、失败行) */
  dangerSoft: string

  /** 滚动条滑块 */
  scrollThumb: string
}

/**
 * 浅色 —— 石墨蓝灰。
 *
 * 层级链(全部是实测值,不是估计):主 14.28 / 二级 7.04 / 三级 4.59 / 禁用 ~2.4。
 * 三级那 4.59 是**下限附近**的取值 —— 再浅一格就跌破 AA。
 */
export const lightTheme: ThemeTokens = {
  bg: '#ECEDEF',
  surface: '#FFFFFF',
  fill: '#F3F4F6',

  text: '#1B1E22',
  // 7.04:1。不是"好看的深灰",是被三级(4.59)和"级差 ≥1.5"两条一起逼出来的
  textSecondary: '#4A4F57',
  // 4.59:1(页底)/ 5.38:1(卡片面)/ 4.89:1(控件面)。三处都必须在线上
  textTertiary: '#656B73',
  textDisabled: '#9AA0A7',

  separator: '#DEE0E4',
  border: '#D1D4D9',

  selection: '#E7E9EC',

  // 近黑而非纯黑:按下/悬浮还要有"再深一点"的余地
  ink: '#1B1E22',
  onInk: '#F8FAFC',

  accent: '#2F5FA8',
  // 6.04:1 于 accent 实心底上 —— 与 accentText 分家,见文件头
  onAccent: '#F8FAFD',
  // 7.05:1 于 accentSoft 上、8.22:1 于白卡上
  accentText: '#274E8C',
  accentSoft: '#E8EEF8',

  // 6.08:1 于白卡、5.48:1 于页底 —— 只用作 12px 标签文字
  infoText: '#2F6B4A',
  infoSoft: '#E6F0E9',

  danger: '#A0342A',
  dangerSoft: '#FAEAE7',

  scrollThumb: 'rgba(27,30,34,0.24)',
}

/**
 * 深色 —— 石墨。
 *
 * 不是浅色反相,而是同一套规则换一组取值:底面石墨黑、`ink` 翻成冷白、
 * `accent` 提亮到能在暗底上做文字(5.63:1 于卡面)。于是所有"实心块 + 反相字"的部件
 * 自动成立,不必为主题写分支。
 *
 * 注意 `accentText` 与 `accent` **在深色下取值相同**:暗底上强调色本来就够亮,
 * 做填充(要压深色字)与做文字(要压暗底)都够格,不必再分两档 ——
 * 浅色下分家是**被对比度逼的**,不是为了对称。
 */
export const darkTheme: ThemeTokens = {
  bg: '#16181B',
  surface: '#1E2126',
  fill: '#262A30',

  text: '#E9EBEE',
  textSecondary: '#AFB4BC',
  // 5.53:1(页底)/ 5.02:1(卡片面)
  textTertiary: '#8A9099',
  textDisabled: '#5F666E',

  separator: '#2C3036',
  border: '#3A3F46',

  selection: '#2B3037',

  ink: '#E9EBEE',
  onInk: '#16181B',

  accent: '#6C9BD8',
  // 6.39:1 于 accent 上
  onAccent: '#10151C',
  accentText: '#6C9BD8',
  accentSoft: '#1E2938',

  // 7.05:1 于 infoSoft 上 —— 暗底上提亮一档
  infoText: '#93C2A1',
  infoSoft: '#22302A',

  danger: '#E08B80',
  dangerSoft: '#3A2320',

  scrollThumb: 'rgba(233,235,238,0.28)',
}

export function getThemeTokens(theme: ThemeMode): ThemeTokens {
  return theme === 'dark' ? darkTheme : lightTheme
}
