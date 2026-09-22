/**
 * 知识库 CRUD 编排(P4-KB v1)。
 * 幂等:normalize + 标题 hash 查重,已存在直接返回 exists,不重复建、不重嵌。
 * 编辑:标题实质变更才作废旧向量重嵌(检索锚=标题向量);正文编辑不动向量;
 * enabled 停用切换不重嵌(停用条目在检索读库时被过滤)。
 */
import { db } from './db'
import { queueEmbedding } from './offscreen'
import { hashText, normalizeText } from '../shared/text'
import { SPLITTER_VERSION, chunkMarkdown } from '../shared/mdText'
import { kbAnchorText } from './kbAnchor'
import { planKnowledgeEdit } from './knowledgeEdit'
import type { CreateKbRequest, UpdateKbRequest, UploadKbDocRequest } from '../types/messages'

export interface CreateKbOutcome {
  id?: string
  exists?: boolean
  error?: string
}

export async function createKnowledge(
  payload: CreateKbRequest['payload'],
): Promise<CreateKbOutcome> {
  const title = normalizeText(payload.title ?? '')
  const content = normalizeText(payload.content ?? '')
  if (!title || !content) return { error: '标题或正文为空' }

  const questionHash = hashText(title)
  const dup = await db.findKnowledgeByTitleHash(questionHash)
  if (dup) return { id: dup.id, exists: true }

  const now = Date.now()
  const id = `kb-${now}-${Math.random().toString(36).slice(2, 8)}`
  await db.addKnowledge({
    id,
    title,
    content,
    questionHash,
    hasEmbedding: 0,
    enabled: 1,
    createdAt: now,
    updatedAt: now,
  })
  queueEmbedding('knowledge', id, title)
  return { id }
}

export interface UpdateKbOutcome {
  id?: string
  reembed?: boolean
  error?: string
}

/** 编辑知识条目:双字段编辑 / enabled 停用切换;标题实质变更时重嵌 */
export async function updateKnowledgeWithReembed(
  payload: UpdateKbRequest['payload'],
): Promise<UpdateKbOutcome> {
  const existing = await db.getKnowledge(payload.id)
  if (!existing) return { error: '知识条目不存在' }

  // 文档块只读:锚是块正文,直接改标题/正文会嵌错文本;要改请重新上传整篇
  if (existing.source === 'doc' && (payload.title !== undefined || payload.content !== undefined)) {
    return { error: '文档分块不可编辑,请修改后重新上传该文档' }
  }

  // enabled 切换:直改不重嵌(编辑决策不管 enabled)
  if (payload.enabled !== undefined) {
    await db.updateKnowledge(payload.id, { enabled: payload.enabled === 1 ? 1 : 0 })
    if (payload.title === undefined && payload.content === undefined) {
      return { id: payload.id, reembed: false }
    }
  }

  const others = new Set(
    (await db.knowledge.toArray())
      .filter((k) => k.id !== payload.id)
      .map((k) => k.questionHash),
  )
  const plan = planKnowledgeEdit(
    existing,
    { title: payload.title, content: payload.content },
    others,
  )
  if (!plan.ok) return { error: plan.error }

  const patch = { ...plan.updates }
  if (plan.reembed) patch.hasEmbedding = 0
  await db.updateKnowledge(payload.id, patch)
  if (plan.reembed) {
    queueEmbedding('knowledge', payload.id, patch.title ?? existing.title)
  }
  return { id: payload.id, reembed: plan.reembed }
}

/** 删除知识条目;删掉的是某文档最后一块时,连带清掉 kbDocs 原文(否则重分块会把它复活) */
export async function deleteKnowledge(id: string): Promise<void> {
  const existing = await db.getKnowledge(id)
  await db.deleteKnowledge(id)
  const docId = existing?.docId
  if (!docId) return
  const rest = await db.listKnowledgeByDoc(docId)
  if (rest.length === 0) await db.deleteKbDoc(docId)
}

