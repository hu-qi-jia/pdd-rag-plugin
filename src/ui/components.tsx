/**
 * 通用组件库 — 各页签复用的视觉资产 · v5.1「石墨蓝灰」
 *
 * 清单:Btn / IconBtn / ConfirmRow / CreateBtn / Notice / Section / Tag /
 *      EmptyState / Toggle / Slider / SearchInput / CatNav / StatusBar / List
 *
 * 两条口径(自 v3.0 起,不变):
 *
 *  ① **组件不吃 `tk` 令牌对象**。v2.6 把 `ThemeTokens` 一路 prop-drill 到每个叶子
 *     是为写内联样式;而核心交互全是**状态色**(悬浮、按下、选中),内联样式表达
 *     不了 `:hover` —— 颜色必须有 CSS 层。既然 CSS 层非有不可,就不再把同一份颜色
 *     用 props 传一遍:令牌经 `index.tsx` 桥成 `--pddcs-*` 挂到 `<html>` 上,
 *     组件与样式表都只认这组变量。令牌仍只有一个真源(theme.ts)。
 *
 *  ② **组件只管结构与几何,不管状态色**。`:hover` / `[aria-current]` / `[data-*]`
 *     规则集中在 `ui/popup-css.ts`。
 *
 * 类名一律带 `pddcs-` 前缀(聊天页覆盖层会注入到平台页,避免撞名)。
 */
import type React from 'react'
import { useEffect, useRef } from 'react'
import { controlH, fontSize, radius, size, spacing, formType } from './design'
import { PlusIcon, SearchIcon } from './icons'

// ── 按钮 ─────────────────────────────────────────────────────────────────────

/**
 * `primary` 墨底白字(一页只有一个)· `default` 填充式控件(IOS 的做法:用底色
 * 而不是描边说"我能点")· `danger` 语义红软底 · `ghost` 无底无框
 */
export function Btn({
  onClick,
  children,
  variant = 'default',
  disabled,
  title,
  small,
}: {
  onClick: () => void
  children: React.ReactNode
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  title?: string
  /** 行内小号(28px 高,与图标钮同档) */
  small?: boolean
}) {
  return (
    <button
      type="button"
      className={`pddcs-btn${small ? ' pddcs-btn-sm' : ''}`}
      data-variant={variant}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

// ── 图标钮 ───────────────────────────────────────────────────────────────────

/**
 * 28×28,图标 16 居中 —— 盒内左右各留 6px。
 * 那个 6px 不是随手定的:操作行要"图标对齐正文竖线"时,首枚钮加 `margin-left:-6px`
 * 正好抵消它(见 popup-css `.pddcs-gops > .pddcs-iconbtn:first-child`)。
 */
export function IconBtn({
  onClick,
  children,
  title,
  disabled,
  on,
  busy,
  className,
}: {
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
  title?: string
  disabled?: boolean
  on?: boolean
  /** 请求在途:图标原地转圈 */
  busy?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`pddcs-iconbtn${busy ? ' pddcs-iconbtn-busy' : ''}${className ? ` ${className}` : ''}`}
      data-on={on ? 'true' : undefined}
      disabled={disabled}
      title={title}
      /* 图标钮没有文字,title 只是悬浮提示,读屏拿不到 —— 语义必须另给一份。
         全站图标钮都靠这条:知识库页一行五个动作、记忆页的删除入口都是纯图标 */
      aria-label={title}
      onClick={(e) => {
        // 图标钮几乎总长在可点/可展开的行里:不放行的话,点一下星会把所在行也一起展开
        e.stopPropagation()
        onClick(e)
      }}
    >
      {children}
    </button>
  )
}

// ── 内联二次确认行 ────────────────────────────────────────────────────────────

export function ConfirmRow({
  text,
  onOk,
  onCancel,
  fullWidth = false,
}: {
  text: string
  onOk: () => void
  onCancel: () => void
  /**
   * 独占整行。用在**横向 flex + flex-wrap**的容器里(如尺码表状态条):
   * 默认的 `flex: 1` 展开成 `flex-basis: 0`,父容器不会让它换行,只把剩余的那点
   * 宽度分给它 —— 确认文案被挤成一字一列。`flex-basis: 100%` 强制它落到下一行。
   */
  fullWidth?: boolean
}) {
  return (
    <div
      data-fullwidth={fullWidth ? 'true' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.md,
        flexWrap: 'wrap',
        flex: fullWidth ? '1 1 100%' : 1,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, fontSize: fontSize.cap, color: 'var(--pddcs-danger)' }}>
        {text}
      </span>
      <Btn variant="danger" small onClick={onOk}>
        确认
      </Btn>
      <Btn variant="ghost" small onClick={onCancel}>
        取消
      </Btn>
    </div>
  )
}

