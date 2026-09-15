/**
 * 聊天页覆盖层主题(2026-09-15 评审 设计1):
 * pdd-ai-button 的覆盖层 CSS 原先在模块顶用 `lightTheme as tk` 一次定格,
 * popup 里切深色后聊天页面板仍是白的。现把 CSS 抽成按 ThemeTokens 生成的纯函数,
 * 内容脚本负责读 chrome.storage(pddcs:theme)+ onChanged 实时重建。
 * 本模块保持纯逻辑(不触碰 chrome/DOM),供内容脚本与单测共用。
 *
 * 第十四轮(2026-09-15):面板重设计 —— 入场动效、候选行错峰进入、悬浮左蓝条 +
 * 「填入」悬浮主钮、头部检索依据行、键帽脚注(头/脚双 sticky)、面板内细滚动条;
 * 「AI回复」按钮升为实心蓝主钮(页面上唯一的品牌入口)。主题色 = 飞书蓝 #3370FF。
 */
import type { ThemeTokens } from '../ui/theme'
import { controlH, fontFamily, fontSize, motion, radius, semantic, spacing } from '../ui/design'

/** 与 popup 主题上下文(theme-context)共用的存储键 */
export const THEME_STORAGE_KEY = 'pddcs:theme'

export type OverlayThemeMode = 'light' | 'dark'

/** 存储值容错解析:非法/缺失一律回退浅色 */
export function parseThemeMode(value: unknown): OverlayThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

/** 候选弹窗宽度(CSS 与 JS 定位共用,单处维护) */
export const POPUP_W = 340

