/**
 * 知识库页 — v4.0「Codex × iOS · 黑灰白」
 *
 * 结构:工具栏(新建条目 / 上传 .md / 上传尺码表)→ 模板下载 → 尺码表状态条 → 搜索 → 条目卡流。
 *
 * 尺码表走**上传入口**,不再有"每块一个开关":
 * 它本来是文档级标记(落在 kbDocs),而一篇文档会切成许多块 —— v2.6 为了让开关
 * 只出现一次,弄了套 `firstChunkIds`("只在该文档第一块上渲染"),既绕又脆:
 * 单块文档、早期盲切留下的文档都可能认不出"第一块",于是那个开关**静默失效**。
 * 现在"是不是尺码表"由**你点了哪个按钮**决定。顶部那行状态条是唯一的显示与撤销处。
 *
 * v4.0 还删了两处冗余文字:状态条尾部的"整篇原文作生成资料,不参与检索"、
 * 页脚整块的"检索层级:标准回答 > 历史 > 知识库"。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Btn,
  ConfirmRow,
  CreateBtn,
  EmptyState,
  IconBtn,
  List,
  Notice,
  SearchInput,
  Tag,
  Toolbar,
  formatTs,
  inputStyle,
  type NoticeMsg,
} from '../ui/components'
import { fontSize, size, spacing } from '../ui/design'
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FillIcon,
  PencilIcon,
  TrashIcon,
  UploadIcon,
} from '../ui/icons'
import { legacyDocNotice } from './logic'
import {
  downloadKnowledgeTemplate,
  knowledgeTemplateFile,
  sizeTableTemplateFile,
} from './knowledgeTemplates'

export function KnowledgeTab({ onDataChanged }: { onDataChanged: () => Promise<void> | void }) {
  const [items, setItems] = useState<PanelKnowledge[]>([])
  /** 升级前上传、无原文可重切的文档名(非空则提示重新上传) */
  const [legacyDocs, setLegacyDocs] = useState<string[]>([])
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
  const [confirmUnsetSize, setConfirmUnsetSize] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const sizeFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const resp = await sendMessage<GetPanelDataResponse>({ type: 'GET_PANEL_DATA' })
      if (resp.payload.error) {
        setMsg({ ok: false, text: `读取失败:${resp.payload.error}` })
      } else {
        setItems(resp.payload.knowledge ?? [])
        setLegacyDocs(resp.payload.legacyDocs ?? [])
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
    return items.filter(
      (k) => k.title.toLowerCase().includes(kw) || k.content.toLowerCase().includes(kw),
    )
  }, [items, keyword])

  const legacyNotice = useMemo(() => legacyDocNotice(legacyDocs), [legacyDocs])

  /** 当前尺码表的 docId(唯一的真源在 kbDocs.isSizeTable,这里从块上读回) */
  const sizeDocId = useMemo(() => items.find((k) => k.isSizeTable === true)?.docId ?? null, [items])
  const sizeChunkCount = useMemo(
    () => (sizeDocId ? items.filter((k) => k.docId === sizeDocId).length : 0),
    [items, sizeDocId],
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

  /**
   * 上传尺码表 —— 唯一的标记入口。
   * 两步:先按普通文档上传(同样的分块与原文留存),再对该 docId 打文档级标记。
   * 「同一时刻只有一份尺码表」由后台保证(见 knowledge#setKbDocSizeTable),
   * 这里只负责把"顶替了谁"如实报给用户。
   */
  const uploadSizeTable = async (file: File) => {
    setUploading(true)
    try {
      const up = await sendMessage<UploadKbDocResponse>({
        type: 'UPLOAD_KB_DOC',
        payload: { name: file.name, content: await file.text() },
      })
      if (up.payload.error || !up.payload.docId) {
        setMsg({
          ok: false,
          text: `上传失败:${up.payload.error ?? '后台没有回带 docId,无法标记尺码表'}`,
        })
        return
      }
      const mark = await sendMessage<SetKbSizeTableResponse>({
        type: 'SET_KB_SIZE_TABLE',
        payload: { docId: up.payload.docId, on: true },
      })
      if (!mark.payload.success) {
        setMsg({ ok: false, text: `标记为尺码表失败:${mark.payload.error ?? '未知错误'}` })
      } else {
        setMsg({
          ok: true,
          text:
            `已上传尺码表《${up.payload.docId}》共 ${up.payload.chunkCount} 块` +
            (mark.payload.replaced ? `,已替换原尺码表《${mark.payload.replaced}》` : ''),
        })
      }
      await refresh()
    } catch (err) {
      setMsg({ ok: false, text: `上传失败:${String(err)}` })
    } finally {
      setUploading(false)
      if (sizeFileRef.current) sizeFileRef.current.value = ''
    }
  }

  /** 取消尺码表标记:文档本身保留,只是重新回到向量检索池 */
  const unsetSizeTable = async () => {
    if (!sizeDocId) return
    try {
      const resp = await sendMessage<SetKbSizeTableResponse>({
        type: 'SET_KB_SIZE_TABLE',
        payload: { docId: sizeDocId, on: false },
      })
      if (resp.payload.success) {
        setMsg({ ok: true, text: '已取消尺码表标记:该文档恢复参与向量检索' })
        await refresh()
      } else {
        setMsg({ ok: false, text: `取消失败:${resp.payload.error ?? '未知错误'}` })
      }
    } catch (err) {
      setMsg({ ok: false, text: `取消失败:${String(err)}` })
    }
    setConfirmUnsetSize(false)
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
      setMsg({ ok: true, text: resp.payload.reembed ? '已保存,正在重新生成标题向量' : '已保存' })
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
        // 带上来源标注:SW 填成功后据此记一笔使用统计
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
    return (
      <div style={{ fontSize: fontSize.sub, color: 'var(--pddcs-text-tertiary)', padding: spacing.xxl }}>
        读取中…
      </div>
    )
  }

  return (
    <div>
      <Notice msg={msg} onDismiss={() => setMsg(null)} />

      {creating ? (
        // 与上面的编辑态同一副长相(创建 = 编辑),也不再自画一块填充底的方盒 ——
        // 见 FoldersTab 同一处的说明
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.xl,
            padding: `${spacing.xxl}px ${spacing.xxl}px 0`,
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="标题(检索锚,如:退货政策)"
            autoFocus
            className="pddcs-input"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={4}
            placeholder="正文(填充与复制的内容)"
            className="pddcs-input"
            style={inputStyle({ resize: 'vertical' })}
          />
          <div style={{ display: 'flex', gap: spacing.md }}>
            <Btn variant="primary" onClick={() => void submitCreate()} title="创建后自动向量化">
              创建
            </Btn>
            <Btn variant="ghost" onClick={() => setCreating(false)}>
              取消
            </Btn>
          </div>
        </div>
      ) : (
        <div style={{ paddingTop: spacing.xxl }}>
          <Toolbar>
            <CreateBtn label="新建条目" onClick={() => setCreating(true)} />
            <Btn
              disabled={uploading}
              title="上传 .md 文档:自动切分(问答体按条、其余按小节)并逐块向量化"
              onClick={() => fileRef.current?.click()}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <UploadIcon size={size.icon} strokeWidth={2} />
                上传 .md
              </span>
            </Btn>
            {/* 尺码表走**自己的上传按钮**:「是不是尺码表」由此变成"你点了哪个钮",
                不依赖代码认出"第一块" */}
            <Btn
              disabled={uploading}
              title="上传尺码表:整篇原文作为尺码生成的资料,不参与向量检索"
              onClick={() => sizeFileRef.current?.click()}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <UploadIcon size={size.icon} strokeWidth={2} />
                上传尺码表
              </span>
            </Btn>
          </Toolbar>
          {/* 模板下载是次级操作：用文字链，不另起一行按钮 —— 它只是"给一份可编辑的起点"，
              不该和三个上传按钮抢同一档视觉重量，也不该多占 40px 高度 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing.xxl,
              padding: `0 ${spacing.xxl}px ${spacing.md}px`,
            }}
          >
            <button
              type="button"
              className="pddcs-linkbtn"
              title="下载知识库 Markdown 模板，编辑后通过「上传 .md」导入"
              onClick={() => downloadKnowledgeTemplate(knowledgeTemplateFile())}
            >
              <DownloadIcon size={12} strokeWidth={2} />
              知识库模板
            </button>
            <button
              type="button"
              className="pddcs-linkbtn"
              title="下载尺码表 Markdown 模板，填写后通过「上传尺码表」导入"
              onClick={() => downloadKnowledgeTemplate(sizeTableTemplateFile())}
            >
              <DownloadIcon size={12} strokeWidth={2} />
              尺码表模板
            </button>
          </div>
        </div>
      )}

      {/* data-kind 是**稳定的锚点**:两个文件选择框外观完全一样(都是隐藏的),
          测试与验收脚本按它区分,而不是按 DOM 顺序 */}
      <input
        ref={fileRef}
        data-kind="doc"
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void uploadDoc(f)
        }}
      />
      <input
        ref={sizeFileRef}
        data-kind="size"
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void uploadSizeTable(f)
        }}
      />

      {/* 尺码表状态条:一行文字 + 发丝线,整页唯一的显示与撤销处 */}
      {sizeDocId && (
        <div className="pddcs-sizeline pddcs-hair">
          <span className="nm">尺码表</span>
          <span>{sizeDocId}</span>
          <span className="ct">{sizeChunkCount} 块</span>
          {/* 撑开用的空档只在"只有一个按钮"时需要。确认态下它是多余的一个 flex:1 ——
              和确认条并排会把剩下的宽度对半分,确认文字被挤成两三行 */}
          {!confirmUnsetSize && <span className="sp" />}
          {confirmUnsetSize ? (
            <ConfirmRow
              fullWidth
              text="取消标记后该文档恢复参与向量检索?"
              onOk={() => void unsetSizeTable()}
              onCancel={() => setConfirmUnsetSize(false)}
            />
          ) : (
            <Btn variant="ghost" small onClick={() => setConfirmUnsetSize(true)}>
              取消标记
            </Btn>
          )}
        </div>
      )}

      {/* 旧版文档(有块无原文)提示:它们检索不到却看起来一切正常,不说一声
          用户只会以为"知识库不灵"。不是错误提示(用户没做错什么),但确实要动手 */}
      {legacyNotice && (
        <div
          style={{
            background: 'var(--pddcs-danger-soft)',
            color: 'var(--pddcs-danger)',
            padding: `${spacing.lg}px ${spacing.xxl}px`,
            fontSize: fontSize.sub,
            lineHeight: 1.55,
            wordBreak: 'break-word',
            margin: `0 ${spacing.xxl}px ${spacing.xl}px`,
          }}
        >
          {legacyNotice}
        </div>
      )}

      <div style={{ padding: `0 ${spacing.xxl}px ${spacing.xl}px` }}>
        <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索标题或正文" />
      </div>

      {shown.length === 0 && (
        <EmptyState>
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

      {shown.length > 0 && (
        <List>
          {shown.map((k) => {
            if (editingId === k.id) {
              return (
                <div className="pddcs-gcard pddcs-hair" key={k.id}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="pddcs-input"
                    />
                    <textarea
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      rows={5}
                      className="pddcs-input"
                      style={inputStyle({ resize: 'vertical' })}
                    />
                    <div style={{ display: 'flex', gap: spacing.md }}>
                      <Btn
                        variant="primary"
                        onClick={() => void submitEdit()}
                        title="标题实质变更时自动重新生成向量"
                      >
                        保存
                      </Btn>
                      <Btn variant="ghost" onClick={() => setEditingId(null)}>
                        取消
                      </Btn>
                    </div>
                  </div>
                </div>
              )
            }

            const disabled = k.enabled !== 1
            return (
              <div className="pddcs-gcard pddcs-hair" key={k.id} style={{ opacity: disabled ? 0.5 : 1 }}>
                {/* 灰标行:只上有信息量的标。文档块标 [文档] 以区分手工条目 */}
                {/* 这张卡的灰标行**压在卡片顶部**(标 → 标题 → 正文),
                    所以是 gmeta-top 而不是默认的 gmeta(默认贴着正文上缘) */}
                <div className="pddcs-gmeta pddcs-gmeta-flush pddcs-gmeta-top">
                  {k.source === 'doc' && <Tag>文档</Tag>}
                  {disabled && <Tag>已停用</Tag>}
                  {!disabled && k.hasEmbedding === 0 && <Tag>向量生成中</Tag>}
                  {!disabled && k.hasEmbedding === -1 && (
                    <Tag tone="danger" title="嵌入失败,后台将自动重试">
                      嵌入失败
                    </Tag>
                  )}
                  <span
                    className="pddcs-num"
                    style={{ marginLeft: 'auto', fontSize: fontSize.cap, color: 'var(--pddcs-text-tertiary)' }}
                  >
                    {formatTs(k.updatedAt)}
                  </span>
                </div>

                <div className="pddcs-kb-title">{k.title}</div>
                <div className="pddcs-kb-body">{k.content}</div>

                {/* pddcs-gops-flush:知识库卡没有 Q/A 字母槽,正文从 16px 起,
                    操作行不补那 21px —— 图标与标题同一条竖线 */}
                <div className="pddcs-gops pddcs-gops-flush">
                  {confirmDeleteId === k.id ? (
                    <ConfirmRow
                      text="删除这条知识?同名文档重新上传可整篇替换。"
                      onOk={() => void deleteKb(k.id)}
                      onCancel={() => setConfirmDeleteId(null)}
                    />
                  ) : (
                    <>
                      {/* 填充也是图标:一行五个动作全是图标,形状一致、宽度一致,
                          不会因为"填充"两个字把这一行撑歪 */}
                      <IconBtn
                        title="填充到聊天页输入框(发送由人工完成)"
                        disabled={disabled}
                        onClick={() => void fillKb(k)}
                      >
                        <FillIcon size={size.iconBtn} strokeWidth={2} />
                      </IconBtn>
                      <IconBtn title="复制正文" onClick={() => void copyKb(k)} disabled={disabled}>
                        <CopyIcon size={size.iconBtn} strokeWidth={2} />
                      </IconBtn>
                      {k.source !== 'doc' && (
                        <IconBtn title="编辑标题与正文" onClick={() => startEdit(k)}>
                          <PencilIcon size={size.iconBtn} strokeWidth={2} />
                        </IconBtn>
                      )}
                      <IconBtn
                        title={disabled ? '启用后重新参与检索' : '停用后保留数据,不参与检索'}
                        onClick={() => void toggleEnabled(k)}
                      >
                        {disabled ? (
                          <EyeIcon size={size.iconBtn} strokeWidth={2} />
                        ) : (
                          <EyeOffIcon size={size.iconBtn} strokeWidth={2} />
                        )}
                      </IconBtn>
                      <IconBtn
                        title="删除"
                        className="pddcs-iconbtn-danger"
                        onClick={() => setConfirmDeleteId(k.id)}
                      >
                        <TrashIcon size={size.iconBtn} strokeWidth={2} />
                      </IconBtn>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </List>
      )}
    </div>
  )
}
