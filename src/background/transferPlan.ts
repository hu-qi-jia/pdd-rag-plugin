/**
 * 导入导出 v2 —— 纯计划逻辑(无 DB/chrome 依赖,单测覆盖)。
 * 设计依据:设计文档 §8(信封 2.0:默认 goldens+folders+settings,记忆可选;
 * 恢复按 id/内容幂等,不覆盖本地编辑)。
 *
 * 实现差异(记录在案):导出统一剥离向量字段、hasEmbedding 归 0,
 * 导入端全量重新嵌入 —— 终态与"含向量搬库"一致,免去跨模型版本校验。
 */
import { SELF_TEST_SESSION_KEY, UNCATEGORIZED_FOLDER_ID } from '../shared/constants'
import type {
  FolderRecord,
  GoldenRecord,
  KbDocRecord,
  KnowledgeRecord,
  PddSettings,
  QaRecord,
  ReplyRecord,
} from '../types/memory'
// 导出线上形状(信封/剥离向量后的记录)是纯类型,2026-09-16 工程审查③移入 types/transfer,
// types 层不再反向依赖 background
import type {
  ExportEnvelope,
  ExportedGolden,
  ExportedKbDoc,
  ExportedKnowledge,
  ExportedQa,
  ExportedReply,
} from '../types/transfer'
import { hashText } from '../shared/text'

export const EXPORT_VERSION = '2.0'

const stripGolden = (g: GoldenRecord): ExportedGolden => ({
  id: g.id,
  folderId: g.folderId,
  question: g.question,
  answer: g.answer,
  questionHash: g.questionHash,
  hasEmbedding: 0,
  ...(g.sourceRecordId !== undefined ? { sourceRecordId: g.sourceRecordId } : {}),
  ...(g.sourceReplyId !== undefined ? { sourceReplyId: g.sourceReplyId } : {}),
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
})

const stripQa = (q: QaRecord): ExportedQa => ({
  id: q.id,
  sessionKey: q.sessionKey,
  ...(q.buyerIdTail !== undefined ? { buyerIdTail: q.buyerIdTail } : {}),
  question: q.question,
  questionHash: q.questionHash,
  questionTs: q.questionTs,
  hasEmbedding: 0,
  replyCount: q.replyCount,
  createdAt: q.createdAt,
  updatedAt: q.updatedAt,
})

const stripReply = (r: ReplyRecord): ExportedReply => ({
  id: r.id,
  qaId: r.qaId,
  text: r.text,
  contentHash: r.contentHash,
  ...(r.msgId !== undefined ? { msgId: r.msgId } : {}),
  ts: r.ts,
  hasEmbedding: 0,
})

const stripKnowledge = (k: KnowledgeRecord): ExportedKnowledge => ({
  id: k.id,
  title: k.title,
  content: k.content,
  questionHash: k.questionHash,
  hasEmbedding: 0,
  enabled: k.enabled,
  ...(k.source !== undefined ? { source: k.source } : {}),
  ...(k.docId !== undefined ? { docId: k.docId } : {}),
  // v0.16:块类型与节序号必须跟着走,否则导入的文档块会丢掉"这段是怎么切出来的"
  ...(k.chunkKind !== undefined ? { chunkKind: k.chunkKind } : {}),
  ...(k.sectionSeq !== undefined ? { sectionSeq: k.sectionSeq } : {}),
  createdAt: k.createdAt,
  updatedAt: k.updatedAt,
})

const stripKbDoc = (d: KbDocRecord): ExportedKbDoc => ({
  docId: d.docId,
  content: d.content,
  splitterVersion: d.splitterVersion,
  chunkCount: d.chunkCount,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
})

/** 构建导出信封;includeMemory=false 时不携带问答/回复字段;知识库(含文档原文)始终携带 */
export function buildExportEnvelope(input: {
  goldens: GoldenRecord[]
  folders: FolderRecord[]
  knowledge?: KnowledgeRecord[]
  kbDocs?: KbDocRecord[]
  settings: PddSettings
  qaRecords?: QaRecord[]
  replies?: ReplyRecord[]
  includeMemory: boolean
  exportedAt: number
}): ExportEnvelope {
  const env: ExportEnvelope = {
    version: EXPORT_VERSION,
    exportedAt: input.exportedAt,
    settings: input.settings,
    folders: input.folders,
    goldens: input.goldens.map(stripGolden),
    knowledge: (input.knowledge ?? []).map(stripKnowledge),
    kbDocs: (input.kbDocs ?? []).map(stripKbDoc),
  }
  if (input.includeMemory) {
    env.qaRecords = (input.qaRecords ?? []).map(stripQa)
    env.replies = (input.replies ?? []).map(stripReply)
  }
  return env
}

