/**
 * 回复文件夹页(P3,设计文档 §7)— 工具风分区树(2026-09-15 三次重设计)。
 *
 * 结构:工具栏(新建文件夹)→ 文件夹分区容器(可折叠标题栏)→ 标准回答行。
 * 仅支持一级文件夹(v2.6.1 用户要求,子文件夹创建入口已移除;历史遗留的子夹数据仍照常展示可删)。
 * 层级表达只用三件事:统一缩进节奏(12 + 16×深度)、字重/字号、标题栏底色 ——
 * 不再用引导线/嵌套边框(实测叠在容器与行分隔线之间显乱)。
 * 行操作(v2.6.29 左移 / v2.6.31 常驻):原「填充」常驻主钮已删,四个图标钮(迁移/复制/编辑/删除)
 * 占原填充位、**默认可见**(不再悬浮才显),且**图标左缘与上方正文左缘对齐**(负 margin 抵消钮盒内留白);
 * 填充能力保留在聊天页面板与知识库页。
 * 文件夹操作:重命名 / 删除(内联确认行,常驻可见)。
 * 数据流与全部功能不变:默认文件夹不可改名删除且置底;删除文件夹仅移出标准回答。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../shared/message-passing'
import type {
  CreateFolderResponse,
  DeleteFolderResponse,
  DeleteGoldenResponse,
  FlattenFoldersResponse,
  GetPanelDataResponse,
  PanelFolder,
  PanelGolden,
  RenameFolderResponse,
  UpdateGoldenResponse,
} from '../types/messages'
import { UNCATEGORIZED_FOLDER_ID, MAX_GOLDENS_PER_QUESTION } from '../shared/constants'
import { buildFolderTree, countGoldensByQuestion, type FolderNode } from './logic'
import { hashText } from '../shared/text'
import { ConfirmRow, CreateBtn, EmptyState, Notice, controlStyle, inputStyle, type NoticeMsg } from '../ui/components'
import { controlH, fontSize, fontWeight, motion, radius, size, spacing } from '../ui/design'
import {
  ChevronDownIcon,
  CopyIcon,
  FolderIcon,
  FolderInputIcon,
  PencilIcon,
  TrashIcon,
} from '../ui/icons'

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
  const [folders, setFolders] = useState<PanelFolder[]>([])
  const [goldens, setGoldens] = useState<PanelGolden[]>([])
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [loading, setLoading] = useState(true)

  // 内联交互状态(同一时刻至多一个激活)
  const [createParent, setCreateParent] = useState<string | null>(null) // 'root' | folderId
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftQ, setDraftQ] = useState('')
  const [draftA, setDraftA] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)
  const [confirmGoldenDelete, setConfirmGoldenDelete] = useState<string | null>(null)
  // 折叠的文件夹 id 集合(默认全部展开)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // 遗留子文件夹拍平确认(PM7)
  const [confirmFlatten, setConfirmFlatten] = useState(false)

  /** 同问题标准回答条数(questionHash → n):多答案问题的行上标注 n / 已满 */
  const questionCounts = useMemo(() => countGoldensByQuestion(goldens), [goldens])

  /** 遗留子文件夹(PM7:UI 只建一级,存量子夹给出"拍平"清入口) */
  const legacySubfolders = useMemo(() => folders.filter((f) => f.parentId !== null), [folders])

  const flattenAll = async () => {
    try {
      const resp = await sendMessage<FlattenFoldersResponse>({ type: 'FLATTEN_FOLDERS' })
      if (resp.payload.success) {
        setMsg({ ok: true, text: `已拍平 ${resp.payload.flattened} 个子文件夹,其下标准回答上移到父文件夹` })
      } else {
        setMsg({ ok: false, text: `拍平失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `拍平失败:${String(err)}` })
    }
    setConfirmFlatten(false)
    await refresh()
  }

  const load = useCallback(async () => {
    try {
      const resp = await sendMessage<GetPanelDataResponse>({ type: 'GET_PANEL_DATA' })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        setFolders(resp.payload.folders)
        setGoldens(resp.payload.goldens)
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

  // ─── 文件夹操作 ────────────────────────────────────────────────────────────────

  const submitCreate = async () => {
    if (!createParent) return
    try {
      const resp = await sendMessage<CreateFolderResponse>({
        type: 'CREATE_FOLDER',
        payload: { name: newName, parentId: null }, // 仅一级文件夹
      })
      if (resp.payload.error) setMsg({ ok: false, text: `新建失败:${resp.payload.error}` })
      else {
        setMsg({ ok: true, text: '文件夹已创建' })
        await refresh()
      }
    } catch (err) {
      setMsg({ ok: false, text: `新建失败:${String(err)}` })
    }
    setCreateParent(null)
    setNewName('')
  }

  const submitRename = async () => {
    if (!renamingId) return
    try {
      const resp = await sendMessage<RenameFolderResponse>({
        type: 'RENAME_FOLDER',
        payload: { id: renamingId, name: renameName },
      })
      if (resp.payload.success) {
        await refresh()
      } else {
        setMsg({ ok: false, text: `重命名失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `重命名失败:${String(err)}` })
    }
    setRenamingId(null)
  }

  const deleteFolder = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteFolderResponse>({
        type: 'DELETE_FOLDER',
        payload: { id },
      })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '文件夹已删除,其下标准回答已移入「默认文件夹」' })
        await refresh()
      } else {
        setMsg({ ok: false, text: `删除失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `删除失败:${String(err)}` })
    }
    setConfirmFolderDelete(null)
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

  const moveGolden = async (goldenId: string, folderId: string) => {
    try {
      const resp = await sendMessage<UpdateGoldenResponse>({
        type: 'UPDATE_GOLDEN',
        payload: { id: goldenId, folderId: folderId === 'null' ? null : folderId },
      })
      if (resp.payload.error) setMsg({ ok: false, text: `移动失败:${resp.payload.error}` })
      else await refresh()
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

  // ─── 视觉原语 ──────────────────────────────────────────────────────────────────

  /** 悬浮显现的图标操作钮(pddddd doc-op 同款:透明底 → 浅灰,危险项悬浮红) */
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

  /** 圆形计数徽标(pddddd nav-sub-count 同款) */
  const countPill = (n: number, active = false): React.ReactNode => (
    <span
      style={{
        minWidth: 18,
        height: 16,
        padding: '0 5px',
        borderRadius: radius.pill,
        backgroundColor: active ? tk.text : tk.bgSecondary,
        border: active ? 'none' : `1px solid ${tk.borderLight}`,
        color: active ? tk.btnPrimaryText : tk.textMuted,
        fontVariantNumeric: 'tabular-nums',
        fontSize: fontSize.caption,
        fontWeight: fontWeight.semibold,
        lineHeight: '14px',
        textAlign: 'center',
        display: 'inline-block',
        flexShrink: 0,
      }}
    >
      {n}
    </span>
  )

  /**
   * 操作钮容器:整组**常驻可见**(v2.6.31 用户"默认展示吧,不要鼠标悬浮再展示",悬浮显隐机制退役)。
   * `align` 三档(v2.6.29 引入左对齐,v2.6.31 细分):
   *   - `right`(默认):文件夹标题栏,`marginLeft: auto` 顶到行尾;
   *   - `text` :靠左,钮盒直接贴正文左缘(文字钮 `BtnMini` 与迁移下拉 —— 钮自身有内边距,不再补偿);
   *   - `icon` :靠左的**图标钮组**,再减 `ICON_BTN_INSET`,把**图标**拉到正文左缘(v2.6.31 用户"按钮左侧和上方文字左侧对齐")。
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

  /** 内联表单行(新建 / 重命名):输入框 + 创建/保存 + 取消
   *  输入框与按钮同取 controlH.form 档 → 严格等高(靠 height 而非 padding 撑) */
  const inlineForm = (
    placeholder: string,
    value: string,
    onValue: (v: string) => void,
    onOk: () => void,
    onCancel: () => void,
    okLabel: string,
  ): React.ReactNode => (
    <div style={{ display: 'flex', gap: spacing.sm, padding: `${spacing.xs}px 0` }}>
      <input
        value={value}
        onChange={(e) => onValue(e.target.value)}
        placeholder={placeholder}
        autoFocus
        className="pddcs-input"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOk()
          if (e.key === 'Escape') onCancel()
        }}
        style={controlStyle(tk, controlH.form, { flex: 1, minWidth: 0 })}
      />
      <button
        type="button"
        onClick={onOk}
        style={{
          height: controlH.form,
          padding: '0 12px',
          border: 'none',
          borderRadius: radius.md,
          backgroundColor: tk.btnPrimaryBg,
          color: tk.btnPrimaryText,
          fontSize: fontSize.body,
          fontWeight: fontWeight.medium,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {okLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{
          height: controlH.form,
          padding: '0 12px',
          border: `1px solid ${tk.btnBorder}`,
          borderRadius: radius.md,
          backgroundColor: 'transparent',
          color: tk.textMuted,
          fontSize: fontSize.body,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        取消
      </button>
    </div>
  )

  /** 内联确认行(删除二次确认):文案 + 确认/取消。样式在 ui/components#ConfirmRow(第五十一轮共享) */
  const confirmRow = (text: string, onOk: () => void, onCancel: () => void): React.ReactNode => (
    <div style={{ padding: `${spacing.xs}px 0 ${spacing.xs + 2}px` }}>
      <ConfirmRow tk={tk} text={text} onOk={onOk} onCancel={onCancel} />
    </div>
  )

  // ─── 标准回答行 ────────────────────────────────────────────────────────────────

  /** 统一缩进节奏(2026-09-15 重设计):基础 12px,每深一层 +16px;
   *  分区头、子夹行、标准回答行、内联表单全部走同一基线,不再有引导线与混合缩进 */
  const rowIndent = (depth: number): number => 12 + depth * 16

  const goldenRow = (g: PanelGolden, depth = 0): React.ReactNode => {
    const editing = editingId === g.id
    const moving = movingId === g.id
    /** 标准回答行与所在分区的头/表单/占位共用同一左基线 */
    const rowPadLeft = rowIndent(depth)
    if (editing) {
      return (
        <div
          key={g.id}
          style={{
            padding: `${spacing.md}px ${spacing.xl}px ${spacing.sm}px ${rowPadLeft}px`,
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
          padding: `${spacing.md}px ${spacing.xl}px ${spacing.sm + 2}px ${rowPadLeft}px`,
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
        {/* 问题行:加粗单行 + 同问题条数 + 向量状态 */}
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
        {/* 操作行(v2.6.29 左移 / v2.6.31 常驻):原「填充」主钮已删,四个图标钮占原位且默认可见;
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
                  value={g.folderId ?? UNCATEGORIZED_FOLDER_ID}
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
                  {flatFolderOptions(tree)}
                </select>
              </>,
              'text',
            )
          ) : (
            opsWrap(
              <>
                {iconBtn('迁移到其他文件夹', <FolderInputIcon size={ICON_SIZE} strokeWidth={2} />, () => {
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

  // ─── 文件夹分区 ────────────────────────────────────────────────────────────────

  const folderSection = (node: FolderNode, depth: number): React.ReactNode => {
    const f = node.folder
    const isUnc = f.id === UNCATEGORIZED_FOLDER_ID
    const isCollapsed = collapsed.has(f.id)
    const count = node.goldens.length
    const toggle = () =>
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(f.id)) next.delete(f.id)
        else next.add(f.id)
        return next
      })

    const isRoot = depth === 0
    const expanded = !isCollapsed || confirmFolderDelete === f.id
    const empty = node.goldens.length === 0 && node.children.length === 0

    const startRename = () => {
      setRenamingId(f.id)
      setRenameName(f.name)
    }

    /** 分区头:根夹为标题栏(常驻浅灰底 + 展开时底边分隔线),子夹为同构缩进行;
     *  两者结构完全一致(chevron + 文件夹图标 + 名称 + 计数),层级只靠缩进与字重表达。
     *  重命名入口(v2.6.1):悬浮「重命名」图标钮,或**双击文件夹名**直接进入改名 */
    const header = (
      <div
        // 分区头的稳定锚点:验收脚本要按文件夹名找到"这一夹的那一块"再断内部顺序,
        // 而原先用的 .pddcs-row 钩子在 v2.6.31 已退役 —— 脚本因此静默失配(找到 0 个),
        // 报出来的是"子夹不在父夹前面"这种像是功能坏了的结论。见 verify-golden-multi。
        data-folder-id={f.id}
        onClick={renamingId === f.id ? undefined : toggle}
        onDoubleClick={isUnc || renamingId === f.id ? undefined : startRename}
        title={isUnc ? undefined : '单击展开/折叠,双击重命名'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          height: isRoot ? 34 : 30,
          padding: `0 8px 0 ${rowIndent(depth)}px`,
          backgroundColor: isRoot ? tk.bgSecondary : 'transparent',
          borderBottom: isRoot && expanded ? `1px solid ${tk.borderLight}` : 'none',
          cursor: renamingId === f.id ? 'default' : 'pointer',
          transition: `background-color ${motion.fast}`,
        }}
        onMouseEnter={(e) => {
          if (renamingId === f.id) return
          e.currentTarget.style.backgroundColor = isRoot ? tk.borderLight : tk.bgSecondary
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = isRoot ? tk.bgSecondary : 'transparent'
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            color: tk.textTertiary,
            transform: expanded ? 'none' : 'rotate(-90deg)',
            transition: `transform ${motion.fast}`,
            flexShrink: 0,
          }}
        >
          <ChevronDownIcon size={isRoot ? 13 : 12} strokeWidth={2.2} />
        </span>
        {renamingId === f.id ? (
          <div style={{ flex: 1, display: 'flex', gap: spacing.sm }}>
            <input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              autoFocus
              className="pddcs-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitRename()
                if (e.key === 'Escape') setRenamingId(null)
              }}
              style={controlStyle(tk, controlH.inline, { flex: 1, minWidth: 0 })}
            />
            <BtnMini tk={tk} primary onClick={() => void submitRename()}>
              保存
            </BtnMini>
            <BtnMini tk={tk} onClick={() => setRenamingId(null)}>取消</BtnMini>
          </div>
        ) : (
          <>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: spacing.xs + 2,
                fontSize: isRoot ? fontSize.body : fontSize.secondary,
                fontWeight: isRoot ? fontWeight.semibold : fontWeight.medium,
                color: isUnc ? tk.textMuted : isRoot ? tk.text : tk.textMuted,
                minWidth: 0,
                ...clamp1,
              }}
            >
              <FolderIcon
                size={isRoot ? 14 : 13}
                strokeWidth={2}
                style={{ flexShrink: 0, color: isUnc ? tk.textTertiary : tk.textTertiary }}
              />
              {f.name}
            </span>
            {countPill(count)}
            {/* 常驻可见(2026-09-15 用户反馈"父文件夹不能改名":功能本就有,
                但纯悬浮显现不可发现);默认文件夹不给改名/删除。
                v2.6.31 起全页操作组一律常驻(悬浮显隐机制退役) */}
            {opsWrap(
              <>
                {!isUnc && (
                  <>
                    {iconBtn('重命名(或双击文件夹名)', <PencilIcon size={ICON_SIZE} strokeWidth={2} />, startRename)}
                    {iconBtn(
                      '删除文件夹(其下标准回答移入「默认文件夹」)',
                      <TrashIcon size={ICON_SIZE} strokeWidth={2} />,
                      () => setConfirmFolderDelete(f.id),
                      true,
                    )}
                  </>
                )}
              </>,
            )}
          </>
        )}
      </div>
    )

    const body =
      isCollapsed && confirmFolderDelete !== f.id ? null : (
        <>
          {confirmFolderDelete === f.id && (
            <div style={{ padding: `6px ${spacing.xl}px 6px ${rowIndent(depth)}px` }}>
              {confirmRow(
                '删除该文件夹?其下标准回答将移入「默认文件夹」。',
                () => void deleteFolder(f.id),
                () => setConfirmFolderDelete(null),
              )}
            </div>
          )}
          {/* 文件夹优先于内容(资源管理器直觉):子夹排在标准回答之前。
              子夹直接平铺渲染,层级只靠统一缩进节奏表达(2026-09-15 重设计:
              移除旧的 borderLeft 引导线包裹层 —— 它与容器边框、行分隔线叠在一起显乱) */}
          {node.children.map((c) => (
            <div key={c.folder.id}>{folderSection(c, depth + 1)}</div>
          ))}
          {node.goldens.map((g) => goldenRow(g, depth))}
          {empty && (
            <div
              style={{
                padding: `10px ${spacing.xl}px 12px ${rowIndent(depth) + 2}px`,
                fontSize: fontSize.caption,
                color: tk.textTertiary,
              }}
            >
              暂无标准回答
            </div>
          )}
        </>
      )

    if (!isRoot) {
      return (
        <div>
          {header}
          {body}
        </div>
      )
    }

    // 根文件夹 = 一张分区容器:边框 + 圆角把「文件夹」与其内容框在一起
    return (
      <div
        style={{
          border: `1px ${isUnc ? 'dashed' : 'solid'} ${isUnc ? tk.border : tk.border}`,
          borderRadius: radius.lg,
          backgroundColor: tk.bg,
          overflow: 'hidden',
        }}
      >
        {header}
        {body}
      </div>
    )
  }

  // ─── 渲染 ──────────────────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>
  }

  const fullTree = buildFolderTree(folders, goldens)
  // 默认文件夹置底,其余保持创建顺序
  const tree = [
    ...fullTree.filter((n) => n.folder.id !== UNCATEGORIZED_FOLDER_ID),
    ...fullTree.filter((n) => n.folder.id === UNCATEGORIZED_FOLDER_ID),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* 工具栏:新建文件夹(左对齐,与知识库按钮行同款;新建时原位变表单) */}
      {createParent === 'root' ? (
        inlineForm(
          '文件夹名称',
          newName,
          setNewName,
          () => void submitCreate(),
          () => setCreateParent(null),
          '创建',
        )
      ) : (
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <CreateBtn
            tk={tk}
            label="新建文件夹"
            onClick={() => {
              setCreateParent('root')
              setNewName('')
            }}
          />
        </div>
      )}

      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      {/* 遗留子文件夹拍平入口(PM7):仅存量数据可见,拍平 = 金标准上移父夹 + 删除子夹 */}
      {legacySubfolders.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: spacing.sm,
            padding: `${spacing.md}px ${spacing.lg}px`,
            border: `1px dashed ${tk.border}`,
            borderRadius: radius.md,
            backgroundColor: tk.bgSecondary,
          }}
        >
          {confirmFlatten ? (
            confirmRow(
              `拍平 ${legacySubfolders.length} 个子文件夹(${legacySubfolders
                .map((f) => f.name)
                .join('、')})?其下标准回答上移到父文件夹,子文件夹删除。`,
              () => void flattenAll(),
              () => setConfirmFlatten(false),
            )
          ) : (
            <>
              <span style={{ fontSize: fontSize.caption, color: tk.textMuted, flex: 1 }}>
                检测到 {legacySubfolders.length} 个遗留子文件夹(新版仅支持一级文件夹)
              </span>
              <button
                type="button"
                onClick={() => setConfirmFlatten(true)}
                style={{
                  height: controlH.inline,
                  padding: '0 10px',
                  border: `1px solid ${tk.btnBorder}`,
                  borderRadius: radius.sm,
                  backgroundColor: 'transparent',
                  color: tk.text,
                  fontSize: fontSize.caption,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                一键拍平
              </button>
            </>
          )}
        </div>
      )}

      {tree.length === 0 && <EmptyState tk={tk}>暂无文件夹,点击左上角「新建文件夹」开始整理</EmptyState>}
      {tree.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {tree.map((n) => (
            <div key={n.folder.id}>{folderSection(n, 0)}</div>
          ))}
        </div>
      )}

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

/** 迁移下拉的扁平选项(两层缩进) */
function flatFolderOptions(tree: FolderNode[]): React.ReactNode {
  const out: React.ReactNode[] = []
  const walk = (node: FolderNode, depth: number) => {
    out.push(
      <option key={node.folder.id} value={node.folder.id}>
        {'　'.repeat(depth)}
        {depth > 0 ? '└ ' : ''}
        {node.folder.name}
      </option>,
    )
    for (const c of node.children) walk(c, depth + 1)
  }
  for (const n of tree) walk(n, 0)
  return out
}
