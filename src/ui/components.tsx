/**
 * 通用组件库 — 各页签复用的视觉资产(设计规范的可执行形态)
 *
 * 清单:Btn / Notice / Card / Badge / EmptyState / Toggle / Slider / SearchInput / SectionLabel
 * 原则:颜色一律来自 ThemeTokens,几何一律来自 design.ts;页面不得自带样式实现。
 */
import type React from 'react'
import type { ThemeTokens } from './theme'
import { fontSize, fontWeight, radius, spacing, semantic, motion, size } from './design'
import { SearchIcon } from './icons'

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
        if (isPrimary) e.currentTarget.style.backgroundColor = tk.btnPrimaryHover
        else if (!isGhost && !isDanger) e.currentTarget.style.backgroundColor = tk.btnHoverBg
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = bg
      }}
    >
      {children}
    </button>
  )
}

// ── 结果提示条 ────────────────────────────────────────────────────────────────

export type NoticeMsg = { ok: boolean; text: string } | null

export function Notice({ tk, msg }: { tk: ThemeTokens; msg: NoticeMsg }) {
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
}: {
  tk: ThemeTokens
  title?: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
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
        <div style={{ fontSize: fontSize.secondary, fontWeight: fontWeight.semibold, color: tk.textMuted }}>
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

// ── 拨杆开关(胶囊式,accent 色)─────────────────────────────────────────────

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
  return (
    <label
      style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.lg, cursor: 'pointer' }}
      onClick={(e) => {
        e.preventDefault()
        onChange(!checked)
      }}
    >
      <span
        role="switch"
        aria-checked={checked}
        title={label}
        style={{
          width: size.toggleWidth,
          height: size.toggleHeight,
          flexShrink: 0,
          borderRadius: radius.pill,
          marginTop: 2,
          position: 'relative',
          transition: `background-color ${motion.normal}`,
          backgroundColor: checked ? tk.text : tk.inputBorder,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? size.toggleWidth - size.toggleKnob - 2 : 2,
            width: size.toggleKnob,
            height: size.toggleKnob,
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            transition: `left ${motion.normal}`,
          }}
        />
      </span>
      <span>
        <span style={{ fontSize: fontSize.body, fontWeight: fontWeight.medium }}>{label}</span>
        <span
          style={{
            display: 'block',
            fontSize: fontSize.caption,
            color: tk.textMuted,
            lineHeight: 1.55,
            marginTop: 1,
          }}
        >
          {desc}
        </span>
      </span>
    </label>
  )
}

// ── 滑杆 ─────────────────────────────────────────────────────────────────────

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
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fontSize.body }}>
        <span>{label}</span>
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
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: tk.accent, cursor: 'pointer' }}
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
