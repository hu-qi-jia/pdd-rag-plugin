/**
 * 聊天页覆盖层主题 —— **复古极简 + 极客工具风**(v3.0)
 *
 * pdd-ai-button 的覆盖层 CSS 抽成按 ThemeTokens 生成的纯函数,内容脚本负责读
 * chrome.storage(pddcs:theme)+ onChanged 实时重建。
 * 本模块保持纯逻辑(不触碰 chrome/DOM),供内容脚本与单测共用。
 *
 * v3.0 对面板的改动是**推翻性的**,不是调参。旧版(v2.7.0)是一张 Apple 式毛玻璃材料:
 * 半透明底 + backdrop-filter 模糊、无描边、轮廓靠阴影里那圈 0.5px 亮环、头/脚无分隔线、
 * 行是内缩的同心圆角软块。新版把这套语汇整个换掉:
 *
 *  1. **面板 = 一块带框的纸/屏** —— 1px 结构线(borderStrong)+ 直角,没有阴影、没有模糊。
 *     浮层与页面之间靠**实线**分开:这是复古极简的核心,投影和材质都属于"浮起来"的语言。
 *  2. **标题条反白** —— 头不是"面板名那一行",而是一条**实心反白条**(黑底白字)。
 *     这是终端窗口标题栏 / Norton Commander 的记法,也是整个面板唯一的重色块:
 *     一眼定位面板、一眼读到"推荐回复 + 几条"。
 *  3. **选中 = 真反白** —— 候选行被选中时整行反相(底色换主文本色、字换面板底色)。
 *     悬浮只是浅灰轻染。两者强度差得足够远,键盘面板里"Enter 到底填哪条"不可能看错。
 *  4. **行与行靠发丝线**(borderLight),不是留白,也不是圆角软块 —— 行现在是**满幅**的
 *     (旧版左右各内缩 8px),于是列表读起来像一张表,而不是一叠卡片。
 *  5. **左括号挂出去** —— 徽标改方括号 `[标准]`,而那个 `[` 用 `position: absolute` 挂在
 *     徽标盒左侧,不占正文横向空间。于是「徽标文字 / 原问题 / 回答正文」三处文字左缘
 *     由**构造**保证同线,与字体进宽无关(旧版靠 9px 内边距凑,一旦字号分档就会错开;
 *     试过用 `1ch` 也不行 —— `ch` 按元素**自身**字号解析,11.5px 与 13.5px 会算出两个值)。
 */
import type { ThemeMode, ThemeTokens } from './theme'
import {
  controlH,
  fontFamily,
  fontSize,
  fontWeight,
  panelType,
  radius,
  spacing,
  stroke,
} from './design'
import { thinScrollbarCss } from './scrollbar'
import { ICON_BTN_SIZE } from './overlay-icons'

/** 与 popup 主题上下文(theme-context)共用的存储键 */
export const THEME_STORAGE_KEY = 'pddcs:theme'

/** 存储值容错解析:非法/缺失一律回退浅色 */
export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

/**
 * 候选弹窗宽度(CSS 与 JS 定位共用,单处维护)。
 * v3.0 由 360 → **380**:面板整体改等宽字,同样的字数比比例字宽出约一成 ——
 * 不加宽的话"原问题"引子与正文的折行位置会比旧版更早,反而降低可读性。
 */
export const POPUP_W = 380

// ── 行的盒子 ────────────────────────────────────────────────────────────────
/** 行左右相对面板外缘的内缩量 = 可滚动中段的水平内边距。v3.0 归零:行**满幅** */
export const ROW_INSET_X = 0
/** 行左右内边距(行内所有内容的公共左缘) */
export const ROW_PAD_X = 12
/** 行上下内边距 */
export const ROW_PAD_Y = spacing.lg
/** 行内纵向节奏:标签行→引子、引子→正文、整合行主行→说明行,三处同一个值 */
export const ROW_GAP_Y = spacing.sm
/**
 * 行圆角 = 面板圆角 − 行内缩量。v3.0 两个减数都成了 0(直角 + 满幅),公式**依然成立**,
 * 保留它是为了"改面板圆角就会带上行圆角"这条约束不因一次改版而丢失。
 */
