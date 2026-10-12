/**
 * 通用组件库 — 各页签复用的视觉资产(设计规范的可执行形态)
 *
 * v3.0(复古极简 + 极客工具风)对本文件的整体影响:
 *  - 盒子退场,线登场。`Card` 不再是"白底 + 描边 + 圆角的卡片",而是**一根线加一块内容**;
 *    分区靠 `border` 横线、列表靠 `borderLight` 上缘线,谁都不再是一个圆角盒子。
 *  - 反白是唯一的"高权重"表达:主按钮、导航选中、面板选中行共用同一种黑底白字,
 *    不再有第二套强调色。
 *  - 徽标改**方括号标签** `[标准]`:旧版是彩色软底 chip(圆角 + 填充 + 图标),
 *    在黑白灰的版面上那是最响的三个色块。现在只留油墨色的方括号,信息量不减、墨点大减。
 *
 * 清单:SectionHeader / Btn / ConfirmRow / CreateBtn / Notice / Card / Badge /
 *       EmptyState / SearchInput / Toggle / Slider + 样式原语
 * 原则:颜色一律来自 ThemeTokens,几何一律来自 design.ts;页面不得自带样式实现。
 */
import type React from 'react'
import { useEffect, useState } from 'react'
import type { ThemeTokens } from './theme'
import { controlH, fontSize, fontWeight, radius, spacing, motion, size, formType, formGap, stroke, rowHover } from './design'
import { PlusIcon, SearchIcon } from './icons'


// ── 分区标题(全站唯一的分区装置)────────────────────────────────────────────
/**
 * `标题 ────────────────────  [右端附加物]`
 *
 * 这是承担"分区"职责的**唯一**装置(旧版是卡片盒子的标题行)。
 * 一个标签 + 一条向右延伸的线:标签说明"这是什么",线说明"这段到哪儿结束"。
 * 整屏没有盒子,层级完全由这几根线给出。
 *
 * **线取 `borderStrong`(结构线档)**,这是标题与列表行能被一眼分开的全部依据:
 * 行与行之间画的是 `borderLight` 发丝线,两档深浅差得足够远。
 *
 * **标题前那根 3×12 的竖标记已在第二版删除**(用户:"标题前的竖线删除")——
 * 与"盒子退场"同一条思路:能靠线说清的事就不再叠一枚符号。
 * 标题文字左缘因此正好落在 x=0,与它管着的那些行的文字同线,不需要任何补偿量。
 *
 * 为什么不让调用方自己拼:分区标题一旦有两个实现,装饰量立刻分叉
 * (旧版就是 Card 的标题行与 MemoryListTab 手搓的折叠标题各写一套)。
 * 需要可折叠时传 `onClick` —— 同一个装置,多一种交互而已。
 */
