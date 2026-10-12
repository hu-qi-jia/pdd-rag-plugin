/**
 * Popup — **复古极简 + 极客工具风**面板(v3.0)
 *
 * 版面:左侧 52px 图标导航栏(|)硬线分隔)+ 右侧状态条 + 内容区。
 * 四页签(设计文档 §7):记忆列表 / 标准回答 / 知识库 / 设置。
 *
 * 这一版的版面只有三样东西:**线、反白、等宽字**。
 *  - 窗口外缘 1px 纯黑框(borderStrong),导航栏右缘同一档线 —— 整块面板读起来像一台仪器;
 *  - 页面标题与统计**并成一行状态条**,标题左侧一根 ▍ 竖条,条下一根硬线收口;
 *  - 导航选中项 = **反白方块**(纯黑底 + 面板底色图标),与主按钮、面板选中行共用同一种语言。
 * 没有圆角、没有阴影、没有背景模糊,也不再有任何强调色(焦点环即纯黑)。
 */

import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import logoPng from '~assets/icon.png'
import { ThemeProvider, useTheme } from '../ui/theme-context'
import { getThemeTokens, lightTheme, type ThemeTokens } from '../ui/theme'
import { controlH, fontFamily, fontSize, formGap, fontWeight, motion, radius, size, spacing, stroke } from '../ui/design'
import { thinScrollbarCss } from '../ui/scrollbar'
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