// ─── 导入计划 ──────────────────────────────────────────────────────────────────

export interface GoldenImportPlan {
  toAdd: GoldenRecord[]
  skipped: number
  /** 因目标问题已达上限而跳过的条数 */
  limited: number
}

/** (问题, 答案) 唯一键 —— 同一问题可有多条标准回答(答案不同),跨问题不冲突 */
export function goldenPairKey(questionHash: string, answer: string): string {
  return `${questionHash}|${hashText(answer)}`
}

/** 导入时已存在的标准回答快照:(问题+答案) 键集合 + 每问题条数 */
export interface GoldenImportContext {
  existingKeys: Set<string>
  /** questionHash → 已有条数 */
  existingCounts: Map<string, number>
}

export function goldenImportContext(
  existing: Array<Pick<GoldenRecord, 'questionHash' | 'answer'>>,
): GoldenImportContext {
  const existingKeys = new Set<string>()
  const existingCounts = new Map<string, number>()
  for (const g of existing) {
    existingKeys.add(goldenPairKey(g.questionHash, g.answer))
    existingCounts.set(g.questionHash, (existingCounts.get(g.questionHash) ?? 0) + 1)
  }
  return { existingKeys, existingCounts }
}

/**
 * 标准回答导入计划:按 **(问题 + 答案)** 幂等(已存在跳过,不覆盖本地编辑);
 * 导入包内部同键重复只留第一条;每个问题上限 maxPerQuestion(超限计入 limited);
 * 入列记录强制 hasEmbedding=0 待重嵌。
 */
export function planGoldenImports(
  incoming: ExportedGolden[],
  ctx: GoldenImportContext,
  maxPerQuestion: number,
): GoldenImportPlan {
  const toAdd: GoldenRecord[] = []
  const counts = new Map(ctx.existingCounts)
  let skipped = 0
  let limited = 0
  for (const g of incoming) {
    const key = goldenPairKey(g.questionHash, g.answer)
    if (ctx.existingKeys.has(key)) {
      skipped += 1
      continue
    }
    if ((counts.get(g.questionHash) ?? 0) >= maxPerQuestion) {
      limited += 1
      continue
    }
    ctx.existingKeys.add(key)
    counts.set(g.questionHash, (counts.get(g.questionHash) ?? 0) + 1)
    // 显式挑字段:导入来源可能携带多余运行时字段(如向量),一律丢弃待重嵌
    toAdd.push({
      id: g.id,
      folderId: g.folderId,
      question: g.question,
      answer: g.answer,
      questionHash: g.questionHash,
      hasEmbedding: 0,
      ...(g.sourceRecordId !== undefined ? { sourceRecordId: g.sourceRecordId } : {}),
      ...(g.sourceReplyId !== undefined ? { sourceReplyId: g.sourceReplyId } : {}),
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })
  }
  return { toAdd, skipped, limited }
}

export interface FolderImportPlan {
  toAdd: FolderRecord[]
  skipped: number
}

/**
 * 文件夹导入计划:按 id 幂等;预置"默认文件夹"恒跳过;
 * 悬空 parentId(不在已有集与导入包内)→ 置为根层。
 */
export function planFolderImports(
  incoming: FolderRecord[],
  existingIds: Set<string>,
): FolderImportPlan {
  const seen = new Set<string>()
  const keep: FolderRecord[] = []
  let skipped = 0
  for (const f of incoming) {
    if (f.id === UNCATEGORIZED_FOLDER_ID || existingIds.has(f.id) || seen.has(f.id)) {
      skipped += 1
      continue
    }
    seen.add(f.id)
    keep.push(f)
  }
  const allowedParents = new Set([...existingIds, ...keep.map((f) => f.id)])
  const toAdd = keep.map((f) =>
    f.parentId !== null && !allowedParents.has(f.parentId) ? { ...f, parentId: null } : f,
  )
  return { toAdd, skipped }
}

export interface MemoryImportPlan {
  toAddQa: QaRecord[]
  toAddReplies: ReplyRecord[]
  skippedQa: number
  skippedReplies: number
}

/**
 * 记忆搬库计划:问答按 id 幂等,自检示例数据排除;
 * 回复按 id 幂等,且 qaId 必须指向已有或本次导入的问答(孤儿丢弃计数)。
 */
