/**
 * 聊天页覆盖层主题(2026-09-15 评审 设计1):
 * pdd-ai-button 的覆盖层 CSS 原先在模块顶用 `lightTheme as tk` 一次定格,
 * popup 里切深色后聊天页面板仍是白的。现把 CSS 抽成按 ThemeTokens 生成的纯函数,
 * 内容脚本负责读 chrome.storage(pddcs:theme)+ onChanged 实时重建。
 * 本模块保持纯逻辑(不触碰 chrome/DOM),供内容脚本与单测共用。
 * (2026-09-16 工程审查③-V2:自 utils/ 迁入 ui/,与令牌/尺寸/滚动条同层)
 */
import type { ThemeMode, ThemeTokens } from './theme'
import { controlH, fontFamily, fontSize, motion, radius, semantic, spacing } from './design'
import { thinScrollbarCss } from './scrollbar'

/** 与 popup 主题上下文(theme-context)共用的存储键 */
export const THEME_STORAGE_KEY = 'pddcs:theme'

/** 存储值容错解析:非法/缺失一律回退浅色 */
export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

/** 候选弹窗宽度(CSS 与 JS 定位共用,单处维护;v2.6.18 340→360,给 13.5px 中文正文松一档) */
export const POPUP_W = 360

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
  background: ${tk.bg}; border: 1px solid ${tk.border}; border-radius: ${radius.xxl}px;
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
/* 滚动中段:唯一滚动容器(6px 细轨挂此) */
.pddcs-popup-body { flex: 1 1 auto; overflow-y: auto; padding: 2px 0 4px; }
.pddcs-popup-close { margin-left: auto; border: none; background: none; cursor: pointer;
  width: 24px; height: 24px; border-radius: ${radius.sm}px; display: flex; align-items: center;
  justify-content: center; color: ${tk.textTertiary}; font-size: 15px; transition: background-color .12s ease; }
.pddcs-popup-close:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; }
/* 候选行(v2.6.18 重设计):通栏矩形 → 内缩圆角软行(留白分组,无分隔线);
   悬浮与键盘选中共用同一软中性灰圆角填充(第二十三轮用户指定的中性灰口径;
   旧 3px 左描边属表格行语言,随通栏行一并移除) */
/* 候选行(v2.6.20 收紧):行距 2px(外边距塌缩)+ 行内 padding 8px,
   条目间视觉间隙 24→18px,列表更紧凑;悬浮/选中语言不变 */
.pddcs-cand { position: relative; margin: 2px 8px; padding: 8px 28px 8px 12px; border-radius: ${radius.lg}px;
  cursor: pointer; transition: background-color .12s ease; }
.pddcs-cand:hover, .pddcs-cand-selected, .pddcs-cand-selected:hover { background: ${tk.selectedBg}; }
/* 折叠候选行:底边预留条位,右下角「同内容×n」不压正文 */
.pddcs-cand-folded { padding-bottom: 22px; }
.pddcs-cand-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
/* 候选分组标题(标准回答/历史/知识库):帮用户把不同来源的条目扫成块 */
.pddcs-cand-group { padding: 6px 14px; font-size: ${fontSize.caption}px; font-weight: 600;
  color: ${tk.textMuted}; letter-spacing: -0.01em; }
/* 填入指示箭头:行右侧中央,悬浮/键盘选中才显,提示整行可点击填入 */
.pddcs-cand-arrow { position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  color: ${tk.textMuted}; font-size: 14px; line-height: 1; opacity: 0; pointer-events: none;
  transition: opacity .12s ease; }
.pddcs-cand:hover .pddcs-cand-arrow, .pddcs-cand-selected .pddcs-cand-arrow { opacity: 1; }
/* 类别徽标(v2.6.19 重设计,用户"明显一点"):6px 圆点 → 软底色 chip ——
   标准回答 = 琥珀软底金字,知识库 = 绿软底绿字(色相同源 semantic,两表面不割裂),
   历史 = 中性灰软底灰字;10px caption 档不抢正文 */
.pddcs-badge { display: inline-flex; align-items: center; padding: 1px 7px;
  border-radius: ${radius.sm}px; font-size: 10px; font-weight: 500;
  background: ${tk.selectedBg}; color: ${tk.textMuted}; }
.pddcs-badge.golden { background: rgba(184, 134, 11, 0.14); color: ${semantic.golden}; }
.pddcs-badge.knowledge { background: rgba(20, 174, 92, 0.12); color: ${semantic.knowledge}; }
/* 同内容折叠数(v2.6.19,用户指定):移至行右下角,悬浮才显 */
.pddcs-fold { position: absolute; right: 10px; bottom: 6px; color: ${tk.textTertiary};
  font-size: 10px; opacity: 0; pointer-events: none; transition: opacity .12s ease; }
.pddcs-cand:hover .pddcs-fold { opacity: 1; }
/* 操作钮(v2.6.18):悬浮/选中才显 —— 静止时行内只有徽标+回显+正文,
   9 行候选不再顶着一排常驻灰字小钮;布局占位不变,显现无跳动 */
.pddcs-cand-actions { margin-left: auto; display: flex; gap: 4px;
  opacity: 0; pointer-events: none; transition: opacity .12s ease; }
.pddcs-cand:hover .pddcs-cand-actions, .pddcs-cand-selected .pddcs-cand-actions {
  opacity: 1; pointer-events: auto; }
.pddcs-mini { border: 1px solid transparent; background: transparent; border-radius: ${radius.sm}px;
  cursor: pointer; font-size: 10.5px; padding: 2px 8px; color: ${tk.textMuted}; font-weight: 500;
  transition: background-color .1s ease, color .1s ease; }
.pddcs-mini:hover { background: ${tk.borderLight}; color: ${tk.text}; }
/* 危险型迷你钮(取消标准回答):悬浮转红,与图标钮的危险态同语言 */
.pddcs-mini-danger { color: ${tk.errorText}; }
.pddcs-mini-danger:hover { background: ${tk.errorBg}; color: ${tk.errorText}; }
/* 回答正文 = 面板唯一主层(v2.6.17):13.5px + 1.6 行高,与其余 11.5/10.5 灰字拉开两档 */
.pddcs-cand-text { font-size: ${fontSize.title}px; line-height: 1.6; white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
/* 问题回显上置为引子(v2.6.17,原底部「原问题:…」来源行移此):11.5px 灰字单行省略 */
.pddcs-cand-q { margin-bottom: 3px; color: ${tk.textTertiary}; font-size: ${fontSize.secondary}px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