const RESET_CSS = `
/* 文档底 = 面板底色(跟随主题)。变量由 App 统一挂到 <html>(全部主题变量都走这一条桥);
   fallback 插值 lightTheme.bg 保持令牌单源;不写 !important(产物 popup.html 无竞争样式表)。 */
html, body { margin: 0; padding: 0; background: var(--pddcs-page-bg, ${lightTheme.bg}); }
* { box-sizing: border-box; }

/* ── 按钮(直角控件;高度固定为表单档,保证与同排输入框等高)─────────────
   v3.0:圆角 6 → 0;字重 500 → 600(等宽字下 500 与 400 看不出差别,
   按钮要"按得动"就得给足一档;medium 已从字号令牌表退役) */
.pddcs-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: ${controlH.form}px; padding: 0 ${spacing.xl}px;
  border-radius: ${radius.md}px; border: ${stroke.hairline}px solid;
  font-size: ${fontSize.body}px; font-weight: ${fontWeight.semibold}; line-height: 1.5;
  cursor: pointer; white-space: nowrap; font-family: inherit;
  transition: background-color ${motion.fast}, border-color ${motion.fast}, opacity ${motion.fast};
}
.pddcs-btn:disabled { opacity: .45; cursor: not-allowed; }
.pddcs-btn:focus-visible { outline: 2px solid var(--pddcs-accent); outline-offset: 2px; }

/* ── 输入框/文本域 ──────────────────────────────────────────────────────── */
.pddcs-input {
  width: 100%; padding: 7px ${spacing.xl}px;
  border-radius: ${radius.md}px; border: ${stroke.hairline}px solid;
  font-size: ${fontSize.body}px; outline: none; font-family: inherit; line-height: 1.5;
  transition: border-color ${motion.fast};
}
/* 聚焦把描边提到主文本色 —— 黑白灰版面里"墨变浓"就是焦点信号 */
.pddcs-input:focus { border-color: var(--pddcs-accent); }
.pddcs-input::placeholder { color: var(--pddcs-text-tertiary); }

/* ── 原生下拉(文件夹页「迁移到」):保留系统控件外观,只对齐尺寸与描边 ──
   极客工具风要的正是"这是一枚系统控件",不去重画箭头、不套自定义弹层 */
.pddcs-select {
  height: ${controlH.inline}px; padding: 0 3px; border-radius: ${radius.sm}px;
  border: ${stroke.hairline}px solid; font-size: ${fontSize.caption}px;
  outline: none; font-family: inherit; cursor: pointer;
  transition: border-color ${motion.fast};
}
.pddcs-select:focus-visible { outline: 2px solid var(--pddcs-accent); outline-offset: 1px; }

/* ── 滚动条:细、悬浮才出现(与聊天页推荐面板同一规格)────────────────── */
${thinScrollbarCss('.pddcs-scroll', 'var(--pddcs-scroll-thumb)')}

/* ── 分类导航(ui/CategoryNav.tsx):单行横滚,滚动条整根隐藏 ──────────────
   "还有更多"由组件内的两侧渐隐 mask 提示,不靠滚动条;滚轮已映射为横移 */
.pddcs-catnav { scrollbar-width: none; }
.pddcs-catnav::-webkit-scrollbar { display: none; }

/* ── 导航图标按钮:静止只有图标本身,无背景块 ────────────────────────── */
.pddcs-rail-btn {
  width: ${size.railBtn}px; height: ${size.railBtn}px; padding: 0; border: none;
  border-radius: ${radius.sm}px; background: transparent;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; position: relative;
  transition: background-color ${motion.fast};
}
.pddcs-rail-btn:focus-visible { outline: 2px solid var(--pddcs-accent); outline-offset: 2px; }

/* ── 开关(v3.0 直角双态):方形轨道 + 方形滑块,与输入框共用描边语言。
      滑块位置由 [aria-checked] 驱动,按压时顺拖动方向拉伸 2px;
      滑块底色由主题变量注入(浅色白 / 深色黑),与轨道**反相** ── */
.pddcs-switch .pddcs-switch-knob {
  position: absolute; top: 2px; left: 2px;
  width: ${size.toggleKnob}px; height: ${size.toggleKnob}px;
  border-radius: ${radius.sm}px; background: var(--pddcs-control-knob);
  transition: left ${motion.emphasized}, width ${motion.fast};
}
.pddcs-switch[aria-checked='true'] .pddcs-switch-knob {
  left: ${size.toggleWidth - size.toggleKnob - 2}px;
}
.pddcs-switch:active .pddcs-switch-knob { width: ${size.toggleKnob + 2}px; }
.pddcs-switch[aria-checked='true']:active .pddcs-switch-knob {
  left: ${size.toggleWidth - size.toggleKnob - 4}px;
}

/* ── 开关焦点环:仅键盘聚焦时显现 ─────────────────────────────────────── */
.pddcs-switch:focus-visible {
  outline: 2px solid var(--pddcs-accent);
  outline-offset: 2px;
}

/* ── 滑杆(v3.0):4px 平轨(激活色填充到当前值)+ **矩形滑块头**(10×16 推子帽)。
      旧版是 14px 圆拇指 + 悬浮/按住放大 —— 圆形与缩放都属于精致控件语言;
      推子帽只改颜色不改形状,反馈靠"墨变浓"给出,不靠形变 ── */
.pddcs-slider {
  -webkit-appearance: none; appearance: none;
  /* display:block 是行距前提:range 默认是 inline 级,父级 line-height 的 strut
     会在轨道上方多顶出 1px */
  display: block;
  width: 100%; height: 4px; margin: ${formGap.labelControl}px 0 0;
  border-radius: ${radius.sm}px; outline: none; cursor: pointer;
}
.pddcs-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 10px; height: 16px; border-radius: ${radius.sm}px;
  background: var(--pddcs-control-active);
  border: ${stroke.hairline}px solid var(--pddcs-control-knob);
  transition: background-color ${motion.fast};
}
.pddcs-slider:hover::-webkit-slider-thumb { background: var(--pddcs-control-active-hover); }
.pddcs-slider:focus-visible { outline: 2px solid var(--pddcs-accent); outline-offset: 4px; }
.pddcs-slider::-moz-range-thumb {
  width: 10px; height: 16px; border-radius: ${radius.sm}px;
  background: var(--pddcs-control-active);
  border: ${stroke.hairline}px solid var(--pddcs-control-knob);
}
.pddcs-slider::-moz-range-track { height: 4px; border-radius: ${radius.sm}px; background: transparent; }
`

type TabId = 'memory' | 'folders' | 'knowledge' | 'settings'

type StatsPayload = GetStatsResponse['payload']