export function planMemoryImports(
  incomingQa: ExportedQa[],
  incomingReplies: ExportedReply[],
  existingQaIds: Set<string>,
  existingReplyIds: Set<string>,
): MemoryImportPlan {
  const toAddQa: QaRecord[] = []
  const seenQa = new Set<string>()
  let skippedQa = 0
  for (const q of incomingQa) {
    if (q.sessionKey === SELF_TEST_SESSION_KEY) {
      skippedQa += 1
      continue
    }
    if (existingQaIds.has(q.id) || seenQa.has(q.id)) {
      skippedQa += 1
      continue
    }
    seenQa.add(q.id)
    toAddQa.push({
      id: q.id,
      sessionKey: q.sessionKey,
      ...(q.buyerIdTail !== undefined ? { buyerIdTail: q.buyerIdTail } : {}),
      question: q.question,
      questionHash: q.questionHash,
      questionTs: q.questionTs,
      hasEmbedding: 0,
      replyCount: q.replyCount,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
    })
  }

  const allowedQaIds = new Set([...existingQaIds, ...toAddQa.map((q) => q.id)])
  const toAddReplies: ReplyRecord[] = []
  const seenReply = new Set<string>()
  let skippedReplies = 0
  for (const r of incomingReplies) {
    if (existingReplyIds.has(r.id) || seenReply.has(r.id) || !allowedQaIds.has(r.qaId)) {
      skippedReplies += 1
      continue
    }
    seenReply.add(r.id)
    toAddReplies.push({
      id: r.id,
      qaId: r.qaId,
      text: r.text,
      contentHash: r.contentHash,
      ...(r.msgId !== undefined ? { msgId: r.msgId } : {}),
      ts: r.ts,
      hasEmbedding: 0,
    })
  }
  return { toAddQa, toAddReplies, skippedQa, skippedReplies }
}

export interface KnowledgeImportPlan {
  toAdd: KnowledgeRecord[]
  skipped: number
}

/**
 * 知识库导入计划:按归一化标题 hash 幂等(已存在跳过,不覆盖本地编辑);
 * 导入包内部同 hash 重复只留第一条;enabled 原样保留,向量一律丢弃待重嵌。
 */
export function planKnowledgeImports(
  incoming: ExportedKnowledge[],
  existingTitleHashes: Set<string>,
): KnowledgeImportPlan {
  const toAdd: KnowledgeRecord[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const k of incoming) {
    if (existingTitleHashes.has(k.questionHash) || seen.has(k.questionHash)) {
      skipped += 1
      continue
    }
    seen.add(k.questionHash)
    // 显式挑字段:运行时多余字段(如向量)一律不带入
    toAdd.push({
      id: k.id,
      title: k.title,
      content: k.content,
      questionHash: k.questionHash,
      hasEmbedding: 0,
      enabled: k.enabled,
      ...(k.source !== undefined ? { source: k.source } : {}),
      ...(k.docId !== undefined ? { docId: k.docId } : {}),
      // v0.16:块类型/节序号随条目一起带过来(旧导出文件没有这两个字段 → 保持缺省)
      ...(k.chunkKind !== undefined ? { chunkKind: k.chunkKind } : {}),
      ...(k.sectionSeq !== undefined ? { sectionSeq: k.sectionSeq } : {}),
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    })
  }
  return { toAdd, skipped }
}

export interface KbDocImportPlan {
  toAdd: KbDocRecord[]
  skipped: number
}

/**
 * 知识库文档原文导入计划(v0.16):按 docId 幂等。
 *
 * 已存在同名原文时**跳过而非覆盖** —— docId 是文档名,同名意味着"同一篇文档",
 * 而本地那份可能已经被用户用新内容重传过;导入包里的可能是更旧的版本。
 * 覆盖等于用旧内容回退本地,与全库"导入不覆盖本地编辑"的口径一致。
 *
 * splitterVersion 原样带入:与当前分块器版本不符时,SW 启动的 resplitStaleKbDocs
 * 会据此自动重切,文档块也就跟着更新 —— 这正是本字段存在的意义。
 */
export function planKbDocImports(
  incoming: ExportedKbDoc[],
  existingDocIds: Set<string>,
): KbDocImportPlan {
  const toAdd: KbDocRecord[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const d of incoming) {
    if (!d || typeof d.docId !== "string" || !d.docId) {
      skipped += 1
      continue;
    }
    if (existingDocIds.has(d.docId) || seen.has(d.docId)) {
      skipped += 1
      continue;
    }
    seen.add(d.docId)
    toAdd.push({
      docId: d.docId,
      content: String(d.content ?? ""),
      splitterVersion: String(d.splitterVersion ?? ""),
      chunkCount: Number(d.chunkCount) || 0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });
  }
  return { toAdd, skipped };
}