export function SectionHeader({
  tk,
  title,
  extra,
  onClick,
  expanded,
}: {
  tk: ThemeTokens
  title: React.ReactNode
  /** 右端附加物(折叠箭头、改名/删除图标钮);线在它之前收住 */
  extra?: React.ReactNode
  /** 传入则整行成为可折叠按钮(aria-expanded 随之声明) */
  onClick?: () => void
  expanded?: boolean
}) {
  const content = (
    <>
      {/* 分区标题取 `textMuted`(用户:「标题与词条颜色也做一下区分")——
          此前标题与词条同为纯黑,只靠字号(13.5 vs 12.5)与分区线区分,在满屏条目里
          那一行标题读起来就像"又一条内容、只是大一点"。
          现在三样一起说:字号 + 字重 + **颜色**(灰标题 vs 纯黑条目),
          而分区线仍是全屏最重的那根线。灰标题不是"弱化",是**角色区分** ——
          分区名是一枚标签,它管着的那些行才是内容。
          注:设置页的分区标题用的是同一个装置,会一起变灰(它下面的字段标签仍是纯黑)。 */}
      <span
        style={{
          fontSize: formType.groupTitle.size,
          fontWeight: formType.groupTitle.weight,
          color: tk.textMuted,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      {/* 向右延伸的分区线:**取分区线档**(`border`,#e5e5e5)。
          v3.1 §四把线分成了三档且**都是 1px**,靠深浅分档:
            外框 `borderStrong`(#111)> 分区线 `border`(#e5e5e5)> 行分隔 `borderLight`(#f0f0f0)。
          所以这里**不是**结构线 —— 结构线只留给窗口外框与页头那种"版面的边"。
          flex 吃满剩余宽度;窄到一定程度就让它消失(minWidth 兜底),
          否则标题一长线就缩成一个小点,反而更像噪点 */}
      <span
        aria-hidden
        style={{
          flex: 1,
          minWidth: spacing.md,
          height: stroke.hairline,
          backgroundColor: tk.border,
        }}
      />
      {extra ? <span style={{ flexShrink: 0, display: 'inline-flex' }}>{extra}</span> : null}
    </>
  )
  if (!onClick) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        width: '100%',
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: tk.text,
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      {content}
    </button>
  )
}

// ── 按钮 ─────────────────────────────────────────────────────────────────────

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
  const color = isPrimary ? tk.btnPrimaryText : isGhost ? tk.textMuted : tk.text
  const bg = isPrimary ? tk.btnPrimaryBg : isGhost ? 'transparent' : tk.btnBg
  // 悬浮:primary 走 opacity(§五.5「hover 用 opacity 变化」,不改色);
  // danger 由墨框**转实心墨底**(v3.1 没有红色,危险动作靠反白表达最高权重)
  const hoverBg = isPrimary ? tk.btnPrimaryHover : isDanger ? tk.borderStrong : tk.btnHoverBg
  const hoverColor = isDanger ? tk.bg : color
  return (
    <button
      type="button"
      className="pddcs-btn"
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{
        // ghost 不描边;danger 取**1px 墨框**(§五.6 的"文字指令钮升级为墨框描边钮")
        borderColor: isGhost ? 'transparent' : isDanger ? tk.dangerBorder : tk.btnBorder,
        backgroundColor: bg,
        color,
        opacity: 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.backgroundColor = hoverBg
        e.currentTarget.style.color = hoverColor
        // primary 额外走 opacity:一页至多一枚主钮,悬浮时"亮一点"即可,不换色
        if (isPrimary) e.currentTarget.style.opacity = '0.82'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = bg
        e.currentTarget.style.color = color
        e.currentTarget.style.opacity = '1'
      }}
    >
      {children}
    </button>
  )
}

// ── 内联二次确认行 ────────────────────────────────────────────────────────────

/**
 * 删除类操作的**原位**二次确认行:警示文案 + 确认/取消。
 *
 * 取**内联档**(`controlH.inline` + `fontSize.caption`):确认行长在行内、不占表单位,
 * 与被确认的那一行同档才是对的。文件夹页与记忆页共用本实现,不允许各写一套。
 */
