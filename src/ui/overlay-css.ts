/**
 * 聊天页覆盖层主题(2026-09-15 评审 设计1):
 * pdd-ai-button 的覆盖层 CSS 原先在模块顶用 `lightTheme as tk` 一次定格,
 * popup 里切深色后聊天页面板仍是白的。现把 CSS 抽成按 ThemeTokens 生成的纯函数,
 * 内容脚本负责读 chrome.storage(pddcs:theme)+ onChanged 实时重建。
 * 本模块保持纯逻辑(不触碰 chrome/DOM),供内容脚本与单测共用。
 * (2026-09-16 工程审查③-V2:自 utils/ 迁入 ui/,与令牌/尺寸/滚动条同层)
 */
import type { ThemeMode, ThemeTokens } from './theme'
import { controlH, fontFamily, fontSize, radius, semantic, spacing } from './design'
import { thinScrollbarCss } from './scrollbar'
import { ICON_BTN_SIZE } from './overlay-icons'

/** 与 popup 主题上下文(theme-context)共用的存储键 */
export const THEME_STORAGE_KEY = 'pddcs:theme'

/** 存储值容错解析:非法/缺失一律回退浅色 */
export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

/** 候选弹窗宽度(CSS 与 JS 定位共用,单处维护;v2.6.18 340→360,给 13.5px 中文正文松一档) */
export const POPUP_W = 360

/**
 * 类别徽标的水平内边距(v2.6.24 放大时定档 9px)。
 * 下方「原问题 / 回答正文」的左缩进**复用同一数字** —— 于是
 * 「标签**文字**左缘 = 原问题文字左缘 = 回答文字左缘」这条对齐基线
 * 由这一个常量单点决定(v2.6.26 用户定稿:对齐标签文字,而非徽标外框)。
 */
export const BADGE_PAD_X = 9

