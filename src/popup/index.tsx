/**
 * Popup — Figma 编辑器工具风面板(对齐 pddddd 控制台设计语言)
 *
 * 布局:左侧 52px 图标导航栏 + 右侧内容区。
 * 四页签(设计文档 §7)与全部功能不变:记忆列表 / 回复文件夹 / 知识库 / 设置。
 * 视觉:工具风设计令牌 —— 白面板细边框、小圆角(6px 控件)、黑白主色。
 */

import React, { useCallback, useEffect, useState } from 'react'
import { ThemeProvider, useTheme } from '../ui/theme-context'
import { getThemeTokens, type ThemeTokens } from '../ui/theme'
import { controlH, fontFamily, fontSize, fontWeight, radius, size, spacing } from '../ui/design'
import {
  BookOpenIcon,
  FolderIcon,
  GearIcon,
  MessageSquareIcon,
  MoonIcon,
  SunIcon,
} from '../ui/icons'
import { sendMessage } from '../utils/message-passing'
import type { GetStatsResponse } from '../types/messages'
import { MemoryListTab } from './MemoryListTab'
import { FoldersTab } from './FoldersTab'
import { KnowledgeTab } from './KnowledgeTab'
import { SettingsTab } from './SettingsTab'

const RAIL_W = size.railWidth
const POPUP_WIDTH = size.popupWidth
/** 固定高度(内容区自行滚动),保证 popup 外形稳定 */
const POPUP_HEIGHT = size.popupHeight

const RESET_CSS = `
html, body { margin: 0; padding: 0; background: transparent !important; }
* { box-sizing: border-box; }

/* ── 按钮(工具风直角控件;高度固定为表单档,保证与同排输入框等高)───── */
.pddcs-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: ${controlH.form}px; padding: 0 12px; border-radius: 6px; border: 1px solid;
  font-size: 12px; font-weight: 500; line-height: 1.5;
  cursor: pointer; white-space: nowrap; font-family: inherit;
  transition: background-color .12s ease, border-color .12s ease, opacity .12s ease;
}
.pddcs-btn:disabled { opacity: .45; cursor: not-allowed; }

/* ── 输入框(focus 时描边提亮,无重投影)────────────────── */
.pddcs-input {
  width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid;
  font-size: 12px; outline: none; font-family: inherit; line-height: 1.5;
  transition: border-color .12s ease;
}

/* ── 滚动条:细、悬浮才出现(滑块色随主题令牌注入,暗色下必须走浅色)── */
.pddcs-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.pddcs-scroll:hover { scrollbar-color: var(--pddcs-scroll-thumb) transparent; }
.pddcs-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.pddcs-scroll::-webkit-scrollbar-thumb {
  background: transparent; border-radius: 9999px; border: 2px solid transparent;
  background-clip: content-box; min-height: 36px;
}
.pddcs-scroll:hover::-webkit-scrollbar-thumb {
  background: var(--pddcs-scroll-thumb); background-clip: content-box;
}

/* ── 导航图标按钮:任何状态下都只有图标本身,无背景块(2026-09-15 用户要求)── */
.pddcs-rail-btn {
  width: 36px; height: 36px; padding: 0; border: none; border-radius: 6px;
  background: transparent;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; position: relative;
}

/* ── 行悬浮操作:默认透明,悬浮/聚焦时显现(pddddd doc-ops 同款)── */
.pddcs-row-ops { opacity: 0; transition: opacity .12s ease; }
.pddcs-row:hover .pddcs-row-ops,
.pddcs-row:focus-within .pddcs-row-ops { opacity: 1; }
`

type TabId = 'memory' | 'folders' | 'knowledge' | 'settings'

type StatsPayload = GetStatsResponse['payload']

/**
 * 顶部概览按页签**分散展示**(2026-09-15 用户要求):
 * 原来四个计数全堆在头部,与当前页面无关;现在只显示本页相关的,
 * 设置页不展示(设置本身就是"配置项",不需要计数)。
 */
function tabSummary(id: TabId, stats: StatsPayload | null): string {
  if (!stats) return '读取中…'
  switch (id) {
    case 'memory':
      return `问答 ${stats.qaCount} · 回复 ${stats.replyCount}`
    case 'folders':
      return `文件夹 ${stats.folderCount} · 标准回答 ${stats.goldenCount}`
    case 'knowledge':
      return `知识 ${stats.knowledgeCount}`
    case 'settings':
      return ''
  }
}

