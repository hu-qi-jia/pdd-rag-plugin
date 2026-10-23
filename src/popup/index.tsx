/**
 * Popup — v5.1「石墨蓝灰」外壳
 *
 * 职责只有两件:①把主题令牌桥成 `--pddcs-*` CSS 自定义属性挂到 `<html>` 上;
 * ②搭出「浮动图标栏 + 浮动主面板(状态条 + 滚动区)」这套外壳。
 *
 * 样式表本身在 `ui/popup-css.ts`(独立模块,可被单测直接断言)。
 * 聊天页覆盖层不吃这套变量(它注入平台页面,够不到 popup 的 `<html>`),
 * 仍走 `ui/overlay-css.ts` 的 `tk` 参数插值。
 *
 * v4.0 → v5.0 的外壳变化:**从"两栏拼接"改成"两块浮起的容器"**。
 * 左栏不再用 `borderRight` 划界(改成 10px 空隙 + 两侧圆角),主面板也终于有了
 * 自己的面 —— 于是"页名"和"列表"同处一张面,而不是悬在页面底上。
 * 滚动容器仍然**不给左右内边距**:需要缩进的内容各自负责(卡片列表走 `listGap.inset`)。
 */
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import logoPng from '~assets/icon.png'
import { ThemeProvider, useTheme } from '../ui/theme-context'
import { getThemeTokens, type ThemeTokens } from '../ui/theme'
import { fontFamily, radius, size, spacing } from '../ui/design'
import { POPUP_CSS } from '../ui/popup-css'
import { StatusBar } from '../ui/components'
import {
  BookOpenIcon,
  FolderIcon,
  GearIcon,
  MessageSquareIcon,
  MoonIcon,
  SunIcon,
} from '../ui/icons'
import { sendMessage } from '../shared/message-passing'
import type { GetStatsResponse } from '../types/messages'
import { MemoryListTab } from './MemoryListTab'
import { FoldersTab } from './FoldersTab'
import { KnowledgeTab } from './KnowledgeTab'
import { SettingsTab } from './SettingsTab'

const RAIL_W = size.railWidth
const POPUP_WIDTH = size.popupWidth
/** 固定高度(内容区自行滚动),保证 popup 外形稳定 */
const POPUP_HEIGHT = size.popupHeight

/**
 * 令牌 → CSS 自定义属性名。
 *
 * 显式列出来而不是按 key 自动 kebab:这组名字是组件与样式表之间的**契约**,
 * 写成一张表,改令牌名时 `tsc` 会在这里报错,而不是让某个 `var()` 静默落空。
 */
const CSS_VARS: Record<keyof ThemeTokens, string> = {
  bg: '--pddcs-bg',
  surface: '--pddcs-surface',
  fill: '--pddcs-fill',
  text: '--pddcs-text',
  textSecondary: '--pddcs-text-secondary',
  textTertiary: '--pddcs-text-tertiary',
  textDisabled: '--pddcs-text-disabled',
  separator: '--pddcs-separator',
  border: '--pddcs-border',
  selection: '--pddcs-selection',
  ink: '--pddcs-ink',
  onInk: '--pddcs-on-ink',
  accent: '--pddcs-accent',
  onAccent: '--pddcs-on-accent',
  accentText: '--pddcs-accent-text',
  accentSoft: '--pddcs-accent-soft',
  infoText: '--pddcs-info-text',
  infoSoft: '--pddcs-info-soft',
  danger: '--pddcs-danger',
  dangerSoft: '--pddcs-danger-soft',
  scrollThumb: '--pddcs-scroll-thumb',
}

type TabId = 'memory' | 'folders' | 'knowledge' | 'settings'

type StatsPayload = GetStatsResponse['payload']

/**
 * 状态条右侧的本页计数(只显示与当前页相关的)。设置页不展示 ——
 * 设置本身就是"配置项",不需要计数。
 */
function tabSummary(id: TabId, stats: StatsPayload | null): string {
  if (!stats) return '读取中…'
  switch (id) {
    case 'memory':
      return `问答 ${stats.qaCount} · 回复 ${stats.replyCount}`
    case 'folders':
      return `标准回答 ${stats.goldenCount}`
    case 'knowledge':
      return `知识 ${stats.knowledgeCount}`
    case 'settings':
      return ''
  }
}