// ─── md 文档上传(P4-KB)────────────────────────────────────────────────────────
// 结构感知分块(chunkMarkdown):按标题切小节,小节整块保留(≤500 字),超长小节
// 按行分组、永不截断单行;节内为问答体(Q：行 ≥2 条)时按条切分;无结构纯文本
// 回退原 chunkText 滑窗(原项目逻辑兜底)。
// 每块一条知识条目,检索锚 = 展示标题 + 块正文(kbAnchorText);同名文档整篇替换。
// 原文另存 kbDocs:分块规则变更后可自动重切,不必要求用户重传(见 kbResplit.ts)。

/** 单文档块数上限:超出提示手动拆分(≈4.2 万字,防止一次排几百个嵌入任务) */
export const MAX_DOC_CHARS = 100_000

export interface UploadKbDocOutcome {
  docId?: string
  chunkCount?: number
  replaced?: boolean
  error?: string
}

export async function importKbDocument(
  payload: UploadKbDocRequest['payload'],
): Promise<UploadKbDocOutcome> {
  // 文档名去扩展名做 docId(展示与幂等键);内容只做首尾清理,不动内部空白
  const docId = normalizeText((payload.name ?? '').replace(/\.(md|markdown|txt)$/i, ''))
  const content = (payload.content ?? '').trim()
  if (!docId) return { error: '文档名为空' }
  if (!content) return { error: '文档内容为空' }
  if (content.length > MAX_DOC_CHARS) {
    return { error: `文档过长(${content.length} 字符,上限 ${MAX_DOC_CHARS}),请拆分后分篇上传` }
  }

  const chunks = chunkMarkdown(content)

  const now = Date.now()
  const rootId = `kbd-${now}-${Math.random().toString(36).slice(2, 8)}`
  // 同一小节被拆成多块时,第 2 块起标题加"(续n)"标识同节兄弟块
  const sectionSeq = new Map<string, number>()
  // 嵌入入队延后到事务提交后:失败回滚不得产生孤儿嵌入任务
  const pendingEmbeds: Array<{ id: string; anchor: string }> = []
  let replaced = false

  // 整篇替换必须原子:删旧块 + 写新块同事务,中途失败整体回滚(旧文档原样保留)
  // (metrics 也要列入:删块会连带清掉旧块的逐条用量键,属同一事务的一部分)
  await db.transaction('rw', db.knowledge, db.kbDocs, db.metrics, async () => {
    replaced = (await db.deleteKnowledgeByDoc(docId)) > 0
    for (let i = 0; i < chunks.length; i++) {
      const id = chunks.length === 1 ? rootId : `${rootId}-c${i}`
      const base = chunks[i].title ? `${docId} · ${chunks[i].title}` : docId
      const seq = sectionSeq.get(base) ?? 0
      sectionSeq.set(base, seq + 1)
      const title = seq === 0 ? base : `${base} (续${seq + 1})`
      await db.addKnowledge({
        id,
        title,
        content: chunks[i].text,
        questionHash: hashText(`${docId}#${i}`),
        hasEmbedding: 0,
        enabled: 1,
        source: 'doc',
        docId,
        chunkKind: chunks[i].kind,
        sectionSeq: chunks[i].sectionSeq,
        createdAt: now,
        updatedAt: now,
      })
      // 锚 = 展示标题 + 块正文(小节标题语义强,拼进锚提升命中率;与 search.ts 同源)
      pendingEmbeds.push({
        id,
        anchor: kbAnchorText({ source: 'doc', title, content: chunks[i].text }),
      })
    }
    await db.putKbDoc({
      docId,
      content,
      splitterVersion: SPLITTER_VERSION,
      chunkCount: chunks.length,
      createdAt: now,
      updatedAt: now,
    })
  })
  for (const p of pendingEmbeds) queueEmbedding('knowledge', p.id, p.anchor)
  return { docId, chunkCount: chunks.length, replaced }
}