export function ConfirmRow({
  tk,
  text,
  onOk,
  onCancel,
}: {
  tk: ThemeTokens
  text: string
  onOk: () => void
  onCancel: () => void
}) {
  const btn: React.CSSProperties = {
    height: controlH.inline,
    padding: '0 10px',
    borderRadius: radius.sm,
    fontSize: fontSize.caption,
    cursor: 'pointer',
    flexShrink: 0,
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
      {/* v3.1 去掉红色:警示靠**墨色 + 加粗 + `!` 前缀** —— 不靠颜色表意 */}
      <span style={{ flex: 1, fontSize: fontSize.caption, color: tk.text, fontWeight: fontWeight.semibold }}>
        ! {text}
      </span>
      <button
        type="button"
        onClick={onOk}
        style={{
          ...btn,
          border: `${stroke.hairline}px solid ${tk.dangerBorder}`,
          backgroundColor: 'transparent',
          color: tk.text,
          fontWeight: fontWeight.semibold,
        }}
      >
        确认
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{ ...btn, border: `${stroke.hairline}px solid ${tk.btnBorder}`, backgroundColor: 'transparent', color: tk.textMuted }}
      >
        取消
      </button>
    </div>
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

// ── 字符图标 + 全站统一的图标钮(v3.1 §五.3 / §六)──────────────────────────

/**
 * **能用字符就不用 SVG**(§六)。这几个字形在 Windows 字体里都有、渲染稳定,
 * 直接用字符;宽窄与基线由 font-size + line-height 统一约束。
 *
 * `⧉`(U+29C9)与 `⇢`(U+21E2)在 Windows 上常缺字或宽窄不一,故**继续用 SVG**
 * (lucide 的 Copy / MoveRight)—— 这是"混合"口径的边界:稳的用字符,不稳的用 SVG。
 */
export const GLYPH = {
  /** 设为标准(描边=未设;实心琥珀=已设,由 IconBtn 的 active 控制颜色) */
  star: '★',
  /** 编辑 */
  edit: '✎',
  /** 删除 */
  close: '✕',
  /** 展开区里每条回复的行首标记(以及回显引子) */
  mark: '›',
  /** 命令台提示符 */
  prompt: '❯',
} as const

/**
 * **图标钮**(v3.1 §五.3):20×20 纯图标无框,默认灰 `textFaint`;hover 黑底白;
 * 已设/激活态**琥珀常显**。必须带 title 提示。
 *
 * 三条实现口径:
 *  - **各自独立** —— 多条结果里每条回复各带自己的钮,不共享一行按钮(§五.3 末句);
 *  - `stopPropagation` —— 这些钮长在可点的行里(点行 = 展开/填充),不拦住就会连带触发父级;
 *  - **数量与位置不随悬浮变化** —— 常驻可见。悬浮才显在本项目里被明确否决过两次。
 */
export function IconBtn({
  tk,
  title,
  onClick,
  children,
  active = false,
  disabled = false,
}: {
  tk: ThemeTokens
  /** 必须给:图标没有文字,title 是它唯一的可读名 */
  title: string
  onClick: () => void
  /** 图标内容:字符(GLYPH.xxx)或一个 SVG 节点 */
  children: React.ReactNode
  /** 已设 / 激活态:琥珀常显 */
  active?: boolean
  disabled?: boolean
}) {
  const idle = active ? tk.goldenText : tk.textFaint
  const hot = active ? tk.goldenBright : tk.bg
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{
        width: size.iconBtn,
        height: size.iconBtn,
        flexShrink: 0,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: radius.sm,
        backgroundColor: 'transparent',
        color: idle,
        fontSize: size.icon,
        lineHeight: 1,
        fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: `background-color ${motion.fast}, color ${motion.fast}`,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.backgroundColor = tk.text
        e.currentTarget.style.color = hot
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
        e.currentTarget.style.color = idle
      }}
    >
      {children}
    </button>
  )
}

// ── 结果提示条 ────────────────────────────────────────────────────────────────

export type NoticeMsg = { ok: boolean; text: string } | null

/** 成功提示自动消失时长;失败提示常驻供读错因 */
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
    // 吸附在滚动区顶部:列表很长时提示不再被顶出视口。
    // v3.0 由"圆角软底条"改**左侧硬色条 + 方角平底**:一条 3px 的实色竖线声明
    // "这一行是一条状态",比整块淡色底更省墨,也不会在一屏黑白灰里糊成一片。
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
          display: 'flex',
          alignItems: 'flex-start',
          gap: spacing.md,
          padding: `${spacing.sm}px ${spacing.md}px`,
          borderLeft: `${rowHover.barWidth}px solid ${tk.borderStrong}`,
          backgroundColor: tk.noticeBg,
          fontSize: fontSize.secondary,
          lineHeight: 1.55,
          color: tk.text,
          fontWeight: msg.ok ? fontWeight.regular : fontWeight.semibold,
          wordBreak: 'break-all',
        }}
      >
        {/* 失败带 `!` 前缀 —— v3.1 没有红色,失败与成功的差别只在"加粗 + 这个记号" */}
        {msg.ok ? msg.text : `! ${msg.text}`}
      </div>
    </div>
  )
}

