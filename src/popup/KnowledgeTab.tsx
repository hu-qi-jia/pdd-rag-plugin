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
  SetKbSizeTableResponse,
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
import { UploadIcon } from '../ui/icons'
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
  /** 尺码表走**另一个**文件输入:同一个 input 没法区分"这次点的是哪个按钮" */
  const sizeFileRef = useRef<HTMLInputElement>(null)

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

  /**
   * 被标为尺码表的文档名(至多一篇)。
   *
   * **尺码表在 UI 侧只有一个**(第二版改):产品概念是"这家店的尺码表",**不该有第二张**。
   * 后端 `SET_KB_SIZE_TABLE` 仍是文档级的通用接口(允许多篇,`collectSizeTableMaterials`
   * 对多篇是"全取、按 docId 稳定排序"),但界面不提供"再标一篇"的入口 ——
   * 上传新的会先把旧的摘掉。这样用户看到的模型是"一张尺码表",而不是"一批被勾选的文档"。
   */
  const sizeTableDocIds = useMemo(
    () => [...new Set(items.filter((k) => k.isSizeTable === true && k.docId).map((k) => k.docId as string))],
    [items],
  )

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

  /** 标记/取消「该文档是尺码表」(文档级)。标记后整篇原文作尺码生成的 LLM 材料、
   *  且该文档的块不再进向量检索池(spec §八)。 */
  const setSizeTable = async (docId: string, on: boolean): Promise<string | null> => {
    try {
      const resp = await sendMessage<SetKbSizeTableResponse>({
        type: 'SET_KB_SIZE_TABLE',
        payload: { docId, on },
      })
      return resp.payload.error ?? null
    } catch (err) {
      return String(err)
    }
  }

  /**
   * 上传尺码表:导入文档 → 标为尺码表(**并把上一张摘掉**)。
   *
   * 第二版按用户要求把入口从"每个文档块上一个开关"搬到这里 ——
   * 旧版是每篇文档的第一块挂一个 `Toggle` 尺码表,用户原话:「不用将每条都增加尺码表的开关,
   * 在顶部上传按钮右侧增加一个上传尺码表就好」。搬过来之后:
   *  · 入口从"列表里逐条找"变成"工具栏上一次";列表回到纯内容,不再有逐条开关;
   *  · "标记"这个动作**合并进上传**:选文件 = 既导入又声明"这张是尺码表",
   *    用户不必先上传、再回头找到那一块、再打开开关(那正是旧流程最绕的一段)。
   */
  const uploadSizeTable = async (file: File) => {
    setUploading(true)
    try {
      const up = await sendMessage<UploadKbDocResponse>({
        type: 'UPLOAD_KB_DOC',
        payload: { name: file.name, content: await file.text() },
      })
      if (up.payload.error) {
        setMsg({ ok: false, text: `上传失败:${up.payload.error}` })
        return
      }
      const docId = up.payload.docId
      // 导入成功却没带回 docId:没法标记,但文档已经进去了 —— 说清楚,别让用户以为白传了
      if (!docId) {
        setMsg({ ok: false, text: `已导入《${file.name}》,但没能标记为尺码表:后台未返回文档标识` })
        await refresh()
        return
      }
      // 先摘旧的再标新的:中途失败最多是"暂时没有尺码表",不会留下两张
      for (const old of sizeTableDocIds) {
        if (old !== docId) await setSizeTable(old, false)
      }
      const err = await setSizeTable(docId, true)
      // 分两种说法:导入成了但没标上,与整件事成了 —— 合成一句会让前者看起来像成功
      setMsg(
        err
          ? { ok: false, text: `已导入《${docId}》,但标为尺码表失败:${err}` }
          : { ok: true, text: `已导入并标为尺码表:《${docId}》${up.payload.chunkCount} 块` },
      )
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `上传失败:${String(err)}` })
    } finally {
      setUploading(false)
      if (sizeFileRef.current) sizeFileRef.current.value = ''
    }
  }

  const clearSizeTable = async (docId: string) => {
    const err = await setSizeTable(docId, false)
    setMsg(err ? { ok: false, text: `取消失败:${err}` } : { ok: true, text: '已取消尺码表标记' })
    if (!err) await refresh()
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
      {/* 内联新建表单:box 形态(整圈 1px 描边),与下方已有条目明确分开 */}
      {creating ? (
        <Card tk={tk} variant="box" style={{ gap: spacing.md }}>
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
        <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          <CreateBtn tk={tk} label="新建条目" onClick={() => setCreating(true)} />
          <Btn tk={tk} disabled={uploading} title="上传 .md 文档:自动切分并逐块向量化" onClick={() => fileRef.current?.click()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <UploadIcon size={12} strokeWidth={2} />
              {uploading ? '导入中…' : '上传 .md'}
            </span>
          </Btn>
          <Btn
            tk={tk}
            disabled={uploading}
            title="上传尺码表:整篇原文作尺码生成的资料,不参与向量检索"
            onClick={() => sizeFileRef.current?.click()}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <UploadIcon size={12} strokeWidth={2} />
              上传尺码表
            </span>
          </Btn>
        </div>
      )}

      {/* 尺码表状态行 —— **只在有尺码表时出现**(新装的库没有这一行)。
          入口、状态、取消三件事收在同一处:上传在旁边,取消在这里,
          不必再去列表里逐条找那一块(旧版正是那样,用户要求改掉) */}
      {sizeTableDocIds.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing.sm,
            flexWrap: 'wrap',
            fontSize: fontSize.caption,
            color: tk.textMuted,
          }}
        >
          <span>
            尺码表:{sizeTableDocIds.map((d) => `《${d}》`).join('、')} · 整篇原文作生成资料,不参与检索
          </span>
          <Btn tk={tk} variant="ghost" onClick={() => void clearSizeTable(sizeTableDocIds[0])}>
            取消
          </Btn>
        </div>
      )}

      {/* 两个隐藏文件输入各挂一枚 `data-upload` 锚点:它们是 `display:none` 的元素,
          没有可点击的形态,单测与验收脚本只能按锚点找(与 `data-card-title` /
          `data-category-id` 同一套做法,别按"第几个 input[type=file]"找) */}
      <input
        ref={fileRef}
        data-upload="doc"
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void uploadDoc(f)
        }}
      />
      {/* 尺码表接受 .txt / .csv:尺码表常常就是从表格里导出来的纯文本,不一定是 md */}
      <input
        ref={sizeFileRef}
        data-upload="size-table"
        type="file"
        accept=".md,.markdown,.txt,.csv,text/plain,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void uploadSizeTable(f)
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
            // v3.1 没有红色:需要动手的状态靠**墨色 + 加粗 + `!`**表达
            backgroundColor: tk.noticeBg,
            color: tk.text,
            fontWeight: fontWeight.semibold,
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
            className="pddcs-kb-card"
            style={{
              gap: spacing.sm,
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
                    <Badge tk={tk} tone="knowledge">文档</Badge>
                  )}
                  {disabled && (
                    <span style={{ fontSize: fontSize.caption, color: tk.textMuted }}>已停用</span>
                  )}
                  {!disabled && k.hasEmbedding === 0 && (
                    <span style={{ fontSize: fontSize.caption, color: tk.textMuted }}>向量生成中</span>
                  )}
                  {!disabled && k.hasEmbedding === -1 && (
                    <span style={{ fontSize: fontSize.caption, color: tk.text, fontWeight: fontWeight.semibold }}>
                      ! 嵌入失败,后台将自动重试
                    </span>
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
                {/* 尺码表开关**已从这里移除**(第二版):标记入口搬到工具栏的「上传尺码表」,
                    列表回到纯内容 —— 用户要求"不用将每条都增加尺码表的开关" */}
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

      {/* 页脚(v3.0 第二版精简):只留用户要做的判断 —— 检索层级与"重传即替换"。
          切分规则(问答体按条 / 其余按小节 / 超长按空行句号截断)是实现细节,
          用户改不了也不需要知道,整句删掉;要查的看 docs/DESIGN.md */}
      <div style={{ fontSize: fontSize.caption, color: tk.textTertiary, lineHeight: 1.6 }}>
        检索层级:标准回答 &gt; 历史记录 &gt; 知识库。上传的文档自动切分并逐块向量化,文档块只读;同名文档重新上传即整篇替换。
      </div>
    </div>
  )
}