const TABS: { id: TabId; label: string; Icon: typeof MessageSquareIcon }[] = [
  { id: 'memory', label: '记忆', Icon: MessageSquareIcon },
  { id: 'folders', label: '标准回答', Icon: FolderIcon },
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

  /** 主题令牌 → CSS 变量桥。用 layout effect:变量必须在**首帧之前**落到 `<html>`,
   *  否则深色主题首帧会用 fallback 白底画出来(闪白)。样式节点同理 pre-paint 注入。 */
  useLayoutEffect(() => {
    const id = 'pddcs-popup-style'
    if (!document.getElementById(id)) {
      const el = document.createElement('style')
      el.id = id
      el.textContent = POPUP_CSS
      document.head.appendChild(el)
    }
    const rootStyle = document.documentElement.style
    for (const key of Object.keys(CSS_VARS) as (keyof ThemeTokens)[]) {
      rootStyle.setProperty(CSS_VARS[key], tk[key])
    }
  }, [tk])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  return (
    <div
      style={{
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        display: 'flex',
        overflow: 'hidden',
        // v5.0:外壳从"左右两栏直接拼接"改成"两块浮起的容器" ——
        // 页底只在这 10px 的缝里露出来,它就是"卡片浮在纸上"的全部证据
        padding: spacing.lg,
        gap: spacing.lg,
        boxSizing: 'border-box',
        fontFamily,
        backgroundColor: tk.bg,
        color: tk.text,
      }}
    >
      {/* ── 左侧图标栏(浮动块,不再贴边)───────────────────── */}
      <nav
        style={{
          width: RAIL_W,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: `${spacing.md}px 0`,
          gap: spacing.xs,
          backgroundColor: tk.surface,
          borderRadius: radius.card,
          // 不设 borderRight —— 栏与主面板之间是 10px 的**空隙**,不是一条线
        }}
      >
        {/* 品牌标:与扩展图标同源,置于导航栏顶部 */}
        <img
          src={logoPng}
          alt=""
          width={26}
          height={26}
          style={{ display: 'block', borderRadius: radius.control, marginBottom: spacing.lg }}
        />
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className="pddcs-rail-btn"
            aria-current={tab === id ? 'true' : undefined}
            onClick={() => setTab(id)}
            title={label}
            /* 图标钮没有文字,title 只是悬浮提示 —— 读屏要靠 aria-label */
            aria-label={label}
          >
            <Icon size={size.iconNav} strokeWidth={1.7} />
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <button
          type="button"
          className="pddcs-rail-btn"
          onClick={toggleTheme}
          title={theme === 'light' ? '切换深色' : '切换浅色'}
          aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'}
        >
          {theme === 'light' ? (
            <MoonIcon size={size.iconNav} strokeWidth={1.7} />
          ) : (
            <SunIcon size={size.iconNav} strokeWidth={1.7} />
          )}
        </button>
      </nav>

      {/* ── 右侧内容区(浮动块,页名与列表同处一张面)─────────── */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: tk.surface,
          borderRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        <StatusBar title={TABS.find((t) => t.id === tab)?.label ?? ''} count={tabSummary(tab, stats)} />

        {/* 页签内容(各自滚动)。v5.0 起卡片列表**自带左右内缩**(见 listGap.inset),
            这里仍然不给内边距 —— 设置页的分区、搜索栏等通铺控件各自负责自己的缩进 */}
        <div className="pddcs-scroll" style={{ overflowY: 'auto', flex: 1 }}>
          {tab === 'memory' && (
            <MemoryListTab categories={stats?.categories ?? []} onDataChanged={refreshStats} />
          )}
          {tab === 'folders' && <FoldersTab onDataChanged={refreshStats} />}
          {tab === 'knowledge' && <KnowledgeTab onDataChanged={refreshStats} />}
          {tab === 'settings' && <SettingsTab onDataChanged={refreshStats} />}
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
