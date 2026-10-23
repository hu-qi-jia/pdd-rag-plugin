/**
 * 聊天页覆盖层主题 — v5.1「石墨蓝灰」
 *
 * 与 popup 的差别只在一处:**这份样式注入平台页面**,够不到 popup 的 `<html>`,
 * 所以不吃 `--pddcs-*` 自定义属性,改为按 `ThemeTokens` 插值生成(切换主题时整体
 * 重建,见 contents/pdd-ai-button#applyOverlayTheme)。两边的**视觉语言同源**:
 * 冷灰调、系统无衬线(数字等宽)、圆角、强调色表达当前项。
 *
 * ── 为什么这里还留毛玻璃(v5.0 收紧了它)────────────────────────────────────
 * popup 是**原生窗口,背后没有内容** —— 在那儿做 glass 是白做的。面板压在 PDD
 * 页面上,后面有东西可透,材料语言在这里才成立。iOS 自己就是这么分的:
 * 窗口不透明,浮层半透明。
 *
 * 但 2026 的设计口径对毛玻璃是明确的负面评价,理由**不是审美而是对比度不可控**:
 * 半透明底的最终对比度取决于背后那张页面,而那是我们管不了的。v5.0 因此收紧两只手:
 *  ① **不透明度 0.72/0.74 → 0.90**,模糊 24px → 18px、饱和度 180% → 140%;
 *  ② **补一条 1px 实边框**(见下方 `border`)。
 * 边框是关键的一条:它在"背后恰好是张浅色图"这种最坏情况下把面板边界钉住,
 * 面板因此**有确定的边界**,而不是"一块糊在那儿的半透明区域"。
 *
 * 行的取色**不能用 `tk.fill` / `tk.selection`**:那两个画在半透明材料上会把玻璃
 * 一脚踩成实心板。故悬浮态按主题各给一组 rgba(见 `rowTints`)——
 * 也正因如此,本函数需要知道当前是哪种主题,签名比 popup 多一个 `mode`。
 */
import type { ThemeMode, ThemeTokens } from './theme'
import { controlH, fontFamily, fontFamilyMono, fontSize, panelType, radius, spacing } from './design'
import { thinScrollbarCss } from './scrollbar'
import { ICON_BTN_SIZE as ICON_BTN } from './overlay-icons'

/** 与 popup 主题上下文(theme-context)共用的存储键 */
export const THEME_STORAGE_KEY = 'pddcs:theme'

/** 存储值容错解析:非法/缺失一律回退浅色 */
export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

/** 候选弹窗宽度(CSS 与 JS 定位共用,单处维护) */
export const POPUP_W = 380

/** 行左右相对面板外缘的内缩量 = 可滚动中段的水平内边距 */
export const ROW_INSET_X = spacing.md
/** 行左右内边距(行内所有内容的公共左缘) */
export const ROW_PAD_X = 14
/** 行上下内边距 */
export const ROW_PAD_Y = spacing.xl
/** 行内纵向节奏 */
export const ROW_GAP_Y = spacing.sm
/** 面板文字内容的左右内边距(头部标题、页脚都取它) */
export const PANEL_PAD_X = ROW_INSET_X + ROW_PAD_X
/** 发丝线缩进量(面板里行文字的左缘) */
export const HAIR_IN = ROW_PAD_X
/** 类别标签:矩形 chip 的水平内边距(2026-10-19 从方括号改为矩形标签) */
export const BADGE_PAD_X = 6
/** 类别标签:矩形 chip 的高度与圆角。圆角取 4 —— 是矩形,不是胶囊 */
export const BADGE_H = 18
export const BADGE_RADIUS = 4

/**
 * 半透明材料上的**悬浮**填充 —— 不能用不透明令牌,否则玻璃被踩成实心板。
 * 选中态不走这里:它有语义(强调色软底),走 `tk.accentSoft`,见下方 `.pddcs-cand-selected`。
 */
