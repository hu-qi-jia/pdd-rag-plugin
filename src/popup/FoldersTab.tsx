/**
 * 回复文件夹页(P3,设计文档 §7)— 工具风重构:可折叠分区树 + 分隔线行 + 悬浮操作。
 *
 * 结构(参照 pddddd 知识库 doc-list 与导航折叠模式):
 *   工具栏(新建根文件夹)→ 根文件夹分区(可折叠)→ 子文件夹(左侧引导线)→ 标准回答行。
 * 行操作分层:填充(常驻黑色主钮)/ 复制 / 编辑 / 迁移 / 删除(悬浮显现的图标钮);
 * 文件夹操作:新建子夹 / 重命名 / 删除(内联确认行,常驻可见)。
 * 数据流与全部功能不变:未分类不可改名删除且置底;删除文件夹仅移出标准回答。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../utils/message-passing'
import type {
  CreateFolderResponse,
  DeleteFolderResponse,
  DeleteGoldenResponse,
  FillInputResponse,
  GetPanelDataResponse,
  PanelFolder,
  PanelGolden,
  RenameFolderResponse,
  UpdateGoldenResponse,
} from '../types/messages'
import { UNCATEGORIZED_FOLDER_ID } from '../types/memory'
import { buildFolderTree, countGoldensByQuestion, type FolderNode } from '../utils/panelLogic'
import { hashText } from '../utils/text'
import { MAX_GOLDENS_PER_QUESTION } from '../types/memory'
import { EmptyState, Notice, controlStyle, inputStyle, type NoticeMsg } from '../ui/components'
import { controlH, fontSize, fontWeight, motion, radius, spacing } from '../ui/design'
import {
  ChevronDownIcon,
  CopyIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '../ui/icons'

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

  /** 同问题标准回答条数(questionHash → n):多答案问题的行上标注 n / 已满 */
  const questionCounts = useMemo(() => countGoldensByQuestion(goldens), [goldens])

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
    const parentId = createParent === 'root' ? null : createParent
    try {
      const resp = await sendMessage<CreateFolderResponse>({
        type: 'CREATE_FOLDER',
        payload: { name: newName, parentId },
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
        setMsg({ ok: true, text: '文件夹已删除,其下标准回答已移入「未分类」' })
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

  const fillGolden = async (g: PanelGolden) => {
    try {
      const resp = await sendMessage<FillInputResponse>({
        type: 'FILL_INPUT',
        payload: { text: g.answer },
      })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '已填充至输入框,发送由人工完成' })
      } else {
        setMsg({ ok: false, text: resp.payload.error ?? '填充失败' })
      }
    } catch (err) {
      setMsg({ ok: false, text: `填充失败:${String(err)}` })
    }
  }

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

  /** 操作钮容器:悬浮才显现;confirm 时常驻 */
  const opsWrap = (children: React.ReactNode, alwaysVisible = false): React.ReactNode => (
    <div
      className={alwaysVisible ? undefined : 'pddcs-row-ops'}
      onClick={(e) => e.stopPropagation()}
      style={{
        marginLeft: 'auto',
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

  /** 内联确认行(删除二次确认):警示文案 + 确认/取消 */
  const confirmRow = (text: string, onOk: () => void, onCancel: () => void): React.ReactNode => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        padding: `${spacing.xs}px 0 ${spacing.xs + 2}px`,
      }}
    >
      <span style={{ flex: 1, fontSize: fontSize.caption, color: tk.errorText }}>{text}</span>
      <button
        type="button"
        onClick={onOk}
        style={{
          height: controlH.inline,
          padding: '0 10px',
          border: 'none',
          borderRadius: radius.sm,
          backgroundColor: tk.errorText,
          color: '#ffffff',
          fontSize: fontSize.caption,
          fontWeight: fontWeight.semibold,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        确认
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{
          height: controlH.inline,
          padding: '0 10px',
          border: `1px solid ${tk.btnBorder}`,
          borderRadius: radius.sm,
          backgroundColor: 'transparent',
          color: tk.textMuted,
          fontSize: fontSize.caption,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        取消
      </button>
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
            padding: `${spacing.md}px 4px`,
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
        className="pddcs-row"
        style={{
          padding: `${spacing.md}px 4px ${spacing.sm + 2}px`,
          borderBottom: `1px solid ${tk.borderLight}`,
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
              title="嵌入失败,重启扩展后重试"
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
        {/* 操作行:填充常驻主钮,其余悬浮显现 */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <BtnMini tk={tk} primary title="填充到聊天页输入框,发送由人工完成" onClick={() => void fillGolden(g)}>
            填充
          </BtnMini>
          {confirmGoldenDelete === g.id ? (
            opsWrap(
              <>
                <BtnMini tk={tk} danger onClick={() => void deleteGolden(g.id)}>
                  确认
                </BtnMini>
                <BtnMini tk={tk} onClick={() => setConfirmGoldenDelete(null)}>取消</BtnMini>
              </>,
              true,
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
              true,
            )
          ) : (
            opsWrap(
              <>
                {iconBtn('迁移到其他文件夹', <FolderInputIcon size={13} strokeWidth={2} />, () => {
                  setMovingId(g.id)
                  setConfirmGoldenDelete(null)
                })}
                {iconBtn('复制', <CopyIcon size={13} strokeWidth={2} />, () => void copyGolden(g))}
                {iconBtn('编辑', <PencilIcon size={13} strokeWidth={2} />, () => startEdit(g))}
                {iconBtn(
                  '删除(历史记录不受影响)',
                  <TrashIcon size={13} strokeWidth={2} />,
                  () => {
                    setConfirmGoldenDelete(g.id)
                    setMovingId(null)
                  },
                  true,
                )}
              </>,
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

    const header = (
      <div
        className="pddcs-row"
        onClick={renamingId === f.id ? undefined : toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          height: depth > 0 ? 26 : 28,
          padding: '0 4px',
          borderRadius: radius.sm,
          cursor: renamingId === f.id ? 'default' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (renamingId === f.id) return
          e.currentTarget.style.backgroundColor = tk.bgSecondary
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            color: tk.textTertiary,
            transform: isCollapsed ? 'rotate(-90deg)' : 'none',
            transition: `transform ${motion.fast}`,
            flexShrink: 0,
          }}
        >
          <ChevronDownIcon size={12} strokeWidth={2.2} />
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
                fontSize: fontSize.body,
                fontWeight: depth > 0 ? fontWeight.medium : fontWeight.semibold,
                color: isUnc ? tk.textMuted : tk.text,
                minWidth: 0,
                ...clamp1,
              }}
            >
              <FolderIcon size={depth > 0 ? 13 : 14} strokeWidth={2} style={{ flexShrink: 0 }} />
              {f.name}
            </span>
            {countPill(count)}
            {opsWrap(
              <>
                {depth === 0 &&
                  iconBtn('在此文件夹下新建子文件夹', <FolderPlusIcon size={13} strokeWidth={2} />, () => {
                    setCreateParent(f.id)
                    setNewName('')
                  })}
                {!isUnc && (
                  <>
                    {iconBtn('重命名', <PencilIcon size={13} strokeWidth={2} />, () => {
                      setRenamingId(f.id)
                      setRenameName(f.name)
                    })}
                    {iconBtn(
                      '删除文件夹(其下标准回答移入「未分类」)',
                      <TrashIcon size={13} strokeWidth={2} />,
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
          {createParent === f.id &&
            inlineForm(
              '子文件夹名称',
              newName,
              setNewName,
              () => void submitCreate(),
              () => setCreateParent(null),
              '创建',
            )}
          {confirmFolderDelete === f.id &&
            confirmRow(
              '删除该文件夹?其下标准回答将移入「未分类」。',
              () => void deleteFolder(f.id),
              () => setConfirmFolderDelete(null),
            )}
          {node.goldens.map((g) => goldenRow(g))}
          {node.children.map((c) => (
            <div
              key={c.folder.id}
              style={{
                margin: `${spacing.xs}px 0 0 10px`,
                paddingLeft: 10,
                borderLeft: `1px solid ${tk.border}`,
              }}
            >
              {folderSection(c, depth + 1)}
            </div>
          ))}
        </>
      )

    return (
      <div>
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
  // 未分类置底,其余保持创建顺序
  const tree = [
    ...fullTree.filter((n) => n.folder.id !== UNCATEGORIZED_FOLDER_ID),
    ...fullTree.filter((n) => n.folder.id === UNCATEGORIZED_FOLDER_ID),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* 工具栏:新建根文件夹(靠右,内联新建时让位给表单) */}
      {createParent === 'root' ? (
        inlineForm(
          '根文件夹名称',
          newName,
          setNewName,
          () => void submitCreate(),
          () => setCreateParent(null),
          '创建',
        )
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => {
              setCreateParent('root')
              setNewName('')
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: controlH.form,
              padding: '0 10px',
              border: `1px solid ${tk.btnBorder}`,
              borderRadius: radius.md,
              backgroundColor: tk.btnBg,
              color: tk.text,
              fontSize: fontSize.body,
              cursor: 'pointer',
              transition: `background-color ${motion.fast}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = tk.btnHoverBg
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = tk.btnBg
            }}
          >
            <PlusIcon size={12} strokeWidth={2.2} />
            新建根文件夹
          </button>
        </div>
      )}

      <Notice tk={tk} msg={msg} />

      {tree.length === 0 && <EmptyState tk={tk}>暂无文件夹,点击右上角「新建根文件夹」开始整理</EmptyState>}
      {tree.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tree.map((n) => (
            <div
              key={n.folder.id}
              style={{
                padding: `${spacing.xs}px 0 ${spacing.sm}px`,
                borderBottom:
                  n !== tree[tree.length - 1] ? `1px solid ${tk.borderLight}` : 'none',
              }}
            >
              {folderSection(n, 0)}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
        在聊天页候选弹窗或记忆列表中可将优质回复沉淀为标准回答;检索命中时标准回答置顶并放宽阈值。
      </div>
    </div>
  )
}

// ─── 小工具 ────────────────────────────────────────────────────────────────────

/** 行内小按钮(保存/取消/确认/填充),高度取 controlH.inline 与同排图标钮等高 */
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
        backgroundColor: primary ? tk.btnPrimaryBg : danger ? tk.errorText : 'transparent',
        color: primary || danger ? '#ffffff' : tk.textMuted,
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
