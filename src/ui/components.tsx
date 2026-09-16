/**
 * 通用组件库 — 各页签复用的视觉资产(设计规范的可执行形态)
 *
 * 清单:Btn / Notice / Card / Badge / EmptyState / Toggle / Slider / SearchInput / SectionLabel
 * 原则:颜色一律来自 ThemeTokens,几何一律来自 design.ts;页面不得自带样式实现。
 */
import type React from 'react'
import { useEffect, useState } from 'react'
import type { ThemeTokens } from './theme'
import { fontSize, fontWeight, radius, spacing, semantic, motion, size, formType, formGap } from './design'
import { PlusIcon, SearchIcon } from './icons'

// ── 胶囊按钮 ─────────────────────────────────────────────────────────────────

export function Btn({
  tk,
  onClick,
  children,
  variant = 'default',
  disabled,
  title,
}: {
  tk: ThemeTokens
  onClick: () => void
  children: React.ReactNode
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  title?: string
}) {
  const isPrimary = variant === 'primary'
  const isDanger = variant === 'danger'
  const isGhost = variant === 'ghost'
  const color = isPrimary
    ? tk.btnPrimaryText
    : isDanger
      ? tk.errorText
      : isGhost
        ? tk.textMuted
        : tk.text
  const bg = isPrimary
    ? tk.btnPrimaryBg
    : isDanger
      ? tk.errorBg
      : isGhost
        ? 'transparent'
        : tk.btnBg
  // 悬浮底色(2026-09-15 设计6:四种变体全部有悬浮反馈):
  // primary 再亮一档、danger 红底加深一档、ghost/default 面色提亮一档
  const hoverBg = isPrimary
    ? tk.btnPrimaryHover
    : isDanger
      ? tk.errorHoverBg
      : tk.btnHoverBg
  return (
    <button
      type="button"
      className="pddcs-btn"
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{
        borderColor: isGhost || isDanger ? 'transparent' : tk.btnBorder,
        backgroundColor: bg,
        color,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.backgroundColor = hoverBg
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = bg
      }}
    >
      {children}
    </button>
  )
}

// ── 工具栏「新建」主钮(公共组件)────────────────────────────────────────────

/** 加号图标 + 文字的主操作钮:知识库页「新建条目」与文件夹页「新建文件夹」共用,
 *  视觉统一走 Btn primary(.pddcs-btn,高 controlH.form),不再各自手搓 */
export function CreateBtn({
  tk,
  label,
  onClick,
  disabled,
  title,
}: {
  tk: ThemeTokens
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <Btn tk={tk} variant="primary" onClick={onClick} disabled={disabled} title={title}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <PlusIcon size={12} strokeWidth={2.2} />
        {label}
      </span>
    </Btn>
  )
}

// ── 结果提示条 ────────────────────────────────────────────────────────────────

export type NoticeMsg = { ok: boolean; text: string } | null

/** 成功提示自动消失时长(2026-09-15 PM6:拖滑杆连弹"已保存"永不消失、推挤布局);失败提示常驻 */
export const NOTICE_OK_AUTO_DISMISS_MS = 4000

export function Notice({
  tk,
  msg,
  onDismiss,
}: {
  tk: ThemeTokens
  msg: NoticeMsg
  /** 传入后成功提示到时回调一次(父级清 state);失败提示不自动消失 */
  onDismiss?: () => void
}) {
  useEffect(() => {
    if (!msg?.ok || !onDismiss) return
    const t = window.setTimeout(onDismiss, NOTICE_OK_AUTO_DISMISS_MS)
    return () => window.clearTimeout(t)
  }, [msg, onDismiss])
  if (!msg) return null
  return (
    // 吸附在滚动区顶部:列表很长时提示不再被顶出视口(2026-09-15 用户反馈
    // 「点击设置标准回答无反应」的真实原因之一 —— 操作成功但提示在视口外)。
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 3,
        backgroundColor: tk.bg,
        paddingBottom: spacing.xs,
      }}
    >
      <div
        style={{
          padding: `${spacing.sm + 2}px ${spacing.xl}px`,
          borderRadius: radius.md,
          fontSize: fontSize.secondary,
          lineHeight: 1.55,
          backgroundColor: msg.ok ? tk.successBg : tk.errorBg,
          color: msg.ok ? tk.successText : tk.errorText,
          wordBreak: 'break-all',
        }}
      >
        {msg.text}
      </div>
    </div>
  )
}