// ── 容器(四种形态,各自编码一种结构含义)────────────────────────────────────

/**
 * `variant` 是本设计语言里"这块内容在结构上是什么"的声明,**不是样式选项**:
 *
 * | variant | 形态 | 用在哪儿 |
 * |---|---|---|
 * | `section` | 顶上一行分区标题(`SectionHeader`),无框无底 | 设置页各分区、文件夹页各类型分区 |
 * | `box` | 1px 方框包住,无圆角无底 | 内联的"新建/编辑"表单(临时面板,要和外层内容明确分开) |
 * | `row` | 上缘一条细线分隔,无框 | 列表条目(记忆问答、知识条目) |
 * | `plain` | 什么都不加,纯容器 | 需要自己给孩子排版的场合(如记忆页的分组容器) |
 *
 * 默认值由 `title` 是否存在推出(有标题 = 分区,没标题 = 列表行)—— 这是最常用的两种,
 * 让绝大多数调用点不必声明。但**含义不同就必须显式写明**,比如"没有标题的临时表单"
 * 应当写 `box` 而不是默认落到 `row`。
 */
export type CardVariant = 'section' | 'box' | 'row' | 'plain'

export function Card({
  tk,
  title,
  titleExtra,
  children,
  style,
  className,
  variant,
}: {
  tk: ThemeTokens
  /** 分区标题:字符串或节点 */
  title?: React.ReactNode
  /** 标题行右端附加物(分区旁的改名/删除图标钮) */
  titleExtra?: React.ReactNode
  children: React.ReactNode
  style?: React.CSSProperties
  /** 附加 CSS 类(容器透传) */
  className?: string
  variant?: CardVariant
}) {
  const v: CardVariant = variant ?? (title ? 'section' : 'row')
  const base: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
  }
  // box:整圈描边,无底 —— "临时面板"与周围内容的分界
  if (v === 'box') {
    base.border = `${stroke.hairline}px solid ${tk.border}`
    base.padding = `${spacing.xl}px`
  }
  // row:只画上缘一条细线;**左右不留内边距** —— 行的文字、上方的分区标题、
  // 那条细线三者因此共用同一条左缘(内容区的 16px 内边距是它们共同的页边距)。
  // 上下留 spacing.md(8px):线贴在字上会把行压扁,而 10px 又太散 ——
  // 一屏要装下多少条,靠的就是这几个像素(用户:「紧凑一点」)。
  if (v === 'row') {
    base.borderTop = `${stroke.hairline}px solid ${tk.borderLight}`
    base.padding = `${spacing.md}px 0`
  }
  return (
    // `data-card-title` 是**稳定的分区锚点**(标题为字符串时自动挂上):
    // 验收脚本与单测按它找"这一块",而不是靠"标题元素是第几层子节点 / textContent 恰等于什么"——
    // 后者随渲染改一次就会静默失配(FoldersTab 的 `data-category-id` 就是为此立的,
    // 见 docs/DESIGN.md「文件夹模块布局」;Task 6 移除 data-folder-id 后脚本静默失配的教训)
    <div
      className={className}
      data-card-title={typeof title === 'string' ? title : undefined}
      style={{ ...base, ...style }}
    >
      {title ? <SectionHeader tk={tk} title={title} extra={titleExtra} /> : null}
      {children}
    </div>
  )
}

// ── 徽标(方括号标签)───────────────────────────────────────────────────────

/**
 * `[标准回答]` / `[文档]` / `[预置]`
 *
 * v3.0 由"彩色软底圆角 chip"改为**方括号 + 油墨色文字**,去掉填充、圆角与图标。
 * 方括号是终端与代码注释里的原生标记法,"这是一个标签"这件事不需要靠一块底色来说;
 * 去掉填充后,同一屏里多挂几个徽标也不会把版面染成彩色。
 *
 * 三种 tone 的颜色取自 ThemeTokens(golden / knowledge / neutral),
 * 是**功能信号**不是装饰:读的人靠它区分标准回答、知识库文档块与普通的种类标签。
 */