function rowTints(mode: ThemeMode): { hover: string; hair: string } {
  return mode === 'dark'
    ? { hover: 'rgba(255,255,255,0.06)', hair: 'rgba(255,255,255,0.09)' }
    : { hover: 'rgba(28,38,52,0.05)', hair: 'rgba(28,38,52,0.08)' }
}

/**
 * 面板的 1px 实边框 —— v5.0 新增,是"半透明底也能读"的兜底(理由见文件头)。
 * 深色用白描边、浅色用石墨描边:两边都不是纯黑纯白,免得边框自己跳出来成为主角。
 */
function panelBorder(mode: ThemeMode): string {
  return mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(28,38,52,0.10)'
}

/**
 * 面板的**材料底色** —— CSS 与内容脚本的内联兜底**取同一个值**。
 *
 * 内联兜底存在的理由:本样式注入平台页面,类规则可能被页面级 `!important` 盖掉,
 * 内联背景优先级更高。而两份值一旦分家,兜底就会把毛玻璃一脚踩成不透明板 ——
 * 所以取哪个值由这里单点决定,两边共用、单测可断。
 */
export function panelSurface(mode: ThemeMode): string {
  return mode === 'dark' ? 'rgba(30,33,38,0.90)' : 'rgba(252,253,254,0.90)'
}

