/**
 * 知识库页(P4-KB,设计文档 §7):人工维护的"标题+正文"话术卡 + md 文档上传。
 * 手工条目操作:新建(内联表单)/ 关键词筛选 / 编辑(标题实质变更才重嵌)/
 * 停用开关(停用不参与检索、不重嵌)/ 删除(内联二次确认)/ 填充 / 复制 ——
 * 这一排(填充在左)v2.6.30 合并为整组、v2.6.31 起**默认可见**(不再悬浮才显,与文件夹页同构)。
 * 文档上传:md 文本按 500 字/75 重叠分块(同原项目),每块一条只读条目,逐块向量化;
 * 同名文档重复上传整篇替换。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ThemeTokens } from '../ui/theme'
import { sendMessage } from '../shared/message-passing'
import type {
  CreateKbResponse,
  DeleteKbResponse,
  FillInputResponse,
  GetPanelDataResponse,
  PanelKnowledge,
  UpdateKbResponse,
  UploadKbDocResponse,
} from '../types/messages'
import {
  Badge,
  Btn,
  Card,
  CreateBtn,
  EmptyState,
  Notice,
  SearchInput,
  formatTs,
  inputStyle,
  type NoticeMsg,
} from '../ui/components'
import { fontSize, fontWeight, radius, spacing } from '../ui/design'
import { FileTextIcon, UploadIcon } from '../ui/icons'
import { legacyDocNotice } from './logic'

export function KnowledgeTab({
  tk,
  onDataChanged,
}: {
  tk: ThemeTokens
  onDataChanged: () => Promise<void> | void
}) {
  const [items, setItems] = useState<PanelKnowledge[]>([])
  /** 升级前上传、无原文可重切的文档名(非空则提示重新上传) */
  const [legacyDocs, setLegacyDocs] = useState<string[]>([])
  /** 逐条用量(v0.16):条目 id → 被填充次数(文档块也能看出哪段真被用过) */
  const [itemUsage, setItemUsage] = useState<Record<string, number>>({})
  const [keyword, setKeyword] = useState('')
  const [msg, setMsg] = useState<NoticeMsg>(null)
  const [loading, setLoading] = useState(true)

  // 内联交互状态(同一时刻至多一个激活)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const resp = await sendMessage<GetPanelDataResponse>({ type: 'GET_PANEL_DATA' })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        setItems(resp.payload.knowledge ?? [])
        setLegacyDocs(resp.payload.legacyDocs ?? [])
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

  const shown = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return items
    return items.filter((k) => k.title.toLowerCase().includes(kw) || k.content.toLowerCase().includes(kw))
  }, [items, keyword])

  const legacyNotice = useMemo(() => legacyDocNotice(legacyDocs), [legacyDocs])

  /** 上传 md 文档:读文本 → UPLOAD_KB_DOC(分块+逐块向量化,同名整篇替换) */
  const uploadDoc = async (file: File) => {
    setUploading(true)
    try {
      const resp = await sendMessage<UploadKbDocResponse>({
        type: 'UPLOAD_KB_DOC',
        payload: { name: file.name, content: await file.text() },
      })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `上传失败:${resp.payload.error}` })
      } else {
        setMsg({
          ok: true,
          text: `已导入《${resp.payload.docId}》共 ${resp.payload.chunkCount} 块${resp.payload.replaced ? '(已替换旧版)' : ''},后台逐块向量化`,
        })
        await refresh()
      }
    } catch (err) {
      setMsg({ ok: false, text: `上传失败:${String(err)}` })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submitCreate = async () => {
    try {
      const resp = await sendMessage<CreateKbResponse>({
        type: 'CREATE_KB',
        payload: { title: newTitle, content: newContent },
      })
      if (resp.payload.error) setMsg({ ok: false, text: `新建失败:${resp.payload.error}` })
      else if (resp.payload.exists) setMsg({ ok: false, text: '已存在相同标题的知识条目' })
      else {
        setMsg({ ok: true, text: '已创建,后台将自动向量化' })
        await refresh()
      }
    } catch (err) {
      setMsg({ ok: false, text: `新建失败:${String(err)}` })
    }
    setCreating(false)
    setNewTitle('')
    setNewContent('')
  }

  const startEdit = (k: PanelKnowledge) => {
    setEditingId(k.id)
    setDraftTitle(k.title)
    setDraftContent(k.content)
    setConfirmDeleteId(null)
  }

  const submitEdit = async () => {
    if (!editingId) return
    try {
      const resp = await sendMessage<UpdateKbResponse>({
        type: 'UPDATE_KB',
        payload: { id: editingId, title: draftTitle, content: draftContent },
      })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `保存失败:${resp.payload.error}` })
        return
      }
      setMsg({
        ok: true,
        text: resp.payload.reembed ? '已保存,正在重新生成标题向量' : '已保存',
      })
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `保存失败:${String(err)}` })
    }
    setEditingId(null)
  }

  const toggleEnabled = async (k: PanelKnowledge) => {
    try {
      const resp = await sendMessage<UpdateKbResponse>({
        type: 'UPDATE_KB',
        payload: { id: k.id, enabled: k.enabled === 1 ? 0 : 1 },
      })
      if (resp.payload.error) setMsg({ ok: false, text: `操作失败:${resp.payload.error}` })
      else await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `操作失败:${String(err)}` })
    }
  }

  const fillKb = async (k: PanelKnowledge) => {
    try {
      const resp = await sendMessage<FillInputResponse>({
        type: 'FILL_INPUT',
        // 带上来源标注:SW 填成功后据此记一笔使用统计(填充成功才计,见 fillToChatPage)
        payload: { text: k.content, itemKind: 'knowledge', itemId: k.id },
      })
      if (resp.payload.success) setMsg({ ok: true, text: '已填充至输入框,发送由人工完成' })
      else setMsg({ ok: false, text: resp.payload.error ?? '填充失败' })
    } catch (err) {
      setMsg({ ok: false, text: `填充失败:${String(err)}` })
    }
  }

  const copyKb = async (k: PanelKnowledge) => {
    try {
      await navigator.clipboard.writeText(k.content)
      setMsg({ ok: true, text: '已复制到剪贴板' })
    } catch {
      setMsg({ ok: false, text: '复制失败' })
    }
  }

  const deleteKb = async (id: string) => {
    try {
      const resp = await sendMessage<DeleteKbResponse>({
        type: 'DELETE_KB',
        payload: { id },
      })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '知识条目已删除' })
        await refresh()
      } else {
        setMsg({ ok: false, text: `删除失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `删除失败:${String(err)}` })
    }
    setConfirmDeleteId(null)
  }

  if (loading) {
    return <div style={{ fontSize: fontSize.secondary, color: tk.textMuted }}>读取中…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg }}>
      {creating ? (
        <Card tk={tk} style={{ padding: `${spacing.xl - 2}px ${spacing.xl + 2}px`, gap: spacing.md }}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="标题(检索锚,如:退货政策)"
            autoFocus
            className="pddcs-input"
            style={inputStyle(tk)}
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={4}
            placeholder="正文(填充与复制的内容)"
            className="pddcs-input"
            style={inputStyle(tk, { resize: 'vertical' })}
          />
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <Btn tk={tk} variant="primary" onClick={() => void submitCreate()} title="创建后自动向量化">
              创建
            </Btn>
            <Btn tk={tk} variant="ghost" onClick={() => setCreating(false)}>
              取消
            </Btn>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <CreateBtn tk={tk} label="新建条目" onClick={() => setCreating(true)} />
          <Btn tk={tk} disabled={uploading} title="上传 .md 文档:自动切分(问答体按条、其余按小节)并逐块向量化" onClick={() => fileRef.current?.click()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <UploadIcon size={12} strokeWidth={2} />
              {uploading ? '导入中…' : '上传 .md'}
            </span>
          </Btn>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void uploadDoc(f)
        }}
      />

      {/* 旧版文档(有块无原文)提示:它们检索不到却看起来一切正常,不说一声
          用户只会以为"知识库不灵"。不是错误提示(用户没做错什么),但确实要动手。 */}
      {legacyNotice && (
        <div
          style={{
            padding: `${spacing.sm + 2}px ${spacing.xl}px`,
            borderRadius: radius.md,
            fontSize: fontSize.secondary,
            lineHeight: 1.55,
            backgroundColor: tk.errorBg,
            color: tk.errorText,
            wordBreak: 'break-word',
          }}
        >
          {legacyNotice}
        </div>
      )}

      <SearchInput tk={tk} value={keyword} onChange={setKeyword} placeholder="搜索标题或正文" />

      <Notice tk={tk} msg={msg} onDismiss={() => setMsg(null)} />

      {shown.length === 0 && (
        <EmptyState tk={tk}>
          {items.length === 0 ? (
            <>
              暂无知识条目
              <br />
              以「标题 + 正文」沉淀常用话术,检索时作为独立来源匹配
            </>
          ) : (
            '没有匹配的条目'
          )}
        </EmptyState>
      )}

      {shown.map((k) => {
        const editing = editingId === k.id
        const disabled = k.enabled !== 1
        return (
          <Card
            key={k.id}
            tk={tk}
            style={{
              padding: `${spacing.xl - 2}px ${spacing.xl + 2}px`,
              gap: spacing.sm + 1,
              opacity: disabled ? 0.55 : 1,
            }}
          >
            {editing ? (
              <>
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="pddcs-input"
                  style={inputStyle(tk)}
                />
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={5}
                  className="pddcs-input"
                  style={inputStyle(tk, { resize: 'vertical' })}
                />
                <div style={{ display: 'flex', gap: spacing.sm }}>
                  <Btn tk={tk} variant="primary" onClick={() => void submitEdit()} title="标题实质变更时自动重新生成向量">
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
                  {/* 徽标只标文档块(2026-09-15 设计6:本页即知识库,手工条目徽标冗余);
                      手工条目与文档块的区分交给徽标有无 */}
                  {k.source === 'doc' && (
                    <Badge tk={tk} tone="knowledge" icon={<FileTextIcon size={10} strokeWidth={2.2} />}>
                      文档
                    </Badge>
                  )}
                  {disabled && (
                    <span style={{ fontSize: fontSize.caption, color: tk.textMuted }}>已停用</span>
                  )}
                  {!disabled && k.hasEmbedding === 0 && (
                    <span style={{ fontSize: fontSize.caption, color: tk.textMuted }}>向量生成中</span>
                  )}
                  {!disabled && k.hasEmbedding === -1 && (
                    <span style={{ fontSize: fontSize.caption, color: tk.errorText }}>嵌入失败,后台将自动重试</span>
                  )}
                  {/* 被用次数(v0.16):文档块也能看出哪一段真被填过;0 次不显示(免得满屏灰标) */}
                  {(itemUsage[k.id] ?? 0) > 0 && (
                    <span
                      title={`这条知识已填入输入框 ${itemUsage[k.id]} 次(仅本机计数)`}
                      style={{ fontSize: fontSize.caption, color: tk.textTertiary, whiteSpace: 'nowrap' }}
                    >
                      被用 {itemUsage[k.id]} 次
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: fontSize.caption, color: tk.textTertiary, fontVariantNumeric: 'tabular-nums' }}>
                    {formatTs(k.updatedAt)}
                  </span>
                </div>
                <div style={{ fontSize: fontSize.body, fontWeight: fontWeight.semibold, lineHeight: 1.45, wordBreak: 'break-word' }}>
                  {k.title}
                </div>
                <div
                  style={{
                    fontSize: fontSize.secondary,
                    color: tk.textMuted,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {k.content}
                </div>
                {/* 操作行(v2.6.30 合并 / v2.6.31 常驻):填充在左,复制/编辑/停用/删除紧随其右,
                    **默认可见**(不再悬浮才显) */}
                <div
                  style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <Btn tk={tk} variant="primary" disabled={disabled} onClick={() => void fillKb(k)} title="填充到聊天页输入框,发送由人工完成">
                    填充
                  </Btn>
                  <Btn tk={tk} disabled={disabled} onClick={() => void copyKb(k)}>
                    复制
                  </Btn>
                  {k.source !== 'doc' && (
                    <Btn tk={tk} onClick={() => startEdit(k)}>
                      编辑
                    </Btn>
                  )}
                  <Btn tk={tk} title={disabled ? '启用后重新参与检索' : '停用后保留数据,不参与检索'} onClick={() => void toggleEnabled(k)}>
                    {disabled ? '启用' : '停用'}
                  </Btn>
                  {confirmDeleteId === k.id ? (
                    <>
                      <Btn tk={tk} variant="danger" onClick={() => void deleteKb(k.id)}>
                        确认
                      </Btn>
                      <Btn tk={tk} variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                        取消
                      </Btn>
                    </>
                  ) : (
                    <Btn tk={tk} variant="danger" onClick={() => setConfirmDeleteId(k.id)}>
                      删除
                    </Btn>
                  )}
                </div>
              </>
            )}
          </Card>
        )
      })}

      <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
        检索层级:标准回答 &gt; 历史记录 &gt; 知识库。.md 文档自动切分:问答体按条切、其余按小节切,超长内容按空行/句号智能截断;文档块只读,同名文档重新上传即整篇替换。
      </div>
    </div>
  )
}