// ── 卡片 ─────────────────────────────────────────────────────────────────────

export function Card({
  tk,
  title,
  children,
  style,
  className,
}: {
  tk: ThemeTokens
  title?: string
  children: React.ReactNode
  style?: React.CSSProperties
  /** 附加 CSS 类(如 pddcs-row:配合 .pddcs-row-ops 做悬浮显现操作钮) */
  className?: string
}) {
  return (
    <div
      className={className}
      style={{
        border: `1px solid ${tk.border}`,
        borderRadius: radius.lg,
        backgroundColor: tk.bgCard,
        padding: `${spacing.xl + 2}px ${spacing.xxl - 2}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.lg,
        ...style,
      }}
    >
      {title && (
        // 分组标题(第四十一轮起走 formType 规范):13.5 semibold + 主文本色 ——
        // 旧版是 11.5 + textMuted,比卡内 12.5 的字段标签还小还灰(层级倒挂)
        <div
          style={{
            fontSize: formType.groupTitle.size,
            fontWeight: formType.groupTitle.weight,
            color: tk.text,
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

// ── 徽标(golden / knowledge / neutral)──────────────────────────────────────

export function Badge({
  tk,
  tone,
  icon,
  children,
}: {
  tk: ThemeTokens
  tone: 'golden' | 'knowledge' | 'neutral'
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  const bg =
    tone === 'golden'
      ? semantic.goldenBg
      : tone === 'knowledge'
        ? semantic.knowledgeBg
        : tk.bgSecondary
  const color =
    tone === 'golden' ? semantic.golden : tone === 'knowledge' ? semantic.knowledge : tk.textMuted
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        backgroundColor: bg,
        color,
        border: tone === 'neutral' ? `1px solid ${tk.border}` : '1px solid transparent',
        borderRadius: radius.sm,
        fontSize: fontSize.caption,
        padding: `1px ${spacing.md - 1}px`,
        fontWeight: fontWeight.semibold,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {children}
    </span>
  )
}

// ── 空状态 ───────────────────────────────────────────────────────────────────

export function EmptyState({
  tk,
  children,
}: {
  tk: ThemeTokens
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        fontSize: fontSize.secondary,
        color: tk.textTertiary,
        padding: `${spacing.xxl + 6}px 0`,
        textAlign: 'center',
        lineHeight: 1.8,
      }}
    >
      {children}
    </div>
  )
}

// ── 搜索输入框(带放大镜)───────────────────────────────────────────────────

export function SearchInput({
  tk,
  value,
  onChange,
  placeholder,
}: {
  tk: ThemeTokens
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div style={{ position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          left: 11,
          top: '50%',
          transform: 'translateY(-50%)',
          color: tk.textTertiary,
          display: 'flex',
          pointerEvents: 'none',
        }}
      >
        <SearchIcon size={13} strokeWidth={2} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pddcs-input"
        style={inputStyle(tk, { paddingLeft: 30 })}
      />
    </div>
  )
}

// ── 拨杆开关(胶囊式;文字居左、开关居右,2026-09-15 v2.6.7 用户要求)────────

export function Toggle({
  label,
  desc,
  checked,
  onChange,
  tk,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
  tk: ThemeTokens
}) {
  const [hover, setHover] = useState(false)
  // 选中态 = 控件激活色(2026-09-16 第四十一轮用户"开关…颜色修改为灰色和白色"):
  // 浅色中性深灰 / 深色白,原 accent 蓝退出开关;
  // 未选中轨道仍走专用令牌(比 inputBorder 深一档,悬浮再深一档给出"可点"暗示)。
  const track = checked
    ? hover
      ? tk.controlActiveHover
      : tk.controlActive
    : hover
      ? tk.switchTrackHover
      : tk.switchTrack
  return (
    <label
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: spacing.lg, cursor: 'pointer' }}
      onClick={(e) => {
        e.preventDefault()
        onChange(!checked)
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: formType.label.size,
            fontWeight: formType.label.weight,
          }}
        >
          {label}
        </span>
        {/* 说明文字:formType.desc 档(11.5 regular)+ textMuted;
            与标签的间距统一取 formGap.labelDesc(第四十一轮"间距统一") */}
        <span
          style={{
            display: 'block',
            fontSize: formType.desc.size,
            fontWeight: formType.desc.weight,
            color: tk.textMuted,
            lineHeight: 1.55,
            marginTop: formGap.labelDesc,
          }}
        >
          {desc}
        </span>
      </span>
      <span
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={label}
        tabIndex={0}
        className="pddcs-switch"
        onKeyDown={(e) => {
          // 键盘可达(2026-09-15 设计6):Enter/Space 切换,Space 阻断页面滚动;
          // 不冒泡,避免外层 label 的 onClick 再次翻转
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onChange(!checked)
          }
        }}
        style={{
          width: size.toggleWidth,
          height: size.toggleHeight,
          flexShrink: 0,
          borderRadius: radius.pill,
          position: 'relative',
          transition: `background-color ${motion.normal}`,
          cursor: 'pointer',
          backgroundColor: track,
        }}
      >
        {/* 滑块位置/按压拉伸全由 popup RESET_CSS 的 [aria-checked] / :active 规则驱动
            (内联 left 会压过 :active 拉伸;React 只声明结构) */}
        <span className="pddcs-switch-knob" />
      </span>
    </label>
  )
}

// ── 滑杆(自定义填充轨道;拇指钮样式见 popup RESET_CSS .pddcs-slider)─────────

export function Slider({
  tk,
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  tk: ThemeTokens
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
}) {
  // 填充进度硬切:激活色到当前值,其后是轨道色(inputBorder)
  const pct = Math.round(((value - min) / (max - min)) * 100)
  return (
    <div>
      {/* 标签走 formType.label(12.5 semibold),当前值同档但 regular + 灰 + 等宽数字 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: formType.label.size }}>
        <span style={{ fontWeight: formType.label.weight }}>{label}</span>
        <span
          style={{
            color: tk.textMuted,
            fontFamily: 'ui-monospace, Consolas, monospace',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        className="pddcs-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          // 第四十一轮:已填充段由 accent 蓝改控件激活色(浅色深灰 / 深色白),与开关同一令牌
          backgroundImage: `linear-gradient(to right, ${tk.controlActive} ${pct}%, ${tk.inputBorder} ${pct}%)`,
        }}
      />
    </div>
  )
}

// ── 小节标签 ─────────────────────────────────────────────────────────────────

export function SectionLabel({ tk, children }: { tk: ThemeTokens; children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: fontSize.caption,
        fontWeight: fontWeight.semibold,
        color: tk.textTertiary,
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </div>
  )
}

// ── 样式原语(供表单类元素)─────────────────────────────────────────────────

export function inputStyle(tk: ThemeTokens, extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%',
    padding: `7px ${spacing.xl}px`,
    borderRadius: radius.md,
    border: `1px solid ${tk.inputBorder}`,
    backgroundColor: tk.inputBg,
    color: tk.text,
    fontSize: fontSize.body,
    outline: 'none',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    transition: `border-color ${motion.fast}`,
    ...extra,
  }
}

/**
 * 与按钮同排的输入框样式:显式 height 取 controlH 档位,与同排按钮严格等高。
 * (2026-09-15 用户反馈:新建子文件夹的输入框靠 padding+line-height 撑到 35px,
 *  同排「创建/取消」为 28px,相差 7px。)
 */
export function controlStyle(
  tk: ThemeTokens,
  height: number,
  extra?: React.CSSProperties,
): React.CSSProperties {
  return inputStyle(tk, { height, padding: `0 ${spacing.xl - 2}px`, ...extra })
}


export function formatTs(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