const TABS: { id: TabId; label: string; Icon: typeof MessageSquareIcon }[] = [
  { id: 'memory', label: '记忆', Icon: MessageSquareIcon },
  { id: 'folders', label: '文件夹', Icon: FolderIcon },
  { id: 'knowledge', label: '知识库', Icon: BookOpenIcon },
  { id: 'settings', label: '设置', Icon: GearIcon },
]

function App() {
  const { theme, toggleTheme } = useTheme()
  const tk = getThemeTokens(theme)
  const [tab, setTab] = useState<TabId>('memory')
  const [stats, setStats] = useState<GetStatsResponse['payload'] | null>(null)

  const refreshStats = useCallback(async () => {
    try {
      const resp = await sendMessage<GetStatsResponse>({ type: 'GET_STATS' })
      setStats(resp.payload)
    } catch {
      /* 统计失败不阻塞面板 */
    }
  }, [])

  useEffect(() => {
    const id = 'pddcs-popup-reset-style'
    if (!document.getElementById(id)) {
      const el = document.createElement('style')
      el.id = id
      el.textContent = RESET_CSS
      document.head.appendChild(el)
    }
    void refreshStats()
  }, [refreshStats])

  const railBtn = (active: boolean): React.CSSProperties => ({
    // 图标状态只靠颜色与描边粗细表达,无任何背景块(2026-09-15 用户要求:
    // "仅展示图标即可,图标后不需要有背景" —— 含悬浮态)
    color: active ? tk.text : tk.textMuted,
  })

  // 令牌 → CSS 变量的桥(静态 CSS 无法直接读 React 令牌)
  const cssVars = {
    '--pddcs-scroll-thumb': tk.scrollThumb,
  } as React.CSSProperties

  return (
    <div
      style={{
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        display: 'flex',
        overflow: 'hidden',
        borderRadius: radius.xl,
        boxShadow: tk.shadow,
        fontFamily,
        backgroundColor: tk.bg,
        color: tk.text,
        ...cssVars,
      }}
    >
      {/* ── 左侧图标导航栏(Codex app 式)────────────────────── */}
      <nav
        style={{
          width: RAIL_W,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: `${spacing.lg + 2}px ${spacing.md}px`,
          gap: spacing.xs,
          backgroundColor: tk.bgSecondary,
          borderRight: `1px solid ${tk.borderLight}`,
        }}
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className="pddcs-rail-btn"
            style={railBtn(tab === id)}
            onClick={() => setTab(id)}
            title={label}
          >
            <Icon size={18} strokeWidth={tab === id ? 2.4 : 1.8} />
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <button
          type="button"
          className="pddcs-rail-btn"
          style={{ color: tk.textMuted }}
          onClick={toggleTheme}
          title={theme === 'light' ? '切换深色' : '切换浅色'}
        >
          {theme === 'light' ? <MoonIcon size={17} strokeWidth={1.8} /> : <SunIcon size={17} strokeWidth={1.8} />}
        </button>
      </nav>

      {/* ── 右侧内容区 ───────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 头部:页签名 + 数据概览 */}
        <header style={{ padding: `${spacing.xxl - 2}px ${spacing.xxl}px ${spacing.lg}px` }}>
          <div style={{ fontSize: fontSize.heading, fontWeight: fontWeight.heading, letterSpacing: '-0.01em' }}>
            {TABS.find((t) => t.id === tab)?.label}
          </div>
          <div
            style={{
              fontSize: fontSize.caption,
              color: tk.textTertiary,
              marginTop: 2,
              minHeight: 15,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {tabSummary(tab, stats)}
          </div>
        </header>

        {/* 页签内容(各自滚动) */}
        <div className="pddcs-scroll" style={{ overflowY: 'auto', padding: `2px ${spacing.xxl}px ${spacing.xxl}px`, flex: 1 }}>
          {tab === 'memory' && (
            <MemoryListTab tk={tk} retentionDays={stats?.settings.retentionDays ?? 90} onDataChanged={refreshStats} />
          )}
          {tab === 'folders' && <FoldersTab tk={tk} onDataChanged={refreshStats} />}
          {tab === 'knowledge' && <KnowledgeTab tk={tk} onDataChanged={refreshStats} />}
          {tab === 'settings' && <SettingsTab tk={tk} onDataChanged={refreshStats} />}
        </div>
      </div>
    </div>
  )
}

export default function PopupRoot() {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  )
}