export function buildOverlayCss(tk: ThemeTokens, mode: ThemeMode = 'light'): string {
  const t = rowTints(mode)
  return `
#pddcs-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
  font-family: ${fontFamily}; }

/* 焦点环 —— 面板里的每一枚钮都是真 <button>(AI回复、关闭、行尾 ☆/⧉、重试),
   平台页面上 Tab 得到。没有这条,键盘走到哪里**看不出来**。
   popup 侧同一条规则(强调色 2px 外环),见 popup-css */
#pddcs-overlay :focus-visible { outline: 2px solid ${tk.accent}; outline-offset: 2px; }

/* AI回复按钮 —— 与 popup 的填充式控件同语言(填充底、圆角),悬浮反白。
   唯一的差别是这枚钮要**压在任意页面**上:给一圈 1px 描边,免得落在浅底页面
   或花哨背景上时边界糊掉(popup 在自己的白面上不需要这条) */
.pddcs-ai-btn { position: fixed; box-sizing: border-box; height: ${controlH.form}px;
  border-radius: ${radius.control}px; border: 1px solid ${tk.border};
  cursor: pointer; pointer-events: auto; padding: 0 ${spacing.xxl}px;
  display: inline-flex; align-items: center;
  background: ${tk.bg}; color: ${tk.text};
  font-size: ${fontSize.sub}px; font-weight: 500; line-height: 1;
  transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s, border-color .18s; }
.pddcs-ai-btn:hover { background: ${tk.accent}; color: ${tk.onAccent}; border-color: ${tk.accent}; }
.pddcs-ai-btn .pddcs-ai-btn-label { white-space: nowrap; }
.pddcs-ai-btn:disabled { opacity: .55; cursor: wait; }

/* 候选弹窗 —— 一张**材料**:半透明底 + 背景模糊 + 内高光 + 三段阴影。
   这是全项目唯一该用毛玻璃的地方(它真的浮在别的内容上) */
.pddcs-popup { position: fixed; width: ${POPUP_W}px; max-height: min(62vh, calc(100vh - 16px));
  display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: ${panelSurface(mode)};
  backdrop-filter: saturate(140%) blur(18px);
  -webkit-backdrop-filter: saturate(140%) blur(18px);
  border: 1px solid ${panelBorder(mode)};
  border-radius: ${radius.panel}px;
  box-shadow: ${mode === 'dark'
    ? '0 0 0 .5px rgba(255,255,255,0.12), 0 2px 10px rgba(0,0,0,0.5), 0 16px 48px rgba(0,0,0,0.6)'
    : '0 0 0 .5px rgba(0,0,0,0.08), 0 2px 10px rgba(0,0,0,0.08), 0 16px 48px rgba(0,0,0,0.18)'};
  font-size: ${panelType.meta.size}px; color: ${tk.text}; }
/* 引擎不支持模糊时退回不透明面色 —— 半透明底 + 无模糊 = 看得见后面的字,比纯色更糟 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .pddcs-popup { background: ${tk.bg}; }
}
@media (prefers-reduced-transparency: reduce) {
  .pddcs-popup { background: ${tk.bg}; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
${thinScrollbarCss('.pddcs-popup-body', tk.scrollThumb)}

/* 头部:面板名(17/600)+ 计数(12/等宽灰)+ 关闭钮;下缘一条**通栏**线 */
.pddcs-popup-head { display: flex; align-items: baseline; gap: ${spacing.md}px; flex: 0 0 auto;
  padding: ${spacing.xxl}px ${PANEL_PAD_X}px ${spacing.md}px;
  border-bottom: 1px solid ${t.hair}; color: ${tk.text}; }
.pddcs-popup-title { font-size: ${panelType.title.size}px; font-weight: ${panelType.title.weight};
  letter-spacing: -0.01em; line-height: 1.3; color: ${tk.text}; }
.pddcs-popup-count { font-family: ${fontFamilyMono}; font-size: ${panelType.meta.size}px;
  line-height: 1.3; color: ${tk.textTertiary}; font-variant-numeric: tabular-nums; }
/* 关闭钮 = 28px 图标钮(与行内 ☆/⧉ 同一档同一形状) */
.pddcs-popup-close { margin-left: auto; align-self: center; flex: 0 0 auto; box-sizing: border-box;
  width: ${ICON_BTN}px; height: ${ICON_BTN}px; padding: 0; border: none; cursor: pointer;
  border-radius: ${radius.control}px; display: flex; align-items: center; justify-content: center;
  background: transparent; color: ${tk.textTertiary}; font-size: ${fontSize.body}px; line-height: 1;
  transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s; }
.pddcs-popup-close:hover { background: ${t.hover}; color: ${tk.text}; }

/* 滚动中段:唯一滚动容器。
   **不留 scrollbar-gutter**:留槽会在这条带底色的面板里空出一条 6px 的竖带,
   选中行的软底到不了右缘,看起来像卡片右侧缺了一块(用户实测反馈)。代价是
   滚动条出现/消失时内容宽度会变 6px —— 面板只在行数超出时才滚,比常驻一条空带可接受。 */
.pddcs-popup-body { flex: 1 1 auto; overflow-y: auto;
  padding: ${spacing.xs}px 0 ${spacing.md}px; }

/* ── 候选行:通铺 + **缩进**发丝线 ─────────────────────────────────────────── */
.pddcs-cand { position: relative; padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px;
  cursor: pointer; transition: background-color .18s cubic-bezier(.32,.72,0,1); }
.pddcs-cand::after { content: ""; position: absolute; left: ${HAIR_IN}px; right: 0; bottom: 0;
  height: 1px; background: ${t.hair}; pointer-events: none; }
.pddcs-popup-body > *:last-child::after { display: none; }

/* 选中 = 淡底(不是黑块)。
   两种面板同一规则,但**键盘面板**里选中态由 Tab 独占:鼠标一悬浮就把选中带过去,
   会让"Enter 到底填哪条"在视觉上说不清(2026-09-17 用户反馈)——
   故键盘面板下悬浮不改变任何可见状态(下面各处 :hover 一律加这个守卫) */
/* 选中态走**强调色软底**而不是中性淡底(v5.0):候选之间是"选哪一条"的取舍,
   而当前选中必须一眼可辨 —— 中性淡底在浅色页面上几乎看不出来 */
.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand:hover { background: ${t.hover}; }
.pddcs-cand-selected, .pddcs-cand-selected:hover { background: ${tk.accentSoft}; }
/* 选中行的左缘一道强调色竖条 —— 软底在花哨背景上可能不够抢眼,竖条是第二重保险 */
.pddcs-cand-selected { box-shadow: inset 3px 0 0 ${tk.accent}; }

.pddcs-cand-top { display: flex; align-items: center; gap: 7px; margin-bottom: ${ROW_GAP_Y}px; }
/* 类别标签 = **矩形 chip**(2026-10-19)。
   方括号终端记法([历史])在用户实测里不够像"标签",只够像正文里的注记;改成带底色的
   矩形块后,三类来源各自成块,扫读时先看到色块再看到字。
   圆角取 4px 而不是控件档 13px:这是"标签",不是按钮,也不做成胶囊。 */
.pddcs-tag { display: inline-flex; align-items: center; height: ${BADGE_H}px;
  padding: 0 ${BADGE_PAD_X}px; border-radius: ${BADGE_RADIUS}px;
  font-family: ${fontFamily}; font-size: ${panelType.meta.size}px; font-weight: 600;
  line-height: 1; white-space: nowrap; color: ${tk.textTertiary}; }
/* 三类来源各一套"底色 + 文字色":标准回答 = 靛蓝、知识库 = 绿、历史 = 中性灰。
   底色都用各自的 soft 档,字色用同色系的深/亮档 —— 不靠明度排序,三类同时可读。 */
.pddcs-tag[data-kind='golden'] { color: ${tk.accentText}; background: ${tk.accentSoft}; }
.pddcs-tag[data-kind='knowledge'] { color: ${tk.infoText}; background: ${tk.infoSoft}; }
.pddcs-tag[data-kind='history'] { color: ${tk.textSecondary}; background: ${tk.selection}; }
.pddcs-fold { font-family: ${fontFamilyMono}; color: ${tk.textTertiary};
  font-size: ${panelType.meta.size}px; line-height: 1; white-space: nowrap;
  font-variant-numeric: tabular-nums; }

/* 操作钮:静止时不显,悬浮/选中才出两枚图标钮 */
.pddcs-cand-actions { margin-left: auto; margin-right: -6px; display: flex; gap: 2px;
  opacity: 0; pointer-events: none; transition: opacity .18s cubic-bezier(.32,.72,0,1); }
.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand:hover .pddcs-cand-actions,
.pddcs-cand-selected .pddcs-cand-actions { opacity: 1; pointer-events: auto; }
.pddcs-icon-btn { width: ${ICON_BTN}px; height: ${ICON_BTN}px; flex: 0 0 auto; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; border: none;
  border-radius: ${radius.control}px; background: transparent; color: ${tk.textTertiary};
  cursor: pointer; transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s; }
.pddcs-icon-btn:hover { background: ${t.hover}; color: ${tk.text}; }
.pddcs-icon-btn:disabled { opacity: .5; cursor: default; }
/* 已设标准 = 实心星 + 强调色。v5.0 起有强调色可用,不再只靠"实心 vs 描边" */
.pddcs-icon-btn-golden { color: ${tk.accent}; }
.pddcs-icon-btn-busy svg { animation: pddcs-spin .7s linear infinite; }
@keyframes pddcs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pddcs-icon-btn-busy svg { animation: none; } }

/* 回答正文 = 面板唯一主层(15 / 1.6) */
.pddcs-cand-text { font-size: ${panelType.content.size}px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word; color: ${tk.textSecondary};
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
/* 问题回显上置为引子:12px 灰字单行省略 */
.pddcs-cand-q { margin-bottom: ${ROW_GAP_Y}px; color: ${tk.textTertiary};
  font-size: ${panelType.meta.size}px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── 「根据知识库内容整合并回复」行 ────────────────────────────────────────
   它是**一次动作**,不是一条候选 —— 靠**底色**说清楚,不靠描边(v4.0 把框去掉了:
   整页只剩"行的发丝线"这一种线,在这里单独开一个框会显得突兀) */
/* 底色走**强调色软底**(v5.0):它是一次"会花 API 额度"的动作,不是又一条候选。
   软底把它和上下那些候选从材料上分开,而不必再加一个框 */
.pddcs-cand.pddcs-ai-row { display: flex; flex-direction: column; gap: ${ROW_GAP_Y}px;
  cursor: default; background: ${tk.accentSoft}; }
.pddcs-popup:not(.pddcs-popup-keyboard) .pddcs-cand.pddcs-ai-row:hover,
.pddcs-cand.pddcs-ai-row.pddcs-cand-selected { background: ${tk.accentSoft}; filter: brightness(.97); }
.pddcs-cand.pddcs-ai-row.is-error { background: ${tk.dangerSoft}; }
.pddcs-cand.pddcs-ai-row.is-error .pddcs-ai-label { color: ${tk.danger}; }
/* 只有"还没点过"的整行才是大按钮;出结果后整行不再是触发器 ——
   想复制生成内容的人不该因为点了一下文字就再花一次 API 请求 */
.pddcs-cand.pddcs-ai-row.is-idle { cursor: pointer; }
.pddcs-ai-main { display: flex; align-items: center; gap: ${spacing.md}px;
  min-height: ${ICON_BTN}px; }
.pddcs-ai-label { color: ${tk.accentText}; font-size: ${panelType.action.size}px;
  font-weight: ${panelType.action.weight}; line-height: 1.6; }
/* 第二块:说明行与生成结果同档同排版,换状态时行内不跳字号;区分只靠颜色 */
.pddcs-ai-hint { color: ${tk.textTertiary};
  font-size: ${panelType.content.size}px; line-height: 1.6;
  white-space: pre-line; overflow-wrap: break-word; }
.pddcs-ai-draft { color: ${tk.text}; font-size: ${panelType.content.size}px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.pddcs-ai-retry { box-sizing: border-box; flex: 0 0 auto; margin-left: auto;
  height: ${ICON_BTN}px; padding: 0 ${spacing.xl}px; border: none;
  border-radius: ${radius.control}px; background: ${t.hover};
  color: ${tk.accentText}; font-size: ${panelType.meta.size}px; line-height: 1; cursor: pointer;
  transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s; }
.pddcs-ai-retry:hover { background: ${tk.accent}; color: ${tk.onAccent}; }

/* 页脚:上缘通栏线 + 居中静音说明 */
.pddcs-popup-foot { flex: 0 0 auto; padding: ${spacing.lg}px ${PANEL_PAD_X}px;
  border-top: 1px solid ${t.hair}; text-align: center;
  color: ${tk.textTertiary}; font-size: ${panelType.meta.size}px; line-height: 1.5; }
/* 键帽:圆角取控件档(与设置页那枚键帽同源)。曾经是写死的 5px,
   而设置页写的是 6px —— 同一件东西两个值,正因为两边都不引用令牌 */
.pddcs-kbd { display: inline-block; margin: 0 2px; padding: 2px 6px;
  border: 1px solid ${t.hair}; border-radius: ${radius.control}px;
  background: ${t.hover}; color: ${tk.textSecondary};
  font-family: ${fontFamilyMono}; font-size: ${panelType.meta.size}px; line-height: 1.4; }

/* 轻提示 — 近黑 toast(两主题下都深底白字,可读性不随主题切换) */
/* 轻提示:纯告知,没有任何可点内容 —— pointer-events:none 让它彻底穿过点击。
   auto 会让它悬在页面顶部正中时**吃掉**那一片的点击(它看起来不像挡了什么) */
.pddcs-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  pointer-events: none; background: rgba(22,22,24,.94); color: #FAFAFA;
  font-size: ${fontSize.sub}px; padding: 10px 18px; border-radius: ${radius.control}px;
  opacity: 0; transition: opacity .2s; max-width: 60vw;
  box-shadow: 0 6px 24px rgba(0,0,0,0.22); }
.pddcs-toast.show { opacity: 1; }
`
}
