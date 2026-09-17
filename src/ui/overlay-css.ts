/**
 * 聊天页覆盖层主题(2026-09-15 评审 设计1):
 * pdd-ai-button 的覆盖层 CSS 原先在模块顶用 `lightTheme as tk` 一次定格,
 * popup 里切深色后聊天页面板仍是白的。现把 CSS 抽成按 ThemeTokens 生成的纯函数,
 * 内容脚本负责读 chrome.storage(pddcs:theme)+ onChanged 实时重建。
 * 本模块保持纯逻辑(不触碰 chrome/DOM),供内容脚本与单测共用。
 * (2026-09-16 工程审查③-V2:自 utils/ 迁入 ui/,与令牌/尺寸/滚动条同层)
 */
import type { ThemeMode, ThemeTokens } from './theme'
import {
  controlH,
  fontFamily,
  fontSize,
  fontWeight,
  material,
  panelType,
  radius,
  semantic,
  spacing,
} from './design'
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

// ── 行的盒子(v2.7.0 起单点定义,候选行与整合行共用同一组)────────────────────
/** 行左右相对面板外缘的内缩量 = 可滚动中段的水平内边距 */
export const ROW_INSET_X = spacing.md
/** 行左右内边距(行内所有内容的公共左缘) */
export const ROW_PAD_X = 12
/** 行上下内边距 */
export const ROW_PAD_Y = spacing.lg
/** 行内纵向节奏:标签行→引子、引子→正文、整合行主行→说明行,三处同一个值 */
export const ROW_GAP_Y = spacing.sm
/**
 * 行圆角 = 面板圆角 − 行内缩量 → **同心圆角**(20 − 8 = 12)。
 * 行块的四角与外壳四角平行,视觉上像"从面板上切下来的一块",而不是任意倒角;
 * 改面板圆角或改行内缩量时,这个减法会自动把行圆角带上,不会两边各调一次调歪。
 */
export const ROW_RADIUS = radius.xl - ROW_INSET_X

/**
 * 面板**文字内容**的左右内边距(头部的面板名、页脚的说明都取它)。
 * = 行内缩量 + 行内边距,于是「标题左缘 = 每条行内容的左缘」——
 * 头部不该自成一套缩进,它是这张列表的标题,就该站在列表内容那条竖线上。
 */
export const PANEL_PAD_X = ROW_INSET_X + ROW_PAD_X

/**
 * 面板的"材料"底色(v2.7.0):引擎能模糊背景 → 半透明材料;不能 → 退回不透明面色。
 *
 * 判断**只在这一处**,因为面板底色还有一层内联兜底(见 pdd-ai-button#openPopup:
 * 本样式注入平台页面,类规则可能被页面级 !important 盖掉,内联背景优先级更高)。
 * 那份内联必须和这条 CSS 取同一个值,否则兜底会把材料一脚踩回不透明 ——
 * 于是把"取哪个值"提成纯函数,两边共用、单测可断。
 */
export function panelSurface(tk: ThemeTokens, glass: boolean): string {
  return glass ? tk.surfaceOverlay : tk.bg
}

/** 引擎是否支持背景模糊(材料的前提;不支持就不该把面板做成半透明) */
export function supportsBackdropBlur(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    (CSS.supports('backdrop-filter', `blur(${material.blurPx}px)`) ||
      CSS.supports('-webkit-backdrop-filter', `blur(${material.blurPx}px)`))
  )
}

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

