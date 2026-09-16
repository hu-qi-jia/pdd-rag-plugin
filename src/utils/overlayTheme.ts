/**
 * 聊天页覆盖层主题(2026-09-15 评审 设计1):
 * pdd-ai-button 的覆盖层 CSS 原先在模块顶用 `lightTheme as tk` 一次定格,
 * popup 里切深色后聊天页面板仍是白的。现把 CSS 抽成按 ThemeTokens 生成的纯函数,
 * 内容脚本负责读 chrome.storage(pddcs:theme)+ onChanged 实时重建。
 * 本模块保持纯逻辑(不触碰 chrome/DOM),供内容脚本与单测共用。
 */
import type { ThemeTokens } from '../ui/theme'
import { controlH, fontFamily, fontSize, radius, semantic, spacing } from '../ui/design'

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

/* 候选弹窗 — 工具风浮层卡片 */
.pddcs-popup { position: fixed; width: ${POPUP_W}px; max-height: min(62vh, calc(100vh - 16px)); overflow: auto;
  pointer-events: auto; background: ${tk.bg}; border: 1px solid ${tk.border}; border-radius: ${radius.xl}px;
  box-shadow: ${tk.shadow};
  font-size: ${fontSize.body}px; color: ${tk.text}; }
.pddcs-popup-head { display: flex; align-items: center; padding: 11px 14px;
  border-bottom: 1px solid ${tk.borderLight}; font-weight: 600; font-size: ${fontSize.title}px; position: sticky; top: 0;
  background: ${tk.bg}; letter-spacing: -0.01em; }
.pddcs-popup-close { margin-left: auto; border: none; background: none; cursor: pointer;
  width: 24px; height: 24px; border-radius: ${radius.sm}px; display: flex; align-items: center;
  justify-content: center; color: ${tk.textTertiary}; font-size: 15px; transition: background-color .12s ease; }
.pddcs-popup-close:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; }
.pddcs-cand { padding: 10px 14px; border-bottom: 1px solid ${tk.borderLight}; cursor: pointer;
  transition: background-color .1s ease, box-shadow .1s ease; }
.pddcs-cand:hover { background: ${tk.btnHoverBg}; }
/* 键盘选中态(v2.6.13 加强:accent 软底 + 3px 左描边,原 btnHoverBg 底太淡难辨);
   :hover 同列避免悬浮底色盖掉选中底色(specificity 同级时后者胜);
   悬浮会把选中态一并带过去(mouseenter 写同一 state),两套高亮不打架 */
.pddcs-cand-selected, .pddcs-cand-selected:hover { background: ${tk.accentBg};
  box-shadow: inset 3px 0 0 ${tk.accent}; }
.pddcs-cand-top { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.pddcs-badge { display: inline-flex; align-items: center; border-radius: ${radius.sm}px;
  font-size: 10px; font-weight: 600; padding: 2px 7px; }
.pddcs-badge.golden { background: ${semantic.goldenBg}; color: ${semantic.golden}; }
.pddcs-badge.knowledge { background: ${semantic.knowledgeBg}; color: ${semantic.knowledge}; }
.pddcs-badge.history { background: ${tk.bgCard}; color: ${tk.textMuted}; border: 1px solid ${tk.border}; }
.pddcs-score { color: ${tk.textTertiary}; font-size: 10px; font-variant-numeric: tabular-nums; }
.pddcs-fold { color: ${tk.textTertiary}; font-size: 10px; }
.pddcs-cand-actions { margin-left: auto; display: flex; gap: 4px; }
.pddcs-mini { border: 1px solid transparent; background: transparent; border-radius: ${radius.sm}px;
  cursor: pointer; font-size: 10.5px; padding: 2px 8px; color: ${tk.textMuted}; font-weight: 500;
  transition: background-color .1s ease, color .1s ease; }
.pddcs-mini:hover { background: ${tk.borderLight}; color: ${tk.text}; }
/* 危险型迷你钮(取消标准回答):悬浮转红,与图标钮的危险态同语言 */
.pddcs-mini-danger { color: ${tk.errorText}; }
.pddcs-mini-danger:hover { background: ${tk.errorBg}; color: ${tk.errorText}; }
.pddcs-cand-text { white-space: pre-wrap; word-break: break-word; line-height: 1.55;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.pddcs-cand-src { margin-top: 5px; color: ${tk.textTertiary}; font-size: 11px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pddcs-popup-foot { padding: 8px 14px; color: ${tk.textTertiary}; font-size: 11px; }

/* 轻提示 — 近黑 toast(两主题下都深底白字,可读性不随主题切换) */
.pddcs-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; background: rgba(22,22,22,.92); color: #fff; font-size: ${fontSize.body}px;
  padding: 8px 16px; border-radius: ${radius.md}px; opacity: 0; transition: opacity .2s;
  max-width: 60vw; z-index: 2147483001; box-shadow: 0 4px 16px rgba(0,0,0,0.20); }
.pddcs-toast.show { opacity: 1; }
`
}
