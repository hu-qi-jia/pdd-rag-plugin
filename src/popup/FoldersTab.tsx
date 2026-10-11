/**
 * 标准回答页(P3,设计文档 §7)—— 按**问题类型**分区(第五十七轮 Task 6)。
 *
 * 结构:提示条 → 类型分区容器(标题「类型名 · 条数」)→ 标准回答行。
 *
 * 历史:本页原为两层文件夹树(工具栏新建 / 重命名 / 删除 / 遗留子夹拍平)。
 * folders 表与 goldens.folderId 保留不删(回滚用),但**本页不再读写它们** ——
 * 分区改由 categories 承担;类型的新建 / 改名 / 删除(第五十七轮 Task 7)也在这里:
 * 页头「新建类型」内联表单 + 自定义分区头的改名/删除图标钮(预置与未分类无钮;
 * 重名与空判定说明由后台 handler 硬拦截,删除时其中的标答落回未分类)。
 *
 * 行操作(保持 v2.6.29 左移 / v2.6.31 常驻):四个图标钮(移到类型/复制/编辑/删除)
 * 占原填充位、默认可见,且**图标左缘与上方正文左缘对齐**(负 margin 抵消钮盒内留白);
 * 填充能力保留在聊天页面板与知识库页。
 * 「移到其他类型」用仓库既有的原生 <select> 写法(不引入下拉组件),选中即发
 * UPDATE_GOLDEN_CATEGORY 并刷新。
 * 用户手工摆放过的标答(categorySource === 'manual')在问题行挂「已指定」徽标 ——
 * 让用户看得出哪些是机器打的、哪些是自己摆的。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../shared/message-passing'
import type {
  CreateCategoryResponse,
  DeleteCategoryResponse,
  DeleteGoldenResponse,
  GetPanelDataResponse,
  PanelCategory,
  PanelGolden,
  RenameCategoryResponse,
  UpdateGoldenCategoryResponse,
  UpdateGoldenResponse,
} from '../types/messages'
import { MAX_GOLDENS_PER_QUESTION } from '../shared/constants'
import {
  categoryOrder,
  countGoldensByQuestion,
  criteriaOverlapsPresets,
  groupByCategory,
  orderGoldensByRecency,
} from './logic'
import { hashText } from '../shared/text'
import {
  Badge,
  Btn,
  Card,
  ConfirmRow,
  CreateBtn,
  EmptyState,
  Notice,
  controlStyle,
  inputStyle,
  type NoticeMsg,
} from '../ui/components'
import { controlH, fontSize, fontWeight, motion, radius, size, spacing } from '../ui/design'
import { CopyIcon, PencilIcon, TagIcon, TrashIcon } from '../ui/icons'

/**
 * 图标钮内的图标渲染尺寸,以及由此产生的**盒内留白**(v2.6.31):
 * 24px(`controlH.inline`)方钮里居中放 13px 图标 → 左右各 `(24 − 13) / 2 = 5.5px`。
 * 操作组靠左时必须用 `-ICON_BTN_INSET` 抵消,否则**图标**会比上方正文多缩进 5.5px
 * (用户第四十四轮反馈"按钮左侧和上方文字左侧对齐":钮盒本就对齐,视觉错位来自这段留白)。
 * 铁律:图标尺寸改这里,不要在各处写 `size={13}`。
 * 第五十一轮:值本身改取 `design.size.icon`(与聊天页覆盖层的 overlay-icons.ICON_SIZE 同源),
 * 这里保留导出名 —— 上面那条"盒内留白"的推导是本文件的口径。
 */
export const ICON_SIZE = size.icon
const ICON_BTN_INSET = (controlH.inline - ICON_SIZE) / 2

/** 操作组对齐档:靠右(标题栏)/ 靠左·钮盒贴正文(文字钮、下拉)/ 靠左·图标贴正文(图标钮组) */
type OpsAlign = 'right' | 'text' | 'icon'

/** 标准回答行与所在分区共用的左基线(第五十七轮:分区压平成一层,不再有深度参数) */
const ROW_INDENT = 12

const clamp2: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  wordBreak: 'break-word',
}