/* 候选弹窗(v2.7.0 重设计:Apple 式毛玻璃浮层 — 第四十九轮用户"不要带着现有设计的框架,
   大胆一点,简约风格,类似 apple 的设计")。
   与 v2.6.18~v2.6.34 那版的根本差别在**面板靠什么与页面分开**:
   旧版 = 一面不透明实心底 + 一圈 1px 描边 + 头/脚两条 hairline(近于"卡片");
   新版 = **半透明底 + backdrop-filter 模糊**成为一张材料,描边全部撤掉,
   改由阴影里的那圈 0.5px 亮环定轮廓,头/脚的分隔线也撤掉,三段只靠留白分层。
   于是整块面板是一张连续的材料,而不是三个被线切开的格子。
   底色的实际取值由 openPopup 内联写入(见 panelSurface:支持模糊才给半透明),
   这里的 ${tk.bg} 是"引擎不支持/内联没跑到"时的不透明兜底。
   入场 220ms:比旧版 160ms 长,配减速曲线做"落位"而不是"闪出来" */
.pddcs-popup { position: fixed; width: ${POPUP_W}px; max-height: min(62vh, calc(100vh - 16px));
  display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: ${tk.bg};
  backdrop-filter: saturate(${material.saturate}) blur(${material.blurPx}px);
  -webkit-backdrop-filter: saturate(${material.saturate}) blur(${material.blurPx}px);
  border: none; border-radius: ${radius.xl}px;
  box-shadow: ${tk.shadow}; opacity: 1;
  /* 面板基础字号 = 辅助档(v2.7.1):面板内每一处可见文字都显式取三档之一,
     这条只是**兜底** —— 万一有文字漏挂类名,也落在规范内,不会冒出第四个字号 */
  font-size: ${panelType.meta.size}px; color: ${tk.text};
  animation: pddcs-pop-in .22s cubic-bezier(0.32, 0.72, 0, 1); }