// ── 工具栏「新建」主钮 ───────────────────────────────────────────────────────

export function CreateBtn({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <Btn variant="primary" onClick={onClick} disabled={disabled} title={title}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <PlusIcon size={size.icon} strokeWidth={2.2} />
        {label}
      </span>
    </Btn>
  )
}

// ── 结果提示条 ────────────────────────────────────────────────────────────────

export type NoticeMsg = { ok: boolean; text: string } | null

/** 成功提示自动消失时长;失败提示常驻 */
export const NOTICE_OK_AUTO_DISMISS_MS = 4000

export function Notice({ msg, onDismiss }: { msg: NoticeMsg; onDismiss?: () => void }) {
  useEffect(() => {
    if (!msg?.ok || !onDismiss) return
    const t = window.setTimeout(onDismiss, NOTICE_OK_AUTO_DISMISS_MS)
    return () => window.clearTimeout(t)
  }, [msg, onDismiss])
  if (!msg) return null
  return (
    // 吸附在滚动区顶部:列表很长时提示不再被顶出视口
    <div className="pddcs-notice">
      <div className="pddcs-notice-body" data-ok={msg.ok ? 'true' : 'false'}>
        {msg.text}
      </div>
    </div>
  )
}

// ── 分区(设置页用)───────────────────────────────────────────────────────────

/**
 * 分区:**标题在卡外,行收进一张卡**。
 *
 * v4.0 的分区不是盒子(标题 + 行都落在同一片面上);v5.0 按设计稿改回分组卡片,
 * 但**标题仍留在卡外** —— 设置页一行一件事,"这一组叫什么"和"这一组有哪几行"
 * 一眼分得开,比把标题也塞进卡里清楚。
 *
 * 卡片样式在 `.pddcs-section-body`(popup-css),这里只负责把 children 包进那一层。
 */
export function Section({
  title,
  children,
  style,
  className,
}: {
  title?: string
  children: React.ReactNode
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <section className={`pddcs-section${className ? ` ${className}` : ''}`} style={style}>
      {title && <div className="pddcs-section-title">{title}</div>}
      <div className="pddcs-section-body">{children}</div>
    </section>
  )
}

// ── 方括号灰标 ───────────────────────────────────────────────────────────────

/**
 * `[文案]` 的终端记法。零信息量的标**不要渲染**(如「被用 0 次」「向量正常」)——
 * 该判断在调用方。
 */
export function Tag({
  tone = 'neutral',
  title,
  children,
}: {
  /**
   * `accent` 是 v5.0 新增档,给"值得你留意一眼"的标用(目前只有「低置信」)。
   * 它不是 danger:低置信是**需要复核**,不是**出错了** —— 用红会把
   * "需要看一眼"和"坏了"混成一件事。
   */
  tone?: 'neutral' | 'strong' | 'danger' | 'accent'
  title?: string
  children: React.ReactNode
}) {
  return (
    <span className="pddcs-tag" data-tone={tone} title={title}>
      {children}
    </span>
  )
}

// ── 空状态 ───────────────────────────────────────────────────────────────────

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: fontSize.sub,
        color: 'var(--pddcs-text-tertiary)',
        padding: `${spacing.xxl + 12}px ${spacing.xxl}px`,
        textAlign: 'center',
        lineHeight: 1.8,
      }}
    >
      {children}
    </div>
  )
}

// ── 搜索栏(IOS 形态:填充底、无描边)──────────────────────────────────────