const clamp1: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export function FoldersTab({
  tk,
  onDataChanged,
}: {
  tk: ThemeTokens
  onDataChanged: () => Promise<void> | void
}) {
  const [categories, setCategories] = useState<PanelCategory[]>([])
  const [goldens, setGoldens] = useState<PanelGolden[]>([])
  // 逐条用量(v0.16):条目 id → 被填充次数;"哪条话术真在用"只有这里看得出来
  const [itemUsage, setItemUsage] = useState<Record<string, number>>({})
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [loading, setLoading] = useState(true)

  // 内联交互状态(同一时刻至多一个激活)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftQ, setDraftQ] = useState('')
  const [draftA, setDraftA] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)
  const [confirmGoldenDelete, setConfirmGoldenDelete] = useState<string | null>(null)

  // 类型 CRUD(第五十七轮 Task 7):新建表单 / 分区头改名 / 删除二次确认(同一时刻至多一个)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCriteria, setNewCriteria] = useState('')
  const [renamingCat, setRenamingCat] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [confirmCatDelete, setConfirmCatDelete] = useState<string | null>(null)

  /** 同问题标准回答条数(questionHash → n):多答案问题的行上标注 n / 已满 */
  const questionCounts = useMemo(() => countGoldensByQuestion(goldens), [goldens])

  /**
   * 分区前必须**先把顺序排好**(groupByCategory 的契约:组内保持传入顺序,它不排)。
   * GET_PANEL_DATA 回来的是 `db.goldens.toArray()` = id 序 = **最旧在前** ——
   * 直接喂给 groupByCategory 会让同问题的多条答案把最旧的顶到最前,与既定口径相反。
   * 这里补回旧路径(`buildFolderTree`)原有的 `orderGoldensByRecency`:同问题多条按
   * updatedAt 倒序(最近设置的靠前,与聊天页候选同一口径)。
   */
  const orderedGoldens = useMemo(() => orderGoldensByRecency(goldens), [goldens])

  /**
   * 按问题类型分区(第五十七轮 Task 6):复用 logic#groupByCategory —— 未分类恒最后、
   * 类型表里没有的 id 并进未分类、空组不产出。这里不再有第二套分组实现。
   */
  const groups = useMemo(
    () => groupByCategory(orderedGoldens, categories),
    [orderedGoldens, categories],
  )

  /** 类型下拉的选项:未分类在内,已删除的类型不在(它本来就不在类型表里) */
  const categoryOptions = useMemo(
    () =>
      categoryOrder(categories).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      )),
    [categories],
  )

  /**
   * 渲染分区 = 非空分组 + **空的自定义类型**。
   * 空组不产出是 groupByCategory 的既定契约(记忆页只读,无可厚非),但本页要能改名/删除 ——
   * 一个刚建好、还没摆任何标答的类型若无分区,就永远够不到它的操作钮。
   * 未分类由 groupByCategory 兜底产出(含"类型表里没有的 id"),这里不再重复。
   */
  const sections = useMemo(() => {
    const seen = new Set(groups.map((g) => g.category.id))
    const merged = [
      ...groups,
      ...categoryOrder(categories)
        .filter((c) => c.kind === 'custom' && !seen.has(c.id))
        .map((c) => ({ category: c, items: [] as PanelGolden[] })),
    ]
    const order = new Map(categoryOrder(categories).map((c, i) => [c.id, i]))
    return merged.sort(
      (a, b) => (order.get(a.category.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.category.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }, [groups, categories])

  /** 判定说明与预置描述的字符重合度警示(spec §五.3):不做计算式拦截,只把说明行标红 */
  const overlapWarn = useMemo(
    () => (newCriteria.trim() ? criteriaOverlapsPresets(newCriteria.trim()) : false),
    [newCriteria],
  )

  const load = useCallback(async () => {
    try {
      const resp = await sendMessage<GetPanelDataResponse>({ type: 'GET_PANEL_DATA' })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        setGoldens(resp.payload.goldens)
        setCategories(resp.payload.categories ?? [])
        setItemUsage(resp.payload.itemUsage ?? {})
      }
    } catch (err) {
      setMsg({ ok: false, text: `读取失败:${String(err)}` })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    await load()
    await onDataChanged()
  }

  // ─── 标准回答操作 ──────────────────────────────────────────────────────────────

  const copyGolden = async (g: PanelGolden) => {
    try {
      await navigator.clipboard.writeText(g.answer)
      setMsg({ ok: true, text: '已复制到剪贴板' })
    } catch {
      setMsg({ ok: false, text: '复制失败' })
    }
  }

  const startEdit = (g: PanelGolden) => {
    setEditingId(g.id)
    setDraftQ(g.question)
    setDraftA(g.answer)
    setMovingId(null)
    setConfirmGoldenDelete(null)
  }

  const submitEdit = async () => {
    if (!editingId) return
    try {
      const resp = await sendMessage<UpdateGoldenResponse>({
        type: 'UPDATE_GOLDEN',
        payload: { id: editingId, question: draftQ, answer: draftA },
      })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `保存失败:${resp.payload.error}` })
        return
      }
      setMsg({
        ok: true,
        text: resp.payload.reembed ? '已保存,正在重新生成问题向量' : '已保存',
      })
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `保存失败:${String(err)}` })
    }
    setEditingId(null)
  }

  /** 移到其他类型:落库即标 manual(机器永不许覆盖用户手工摆放) */
  const moveGolden = async (goldenId: string, categoryId: string) => {
    try {
      const resp = await sendMessage<UpdateGoldenCategoryResponse>({
        type: 'UPDATE_GOLDEN_CATEGORY',
        payload: { id: goldenId, categoryId },
      })
      if (!resp.payload.success) {
        setMsg({ ok: false, text: `移动失败:${resp.payload.error ?? '未知错误'}` })
      } else {
        await refresh()
      }
    } catch (err) {
      setMsg({ ok: false, text: `移动失败:${String(err)}` })
    }
    setMovingId(null)
  }

  const deleteGolden = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteGoldenResponse>({
        type: 'DELETE_GOLDEN',
        payload: { id },
      })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '标准回答已删除,历史记录不受影响' })
        await refresh()
      } else {
        setMsg({ ok: false, text: `删除失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `删除失败:${String(err)}` })
    }
    setConfirmGoldenDelete(null)
  }

  // ─── 类型操作(第五十七轮 Task 7)────────────────────────────────────────────────

  const closeCreate = () => {
    setCreating(false)
    setNewName('')
    setNewCriteria('')
  }

  /** 新建类型:name 与 criteria 的合法性由后台 handler 判定,这里只回显拒绝理由 */
  const submitCreate = async () => {
    try {
      const resp = await sendMessage<CreateCategoryResponse>({
        type: 'CREATE_CATEGORY',
        payload: { name: newName, criteria: newCriteria },
      })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `新建失败:${resp.payload.error}` })
        return
      }
      setMsg({ ok: true, text: `类型「${newName.trim()}」已新建` })
      closeCreate()
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `新建失败:${String(err)}` })
    }
  }

  /** 改名(仅自定义类型;判定说明不在此列,不必重填) */
  const submitRename = async (id: string) => {
    try {
      const resp = await sendMessage<RenameCategoryResponse>({
        type: 'RENAME_CATEGORY',
        payload: { id, name: renameName },
      })
      if (!resp.payload.success) {
        setMsg({ ok: false, text: `改名失败:${resp.payload.error ?? '未知错误'}` })
        return
      }
      setMsg({ ok: true, text: '类型已改名' })
      setRenamingCat(null)
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `改名失败:${String(err)}` })
    }
  }

  /** 删除自定义类型:其中的标答由后台在事务里落回未分类(不丢数据) */
  const deleteCategory = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteCategoryResponse>({
        type: 'DELETE_CATEGORY',
        payload: { id },
      })
      if (!resp.payload.success) {
        setMsg({ ok: false, text: `删除失败:${resp.payload.error ?? '未知错误'}` })
      } else {
        const moved = resp.payload.movedGoldens ?? 0
        setMsg({
          ok: true,
          text: moved > 0 ? `类型已删除,其中 ${moved} 条标准回答已移到未分类` : '类型已删除',
        })
        await refresh()
      }
    } catch (err) {
      setMsg({ ok: false, text: `删除失败:${String(err)}` })
    }
    setConfirmCatDelete(null)
  }

  // ─── 视觉原语 ──────────────────────────────────────────────────────────────────

  /** 图标操作钮(透明底 → 浅灰,危险项悬浮红) */
  const iconBtn = (
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    danger = false,
  ): React.ReactNode => {
    const hoverBg = danger ? tk.errorBg : tk.btnHoverBg
    const hoverColor = danger ? tk.errorText : tk.text
    return (
      <button
        type="button"
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        style={{
          width: controlH.inline,
          height: controlH.inline,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: radius.sm,
          backgroundColor: 'transparent',
          color: tk.textTertiary,
          cursor: 'pointer',
          padding: 0,
          transition: `background-color ${motion.fast}, color ${motion.fast}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = hoverBg
          e.currentTarget.style.color = hoverColor
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = tk.textTertiary
        }}
      >
        {icon}
      </button>
    )
  }

  /**
   * 操作钮容器:整组**常驻可见**(v2.6.31 用户"默认展示吧,不要鼠标悬浮再展示",悬浮显隐机制退役)。
   * `align` 三档(v2.6.29 引入左对齐,v2.6.31 细分):
   *   - `right`(默认):靠右顶到行尾;
   *   - `text` :靠左,钮盒直接贴正文左缘(文字钮与类型下拉 —— 钮自身有内边距,不再补偿);
   *   - `icon` :靠左的**图标钮组**,再减 `ICON_BTN_INSET`,把**图标**拉到正文左缘。
   */
  const opsWrap = (children: React.ReactNode, align: OpsAlign = 'right'): React.ReactNode => (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginLeft: align === 'right' ? 'auto' : align === 'icon' ? -ICON_BTN_INSET : 0,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  )

  /** 内联确认行(删除二次确认):文案 + 确认/取消。样式在 ui/components#ConfirmRow(第五十一轮共享) */
  const confirmRow = (text: string, onOk: () => void, onCancel: () => void): React.ReactNode => (
    <div style={{ padding: `${spacing.xs}px 0 ${spacing.xs + 2}px` }}>
      <ConfirmRow tk={tk} text={text} onOk={onOk} onCancel={onCancel} />
    </div>
  )

  // ─── 标准回答行 ────────────────────────────────────────────────────────────────

  const goldenRow = (g: PanelGolden): React.ReactNode => {
    const editing = editingId === g.id
    const moving = movingId === g.id
    if (editing) {
      return (
        <div
          key={g.id}
          style={{
            padding: `${spacing.md}px ${spacing.xl}px ${spacing.sm}px ${ROW_INDENT}px`,
            borderBottom: `1px solid ${tk.borderLight}`,
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.sm,
          }}
        >
          <textarea
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            rows={2}
            placeholder="标准问题"
            autoFocus
            className="pddcs-input"
            style={inputStyle(tk, { resize: 'vertical' })}
          />
          <textarea
            value={draftA}
            onChange={(e) => setDraftA(e.target.value)}
            rows={4}
            placeholder="标准回复"
            className="pddcs-input"
            style={inputStyle(tk, { resize: 'vertical' })}
          />
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <BtnMini tk={tk} primary title="保存后自动重新生成问题向量" onClick={() => void submitEdit()}>
              保存
            </BtnMini>
            <BtnMini tk={tk} onClick={() => setEditingId(null)}>取消</BtnMini>
          </div>
        </div>
      )
    }
    return (
      <div
        key={g.id}
        style={{
          padding: `${spacing.md}px ${spacing.xl}px ${spacing.sm + 2}px ${ROW_INDENT}px`,
          borderBottom: `1px solid ${tk.borderLight}`,
          transition: `background-color ${motion.fast}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = tk.bgSecondary
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        {/* 问题行:加粗单行 + 手工指定徽标 + 同问题条数 + 向量状态 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: 2 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: fontSize.body,
              fontWeight: fontWeight.semibold,
              lineHeight: 1.45,
              ...clamp1,
            }}
          >
            {g.question}
          </div>
          {/* 手工摆放标记(第五十七轮):'manual' = 用户自己摆的,机器补分类会跳过。
              机器打的标(jev/缺省)不挂徽标 —— 两者必须一眼可分 */}
          {g.categorySource === 'manual' && (
            <Badge tk={tk} tone="neutral" icon={<TagIcon size={10} strokeWidth={2} />}>
              已指定
            </Badge>
          )}
          {(() => {
            const n = questionCounts.get(hashText(g.question)) ?? 1
            if (n < 2) return null
            return (
              <span
                title={`同一问题的标准回答共 ${n} 条(上限 ${MAX_GOLDENS_PER_QUESTION} 条),按设置时间倒序展示`}
                style={{ fontSize: fontSize.caption, color: tk.textTertiary, flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                同问题 {n} 条{n >= MAX_GOLDENS_PER_QUESTION ? ' · 已满' : ''}
              </span>
            )
          })()}
          {/* 被用次数(v0.16):只在真被填过时出现 —— 0 次的行平白多一枚灰标,
              新库满屏"被用 0 次",噪声盖过信息 */}
          {itemUsage[g.id] > 0 && (
            <span
              title={`这条标准回答已被填入输入框 ${itemUsage[g.id]} 次(仅本机计数)`}
              style={{ fontSize: fontSize.caption, color: tk.textTertiary, flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              被用 {itemUsage[g.id]} 次
            </span>
          )}
          {g.hasEmbedding === 0 && (
            <span style={{ fontSize: fontSize.caption, color: tk.textTertiary, flexShrink: 0 }}>
              向量生成中
            </span>
          )}
          {g.hasEmbedding === -1 && (
            <span
              title="嵌入失败,后台将自动重试"
              style={{ fontSize: fontSize.caption, color: tk.errorText, flexShrink: 0 }}
            >
              嵌入失败
            </span>
          )}
        </div>
        {/* 回复预览:灰色两行 */}
        <div
          style={{
            fontSize: fontSize.secondary,
            color: tk.textMuted,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            marginBottom: spacing.sm,
            ...clamp2,
          }}
        >
          {g.answer}
        </div>
        {/* 操作行(v2.6.29 左移 / v2.6.31 常驻):四个图标钮默认可见;
            负 margin 让**图标**左缘与上方正文左缘对齐 */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {confirmGoldenDelete === g.id ? (
            opsWrap(
              <>
                <BtnMini tk={tk} danger onClick={() => void deleteGolden(g.id)}>
                  确认
                </BtnMini>
                <BtnMini tk={tk} onClick={() => setConfirmGoldenDelete(null)}>取消</BtnMini>
              </>,
              'text',
            )
          ) : moving ? (
            opsWrap(
              <>
                <select
                  autoFocus
                  value={g.categoryId}
                  onChange={(e) => void moveGolden(g.id, e.target.value)}
                  onBlur={() => setMovingId(null)}
                  style={{
                    height: controlH.inline,
                    maxWidth: 120,
                    fontSize: fontSize.caption,
                    border: `1px solid ${tk.btnBorder}`,
                    borderRadius: radius.sm,
                    backgroundColor: tk.inputBg,
                    color: tk.text,
                    padding: '0 3px',
                    outline: 'none',
                    flexShrink: 0,
                  }}
                >
                  {categoryOptions}
                </select>
              </>,
              'text',
            )
          ) : (
            opsWrap(
              <>
                {iconBtn('移到其他类型', <TagIcon size={ICON_SIZE} strokeWidth={2} />, () => {
                  setMovingId(g.id)
                  setConfirmGoldenDelete(null)
                })}
                {iconBtn('复制', <CopyIcon size={ICON_SIZE} strokeWidth={2} />, () => void copyGolden(g))}
                {iconBtn('编辑', <PencilIcon size={ICON_SIZE} strokeWidth={2} />, () => startEdit(g))}
                {iconBtn(
                  '删除(历史记录不受影响)',
                  <TrashIcon size={ICON_SIZE} strokeWidth={2} />,
                  () => {
                    setConfirmGoldenDelete(g.id)
                    setMovingId(null)
                  },
                  true,
                )}
              </>,
              'icon',
            )
          )}
        </div>
      </div>
    )
  }

  // ─── 渲染 ──────────────────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      {creating ? (
        <Card tk={tk} style={{ padding: `${spacing.xl - 2}px ${spacing.xl + 2}px`, gap: spacing.md }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="类型名(如:发票咨询)"
            autoFocus
            className="pddcs-input"
            style={inputStyle(tk)}
          />
          <textarea
            value={newCriteria}
            onChange={(e) => setNewCriteria(e.target.value)}
            rows={3}
            placeholder="判定说明(必填):这个类型涵盖哪些问题 —— 原样发给分类模型当作选项描述"
            className="pddcs-input"
            style={inputStyle(tk, { resize: 'vertical' })}
          />
          {/* spec §五.3:与预置含义重叠不做计算式拦截,只在描述字符高度重合时把这行标红 */}
          <div
            style={{
              fontSize: fontSize.secondary,
              lineHeight: 1.6,
              color: overlapWarn ? tk.errorText : tk.textTertiary,
            }}
          >
            判定说明若与某个预置类型含义相近(例如又建一个「尺码咨询」),分类模型会在两者之间摇摆,
            <b>全部类型</b>的判断质量一起下降。
          </div>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Btn tk={tk} variant="primary" onClick={() => void submitCreate()}>
              创建
            </Btn>
            <Btn tk={tk} variant="ghost" onClick={closeCreate}>
              取消
            </Btn>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <CreateBtn tk={tk} label="新建类型" onClick={() => setCreating(true)} />
        </div>
      )}

      {sections.length === 0 && (
        <EmptyState tk={tk}>
          暂无标准回答
          <br />
          在聊天页候选弹窗或记忆列表中可将优质回复沉淀为标准回答
        </EmptyState>
      )}

      {sections.map((group) => {
        const c = group.category
        const isCustom = c.kind === 'custom'
        const renaming = renamingCat === c.id
        // 种类徽标:预置与未分类不可改名/删,得让用户一眼看出为什么没有操作钮
        const kindLabel = c.kind === 'preset' ? '预置' : c.kind === 'custom' ? '自定义' : null
        const title = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.sm, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {`${c.name} · ${group.items.length}`}
            </span>
            {kindLabel && (
              <Badge tk={tk} tone="neutral">
                {kindLabel}
              </Badge>
            )}
          </span>
        )
        return (
          // data-category-id 是**稳定的分区锚点**:验收脚本按类型 id 找"这一块",
          // 而不是靠标题 div 的文字/DOM 形状 —— 后者随渲染改一次就会静默失配
          // (Task 6 移除 data-folder-id 后 verify-golden-multi 静默失配的教训)。
          <div key={c.id} data-category-id={c.id}>
          <Card
            tk={tk}
            title={title}
            titleExtra={
              isCustom
                ? opsWrap(
                    <>
                      {iconBtn('重命名类型', <PencilIcon size={ICON_SIZE} strokeWidth={2} />, () => {
                        setRenamingCat(c.id)
                        setRenameName(c.name)
                        setConfirmCatDelete(null)
                      })}
                      {iconBtn(
                        '删除类型',
                        <TrashIcon size={ICON_SIZE} strokeWidth={2} />,
                        () => {
                          setConfirmCatDelete(c.id)
                          setRenamingCat(null)
                        },
                        true,
                      )}
                    </>,
                    'right',
                  )
                : undefined
            }
            style={{ padding: `${spacing.lg}px ${spacing.lg}px`, gap: spacing.md }}
          >
            {renaming && (
              <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
                <input
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  autoFocus
                  className="pddcs-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename(c.id)
                    if (e.key === 'Escape') setRenamingCat(null)
                  }}
                  style={controlStyle(tk, controlH.form, { flex: 1, minWidth: 0 })}
                />
                <BtnMini tk={tk} primary onClick={() => void submitRename(c.id)}>
                  保存
                </BtnMini>
                <BtnMini tk={tk} onClick={() => setRenamingCat(null)}>
                  取消
                </BtnMini>
              </div>
            )}
            {confirmCatDelete === c.id &&
              confirmRow(
                `删除「${c.name}」?其中的标准回答会移到未分类,不会消失`,
                () => void deleteCategory(c.id),
                () => setConfirmCatDelete(null),
              )}
            {group.items.length === 0 && isCustom && !renaming && confirmCatDelete !== c.id && (
              <div style={{ fontSize: fontSize.secondary, color: tk.textTertiary, lineHeight: 1.6 }}>
                这个类型下还没有标准回答 —— 可在记忆页或本页「移到其他类型」把标答摆进来。
              </div>
            )}
            {group.items.map((g) => goldenRow(g))}
          </Card>
          </div>
        )
      })}

      <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
        在聊天页候选弹窗或记忆列表中可将优质回复沉淀为标准回答;同一问题最多 3 条,检索命中时置顶并放宽阈值。
      </div>
    </div>
  )
}

// ─── 小工具 ────────────────────────────────────────────────────────────────────

/** 行内小按钮(保存/取消/确认),高度取 controlH.inline 与同排图标钮等高 */
function BtnMini({
  tk,
  children,
  onClick,
  primary,
  danger,
  title,
}: {
  tk: ThemeTokens
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  danger?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        height: controlH.inline,
        padding: '0 10px',
        border: primary || danger ? 'none' : `1px solid ${tk.btnBorder}`,
        borderRadius: radius.sm,
        backgroundColor: primary ? tk.btnPrimaryBg : danger ? tk.errorBg : 'transparent',
        color: primary ? tk.btnPrimaryText : danger ? tk.errorText : tk.textMuted,
        fontSize: fontSize.caption,
        fontWeight: primary || danger ? fontWeight.semibold : fontWeight.regular,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

// ─── 判定说明与预置的"含义相近"提示(spec §五.3,纯提示不做拦截)──────────────────
// 计算本体在 popup/logic.ts(与其它纯逻辑同层,便于单测);此处只负责调用与展示。