@keyframes pddcs-pop-in { from { opacity: 0; transform: translateY(6px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .pddcs-popup { animation: none; } }
${thinScrollbarCss('.pddcs-popup-body', tk.scrollThumb)}
/* 头部:面板名 + 计数,两者**分属两个文字档**(15px 半粗主文本 vs 12.5px 三级灰)——
   旧版把「推荐回复(3)」挤在同一个 12.5px 灰字串里,一条标题读起来像一句注释。
   无 hairline(sticky 早已取消,头本就在滚动视口之外) */
.pddcs-popup-head { display: flex; align-items: center; gap: ${spacing.sm}px; flex: 0 0 auto;
  padding: ${spacing.xxl}px ${PANEL_PAD_X}px ${spacing.md}px; color: ${tk.text}; }
.pddcs-popup-title { font-size: ${panelType.title.size}px; font-weight: ${panelType.title.weight};
  letter-spacing: -0.02em; line-height: 1.3; color: ${tk.text}; }
/* 计数与标题同排、比标题低两档:面板里"次要信息"只有辅助档一种字号(v2.7.1 规范),
   原先单开的 12.5px 是夹在标题与辅助之间的第三档,已收掉 */
.pddcs-popup-count { font-size: ${panelType.meta.size}px; font-weight: ${panelType.meta.weight};
  line-height: 1.3; color: ${tk.textTertiary}; }
/* 关闭钮(v2.7.2 收成裸图标):用户"推荐回复面板右上角的关闭按钮,仅保留 × 图标即可" ——
   上一版是一枚**常驻的灰色圆底 + ×**(v2.7.0 为避免"要先找到它才看得见"而加),
   在一屏全是无底文字的极简面板里,那颗圆是唯一多出来的墨点。
   现撤掉静止态的圆底,只留 × 字形本身;命中区仍是 26px(controlH.form,视觉变小、可点范围不变),
   悬浮时软底回来 —— 点得动这件事由悬浮回执交代,不再靠常驻底色。
   v2.7.0 那条"关闭入口要常驻可见"仍成立:常驻的是 **× 本身**,不是它身后的圆 */
.pddcs-popup-close { margin-left: auto; flex: 0 0 auto; box-sizing: border-box;
  width: ${controlH.form}px; height: ${controlH.form}px; padding: 0; border: none; cursor: pointer;
  border-radius: ${radius.pill}px; display: flex; align-items: center;
  justify-content: center; background: transparent; color: ${tk.textMuted};
  font-size: ${fontSize.heading}px; line-height: 1; transition: background-color .12s ease, color .12s ease; }
.pddcs-popup-close:hover { background: ${tk.fillQuiet}; color: ${tk.text}; }
/* 滚动中段:唯一滚动容器(6px 细轨挂此)。左右 ${ROW_INSET_X}px 就是行的内缩量 ——
   行自己不再带左右外边距,行的左右缘由这里单点决定(ROW_INSET_X / ROW_RADIUS 同源) */
.pddcs-popup-body { flex: 1 1 auto; overflow-y: auto;
  padding: ${spacing.xs}px ${ROW_INSET_X}px ${spacing.md}px; }
/* 候选行:内缩圆角软行,静止**完全无底**(行与行之间没有任何分隔物,分组全靠留白);
   悬浮与键盘选中共用同一软中性灰圆角填充(第二十三轮用户指定的中性灰口径;
   旧 3px 左描边属表格行语言,随通栏行一并移除)。
   行内左缘 = ROW_PAD_X,是徽标外框、操作钮组的公共基准;
   正文再在此基础上各自缩进 BADGE_PAD_X(见下)。
   行距 = ROW_GAP_Y(与行内节奏同一个值,列表的"疏"和内文的"疏"才是一套) */
.pddcs-cand { position: relative; margin: 0 0 ${ROW_GAP_Y}px; padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px;
  border-radius: ${ROW_RADIUS}px;
  cursor: pointer; transition: background-color .12s ease; }
.pddcs-cand:hover, .pddcs-cand-selected, .pddcs-cand-selected:hover { background: ${tk.selectedBg}; }
/* 行首行:徽标居左 → 折叠数紧随徽标 → 操作图标钮居右(margin-left:auto 顶到行末);
   行首行自身**不加左缩进**(徽标外框即整行左缘),
   下方「原问题 / 正文」各自 padding-left: BADGE_PAD_X → 三处**文字**左缘同一条线
   (v2.6.24 用户指定"下方内容和标签左侧对齐";v2.6.26 明确为对齐**标签文字**而非徽标外框) */
.pddcs-cand-top { display: flex; align-items: center; gap: 6px; margin-bottom: ${ROW_GAP_Y}px; }
/* 类别徽标(v2.6.19 chip 化 → v2.6.24 放大):用户"标准回答、历史、知识库标签比例增大"——
   10px / 内边距 1px 7px → **11.5px(secondary 档)/ 3px 9px**,圆角 4→6px,
   与 24px 图标钮同行时是一眼可辨的类别标签;
   水平内边距 = BADGE_PAD_X 常量,同时决定下方正文的左缩进量(改一处即整体重对齐);
   配色不变:标准回答 = 琥珀软底金字,知识库 = 绿软底绿字(semantic 同源,两表面不割裂),
   历史 = 中性灰软底灰字。
   v2.7.0 保留 chip 形态:面板越安静,这行"这是什么"的标签越得自己立得住 */
.pddcs-badge { display: inline-flex; align-items: center; padding: 3px ${BADGE_PAD_X}px;
  border-radius: ${radius.md}px; font-size: ${panelType.meta.size}px; font-weight: ${fontWeight.semibold};
  background: ${tk.selectedBg}; color: ${tk.textMuted}; }
.pddcs-badge.golden { background: ${semantic.goldenSoft}; color: ${semantic.golden}; }
.pddcs-badge.knowledge { background: ${semantic.knowledgeSoft}; color: ${semantic.knowledge}; }
/* 同内容折叠数(v2.6.19 行右下角悬浮才显 → v2.6.25 用户"同内容移动至标签的右侧"):
   回到行首行、紧贴徽标右侧,与徽标共用行首行的 align-items 中线;
   随之**常驻显示**(右下角那版是浮动覆盖物,才需要悬浮才显来避让正文),
   absolute 定位与折叠行的底边条位预留规则一并删除 —— 折叠与否不再改变词条高度 */
.pddcs-fold { color: ${tk.textTertiary}; font-size: ${panelType.meta.size}px; line-height: 1;
  white-space: nowrap; }
/* 操作钮(v2.6.18 悬浮显现;v2.6.24 文字 → 图标):静止时行内只有徽标 + 回显 + 正文,
   悬浮/选中才显两枚图标钮;margin-right -6px = 按用户"按钮向右移动一点"
   把这组钮自行内边距(ROW_PAD_X)推向面板右缘(仍留在悬浮底色块内) */
.pddcs-cand-actions { margin-left: auto; margin-right: -6px; display: flex; gap: 2px;
  opacity: 0; pointer-events: none; transition: opacity .12s ease; }
.pddcs-cand:hover .pddcs-cand-actions, .pddcs-cand-selected .pddcs-cand-actions {
  opacity: 1; pointer-events: auto; }
/* 图标操作钮(第三十七轮 v2.6.24):24px(controlH.inline)方钮 + 13px lucide 图标 ——
   与 popup 行悬浮图标钮同档同语言(透明底 → 悬浮浅灰,颜色由 currentColor 继承)。
   v2.7.0 圆角改 pill(正圆):面板里所有无描边的小控件自此同一套形状语言,
   悬浮时出现的那个圆底不再与方钮的圆角打架 */
.pddcs-icon-btn { width: ${ICON_BTN_SIZE}px; height: ${ICON_BTN_SIZE}px; flex: 0 0 auto; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; border: none;
  border-radius: ${radius.pill}px; background: transparent; color: ${tk.textTertiary}; cursor: pointer;
  transition: background-color .1s ease, color .1s ease; }
.pddcs-icon-btn:hover { background: ${tk.fillQuietHover}; color: ${tk.text}; }
.pddcs-icon-btn:disabled { opacity: .5; cursor: default; }
/* 星标钮(设为 / 取消标准回答):悬浮走语义金(与琥珀徽标、popup 金标同源);
   已设态 = **实心金星**,一眼看出该条已被提升为标准回答,点击即取消 */
.pddcs-icon-btn-star:hover { background: ${semantic.goldenSoft}; color: ${semantic.golden}; }
.pddcs-icon-btn-golden { color: ${semantic.golden}; }
.pddcs-icon-btn-golden:hover { background: ${semantic.goldenSoft}; color: ${semantic.golden}; }
/* 请求在途:图标原地转圈(替代原「设置中… / 取消中…」文字反馈) */
.pddcs-icon-btn-busy svg { animation: pddcs-spin .7s linear infinite; }
@keyframes pddcs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pddcs-icon-btn-busy svg { animation: none; } }
/* 回答正文 = 面板唯一主层(v2.6.17):13.5px + 1.6 行高,与其余 11.5/10.5 灰字拉开两档;
   左缩进 BADGE_PAD_X = 对齐上方徽标**内文字**左缘(v2.6.26 用户:v2.6.24 那版对齐的是徽标外框,
   视觉上正文比标签文字凸出 9px,看着"不齐") */
.pddcs-cand-text { padding-left: ${BADGE_PAD_X}px;
  font-size: ${panelType.content.size}px; line-height: 1.6; white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
/* 问题回显上置为引子(v2.6.17,原底部「原问题:…」来源行移此):11.5px 灰字单行省略;
   左缩进与正文同一个 BADGE_PAD_X(三处文字左缘同线),下间距 2→4px(v2.6.25 留白重配)。
   注意 padding-left 与 text-overflow:ellipsis 不冲突:省略号仍落在行右缘 */
.pddcs-cand-q { padding-left: ${BADGE_PAD_X}px; margin-bottom: ${ROW_GAP_Y}px; color: ${tk.textTertiary};
  font-size: ${panelType.meta.size}px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* ── 「根据知识库内容整合并回复」行(AI 整合,默认关闭时不渲染)────────────────────
   v2.6.34 立规(用户:「高度太小了,修改为和词条高度类似,视觉效果要和词条区分开」),
   v2.7.0 随面板重设计改**表达方式**,两条口径未动:
   ① **高度同族** —— 沿用候选行同一套盒子(margin/圆角/左右内边距全继承),
      行内同样是两层:主行(min-height 取 controlH.inline 顶住 24px 操作钮)
      + 说明行 11.5px;出结果后说明行让位给正文 —— 高度与候选行**自然同档**,不靠 padding 虚撑;
   ② **视觉区分** —— 候选行静止时是一张**完全无底的纸**(只有内容),
      本行是一块**常驻的知识库绿软底**= 一次动作,且不挂类别徽标(它不是类别)。
      v2.6.34 那版靠"绿软底 + 同色绿描边"两层叠加与候选行拉开;v2.7.0 撤掉描边 ——
      新面板里**所有**候选行都不再有底,于是"有底/没底"这一条就足以区分,再加描边是多余的重量;
      悬浮/选中时绿底加深一档,与候选行的中性灰填充一眼可分;
      失败态整行转语义红软底 + 文案同色(不靠文案里的"失败"二字表意);
   ③ **左缘同线** —— 内边距与候选行同为 ROW_PAD_X,两类行的内容左缘直接重合
      (v2.6.34 那版要靠"11px + 1px 描边"凑出 12px;描边一撤,这条变成恒等);
   ④ **特异度** —— 选择器带双类(0-2-0)会盖过单类的 .pddcs-cand:hover / .pddcs-cand-selected,
      故悬浮与选中态必须在此**显式**补写,失败态规则排在悬浮之后 */
.pddcs-cand.pddcs-ai-row { display: flex; flex-direction: column; gap: ${ROW_GAP_Y}px;
  cursor: default; background: ${tk.knowledgeSurface}; }
/* 只有"还没点过"的整行才是大按钮(点哪儿都行);出结果后整行不再是触发器 ——
   想复制生成内容的人不该因为点了一下文字就再花一次 API 请求,重试走右上角那枚钮 */
.pddcs-cand.pddcs-ai-row.is-idle { cursor: pointer; }
.pddcs-cand.pddcs-ai-row:hover,
.pddcs-cand.pddcs-ai-row.pddcs-cand-selected,
.pddcs-cand.pddcs-ai-row.pddcs-cand-selected:hover {
  background: ${tk.knowledgeSurfaceHover}; }
/* 失败面仍是固定字面量(跟知识库绿不同):失败态的主信号是**文字转红**
   (动作名 + 说明行两处一起变),底色只是补一层。故它不像动作面那样必须随主题 —
   深色下被材料冲淡一点也不影响"这行出错了"读不读得出来 */
.pddcs-cand.pddcs-ai-row.is-error { background: ${semantic.dangerSoft}; }
.pddcs-cand.pddcs-ai-row.is-error:hover { background: ${semantic.dangerSoftHover}; }
/* 主行:动作名 + 右侧「重试/重新生成」钮。min-height 取行内控件档,
   使操作钮显隐不改变主行高度(等高铁律)。
   v2.7.1 去掉行首的 ✦ 图标(用户"删除图标"):这一行整块已经是知识库绿底,
   "这是一次 AI 动作"由底色说得很清楚,再挂一枚装饰符号只是噪音;
   在途状态也不再转圈 —— 主行文案会变成「正在整合知识库…」、第二块同时在流式吐字,
   两个信号都比一枚自转的图标更直接 */
.pddcs-ai-main { display: flex; align-items: center; gap: ${spacing.sm}px;
  min-height: ${controlH.inline}px; padding-left: ${BADGE_PAD_X}px; }
.pddcs-ai-label { color: ${semantic.knowledge}; font-size: ${panelType.action.size}px;
  font-weight: ${panelType.action.weight}; line-height: 1.6; }
.pddcs-ai-row.is-error .pddcs-ai-label { color: ${semantic.danger}; }
/* 第二块(v2.7.1 规范):说明行与生成结果**同档同排版**(13.5 / 1.6),
   两者只是同一个槽位在不同状态下的内容,换状态时行内不该跳字号 ——
   用户反馈"小字和生成后的文字字号不同"即此。区分靠**颜色**:
   说明是元信息(textMuted),生成结果是要发出去的正文(tk.text)。
   pre-line:认文案里的**语义换行**,同时在窄处仍可自然折行 ——
   不出网声明绝不用省略号截断(截掉的正是要用户看清的那半句) */
.pddcs-ai-hint { padding-left: ${BADGE_PAD_X}px; color: ${tk.textMuted};
  font-size: ${panelType.content.size}px; line-height: 1.6;
  white-space: pre-line; overflow-wrap: break-word; }
/* 生成结果 = 一段正文,照候选正文的排版(13.5 / 1.6 / 4 行截断),
   而不是"行内小字的补充说明" —— 用户要的就是能直接发出去的话术 */
.pddcs-ai-draft { padding-left: ${BADGE_PAD_X}px; color: ${tk.text};
  font-size: ${panelType.content.size}px; line-height: 1.6; white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
/* 「重试 / 重新生成」钮:主行右端,24px 行内档,与关闭钮同一套"安静填充 + 全圆端"语言。
   box-sizing 显式声明 —— 本样式注入平台页面,不享受 popup 的全局 border-box 重置。
   字号走辅助档:它是行内小控件,不该和动作名抢层级 */
.pddcs-ai-retry { box-sizing: border-box; flex: 0 0 auto; margin-left: auto;
  height: ${controlH.inline}px; padding: 0 ${spacing.lg}px;
  border: none; border-radius: ${radius.pill}px; background: ${tk.fillQuiet};
  color: ${tk.textMuted}; font-size: ${panelType.meta.size}px; line-height: 1; cursor: pointer;
  transition: background-color .12s ease, color .12s ease; }
.pddcs-ai-retry:hover { background: ${tk.fillQuietHover}; color: ${tk.text}; }
/* 页脚常驻壳:v2.7.0 撤掉 hairline 与独立底色,改**居中**的静音说明 ——
   旧版是"贴了条灰带的页脚",新版是面板这张材料下缘的一行小字,不再自成一段 */
.pddcs-popup-foot { flex: 0 0 auto; padding: 0 ${PANEL_PAD_X}px ${spacing.lg}px; text-align: center;
  color: ${tk.textTertiary}; font-size: ${panelType.meta.size}px; line-height: 1.5; }
/* 键位键帽(v2.6.16):与 popup 设置页 HotkeyRow 的 <kbd> 同语言(灰底细边圆角等宽字)。
   字号随所在行的辅助档(v2.7.1,原为写死的 10px) */
.pddcs-kbd { display: inline-block; margin: 0 2px; padding: 1px 6px;
  border: 1px solid ${tk.border}; border-radius: ${radius.sm}px;
  background: ${tk.bg}; color: ${tk.textMuted};
  font-size: ${panelType.meta.size}px; line-height: 1.4; font-family: ui-monospace, Consolas, monospace; }

/* 轻提示 — 近黑 toast(两主题下都深底白字,可读性不随主题切换)。
   v2.7.0:圆角提到 radius.xl —— 单行时两端正好收成胶囊,与面板里那批无描边小控件同形;
   阴影一并加重一档,近黑浮块压在浅色页面上才不会像贴纸 */
.pddcs-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; background: rgba(22,22,22,.92); color: #fff; font-size: ${fontSize.body}px;
  padding: 9px 18px; border-radius: ${radius.xl}px; opacity: 0; transition: opacity .2s;
  max-width: 60vw; z-index: 2147483001; box-shadow: 0 6px 24px rgba(0,0,0,0.22); }
.pddcs-toast.show { opacity: 1; }
`
}