export function buildOverlayCss(tk: ThemeTokens): string {
  return `
#pddcs-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
  font-family: ${fontFamily}; }

/* AI回复按钮 — 实心品牌蓝主钮(页面上唯一品牌入口,蓝色保证可发现性)
   (26px 高 / 6px 圆角 / 12.5px 字号:2026-09-15 用户反馈原 20px 偏小,与整体设计脱节)
   box-sizing 显式声明:本样式注入平台页面,不享受 popup 的全局 border-box 重置 */
.pddcs-ai-btn { position: fixed; box-sizing: border-box; height: ${controlH.form}px;
  border-radius: ${radius.md}px; border: 1px solid transparent;
  cursor: pointer; pointer-events: auto; padding: 0 ${spacing.xl}px; display: inline-flex; align-items: center;
  background: ${tk.btnPrimaryBg}; color: ${tk.btnPrimaryText}; font-size: ${fontSize.body}px; font-weight: 500; line-height: 1;
  letter-spacing: -0.01em; box-shadow: ${tk.btnPrimaryShadow};
  transition: background-color .12s ease, transform .12s ease; }
.pddcs-ai-btn:hover { background: ${tk.btnPrimaryHover}; }
.pddcs-ai-btn:active { transform: scale(.97); }
.pddcs-ai-btn .pddcs-ai-btn-label { white-space: nowrap; }
.pddcs-ai-btn:disabled { opacity: .55; cursor: wait; }

/* 推荐回复面板 — 工具风浮层卡片:入场动效 + 内部细滚动条 */
@keyframes pddcs-pop-in { from { opacity: 0; transform: translateY(6px) scale(.97); } to { opacity: 1; transform: none; } }
@keyframes pddcs-row-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.pddcs-popup { position: fixed; width: ${POPUP_W}px; max-height: min(62vh, calc(100vh - 16px)); overflow: auto;
  pointer-events: auto; background: ${tk.bg}; border: 1px solid ${tk.border}; border-radius: ${radius.xl}px;
  box-shadow: ${tk.shadow};
  font-size: ${fontSize.body}px; color: ${tk.text};
  animation: pddcs-pop-in ${motion.emphasized}; transform-origin: top left;
  scrollbar-width: thin; scrollbar-color: transparent transparent; }
.pddcs-popup:hover { scrollbar-color: ${tk.scrollThumb} transparent; }
.pddcs-popup::-webkit-scrollbar { width: 10px; }
.pddcs-popup::-webkit-scrollbar-thumb { background: transparent; border-radius: 9999px; border: 3px solid transparent;
  background-clip: content-box; min-height: 40px; }
.pddcs-popup:hover::-webkit-scrollbar-thumb { background: ${tk.scrollThumb}; background-clip: content-box; }

/* 头部:标题行(标题 + 数量徽 + 关闭)+ 检索依据行;双 sticky,滚动时头脚恒在 */
.pddcs-popup-head { position: sticky; top: 0; z-index: 1; padding: 10px 14px 8px;
  border-bottom: 1px solid ${tk.borderLight}; background: ${tk.bg}; }
.pddcs-popup-title-row { display: flex; align-items: center; gap: ${spacing.sm}px; }
.pddcs-popup-title { font-weight: 600; font-size: ${fontSize.title}px; letter-spacing: -0.01em; }
.pddcs-popup-count { display: inline-flex; align-items: center; height: 16px; padding: 0 7px;
  border-radius: ${radius.pill}; background: ${tk.btnBg}; color: ${tk.btnText};
  font-size: ${fontSize.caption}px; font-weight: 600; font-variant-numeric: tabular-nums; }
.pddcs-popup-query { margin-top: 3px; color: ${tk.textTertiary}; font-size: ${fontSize.caption}px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pddcs-popup-close { margin-left: auto; border: none; background: none; cursor: pointer;
  width: 24px; height: 24px; border-radius: ${radius.sm}px; display: flex; align-items: center;
  justify-content: center; color: ${tk.textTertiary}; font-size: 15px; transition: background-color .12s ease; }
.pddcs-popup-close:hover { background: ${tk.borderLight}; color: ${tk.text}; }

/* 候选行:错峰入场;悬浮 = 中性提亮底 + 左侧蓝色指示条(零布局位移) */
.pddcs-cand { position: relative; padding: 10px 14px; border-bottom: 1px solid ${tk.borderLight};
  cursor: pointer; transition: background-color .1s ease, box-shadow .1s ease;
  animation: pddcs-row-in .18s ease backwards; }
.pddcs-cand:nth-child(3) { animation-delay: 30ms; }
.pddcs-cand:nth-child(4) { animation-delay: 60ms; }
.pddcs-cand:nth-child(5) { animation-delay: 90ms; }
.pddcs-cand:hover { background: ${tk.borderLight}; box-shadow: inset 2px 0 0 ${tk.accent}; }
/* 末行(脚注前)去底边,由脚注 border-top 单独成线,避免双线 */
.pddcs-cand:nth-last-child(2) { border-bottom: none; }
.pddcs-cand-top { display: flex; align-items: center; gap: ${spacing.sm}px; margin-bottom: 5px; }
.pddcs-badge { display: inline-flex; align-items: center; border-radius: ${radius.sm}px;
  font-size: 10px; font-weight: 600; padding: 2px 7px; }
.pddcs-badge.golden { background: ${semantic.goldenBg}; color: ${semantic.golden}; }
.pddcs-badge.knowledge { background: ${semantic.knowledgeBg}; color: ${semantic.knowledge}; }
.pddcs-badge.history { background: ${tk.bgCard}; color: ${tk.textMuted}; border: 1px solid ${tk.border}; }
.pddcs-fold { color: ${tk.textTertiary}; font-size: 10px; }
.pddcs-cand-actions { margin-left: auto; display: flex; gap: 4px; }
.pddcs-mini { border: 1px solid transparent; background: transparent; border-radius: ${radius.sm}px;
  cursor: pointer; font-size: 10.5px; padding: 2px 8px; color: ${tk.textMuted}; font-weight: 500;
  transition: background-color .1s ease, color .1s ease; }
.pddcs-mini:hover { background: ${tk.borderLight}; color: ${tk.text}; }
/* 「设置标准回答」= 面板内的蓝色强调迷你钮;「取消标准回答」保持危险红 */
.pddcs-mini-accent { color: ${tk.accent}; }
.pddcs-mini-accent:hover { background: ${tk.btnBg}; color: ${tk.accentHover}; }
/* 危险型迷你钮(取消标准回答):悬浮转红,与图标钮的危险态同语言 */
.pddcs-mini-danger { color: ${tk.errorText}; }
.pddcs-mini-danger:hover { background: ${tk.errorBg}; color: ${tk.errorText}; }
.pddcs-cand-text { white-space: pre-wrap; word-break: break-word; line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
/* 来源行右侧留出「填入」钮的落位(悬浮前不遮文本) */
.pddcs-cand-src { margin-top: 5px; padding-right: 52px; color: ${tk.textTertiary}; font-size: 11px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 悬浮「填入」主钮:默认隐藏,行悬浮/键盘聚焦时显现 —— 把"整行可点"变成可见 affordance */
.pddcs-fill { position: absolute; right: 10px; bottom: 8px; height: 22px; padding: 0 10px;
  display: inline-flex; align-items: center; border: none; border-radius: ${radius.md}px;
  background: ${tk.btnPrimaryBg}; color: ${tk.btnPrimaryText}; font-size: 10.5px; font-weight: 600;
  cursor: pointer; opacity: 0; transform: translateY(2px); box-shadow: ${tk.btnPrimaryShadow};
  transition: opacity .12s ease, transform .12s ease, background-color .12s ease; }
.pddcs-cand:hover .pddcs-fill, .pddcs-cand:focus-within .pddcs-fill { opacity: 1; transform: none; }
.pddcs-fill:hover { background: ${tk.btnPrimaryHover}; }
.pddcs-fill:active { transform: scale(.96); }

/* 脚注:吸附底部;快捷键面板的 Enter 用键帽渲染 */
.pddcs-popup-foot { position: sticky; bottom: 0; display: flex; align-items: center; gap: 4px;
  padding: 7px 14px; border-top: 1px solid ${tk.borderLight}; background: ${tk.bg};
  color: ${tk.textTertiary}; font-size: 11px; }
.pddcs-kbd { display: inline-block; padding: 0 5px; border: 1px solid ${tk.border}; border-bottom-width: 2px;
  border-radius: 4px; background: ${tk.bgSecondary}; color: ${tk.textMuted};
  font-family: ui-monospace, Consolas, monospace; font-size: 10px; line-height: 15px; }

/* 轻提示 — 近黑 toast(两主题下都深底白字,可读性不随主题切换) */
.pddcs-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; background: rgba(22,22,22,.92); color: #fff; font-size: ${fontSize.body}px;
  padding: 8px 16px; border-radius: ${radius.md}px; opacity: 0; transition: opacity .2s;
  max-width: 60vw; z-index: 2147483001; box-shadow: 0 4px 16px rgba(0,0,0,0.20); }
.pddcs-toast.show { opacity: 1; }
`
}