/**
 * 顶部概览按页签**分散展示**:只显示本页相关的计数,设置页不展示
 * (设置本身就是"配置项",不需要计数)。
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

  /** 样式注入 + 令牌 → CSS 变量桥(全部主题变量统一走 <html> 一条桥)。
   *  用 layout effect:变量必须在**首帧之前**落到 <html>,否则深色主题首帧
   *  会用 fallback 白底画出一圈白边(闪白);style 节点同理 pre-paint 注入。 */
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
    rootStyle.setProperty('--pddcs-text-tertiary', tk.textTertiary)
    rootStyle.setProperty('--pddcs-control-active', tk.controlActive)
    rootStyle.setProperty('--pddcs-control-active-hover', tk.controlActiveHover)
    rootStyle.setProperty('--pddcs-control-knob', tk.controlKnobBg)
  }, [tk])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  /**
   * 导航项状态只有一种表达:**选中即反白**(纯黑底 + 面板底色图标)。
   * 旧版是"颜色变深 + 左侧 2px 指示条",而"反白"是本版面权重最高的语言
   * (主按钮、推荐面板选中行同款),导航作为最高层级的切换控件理应取它。
   */
  const railBtn = (active: boolean): React.CSSProperties => ({
    backgroundColor: active ? tk.text : 'transparent',
    color: active ? tk.bg : tk.textMuted,
  })

  return (
    // 外框 = 1px 结构线(borderStrong):本设计语言里浮层与页面之间的那条边由**实线**给出,
    // 不用阴影,也不用圆角(radius.xxl = 0)。
    <div
      style={{
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        display: 'flex',
        overflow: 'hidden',
        borderRadius: radius.xxl,
        border: `${stroke.strong}px solid ${tk.borderStrong}`,
        fontFamily,
        backgroundColor: tk.bg,
        color: tk.text,
      }}
    >
      {/* ── 左侧图标导航栏 ─────────────────────────────────── */}
      <nav
        style={{
          width: RAIL_W,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: `${spacing.lg}px ${spacing.md}px`,
          gap: spacing.xs,
          backgroundColor: tk.bg,
          // 导航栏右缘取**结构线**档:它和窗口外框同属"版面骨架",不是内容分隔
          borderRight: `${stroke.strong}px solid ${tk.borderStrong}`,
        }}
      >
        <img
          src={logoPng}
          alt=""
          width={24}
          height={24}
          style={{
            display: 'block',
            borderRadius: radius.sm,
            border: `${stroke.hairline}px solid ${tk.border}`,
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
            aria-current={tab === id ? 'page' : undefined}
          >
            {/* 图标线宽全站统一(旧版选中态加粗到 2.4 是为了在"只有颜色深浅"时撑住层级;
                现在选中由反白给出,线宽再变就成了第二个信号) */}
            <Icon size={18} strokeWidth={1.8} />
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
        {/* 状态条:页面名(左)+ 本页计数(右)并成一行,下缘一根**结构线**收口。
            旧版是标题一行、统计一行再留白 —— 两行讲一件事,且把"页面从哪儿开始"
            交代得含糊。并成一行后,条下那根黑线就是内容的起点。 */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.md,
            flex: '0 0 auto',
            padding: `${spacing.lg}px ${spacing.xxl}px`,
            borderBottom: `${stroke.strong}px solid ${tk.borderStrong}`,
          }}
        >
          {/* 等宽字禁止负字距 —— 那是比例字用来收紧字偶距的手法,等宽字本来就对齐 */}
          <span style={{ fontSize: fontSize.heading, fontWeight: fontWeight.heading }}>
            {TABS.find((t) => t.id === tab)?.label}
          </span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: fontSize.caption,
              color: tk.textTertiary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {tabSummary(tab, stats)}
          </span>
        </header>

        {/* 页签内容(各自滚动) */}
        <div className="pddcs-scroll" style={{ overflowY: 'auto', padding: `${spacing.xxl}px`, flex: 1 }}>
          {tab === 'memory' && (
            <MemoryListTab
              tk={tk}
              retentionDays={stats?.settings.retentionDays ?? 90}
              categories={stats?.categories ?? []}
              onDataChanged={refreshStats}
            />
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
