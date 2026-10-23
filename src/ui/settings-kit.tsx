/**
 * 设置页组件套装(setting kit)。
 *
 * 为什么单开一个文件:设置页是唯一"很多行、很多控件、少交互"的页面 ——
 * 它的行结构(标签 + 说明 + 右侧控件、卡内缩进发丝线、分组标题)在别的页签里
 * 一次都用不到。放进 `components.tsx` 会和列表/面板的原语混在一起,看不出边界。
 *
 * 约定:
 * - 所有行仍然产出 `.pddcs-srow` / `.pddcs-hair` / `.pddcs-srow-label` 这套类名,
 *   行距、内边距、发丝线只有 `popup-css` 一个出处;组件只管结构与语义。
 * - 组件不带状态,除了 `HotkeyRow`(按键录入是它自己的交互)与 `SettingsNav`
 *   (高亮由父级传入)。
 */
import React, { useEffect, useId, useState } from 'react'
import type { HotkeyConfig } from '../types/memory'
import { Btn } from './components'
import { controlH, fontSize, formGap, radius, size, spacing } from './design'
import { InfoIcon, PencilIcon } from './icons'
import { formatHotkey, isModifierOnly } from '../shared/hotkey'

// ── 分区 ─────────────────────────────────────────────────────────────────────

/**
 * 分区:图标 + 标题 + 概要,卡在下面。
 *
 * 与 `components.tsx#Section` 的差别只有头部:设置页的分区标题要承担"这是哪一组、
 * 里面大概有什么",所以给它一枚图标和一句概要,而不是 12px 的小灰字。
 */
export function SettingsSection({
  id,
  icon,
  title,
  summary,
  children,
}: {
  /** 供分区导航跳转;同时作为 `data-section` 的锚 */
  id: string
  icon: React.ReactNode
  title: string
  summary?: string
  children: React.ReactNode
}) {
  return (
    <section className="pddcs-section" id={id} data-section={id}>
      <div className="pddcs-sect-head">
        <span className="ic" aria-hidden="true">
          {icon}
        </span>
        <span className="t">{title}</span>
        {summary && <span className="s">{summary}</span>}
      </div>
      <div className="pddcs-section-body">{children}</div>
    </section>
  )
}

/** 卡内的子分组标题(如「相似度阈值」「数据保留」)。 */
export function SubGroup({ label }: { label: string }) {
  return <div className="pddcs-subgroup">{label}</div>
}

// ── 行 ───────────────────────────────────────────────────────────────────────

/**
 * 堆叠式字段行:标签在上、控件在下、输入框占满整行。
 *
 * 接口地址 / API Key / 模型名这类长文本,**左右排会把输入框压成一条缝**;
 * 上下排才是表单该有的密度。
 */
export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pddcs-srow pddcs-srow-blk pddcs-hair">
      <span className="pddcs-srow-label">
        <span className="n">{label}</span>
      </span>
      <div className="pddcs-field-stack">{children}</div>
    </div>
  )
}

/**
 * 操作条:**说明/结论贴左,按钮贴右,主按钮永远在最右**。
 *
 * 全页一条规则,免得"保存"在左、"确认"在右、"导出"在左…… 每次都要重新找。
 * 状态文字占剩余宽度,按钮组 `margin-left:auto` 钉在右端 —— 结论长短不会推着按钮跑。
 */
export function ActionBar({
  children,
  status,
}: {
  children: React.ReactNode
  /** 就地结论 / 说明;可以是一段,也可以是多行 */
  status?: React.ReactNode
}) {
  return (
    <div className="pddcs-actionbar pddcs-hair">
      {status ? <div className="status">{status}</div> : null}
      <div className="btns">{children}</div>
    </div>
  )
}

/** 整行说明 / 自查提示。tone 决定颜色:普通灰或危险红。 */
export function NoteRow({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'danger'
}) {
  return (
    <div className="pddcs-srow pddcs-srow-blk pddcs-hair" data-tone={tone}>
      {children}
    </div>
  )
}