export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="pddcs-search">
      <SearchIcon size={size.iconBtn} strokeWidth={2} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  )
}

// ── 分类导航 ─────────────────────────────────────────────────────────────────

export interface CatNavItem {
  id: string
  label: string
  /** 右侧计数;不传就不渲染那枚灰标(设置页的分页导航没有计数) */
  count?: number
}

/**
 * 横向滚动的 pill 导航。三条行为缺一不可:
 *
 *  ① **不换行 + 横滚** —— 类型数会随用户自建而增长,换行会让导航吃掉半屏;
 *  ② **滚轮纵移转横移** —— 鼠标没有横向滚轮;不可滚时**放行**(接管一个滚不动的
 *     元素等于吞掉用户的滚动);
 *  ③ **两侧到头渐隐** —— 一行被切掉一半的分类,用户不会知道右边还有东西。
 *
 * 计数为 0 的类型照样显示:类别是固定位置,不能今天消失、明天跳回来。
 */
export function CatNav({
  items,
  value,
  onChange,
  trailing,
}: {
  items: CatNavItem[]
  value: string
  onChange: (id: string) => void
  /** 导航右端的附加物(如自定义类型的改名/删除钮) */
  trailing?: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const nav = ref.current
    if (!nav) return

    /** 两侧渐隐:还有内容的那一侧才隐,滚到头恢复实色 */
    const mask = () => {
      const max = nav.scrollWidth - nav.clientWidth
      const l = nav.scrollLeft > 1 ? 14 : 0
      const r = max > 1 && nav.scrollLeft < max - 1 ? 14 : 0
      const v =
        l || r
          ? `linear-gradient(to right, transparent 0, #000 ${l}px, #000 calc(100% - ${r}px), transparent 100%)`
          : ''
      nav.style.maskImage = v
      nav.style.webkitMaskImage = v
    }

    const onWheel = (e: WheelEvent) => {
      if (nav.scrollWidth <= nav.clientWidth) return
      e.preventDefault()
      nav.scrollLeft += e.deltaY
    }

    nav.addEventListener('wheel', onWheel, { passive: false })
    nav.addEventListener('scroll', mask)
    window.addEventListener('resize', mask)
    mask()
    return () => {
      nav.removeEventListener('wheel', onWheel)
      nav.removeEventListener('scroll', mask)
      window.removeEventListener('resize', mask)
    }
  }, [items])

  return (
    <div className="pddcs-catnav-wrap">
      <nav className="pddcs-catnav" ref={ref}>
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            // data-cat-id 是**稳定的导航锚点**:验收脚本按类型 id 定位导航项,
            // 而不是按文字/位置 —— 后者随渲染改一次就会静默失配
            data-cat-id={it.id}
            aria-current={value === it.id ? 'true' : undefined}
            onClick={() => onChange(it.id)}
          >
            {it.label}
            {it.count !== undefined && <span className="n">{it.count}</span>}
          </button>
        ))}
      </nav>
      {trailing}
    </div>
  )
}

// ── 状态条 ───────────────────────────────────────────────────────────────────

/**
 * 页面名(17/600)+ 本页计数(12/等宽灰)。
 *
 * v5.0 起**下缘不画线** —— 它现在落在主面板这张卡里,而卡与卡靠间隙分界、
 * 卡内靠缩进线分界。标题下面再插一条通栏线,就成了第三种"边界",
 * 反而让人读不出哪条才是一条列表的开始。
 */
export function StatusBar({ title, count }: { title: string; count?: string }) {
  return (
    <div className="pddcs-statusbar">
      <span className="pg">{title}</span>
      {count ? <span className="ct">{count}</span> : null}
    </div>
  )
}

// ── 列表容器 ─────────────────────────────────────────────────────────────────

/**
 * 列表容器。
 *
 * **卡片的样式挂在 `.pddcs-list > *` 上**(见 popup-css)—— 所以这个组件的职责
 * 比看起来重要:三个页签的列表都得用它包一层,卡片才会成立。
 * v5.0 起容器自带上下左右内缩与行间隙,内容**不要**再各写一份左右内边距。
 */