export function Badge({
  tk,
  tone,
  children,
}: {
  tk: ThemeTokens
  tone: 'golden' | 'knowledge' | 'neutral'
  children: React.ReactNode
}) {
  // v3.1:全站唯一的彩色是琥珀。[知识] 与 [历史] 都是灰,靠**文字**区分而不是靠颜色 ——
  // 多一种颜色就多一个需要解释的信号,而它并不比那两个字更准。
  const color = tone === 'golden' ? tk.goldenText : tk.textFaint
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        color,
        fontSize: fontSize.caption,
        fontWeight: fontWeight.semibold,
        whiteSpace: 'nowrap',
        letterSpacing: 0,
      }}
    >
      [{children}]
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
          left: 9,
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
        // **显式取表单档高度**(26,controlH.form):同排的工具钮都是这一档,
        // 而它又是页面上第一件东西 —— 高度漂一档,下面整列(含分类导航)就跟着漂,
        // 两个页签的导航栏于是对不齐(用户第 2 条)
        style={controlStyle(tk, controlH.form, { paddingLeft: 26 })}
      />
    </div>
  )
}

// ── 拨杆开关(直角方块滑块;文字居左、开关居右)──────────────────────────────

/**
 * v3.0 重设计:旧版是 36×20 胶囊轨道 + 16 圆滑块(精致控件语言)。
 * 现在是一块**方形双态开关**:方角轨道 + 方形滑块,与输入框、按钮共用同一套直角描边语言。
 *
 * 选中态 = 轨道填充 `controlActive`(浅色纯黑 / 深色纯白),即"反白";
 * 滑块底色 `controlKnobBg` 与轨道**反相**(硬约束,同色则滑块消失)。
 * 位移与按压拉伸全由 popup RESET_CSS 按 `aria-checked`/`:active` 驱动,
 * React 只声明结构(knob 无内联 left,内联会压过 :active)。
 */
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
  const track = checked
    ? hover
      ? tk.controlActiveHover
      : tk.controlActive
    : hover
      ? tk.switchTrackHover
      : tk.switchTrack
  return (
    // 容器是 div 而非 label:只有开关本体可点,点标签文字不翻转
    //(标签旁边就挨着说明文字,整行可点会让"选一句话复制"做不到)。
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.lg }}>
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
        title={`${checked ? '点击关闭' : '点击开启'}:${label}`}
        tabIndex={0}
        className="pddcs-switch"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          // 键盘可达:Enter/Space 切换,Space 阻断页面滚动
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
          borderRadius: radius.sm,
          position: 'relative',
          transition: `background-color ${motion.normal}`,
          cursor: 'pointer',
          backgroundColor: track,
        }}
      >
        <span className="pddcs-switch-knob" />
      </span>
    </div>
  )
}

// ── 滑杆(自定义填充轨道;拇指样式见 popup RESET_CSS .pddcs-slider)───────────

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
  // 填充进度硬切:激活色到当前值,其后是轨道色。
  // 这里的 linear-gradient **没有过渡带**(两个色标同位置),渲染出来是两段平涂 ——
  // 它不是"渐变效果",而是用一条 background 画两段色最省 DOM 的写法。
  const pct = Math.round(((value - min) / (max - min)) * 100)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: formType.label.size }}>
        <span style={{ fontWeight: formType.label.weight }}>{label}</span>
        <span
          style={{
            color: tk.textMuted,
            fontFamily: 'inherit',
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
          backgroundImage: `linear-gradient(to right, ${tk.controlActive} ${pct}%, ${tk.inputBorder} ${pct}%)`,
        }}
      />
    </div>
  )
}

// ── 样式原语(供表单类元素)─────────────────────────────────────────────────

export function inputStyle(tk: ThemeTokens, extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: '100%',
    padding: `7px ${spacing.xl}px`,
    borderRadius: radius.md,
    border: `${stroke.hairline}px solid ${tk.inputBorder}`,
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
 * (曾经的事故:输入框靠 padding+line-height 撑到 35px,同排「创建/取消」为 28px,相差 7px。)
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
