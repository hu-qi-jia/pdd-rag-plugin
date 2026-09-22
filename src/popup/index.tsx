/**
 * Popup — Figma 编辑器工具风面板(对齐 pddddd 控制台设计语言)
 *
 * 布局:左侧 52px 图标导航栏 + 右侧内容区。
 * 五页签(设计文档 §7):记忆列表 / 待沉淀 / 回复文件夹 / 知识库 / 设置。
 * 视觉:工具风设计令牌 —— 白面板细边框、小圆角(6px 控件)、黑白主色。
 */

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import logoPng from '~assets/icon.png'
import { ThemeProvider, useTheme } from '../ui/theme-context'
import { getThemeTokens, lightTheme, type ThemeTokens } from '../ui/theme'
import { controlH, fontFamily, fontSize, formGap, fontWeight, motion, radius, size, spacing } from '../ui/design'
import { thinScrollbarCss } from '../ui/scrollbar'
import {
  ArrowUpWideNarrowIcon,
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
import { BacklogTab } from './BacklogTab'
import { SettingsTab } from './SettingsTab'

const RAIL_W = size.railWidth
const POPUP_WIDTH = size.popupWidth
/** 固定高度(内容区自行滚动),保证 popup 外形稳定 */
const POPUP_HEIGHT = size.popupHeight

const RESET_CSS = `
/* v2.6.33:文档底 = 面板底色(跟随主题)。popup 外框有 24px 圆角,窗口四角被切出来的区域
   显示的就是这层底 —— 写 transparent 的话,浅色下露出 Chrome 的默认白看不出,深色主题下
   会露出四个白角块。变量由 App 统一挂到 <html>(v2.6.33 起五个主题变量都走这一条桥);
   fallback 插值 lightTheme.bg 保持令牌单源;不写 !important(产物 popup.html 无竞争样式表)。 */
html, body { margin: 0; padding: 0; background: var(--pddcs-page-bg, ${lightTheme.bg}); }
* { box-sizing: border-box; }

/* ── 按钮(工具风直角控件;高度固定为表单档,保证与同排输入框等高)───── */
.pddcs-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: ${controlH.form}px; padding: 0 12px; border-radius: 6px; border: 1px solid;
  font-size: ${fontSize.body}px; font-weight: ${fontWeight.medium}; line-height: 1.5;
  cursor: pointer; white-space: nowrap; font-family: inherit;
  transition: background-color .12s ease, border-color .12s ease, opacity .12s ease;
}
.pddcs-btn:disabled { opacity: .45; cursor: not-allowed; }

/* ── 输入框(focus 时描边提亮,无重投影)────────────────── */
.pddcs-input {
  width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid;
  font-size: ${fontSize.body}px; outline: none; font-family: inherit; line-height: 1.5;
  transition: border-color .12s ease;
}

/* ── 滚动条:细、悬浮才出现(第二十三轮抽为公共生成器 ui/scrollbar.ts,
      与聊天页推荐面板同一规格;滑块色随主题令牌注入,暗色下必须走浅色)── */
${thinScrollbarCss('.pddcs-scroll', 'var(--pddcs-scroll-thumb)')}

/* ── 导航图标按钮:任何状态下都只有图标本身,无背景块(2026-09-15 用户要求)── */
.pddcs-rail-btn {
  width: ${size.railBtn}px; height: ${size.railBtn}px; padding: 0; border: none; border-radius: 6px;
  background: transparent;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; position: relative;
}

/* ── 开关(v2.6.7 重设计):滑块位置由 [aria-checked] 驱动,按压时滑块
      顺拖动方向拉伸 2px 的微交互;减速曲线落定。React 只声明结构。
      v2.6.28:滑块底色改由主题变量注入(浅色白 / 深色深灰),与轨道反相 ── */
.pddcs-switch .pddcs-switch-knob {
  position: absolute; top: 2px; left: 2px;
  width: ${size.toggleKnob}px; height: ${size.toggleKnob}px;
  border-radius: 9999px; background: var(--pddcs-control-knob);
  box-shadow: 0 1px 2px rgba(0,0,0,0.25);
  transition: left ${motion.emphasized}, width ${motion.fast};
}
.pddcs-switch[aria-checked='true'] .pddcs-switch-knob {
  left: ${size.toggleWidth - size.toggleKnob - 2}px;
}
.pddcs-switch:active .pddcs-switch-knob { width: ${size.toggleKnob + 2}px; }
.pddcs-switch[aria-checked='true']:active .pddcs-switch-knob {
  left: ${size.toggleWidth - size.toggleKnob - 4}px;
}

/* ── 开关焦点环:仅键盘聚焦时显现(Toggle 键盘可达,2026-09-15 设计6)── */
.pddcs-switch:focus-visible {
  outline: 2px solid var(--pddcs-accent);
  outline-offset: 2px;
}

/* ── 滑杆(v2.6.7 重设计):4px 圆轨(激活色填充到当前值,渐变由组件内联注入),
      14px 圆拇指 + 激活色描边,悬浮放大、按住再放大。
      v2.6.28:填充与拇指描边由 accent 蓝改灰白(浅色深灰 / 深色白),
      拇指底色随主题反相;下外边距并入表单行距(design.ts#formGap.row),故归零 ── */
.pddcs-slider {
  -webkit-appearance: none; appearance: none;
  /* display:block 是行距前提:range 默认是 inline 级,父级 line-height 的 strut
     会在轨道上方多顶出 1px(实测 9px 而非 8px) */
  display: block;
  width: 100%; height: 4px; margin: ${formGap.labelControl}px 0 0;
  border-radius: 9999px; outline: none; cursor: pointer;
}
.pddcs-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--pddcs-control-knob); border: 2px solid var(--pddcs-control-active);
  box-shadow: 0 1px 3px rgba(0,0,0,0.28);
  transition: transform .12s ease;
}
.pddcs-slider:hover::-webkit-slider-thumb { transform: scale(1.12); }
.pddcs-slider:active::-webkit-slider-thumb { transform: scale(1.22); }
.pddcs-slider:focus-visible { outline: 2px solid var(--pddcs-accent); outline-offset: 4px; }
.pddcs-slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--pddcs-control-knob); border: 2px solid var(--pddcs-control-active);
  box-shadow: 0 1px 3px rgba(0,0,0,0.28);
}
.pddcs-slider::-moz-range-track { height: 4px; border-radius: 9999px; background: transparent; }
`

type TabId = 'memory' | 'backlog' | 'folders' | 'knowledge' | 'settings'

type StatsPayload = GetStatsResponse['payload']

/**
 * 顶部概览按页签**分散展示**(2026-09-15 用户要求):
 * 原来四个计数全堆在头部,与当前页面无关;现在只显示本页相关的,
 * 设置页不展示(设置本身就是"配置项",不需要计数)。
 *
 * backlog 的计数不来自 stats:它要全表聚合(问答 + 回复分组),而 GET_STATS
 * 连聊天页 content(读快捷键配置)都在调 —— 为了顶部一行字让每次页面加载都
 * 扫一遍全库,不划算。改由该页签自己加载后回传(见 BacklogTab#onCountChange)。
 */
function tabSummary(id: TabId, stats: StatsPayload | null, backlogCount: number | null): string {
  if (id === 'backlog') {
    return backlogCount === null ? '问得多、还没沉淀的问题' : `待沉淀 ${backlogCount} 条 · 按出现次数倒序`
  }
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
  { id: 'backlog', label: '沉淀', Icon: ArrowUpWideNarrowIcon },
  { id: 'folders', label: '文件夹', Icon: FolderIcon },
  { id: 'knowledge', label: '知识库', Icon: BookOpenIcon },
  { id: 'settings', label: '设置', Icon: GearIcon },
]

function App() {
  const { theme, toggleTheme } = useTheme()
  const tk = getThemeTokens(theme)
  const [tab, setTab] = useState<TabId>('memory')
  const [stats, setStats] = useState<GetStatsResponse['payload'] | null>(null)
  // 待沉淀条数由该页签加载后回传(null = 还没打开过,概览行给一句说明而不是假计数)
  const [backlogCount, setBacklogCount] = useState<number | null>(null)

  const refreshStats = useCallback(async () => {
    try {
      const resp = await sendMessage<GetStatsResponse>({ type: 'GET_STATS' })
      setStats(resp.payload)
    } catch {
      /* 统计失败不阻塞面板 */
    }
  }, [])

  /** 样式注入 + 令牌 → CSS 变量桥(v2.6.33 起五变量统一走 <html> 一条桥)。
   *  用 layout effect:变量必须在**首帧之前**落到 <html>,否则深色主题首帧
   *  会用 fallback 白底画出四角(闪白);style 节点同理 pre-paint 注入。 */
  useLayoutEffect(() => {
    const id = 'pddcs-popup-reset-style'
    if (!document.getElementById(id)) {
      const el = document.createElement('style')
      el.id = id
      el.textContent = RESET_CSS
      document.head.appendChild(el)
    }
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--pddcs-page-bg', tk.bg)
    rootStyle.setProperty('--pddcs-scroll-thumb', tk.scrollThumb)
    rootStyle.setProperty('--pddcs-accent', tk.accent)
    rootStyle.setProperty('--pddcs-control-active', tk.controlActive)
    rootStyle.setProperty('--pddcs-control-knob', tk.controlKnobBg)
  }, [tk])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  const railBtn = (active: boolean): React.CSSProperties => ({
    // 图标状态只靠颜色与描边粗细表达,无任何背景块(2026-09-15 用户要求:
    // "仅展示图标即可,图标后不需要有背景" —— 含悬浮态)
    color: active ? tk.text : tk.textMuted,
  })

  return (
    <div
      style={{
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        display: 'flex',
        overflow: 'hidden',
        // v2.6.32 去掉 boxShadow:popup 是原生窗口、外面没有可"浮起"的背景,
        // 阴影唯一可见的部分恰好溢进 24px 圆角切出的四角,看着像一圈半透明边框(见 DESIGN §九)。
        // 浮层阴影留给聊天页推荐面板(`tk.shadow` 仍由 overlay-css 使用)。
        borderRadius: radius.xxl,
        fontFamily,
        backgroundColor: tk.bg,
        color: tk.text,
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
        {/* 品牌标(v2.6.22 用户指定):与扩展图标同源,置于导航栏顶部 */}
        <img
          src={logoPng}
          alt=""
          width={24}
          height={24}
          style={{
            display: 'block',
            borderRadius: 6,
            border: `1px solid ${tk.border}`,
            marginBottom: spacing.lg,
          }}
        />
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className="pddcs-rail-btn"
            style={railBtn(tab === id)}
            onClick={() => setTab(id)}
            title={label}
          >
            {/* 激活指示:2px 左侧短指示条,不画背景块(2026-09-15 设计5;
                激活态原先仅颜色+描边粗细,几乎不可辨) */}
            {tab === id && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: -8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 2,
                  height: 14,
                  borderRadius: 1,
                  backgroundColor: tk.text,
                }}
              />
            )}
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
            {tabSummary(tab, stats, backlogCount)}
          </div>
        </header>

        {/* 页签内容(各自滚动) */}
        <div className="pddcs-scroll" style={{ overflowY: 'auto', padding: `2px ${spacing.xxl}px ${spacing.xxl}px`, flex: 1 }}>
          {tab === 'memory' && (
            <MemoryListTab tk={tk} retentionDays={stats?.settings.retentionDays ?? 90} onDataChanged={refreshStats} />
          )}
          {tab === 'backlog' && (
            <BacklogTab tk={tk} onCountChange={setBacklogCount} onDataChanged={refreshStats} />
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