/** 指标网格:使用统计这类"一串数字"用瓦片排,比一行一个更省高度、也更好扫。 */
export function MetricGrid<T extends string>({
  items,
}: {
  /** wide:值是一整句话时横跨两列(如「12 次 · 未命中 3 次(25%)」) */
  items: ReadonlyArray<{ key: T; label: string; value: string; wide?: boolean }>
}) {
  return (
    <div className="pddcs-metrics">
      {items.map((item) => (
        <div
          className="pddcs-metric"
          key={item.key}
          data-metric={item.key}
          data-wide={item.wide ? 'true' : undefined}
        >
          <div className="k">{item.label}</div>
          <div className="v">{item.value}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * 悬浮说明:标题旁的一枚 ⓘ。
 *
 * 长句子仍然留在 DOM 里(读屏、单测的 textContent 都拿得到),只是**视觉上等到
 * 悬浮/聚焦才出现** —— 设置页一屏要塞很多行,知情说明不该每行都摊开占三行。
 */
export function InfoHint({
  children,
  label = '说明',
}: {
  children: React.ReactNode
  /** 读屏用的一句话:气泡内容会通过 aria-describedby 关联 */
  label?: string
}) {
  const id = useId()
  return (
    <span className="pddcs-hint" tabIndex={0} aria-label={label} aria-describedby={id}>
      <InfoIcon size={13} strokeWidth={2} />
      <span className="bubble" id={id} role="tooltip">
        {children}
      </span>
    </span>
  )
}

// ── 快捷键行:展示 + 按键录入 ─────────────────────────────────────────────────

/**
 * 唤起键 / 候选切换键的行。
 *
 * 录入态:捕获下一次按键(修饰键单独按下先等待主键;Esc 取消)。
 * `allowPlainKey` 只给面板导航键(Tab),唤起键必须带修饰键 —— 纯主键会和日常输入打架。
 */
export function HotkeyRow({
  hotkey,
  label = '快捷键',
  desc = '在聊天页按此键唤起推荐回复',
  allowPlainKey = false,
  onChange,
}: {
  hotkey: HotkeyConfig
  label?: string
  desc?: string
  allowPlainKey?: boolean
  onChange: (hk: HotkeyConfig) => void
}) {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      if (isModifierOnly(e.key)) return
      if (!allowPlainKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        // 纯主键容易与日常输入冲突:唤起键不允许,导航键(allowPlainKey)放开
        setRecording(false)
        return
      }
      const hk: HotkeyConfig = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, key: e.key }
      setRecording(false)
      onChange(hk)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange, allowPlainKey])

  return (
    <div className="pddcs-srow pddcs-srow-blk pddcs-hair">
      {/* 行 1:标签 + 键帽 + 「修改」推到最右。键帽与按钮严格等高 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        <span
          style={{
            fontSize: fontSize.body,
            flexShrink: 0,
          }}
        >
          {label}
        </span>
        <kbd
          className="pddcs-num"
          style={{
            height: controlH.form,
            display: 'inline-flex',
            alignItems: 'center',
            padding: `0 ${spacing.lg}px`,
            borderRadius: radius.control,
            border: '1px solid var(--pddcs-separator)',
            backgroundColor: 'var(--pddcs-fill)',
            color: 'var(--pddcs-text)',
            fontSize: fontSize.cap,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {formatHotkey(hotkey)}
        </kbd>
        {!recording && (
          <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <Btn title="按下新的组合键即可替换当前快捷键" onClick={() => setRecording(true)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <PencilIcon size={size.icon} strokeWidth={2} />
                修改
              </span>
            </Btn>
          </div>
        )}
      </div>
      {/* 行 2:说明 / 录入提示 */}
      {recording ? (
        <span
          style={{
            fontSize: fontSize.cap,
            color: 'var(--pddcs-text)',
            lineHeight: 1.5,
            marginTop: formGap.labelDesc,
          }}
        >
          请按下新的快捷键(Esc 取消{allowPlainKey ? ';可用单键(如 Tab)' : ';需带 Ctrl/Alt/Shift'})
        </span>
      ) : desc ? (
        <span
          style={{
            fontSize: fontSize.cap,
            color: 'var(--pddcs-text-tertiary)',
            lineHeight: 1.5,
            marginTop: formGap.labelDesc,
          }}
        >
          {desc}
        </span>
      ) : null}
    </div>
  )
}
