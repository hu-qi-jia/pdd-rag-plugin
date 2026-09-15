/**
 * 回复文件夹页(P3,设计文档 §7):两层文件夹树 + 金标准卡片。
 * 卡片操作:填充当前输入框(经 SW 转发到聊天页)/ 复制 / 编辑(双字段,保存即重嵌)/
 * 迁移文件夹 / 删除(内联二次确认)。
 * 文件夹操作:新建(根/子,最多两层)/ 重命名 / 删除(其下金标准移出,不删数据)。
 */
import React, { useCallback, useEffect, useState } from 'react'
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
import { buildFolderTree, type FolderNode } from '../utils/panelLogic'
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  Notice,
  inputStyle,
  type NoticeMsg,
} from '../ui/components'
import { fontSize, fontWeight, spacing } from '../ui/design'
import {
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PencilIcon,
  StarIcon,
  XIcon,
} from '../ui/icons'

const clamp2: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  wordBreak: 'break-word',
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
  const [confirmGoldenDelete, setConfirmGoldenDelete] = useState<string | null>(null)

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

  // ─── 金标准操作 ────────────────────────────────────────────────────────────────

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

  // ─── 渲染 ──────────────────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>
  }

  const tree = buildFolderTree(folders, goldens)

  const folderHeader = (node: FolderNode, depth: number) => {
    const f = node.folder
    const isUnc = f.id === UNCATEGORIZED_FOLDER_ID
    const count = node.goldens.length
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          padding: depth > 0 ? '5px 0 3px 14px' : '6px 0 3px',
        }}
      >
        {depth > 0 && <span style={{ color: tk.textTertiary, fontSize: fontSize.secondary }}>└</span>}
        {renamingId === f.id ? (
          <>
            <input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              autoFocus
              className="pddcs-input"
              onKeyDown={(e) => e.key === 'Enter' && void submitRename()}
              style={inputStyle(tk, { flex: 1 })}
            />
            <Btn tk={tk} variant="primary" onClick={() => void submitRename()}>
              保存
            </Btn>
            <Btn tk={tk} variant="ghost" onClick={() => setRenamingId(null)}>
              取消
            </Btn>
          </>
        ) : (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.sm, fontSize: fontSize.body, fontWeight: fontWeight.semibold }}>
              {depth > 0 ? <FolderIcon size={14} strokeWidth={2} /> : <FolderOpenIcon size={14} strokeWidth={2} />}
              {f.name}
            </span>
            <span style={{ fontSize: fontSize.caption, color: tk.textTertiary, fontVariantNumeric: 'tabular-nums' }}>({count})</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: spacing.xs }}>
              {depth === 0 && (
                <Btn tk={tk} variant="ghost" title="在此文件夹下新建子文件夹" onClick={() => { setCreateParent(f.id); setNewName('') }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <FolderPlusIcon size={12} strokeWidth={2} />子夹
                  </span>
                </Btn>
              )}
              {!isUnc && (
                <>
                  <Btn tk={tk} variant="ghost" title="重命名" onClick={() => { setRenamingId(f.id); setRenameName(f.name) }}>
                    <PencilIcon size={12} strokeWidth={2} />
                  </Btn>
                  {confirmFolderDelete === f.id ? (
                    <>
                      <Btn tk={tk} variant="danger" onClick={() => void deleteFolder(f.id)}>
                        确认
                      </Btn>
                      <Btn tk={tk} variant="ghost" onClick={() => setConfirmFolderDelete(null)}>
                        取消
                      </Btn>
                    </>
                  ) : (
                    <Btn tk={tk} variant="ghost" title="删除文件夹(标准回答保留)" onClick={() => setConfirmFolderDelete(f.id)}>
                      <XIcon size={12} strokeWidth={2} />
                    </Btn>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  const goldenCard = (g: PanelGolden, indent: boolean) => {
    const editing = editingId === g.id
    return (
      <Card
        key={g.id}
        tk={tk}
        style={{
          margin: indent ? `0 0 ${spacing.md - 2}px 14px` : `0 0 ${spacing.md - 2}px`,
          padding: `${spacing.md + 1}px ${spacing.xl - 1}px`,
          gap: spacing.sm + 1,
        }}
      >
        {editing ? (
          <>
            <textarea
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              rows={2}
              placeholder="标准问题"
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
              <Btn tk={tk} variant="primary" onClick={() => void submitEdit()} title="保存后自动重新生成问题向量">
                保存
              </Btn>
              <Btn tk={tk} variant="ghost" onClick={() => setEditingId(null)}>
                取消
              </Btn>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <Badge tk={tk} tone="golden" icon={<StarIcon size={10} strokeWidth={2.2} />}>
                标准回答
              </Badge>
              {g.hasEmbedding === 0 && (
                <span style={{ fontSize: fontSize.caption, color: tk.textMuted }}>向量生成中</span>
              )}
              {g.hasEmbedding === -1 && (
                <span style={{ fontSize: fontSize.caption, color: tk.errorText }}>嵌入失败,重启扩展后重试</span>
              )}
              {/* 迁移文件夹 */}
              <select
                value={g.folderId ?? UNCATEGORIZED_FOLDER_ID}
                onChange={(e) => void moveGolden(g.id, e.target.value)}
                title="迁移到其他文件夹"
                style={{
                  marginLeft: 'auto',
                  maxWidth: 110,
                  fontSize: fontSize.caption,
                  border: `1px solid ${tk.border}`,
                  borderRadius: 8,
                  backgroundColor: tk.bgSecondary,
                  color: tk.text,
                  padding: '1px 3px',
                }}
              >
                {flatFolderOptions(tree)}
              </select>
            </div>
            <div style={{ fontSize: fontSize.body, fontWeight: fontWeight.semibold, lineHeight: 1.45, ...clamp2 }}>
              {g.question}
            </div>
            <div style={{ fontSize: fontSize.secondary, color: tk.textMuted, lineHeight: 1.5, whiteSpace: 'pre-wrap', ...clamp2 }}>
              {g.answer}
            </div>
            <div style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap' }}>
              <Btn tk={tk} variant="primary" onClick={() => void fillGolden(g)} title="填充到聊天页输入框,发送由人工完成">
                填充
              </Btn>
              <Btn tk={tk} onClick={() => void copyGolden(g)}>
                复制
              </Btn>
              <Btn tk={tk} onClick={() => startEdit(g)}>
                编辑
              </Btn>
              {confirmGoldenDelete === g.id ? (
                <>
                  <Btn tk={tk} variant="danger" onClick={() => void deleteGolden(g.id)}>
                    确认
                  </Btn>
                  <Btn tk={tk} variant="ghost" onClick={() => setConfirmGoldenDelete(null)}>
                    取消
                  </Btn>
                </>
              ) : (
                <Btn tk={tk} variant="danger" onClick={() => setConfirmGoldenDelete(g.id)}>
                  删除
                </Btn>
              )}
            </div>
          </>
        )}
      </Card>
    )
  }

  const renderNode = (node: FolderNode, depth: number) => (
    <div key={node.folder.id}>
      {folderHeader(node, depth)}
      {createParent === node.folder.id && (
        <div style={{ display: 'flex', gap: spacing.sm, padding: depth > 0 ? '0 0 4px 28px' : '0 0 4px 14px' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="子文件夹名称"
            autoFocus
            className="pddcs-input"
            style={inputStyle(tk, { flex: 1 })}
          />
          <Btn tk={tk} variant="primary" onClick={() => void submitCreate()}>
            创建
          </Btn>
          <Btn tk={tk} variant="ghost" onClick={() => setCreateParent(null)}>
            取消
          </Btn>
        </div>
      )}
      {node.goldens.map((g) => goldenCard(g, depth > 0))}
      {node.children.map((c) => renderNode(c, depth + 1))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {/* 根层新建 */}
      {createParent === 'root' ? (
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="根文件夹名称"
            autoFocus
            className="pddcs-input"
            style={inputStyle(tk, { flex: 1 })}
          />
          <Btn tk={tk} variant="primary" onClick={() => void submitCreate()}>
            创建
          </Btn>
          <Btn tk={tk} variant="ghost" onClick={() => setCreateParent(null)}>
            取消
          </Btn>
        </div>
      ) : (
        <Btn tk={tk} onClick={() => { setCreateParent('root'); setNewName('') }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FolderPlusIcon size={12} strokeWidth={2} />新建根文件夹
          </span>
        </Btn>
      )}

      <Notice tk={tk} msg={msg} />

      {tree.length === 0 && <EmptyState tk={tk}>暂无文件夹</EmptyState>}
      {tree.map((n) => renderNode(n, 0))}

      <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
        在聊天页候选弹窗或记忆列表中可将优质回复沉淀为标准回答;检索命中时标准回答置顶并放宽阈值。
      </div>
    </div>
  )
}

// ─── 小工具 ────────────────────────────────────────────────────────────────────

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