export function buildOverlayCss(tk: ThemeTokens): string {
  return `
#pddcs-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
  font-family: ${fontFamily}; }

/* AI回复按钮 — 与 popup 的 .pddcs-btn 同档工具风控件
   (26px 高 / 6px 圆角 / 12.5px 字号:2026-09-15 用户反馈原 20px 偏小,与整体设计脱节)
   box-sizing 显式声明:本样式注入平台页面,不享受 popup 的全局 border-box 重置 */
.pddcs-ai-btn { position: fixed; box-sizing: border-box; height: ${controlH.form}px;
  border-radius: ${radius.md}px; border: 1px solid ${tk.btnBorder};
  cursor: pointer; pointer-events: auto; padding: 0 ${spacing.xl}px; display: inline-flex; align-items: center;
  background: ${tk.btnBg}; color: ${tk.text}; font-size: ${fontSize.body}px; font-weight: 500; line-height: 1;
  letter-spacing: -0.01em; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: background-color .12s ease, color .12s ease, border-color .12s ease; }
.pddcs-ai-btn:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; border-color: ${tk.textTertiary}; }
.pddcs-ai-btn:active { background: ${tk.border}; }
.pddcs-ai-btn .pddcs-ai-btn-label { white-space: nowrap; }
.pddcs-ai-btn:disabled { opacity: .55; cursor: wait; }

/* 候选弹窗(v2.6.18 重设计):三段式浮层壳 —— 头/页脚常驻成"外壳",中段 body 是唯一滚动区;
   overflow: hidden 负责把 body 的滚动条裁进圆角;opacity 显式 1(第二十三轮防页面样式干扰,
   背景另行内联双保险);入场 160ms 淡入上移 */
.pddcs-popup { position: fixed; width: ${POPUP_W}px; max-height: min(62vh, calc(100vh - 16px));
  display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: ${tk.bg}; border: 1px solid ${tk.border}; border-radius: ${radius.xl}px;
  box-shadow: ${tk.shadow}; opacity: 1;
  font-size: ${fontSize.body}px; color: ${tk.text};
  animation: pddcs-pop-in .16s cubic-bezier(0.2, 0, 0, 1); }
@keyframes pddcs-pop-in { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .pddcs-popup { animation: none; } }
${thinScrollbarCss('.pddcs-popup-body', tk.scrollThumb)}
/* 头部常驻壳(字号极简口径 v2.6.17 不变;sticky 取消 —— 头已移出滚动视口,不再遮挡行) */
.pddcs-popup-head { display: flex; align-items: center; flex: 0 0 auto; padding: 10px 14px 9px;
  border-bottom: 1px solid ${tk.borderLight}; font-weight: 600; font-size: ${fontSize.body}px;
  color: ${tk.textMuted}; letter-spacing: -0.01em; }
/* 滚动中段:唯一滚动容器(6px 细轨挂此);上下贴边 2/4→1/3px(v2.6.24 与行距一并收紧) */
.pddcs-popup-body { flex: 1 1 auto; overflow-y: auto; padding: 1px 0 3px; }
.pddcs-popup-close { margin-left: auto; border: none; background: none; cursor: pointer;
  width: 24px; height: 24px; border-radius: ${radius.sm}px; display: flex; align-items: center;
  justify-content: center; color: ${tk.textTertiary}; font-size: 15px; transition: background-color .12s ease; }
.pddcs-popup-close:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; }
/* 候选行(v2.6.18 重设计):通栏矩形 → 内缩圆角软行(留白分组,无分隔线);
   悬浮与键盘选中共用同一软中性灰圆角填充(第二十三轮用户指定的中性灰口径;
   旧 3px 左描边属表格行语言,随通栏行一并移除) */
/* 候选行(v2.6.20 收紧 → v2.6.24 再收紧 → v2.6.25 重配内外留白):
   v2.6.25 用户"标签/原问题/回答之间间距各 +2px,但词条整体高度不要变化;词条的默认高度减小一点"——
   两处行内间距 2→4px(+4px),行内上下 padding 6→3px(−6px),
   行内竖向总留白 16→14px → **净减 2px**:信息之间更松,词条反而更矮;
   行内**左** padding 12px 是整行的公共左缘(徽标外框、操作钮组的基准),
   正文再在此基础上各自缩进 BADGE_PAD_X(见下) */
.pddcs-cand { position: relative; margin: 1px 8px; padding: 3px 12px; border-radius: ${radius.lg}px;
  cursor: pointer; transition: background-color .12s ease; }
.pddcs-cand:hover, .pddcs-cand-selected, .pddcs-cand-selected:hover { background: ${tk.selectedBg}; }
/* 行首行:徽标居左 → 折叠数紧随徽标 → 操作图标钮居右(margin-left:auto 顶到行末);
   行首行自身**不加左缩进**(徽标外框即整行左缘),
   下方「原问题 / 正文」各自 padding-left: BADGE_PAD_X → 三处**文字**左缘同一条线
   (v2.6.24 用户指定"下方内容和标签左侧对齐";v2.6.26 明确为对齐**标签文字**而非徽标外框);
   下间距 2→4px 见 v2.6.25 留白重配 */
.pddcs-cand-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
/* 类别徽标(v2.6.19 chip 化 → v2.6.24 放大):用户"标准回答、历史、知识库标签比例增大"——
   10px / 内边距 1px 7px → **11.5px(secondary 档)/ 3px 9px**,圆角 4→6px,
   与 24px 图标钮同行时是一眼可辨的类别标签;
   水平内边距 = BADGE_PAD_X 常量,同时决定下方正文的左缩进量(改一处即整体重对齐);
   配色不变:标准回答 = 琥珀软底金字,知识库 = 绿软底绿字(semantic 同源,两表面不割裂),
   历史 = 中性灰软底灰字 */
.pddcs-badge { display: inline-flex; align-items: center; padding: 3px ${BADGE_PAD_X}px;
  border-radius: ${radius.md}px; font-size: ${fontSize.secondary}px; font-weight: 500;
  background: ${tk.selectedBg}; color: ${tk.textMuted}; }
.pddcs-badge.golden { background: rgba(184, 134, 11, 0.14); color: ${semantic.golden}; }
.pddcs-badge.knowledge { background: rgba(20, 174, 92, 0.12); color: ${semantic.knowledge}; }
/* 同内容折叠数(v2.6.19 行右下角悬浮才显 → v2.6.25 用户"同内容移动至标签的右侧"):
   回到行首行、紧贴徽标右侧,与徽标共用行首行的 align-items 中线;
   随之**常驻显示**(右下角那版是浮动覆盖物,才需要悬浮才显来避让正文),
   absolute 定位与折叠行的底边条位预留规则一并删除 —— 折叠与否不再改变词条高度 */
.pddcs-fold { color: ${tk.textTertiary}; font-size: ${fontSize.caption}px; line-height: 1;
  white-space: nowrap; }
/* 操作钮(v2.6.18 悬浮显现;v2.6.24 文字 → 图标):静止时行内只有徽标 + 回显 + 正文,
   悬浮/选中才显两枚图标钮;margin-right -6px = 按用户"按钮向右移动一点"
   把这组钮自行内边距(12px)推向面板右缘(仍留在悬浮底色块内) */
.pddcs-cand-actions { margin-left: auto; margin-right: -6px; display: flex; gap: 2px;
  opacity: 0; pointer-events: none; transition: opacity .12s ease; }
.pddcs-cand:hover .pddcs-cand-actions, .pddcs-cand-selected .pddcs-cand-actions {
  opacity: 1; pointer-events: auto; }
/* 图标操作钮(第三十七轮 v2.6.24):24px(controlH.inline)方钮 + 13px lucide 图标 ——
   与 popup 行悬浮图标钮同档同语言(透明底 → 悬浮浅灰,颜色由 currentColor 继承) */
.pddcs-icon-btn { width: ${ICON_BTN_SIZE}px; height: ${ICON_BTN_SIZE}px; flex: 0 0 auto; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; border: none;
  border-radius: ${radius.sm}px; background: transparent; color: ${tk.textTertiary}; cursor: pointer;
  transition: background-color .1s ease, color .1s ease; }
.pddcs-icon-btn:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; }
.pddcs-icon-btn:disabled { opacity: .5; cursor: default; }
/* 星标钮(设为 / 取消标准回答):悬浮走语义金(与琥珀徽标、popup 金标同源);
   已设态 = **实心金星**,一眼看出该条已被提升为标准回答,点击即取消 */
.pddcs-icon-btn-star:hover { background: rgba(184, 134, 11, 0.14); color: ${semantic.golden}; }
.pddcs-icon-btn-golden { color: ${semantic.golden}; }
.pddcs-icon-btn-golden:hover { background: rgba(184, 134, 11, 0.14); color: ${semantic.golden}; }
/* 请求在途:图标原地转圈(替代原「设置中… / 取消中…」文字反馈) */
.pddcs-icon-btn-busy svg { animation: pddcs-spin .7s linear infinite; }
@keyframes pddcs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pddcs-icon-btn-busy svg { animation: none; } }
/* 回答正文 = 面板唯一主层(v2.6.17):13.5px + 1.6 行高,与其余 11.5/10.5 灰字拉开两档;
   左缩进 BADGE_PAD_X = 对齐上方徽标**内文字**左缘(v2.6.26 用户:v2.6.24 那版对齐的是徽标外框,
   视觉上正文比标签文字凸出 9px,看着"不齐") */
.pddcs-cand-text { padding-left: ${BADGE_PAD_X}px;
  font-size: ${fontSize.title}px; line-height: 1.6; white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
/* 问题回显上置为引子(v2.6.17,原底部「原问题:…」来源行移此):11.5px 灰字单行省略;
   左缩进与正文同一个 BADGE_PAD_X(三处文字左缘同线),下间距 2→4px(v2.6.25 留白重配)。
   注意 padding-left 与 text-overflow:ellipsis 不冲突:省略号仍落在行右缘 */
.pddcs-cand-q { padding-left: ${BADGE_PAD_X}px; margin-bottom: 4px; color: ${tk.textTertiary}; font-size: ${fontSize.secondary}px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* ── 「根据知识库内容整合并回复」行(AI 整合,默认关闭时不渲染)────────────────────
   v2.6.34 重设计(2026-09-17 用户:「高度太小了,修改为和词条高度类似,视觉效果要和词条区分开」)。
   ① **高度同族** —— 沿用候选行同一套盒子(margin 1px 8px + 圆角 radius.lg),
      行内同样是「小字行 + 大字行」两层:主行(min-height 取 controlH.inline 顶住 24px 操作钮)
      + 说明行 11.5px;出结果后说明行让位给正文,第三块正好顶到候选正文那一档 ——
      整行高度于是与候选行**自然同档**,不靠 padding 虚撑;
   ② **视觉区分** —— 候选行是「中性面色 + 彩色类别徽标」= 一条素材;
      本行是「知识库绿软底 + 同色细描边」= 一次动作,且不挂类别徽标(它不是类别)。
      悬浮/选中时绿底加深一档,与候选行的中性灰填充一眼可分;
      失败态整行转语义红(描边 + 软底 + 文案同色),不再是只变个文字色;
   ③ **左缘同线** —— 内边距 11px + 1px 描边 = 候选行的 12px,两类行的内容左缘重合,
      行内文字再各自缩进 BADGE_PAD_X(与候选正文、徽标文字同一条竖线);
   ④ **特异度** —— 选择器带双类(0-2-0)会盖过单类的 .pddcs-cand:hover / .pddcs-cand-selected,
      故悬浮与选中态必须在此**显式**补写,失败态规则排在悬浮之后 */
.pddcs-cand.pddcs-ai-row { display: flex; flex-direction: column; gap: ${spacing.xs}px;
  padding: ${spacing.xs}px 11px; cursor: default;
  border: 1px solid rgba(20, 174, 92, 0.3); background: ${semantic.knowledgeBg}; }
/* 只有"还没点过"的整行才是大按钮(点哪儿都行);出结果后整行不再是触发器 ——
   想复制生成内容的人不该因为点了一下文字就再花一次 API 请求,重试走右上角那枚钮 */
.pddcs-cand.pddcs-ai-row.is-idle { cursor: pointer; }
.pddcs-cand.pddcs-ai-row:hover,
.pddcs-cand.pddcs-ai-row.pddcs-cand-selected,
.pddcs-cand.pddcs-ai-row.pddcs-cand-selected:hover {
  background: rgba(20, 174, 92, 0.16); border-color: rgba(20, 174, 92, 0.45); }
.pddcs-cand.pddcs-ai-row.is-error {
  border-color: rgba(217, 48, 38, 0.32); background: rgba(217, 48, 38, 0.07); }
.pddcs-cand.pddcs-ai-row.is-error:hover { background: rgba(217, 48, 38, 0.12); }
/* 主行:✦ + 动作名(13.5px = 面板唯一主层,与候选正文同档)+ 右侧「重试/重新生成」钮。
   min-height 取行内控件档,使操作钮显隐不改变主行高度(等高铁律) */
.pddcs-ai-main { display: flex; align-items: center; gap: ${spacing.sm}px;
  min-height: ${controlH.inline}px; padding-left: ${BADGE_PAD_X}px; }
.pddcs-ai-icon { color: ${semantic.knowledge}; font-size: ${fontSize.title}px; line-height: 1; }
.pddcs-ai-label { color: ${semantic.knowledge}; font-size: ${fontSize.title}px; font-weight: 500;
  line-height: 1.6; }
.pddcs-ai-row.is-error .pddcs-ai-icon,
.pddcs-ai-row.is-error .pddcs-ai-label { color: ${semantic.danger}; }
/* 说明行(v2.6.34 新增):两行真信息 —— 什么出去、什么留下。这行动作**会出网**,
   得在点之前就把边界写在脸上(ADR-0006 靠用户知情兜底),也是本行与候选行等高的那一层。
   pre-line:认文案里的**语义换行**,同时在窄处仍可自然折行 ——
   不出网声明绝不用省略号截断(截掉的正是要用户看清的那半句)。 */
.pddcs-ai-hint { padding-left: ${BADGE_PAD_X}px; color: ${tk.textMuted};
  font-size: ${fontSize.secondary}px; line-height: 1.5;
  white-space: pre-line; overflow-wrap: break-word; }
/* 生成结果 = 一段正文,照候选正文的排版(13.5px / 1.6 / 4 行截断),
   而不是"行内小字的补充说明" —— 用户要的就是能直接发出去的话术 */
.pddcs-ai-draft { padding-left: ${BADGE_PAD_X}px; color: ${tk.text};
  font-size: ${fontSize.title}px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
/* 「重试 / 重新生成」钮:搬到主行右端(不再另起一行拉高行高),24px 行内档。
   box-sizing 显式声明 —— 本样式注入平台页面,不享受 popup 的全局 border-box 重置 */
.pddcs-ai-retry { box-sizing: border-box; flex: 0 0 auto; margin-left: auto;
  height: ${controlH.inline}px; padding: 0 ${spacing.lg}px;
  border: 1px solid ${tk.border}; border-radius: ${radius.md}px; background: ${tk.bg};
  color: ${tk.textMuted}; font-size: ${fontSize.secondary}px; line-height: 1; cursor: pointer;
  transition: background-color .12s ease, color .12s ease; }
.pddcs-ai-retry:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; }
.pddcs-ai-row.is-busy .pddcs-ai-icon { animation: pddcs-spin .9s linear infinite; }
@media (prefers-reduced-motion: reduce) { .pddcs-ai-row.is-busy .pddcs-ai-icon { animation: none; } }
/* 页脚常驻壳:hairline 上边 + 次级表面底,键位提示不再漂在正文后面 */
.pddcs-popup-foot { flex: 0 0 auto; padding: 7px 14px; border-top: 1px solid ${tk.borderLight};
  background: ${tk.bgSecondary}; color: ${tk.textTertiary}; font-size: ${fontSize.caption}px; }
/* 键位键帽(v2.6.16):与 popup 设置页 HotkeyRow 的 <kbd> 同语言(灰底细边圆角等宽字) */
.pddcs-kbd { display: inline-block; margin: 0 2px; padding: 1px 6px;
  border: 1px solid ${tk.border}; border-radius: ${radius.sm}px;
  background: ${tk.bg}; color: ${tk.textMuted};
  font-size: 10px; line-height: 1.4; font-family: ui-monospace, Consolas, monospace; }

/* 轻提示 — 近黑 toast(两主题下都深底白字,可读性不随主题切换) */
.pddcs-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; background: rgba(22,22,22,.92); color: #fff; font-size: ${fontSize.body}px;
  padding: 8px 16px; border-radius: ${radius.md}px; opacity: 0; transition: opacity .2s;
  max-width: 60vw; z-index: 2147483001; box-shadow: 0 4px 16px rgba(0,0,0,0.20); }
.pddcs-toast.show { opacity: 1; }
`
}