export const ROW_RADIUS = radius.xl - ROW_INSET_X

/**
 * 面板**文字内容**的左右内边距(反白标题条里的面板名、页脚说明都取它)。
 * = 行内缩量 + 行内边距,于是「标题左缘 = 每条行内容的左缘」——
 * 标题是这张列表的标题,就该站在列表内容那条竖线上。
 */
export const PANEL_PAD_X = ROW_INSET_X + ROW_PAD_X

export function buildOverlayCss(tk: ThemeTokens): string {
  return `
#pddcs-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
  font-family: ${fontFamily}; }

/* AI回复按钮 — 与 popup 的 .pddcs-btn 同档工具风控件(直角 / 细描边 / 等宽半粗)。
   box-sizing 显式声明:本样式注入平台页面,不享受 popup 的全局 border-box 重置。
   v3.0 去掉阴影:按钮压在气泡旁边,一枚投影在"纸面"上是最刺眼的一处杂质 */
.pddcs-ai-btn { position: fixed; box-sizing: border-box; height: ${controlH.form}px;
  border-radius: ${radius.md}px; border: ${stroke.hairline}px solid ${tk.btnBorder};
  cursor: pointer; pointer-events: auto; padding: 0 ${spacing.xl}px; display: inline-flex; align-items: center;
  background: ${tk.btnBg}; color: ${tk.text}; font-size: ${fontSize.body}px;
  font-weight: ${fontWeight.semibold}; line-height: 1; letter-spacing: 0;
  transition: background-color .08s linear, color .08s linear, border-color .08s linear; }
.pddcs-ai-btn:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; border-color: ${tk.text}; }
.pddcs-ai-btn:active { background: ${tk.border}; }
.pddcs-ai-btn:focus-visible { outline: 2px solid ${tk.accent}; outline-offset: 2px; }
.pddcs-ai-btn .pddcs-ai-btn-label { white-space: nowrap; }
.pddcs-ai-btn:disabled { opacity: .55; cursor: wait; }

/* ── 候选弹窗 ────────────────────────────────────────────────────────────────
   一块带框的直角面板:1px 结构线 + 不透明底。没有阴影、没有圆角、没有背景模糊。
   底色的实际取值由 openPopup 内联写入(tk.bg)—— 本样式注入平台页面,类规则可能被
   页面级 !important 盖掉,内联是优先级更高的兜底。
   入场 100ms 线性淡入:仪器面板"亮起来"而不是"落下来",故不翻译不缩放 ——
   顺带消掉了旧版那个坑(量高时缩放会让 getBoundingClientRect 矮一圈,定位算错) */
.pddcs-popup { position: fixed; box-sizing: border-box; width: ${POPUP_W}px;
  max-height: min(64vh, calc(100vh - 16px));
  display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: ${tk.bg};
  border: ${stroke.strong}px solid ${tk.borderStrong}; border-radius: ${radius.xl}px;
  opacity: 1;
  /* 面板基础字号 = 辅助档:面板内每一处可见文字都显式取三档之一,
     这条只是**兜底** —— 万一有文字漏挂类名,也落在规范内,不会冒出第四个字号 */
  font-size: ${panelType.meta.size}px; color: ${tk.text};
  animation: pddcs-pop-in .1s linear; }
@keyframes pddcs-pop-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .pddcs-popup { animation: none; } }
${thinScrollbarCss('.pddcs-popup-body', tk.scrollThumb)}

/* ── 标题条:整块反白(黑底白字 / 深色下白底黑字)──────────────────────────
   这是面板唯一的重色块,也是"面板从哪儿开始"的答案。
   子元素一律 color: inherit —— 反白是**整条**的属性,不需要每个孩子各自知道该用哪个色;
   亮度差异用 opacity 表达,于是同一套规则在两个主题下自动成立 */
.pddcs-popup-head { display: flex; align-items: center; gap: ${spacing.sm}px; flex: 0 0 auto;
  padding: ${spacing.md}px ${PANEL_PAD_X}px; background: ${tk.text}; color: ${tk.bg}; }
.pddcs-popup-title { font-size: ${panelType.title.size}px; font-weight: ${panelType.title.weight};
  line-height: 1.3; color: inherit; }
.pddcs-popup-count { font-size: ${panelType.meta.size}px; font-weight: ${panelType.meta.weight};
  line-height: 1.3; color: inherit; opacity: .72; font-variant-numeric: tabular-nums; }
/* 关闭钮:反白条上的裸 ×,命中区仍是 26px(视觉小、可点范围不变);
   悬浮给一层中性灰(半透明白/黑都能看见的那种灰),不引入第三种颜色 */
.pddcs-popup-close { margin-left: auto; flex: 0 0 auto; box-sizing: border-box;
  width: ${controlH.form}px; height: ${controlH.form}px; padding: 0; border: none; cursor: pointer;
  border-radius: ${radius.sm}px; display: flex; align-items: center;
  justify-content: center; background: transparent; color: inherit; opacity: .75;
  font-size: ${fontSize.heading}px; line-height: 1;
  transition: background-color .08s linear, opacity .08s linear; }
.pddcs-popup-close:hover { background: rgba(128,128,128,.35); opacity: 1; }
.pddcs-popup-close:focus-visible { outline: 2px solid ${tk.bg}; outline-offset: -3px; }

/* ── 滚动中段:唯一滚动容器。左右不留内缩 —— 行满幅,分隔线才有资格横贯整块面板 */
.pddcs-popup-body { flex: 1 1 auto; overflow-y: auto;
  padding: 0 ${ROW_INSET_X}px; }

/* ── 候选行:满幅、直角、纸面无底;行与行之间一条发丝线
   行内左缘 = ROW_PAD_X,是徽标与操作钮组的公共基准;
   行内所有文字**同起一条线**:徽标的左括号挂在行内边距里,不推挤后面的内容。
   行距**不靠 margin**:行挨着行,由 border-bottom 分隔 —— 这是表格的读法 */
.pddcs-cand { position: relative; padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px;
  border-bottom: ${stroke.hairline}px solid ${tk.borderLight};
  cursor: pointer; transition: background-color .08s linear, color .08s linear; }
.pddcs-cand:last-child { border-bottom: none; }

/* ── 选中 = 真反白 ──────────────────────────────────────────────────────────
   整行反相:底色取主文本色、字取面板底色。终端菜单的记法,也是本面板里最强的状态信号 ——
   键盘面板中选中态是**唯一**的高亮源,它必须一眼可辨。
   行内每个有自己颜色的孩子都要显式改口(见下方 .pddcs-cand-selected 后代的几条规则):
   徽标、折叠数、引子、正文、图标钮**全都是**反白条上的字,不是"叠在灰底上的元素" */
.pddcs-cand-selected, .pddcs-cand-selected:hover {
  background: ${tk.text}; color: ${tk.bg}; }
.pddcs-cand-selected .pddcs-badge,
.pddcs-cand-selected .pddcs-badge.golden,
.pddcs-cand-selected .pddcs-badge.knowledge { color: inherit; }
.pddcs-cand-selected .pddcs-fold,
.pddcs-cand-selected .pddcs-cand-q { color: inherit; opacity: .72; }
.pddcs-cand-selected .pddcs-cand-text { color: inherit; }
.pddcs-cand-selected .pddcs-icon-btn { color: inherit; }
.pddcs-cand-selected .pddcs-icon-btn:hover { background: rgba(128,128,128,.4); color: inherit; }
/* 反白行上的星标不再取金色:反相行里没有"金色"这回事,整行只有一种前景色 */
.pddcs-cand-selected .pddcs-icon-btn-golden { color: inherit; }

/* ── 悬浮样式只属于「鼠标面板」──────────────────────────────────────────────
   面板有两种开法:点「AI回复」开的是**鼠标面板**,鼠标是它唯一的选择工具;
   快捷键开的是**键盘面板**(.pddcs-popup-keyboard,由 openPopup 加在面板根上),
   在那里选中态由 Tab 独占 —— 鼠标一悬浮就把选中带过去,会让"Enter 到底填哪条"
   在视觉上说不清。故键盘面板的整条规则是:**悬浮不改变任何可见状态**
   (不改选中、不给悬浮底色、不显悬浮操作钮)。
   选择器里带 :not(.pddcs-cand-selected) 是**必要的**:选中规则写得比它轻,
   若不排除,鼠标停在已选中行上时浅灰会盖掉反白 */
.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand:not(.pddcs-cand-selected):hover {
  background: ${tk.selectedBg}; }
/* 行首行:徽标居左 → 折叠数紧随 → 操作图标钮居右(margin-left:auto 顶到行末);
   行首行自身**不加左缩进**(方括号的左括号即整行左缘) */
.pddcs-cand-top { display: flex; align-items: center; gap: ${spacing.sm}px; margin-bottom: ${ROW_GAP_Y}px; }
/* 类别徽标 = **方括号标签**:[标准] / [知识] / [历史]。
   旧版是彩色软底 chip(填充 + 圆角 + 内边距),在一屏黑白灰里它是最响的三个色块;
   现在只留一对括号 —— 括号是终端与代码注释里的原生标记法,"这是标签"不需要靠底色来讲。
   方括号由伪元素给出,于是 JS 侧只写类别名,形态完全由样式决定。
   配色仍走语义色(暗琥珀 / 暗墨绿),那是**功能信号**,不是装饰。

   **左括号挂出去**(absolute + right: 100%),不占正文横向空间 —— 这是"三处文字左缘同一条线"
   (徽标文字 / 原问题 / 回答正文)能在等宽字下成立的关键:
     · 若括号参与排版,徽标文字就被右推一个字符,正文得跟着缩进一格才对齐,
       而缩进量取决于**各自**的 font-size:ch 单位在 11.5px 的引子上算出 6.9px、
       在 13.5px 的正文上算出 8.1px(实测差 1.16px),一个单位算出两个值,永远对不齐;
     · 挂出去之后,徽标盒的左缘**就是**徽标文字左缘,正文不缩进即可,
       没有任何需要"算"的东西 —— 对齐由构造保证,与字体进宽完全无关。
   于是左括号落在行的内边距里(12px 里占约 7px),充当一条标签列的栏线。
   注:popup 侧的 Badge 组件不挂(那边没有"与列表正文对齐"这条要求),两边形态因此略有差异,
   这是渲染栈与排版需求都不同所致,不是漏改。 */
.pddcs-badge { position: relative; display: inline-flex; align-items: center;
  border-radius: ${radius.sm}px; font-size: ${panelType.meta.size}px;
  font-weight: ${fontWeight.semibold}; background: transparent; color: ${tk.textMuted}; }
.pddcs-badge::before { content: '['; position: absolute; right: 100%; }
.pddcs-badge::after { content: ']'; }
.pddcs-badge.golden { color: ${tk.goldenText}; }
.pddcs-badge.knowledge { color: ${tk.knowledgeText}; }
/* 同内容折叠数:紧贴徽标右侧,与徽标共用行首行的 align-items 中线,常驻显示 */
.pddcs-fold { color: ${tk.textTertiary}; font-size: ${panelType.meta.size}px; line-height: 1;
  white-space: nowrap; }
/* 操作钮(v2.6.18 悬浮显现;v2.6.24 文字 → 图标):静止时行内只有徽标 + 回显 + 正文,
   悬浮/选中才显两枚图标钮;margin-right -6px 把这组钮推向面板右缘(仍留在行内) */
.pddcs-cand-actions { margin-left: auto; margin-right: -6px; display: flex; gap: 2px;
  opacity: 0; pointer-events: none; transition: opacity .08s linear; }
.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand:hover .pddcs-cand-actions,
.pddcs-cand-selected .pddcs-cand-actions {
  opacity: 1; pointer-events: auto; }
/* 图标操作钮:24px 方钮 + 13px 图标,透明底 → 悬浮浅灰(颜色由 currentColor 继承)。
   v3.0 圆角由 pill 改直角 —— 面板里所有无描边的小控件自此同一套形状语言 */
.pddcs-icon-btn { width: ${ICON_BTN_SIZE}px; height: ${ICON_BTN_SIZE}px; flex: 0 0 auto; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; border: none;
  border-radius: ${radius.sm}px; background: transparent; color: ${tk.textTertiary}; cursor: pointer;
  transition: background-color .08s linear, color .08s linear; }
.pddcs-icon-btn:hover { background: ${tk.fillQuietHover}; color: ${tk.text}; }
.pddcs-icon-btn:focus-visible { outline: 2px solid ${tk.accent}; outline-offset: 1px; }
.pddcs-icon-btn:disabled { opacity: .5; cursor: default; }
/* 星标钮(设为 / 取消标准回答):悬浮走语义金;已设态 = 实心金星 */
.pddcs-icon-btn-star:hover { background: ${tk.goldenSurface}; color: ${tk.goldenText}; }
.pddcs-icon-btn-golden { color: ${tk.goldenText}; }
.pddcs-icon-btn-golden:hover { background: ${tk.goldenSurface}; color: ${tk.goldenText}; }
/* 请求在途:图标原地转圈(替代原「设置中… / 取消中…」文字反馈) */
.pddcs-icon-btn-busy svg { animation: pddcs-spin .7s linear infinite; }
@keyframes pddcs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pddcs-icon-btn-busy svg { animation: none; } }
/* 回答正文 = 面板唯一主层:13.5px + 1.6 行高。
   **不缩进** —— 徽标的左括号挂出去了(见 .pddcs-badge),徽标盒左缘就是徽标文字左缘,
   正文与它同起一条线。旧版这里有一句 padding-left: 9px 去凑对齐;现在不需要凑 */
.pddcs-cand-text {
  font-size: ${panelType.content.size}px; line-height: 1.6; white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
/* 问题回显上置为引子:11.5px 灰字单行省略(与正文同起一条线,不缩进) */
.pddcs-cand-q { margin-bottom: ${ROW_GAP_Y}px; color: ${tk.textTertiary};
  font-size: ${panelType.meta.size}px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* ── 「根据知识库内容整合并回复」行(AI 整合,默认关闭时不渲染)──────────────
   ① **高度同族** —— 沿用候选行同一套盒子,行内同样是两层:主行 + 说明行/结果;
   ② **视觉区分** —— 候选行静止时是一张**完全无底的纸**,本行是一块常驻的**知识库色软底**
      = 一次动作,且不挂类别徽标(它不是类别)。v3.0 保持"有底/没底"这一条区分,
      另外补一条 **3px 左色条** —— 与 Notice 的提示条同一种记法,让这一行在整屏灰阶里
      一眼是"另一类东西",而不必靠加深底色(加深会与选中反白打架);
   ③ **左缘同线** —— 内边距与候选行同为 ROW_PAD_X。行内文字不需要额外缩进(候选行那边
      靠"左括号挂出去"把文字顶到行内边距上,本行没有徽标),但**左色条会吃掉 3px**,
      故内边距按此补偿,保证色条右侧的文字与候选行同线;
   ④ **特异度** —— 选择器带双类会盖过单类的 .pddcs-cand 规则,故悬浮与选中态在此显式补写 */
.pddcs-cand.pddcs-ai-row { display: flex; flex-direction: column; gap: ${ROW_GAP_Y}px;
  cursor: default; background: ${tk.knowledgeSurface};
  border-left: 3px solid ${tk.knowledgeText};
  padding-left: ${ROW_PAD_X - 3}px; }
/* 只有"还没点过"的整行才是大按钮(点哪儿都行);出结果后整行不再是触发器 ——
   想复制生成内容的人不该因为点了一下文字就再花一次 API 请求,重试走右上角那枚钮 */
.pddcs-cand.pddcs-ai-row.is-idle { cursor: pointer; }
.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand.pddcs-ai-row:not(.pddcs-cand-selected):hover {
  background: ${tk.knowledgeSurfaceHover}; }
/* 失败态(v3.1 去掉了红色):底色转中性浅底、左色条转**墨**、文字转**墨 + 加粗** ——
   "这行出错了"由"底色 + 色条 + 字重"三处同时说,不靠文案里的"失败"二字,也不靠颜色。
   多一种颜色就多一个需要解释的信号,而它并不比加粗更准。 */
.pddcs-cand.pddcs-ai-row.is-error { background: ${tk.noticeBg}; border-left-color: ${tk.text}; }
.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand.pddcs-ai-row.is-error:not(.pddcs-cand-selected):hover {
  background: ${tk.knowledgeSurfaceHover}; }
/* 主行:动作名 + 右侧「重试/重新生成」钮。min-height 取行内控件档,
   使操作钮显隐不改变主行高度(等高铁律) */
.pddcs-ai-main { display: flex; align-items: center; gap: ${spacing.sm}px;
  min-height: ${controlH.inline}px; }
.pddcs-ai-label { color: ${tk.knowledgeText}; font-size: ${panelType.action.size}px;
  font-weight: ${panelType.action.weight}; line-height: 1.6; }
.pddcs-ai-row.is-error .pddcs-ai-label { color: ${tk.text}; font-weight: 600; }
/* 第二块:说明行与生成结果**同档同排版**(13.5 / 1.6),两者只是同一个槽位在不同状态下的
   内容,换状态时行内不该跳字号。区分靠**颜色**:说明是元信息(textMuted),
   生成结果是要发出去的正文(tk.text)。
   pre-line:认文案里的**语义换行**,同时在窄处仍可自然折行 ——
   不出网声明绝不用省略号截断(截掉的正是要用户看清的那半句) */
.pddcs-ai-hint { color: ${tk.textMuted};
  font-size: ${panelType.content.size}px; line-height: 1.6;
  white-space: pre-line; overflow-wrap: break-word; }
/* 生成结果 = 一段正文,照候选正文的排版(13.5 / 1.6 / 4 行截断) */
.pddcs-ai-draft { color: ${tk.text};
  font-size: ${panelType.content.size}px; line-height: 1.6; white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
/* 「重试 / 重新生成」钮:主行右端,24px 行内档,直角 + 安静填充。
   box-sizing 显式声明 —— 本样式注入平台页面,不享受 popup 的全局 border-box 重置 */
.pddcs-ai-retry { box-sizing: border-box; flex: 0 0 auto; margin-left: auto;
  height: ${controlH.inline}px; padding: 0 ${spacing.lg}px;
  border: none; border-radius: ${radius.sm}px; background: ${tk.fillQuiet};
  color: ${tk.textMuted}; font-size: ${panelType.meta.size}px; line-height: 1; cursor: pointer;
  transition: background-color .08s linear, color .08s linear; }
.pddcs-ai-retry:hover { background: ${tk.fillQuietHover}; color: ${tk.text}; }
.pddcs-ai-retry:focus-visible { outline: 2px solid ${tk.accent}; outline-offset: 1px; }

/* ── 页脚状态条:一条发丝线与正文分开,文字**左对齐**站在内容那条竖线上。
   旧版是居中一行静音小字(没有分隔线);既然正文行的分隔线都画了,
   页脚若飘着不画就成了唯一没被"表格化"的一段,读起来像漏了一根线 */
.pddcs-popup-foot { flex: 0 0 auto; padding: ${spacing.sm}px ${PANEL_PAD_X}px;
  border-top: ${stroke.hairline}px solid ${tk.borderLight};
  text-align: left; color: ${tk.textTertiary};
  font-size: ${panelType.meta.size}px; line-height: 1.5; }
/* 键位键帽:与 popup 设置页 HotkeyRow 的 <kbd> 同语言(灰底细边直角等宽) */
.pddcs-kbd { display: inline-block; margin: 0 2px; padding: 1px 6px;
  border: ${stroke.hairline}px solid ${tk.border}; border-radius: ${radius.sm}px;
  background: ${tk.bgSecondary}; color: ${tk.textMuted};
  font-size: ${panelType.meta.size}px; line-height: 1.4; font-family: inherit; }

/* 轻提示 — 近黑 toast(两主题下都深底白字,可读性不随主题切换)。
   v3.0 由胶囊改直角:全站没有第二处圆角,toast 不该是例外 */
.pddcs-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; background: rgba(22,22,22,.94); color: #fff;
  font-size: ${fontSize.body}px;
  padding: 9px 18px; border-radius: ${radius.xl}px; opacity: 0; transition: opacity .1s linear;
  max-width: 60vw; z-index: 2147483001; }
.pddcs-toast.show { opacity: 1; }
`
}