export function List({ children }: { children: React.ReactNode }) {
  return <div className="pddcs-list">{children}</div>
}

// ── 拨杆开关(iOS 胶囊轨 + 圆柄)────────────────────────────────────────────

export function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  /** 可选:能用三五个字说清的就写,说不清的不如不写 */
  desc?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    // 容器是 div 而非 label:整行可点会让"想复制标签旁边那句话"变成一次误触,
    // 故**只有开关本体**可点;键盘可达性由 tabIndex + onKeyDown 保证。
    // pddcs-hair:设置页的行与行之间那条缩进发丝线(一段的最后一行不画)
    <div className="pddcs-srow pddcs-hair">
      <span className="pddcs-srow-label">
        <span className="n">{label}</span>
        {desc && <span className="d">{desc}</span>}
      </span>
      <span
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={`${checked ? '点击关闭' : '点击开启'}:${label}`}
        tabIndex={0}
        className="pddcs-switch"
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onChange(!checked)
          }
        }}
      >
        <span className="pddcs-switch-knob" />
      </span>
    </div>
  )
}

// ── 滑杆(iOS 圆拇指;样式见 popup-css .pddcs-slider)──────────────────────

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
}) {
  const pct = Math.round(((value - min) / (max - min)) * 100)
  return (
    <div className="pddcs-srow pddcs-hair" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing.md }}>
        <span style={{ flex: 1, fontSize: fontSize.body }}>{label}</span>
        {/* 读数走 .pddcs-num(等宽 + 表格数字),不再各写一份内联字体栈 */}
        <span className="pddcs-num" style={{ fontSize: fontSize.cap, color: 'var(--pddcs-text-tertiary)' }}>
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
          backgroundImage: `linear-gradient(to right, var(--pddcs-accent) ${pct}%, var(--pddcs-border) ${pct}%)`,
        }}
      />
    </div>
  )
}

// ── 设置行(标签 + 右侧控件)────────────────────────────────────────────────

export function SettingRow({
  label,
  desc,
  children,
  hair = true,
}: {
  label: string
  desc?: string
  children?: React.ReactNode
  /** 是否画下缘发丝线(一段列表的最后一行传 false) */
  hair?: boolean
}) {
  return (
    <div className={`pddcs-srow${hair ? ' pddcs-hair' : ''}`}>
      <span className="pddcs-srow-label">
        <span className="n">{label}</span>
        {desc && <span className="d">{desc}</span>}
      </span>
      {children}
    </div>
  )
}

/** 文字档位选择器。底层仍是 button，避免原生 radio 在各主题下各画一套。 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; title?: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="pddcs-srow pddcs-hair">
      <span className="pddcs-srow-label">
        <span className="n">{label}</span>
      </span>
      <div className="pddcs-choice" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-active={active ? 'true' : undefined}
              title={option.title}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── 样式原语 ─────────────────────────────────────────────────────────────────

/** 顶部工具栏(新建条目 / 上传 .md / 上传尺码表 那一排) */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: spacing.lg,
        flexWrap: 'wrap',
        padding: `0 ${spacing.xxl}px ${spacing.xl}px`,
      }}
    >
      {children}
    </div>
  )
}

/** 输入框 / 文本域的附加样式(几何与配色在 popup-css `.pddcs-input`) */
export function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { width: '100%', ...extra }
}

/**
 * 列表项的发丝线缩进量。与 `pddcs-hair` 配对使用:
 * `--hair-in` 是自定义属性,CSSProperties 里没有它的位置,故做一次断言。
 */
export function hairStyle(indentPx: number): React.CSSProperties {
  return { '--hair-in': `${indentPx}px` } as React.CSSProperties
}

export const ICON_SIZE = size.iconBtn
export const ICON_BTN_SIZE = controlH.icon
export const HAIR_IN = spacing.xxl

/** 与按钮同排的输入框:显式 height 取 controlH 档位,与同排按钮严格等高 */
export function controlStyle(height: number, extra?: React.CSSProperties): React.CSSProperties {
  return { width: '100%', height, padding: `0 ${spacing.xl}px`, ...extra }
}

export { formType, radius }

export function formatTs(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
