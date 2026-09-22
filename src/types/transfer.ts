// ─── 导入导出 v2 · 线上类型(信封与剥离向量后的导出形状)────────────────────────
// 纯类型,无运行时。构建/计划逻辑见 background/transferPlan.ts。
// 设计依据:设计文档 §8(信封 2.0:默认 goldens+folders+settings,记忆可选;
// 恢复按 id/内容幂等,不覆盖本地编辑)。导出统一剥离向量字段、hasEmbedding 归 0,
// 导入端全量重新嵌入 —— 终态与"含向量搬库"一致,免去跨模型版本校验。

import type { FolderRecord, PddSettings } from './memory'

/** 导出金标准(向量剥离,导入端统一重嵌) */
export interface ExportedGolden {
  id: string
  folderId: string | null
  question: string
  answer: string
  questionHash: string
  hasEmbedding: number
  sourceRecordId?: string
  sourceReplyId?: string
  createdAt: number
  updatedAt: number
}

/** 导出问答记录(问题向量剥离) */
export interface ExportedQa {
  id: string
  sessionKey: string
  buyerIdTail?: string
  question: string
  questionHash: string
  questionTs: number
  hasEmbedding: number
  replyCount: number
  createdAt: number
  updatedAt: number
}

/** 导出回复(预留向量字段剥离) */
export interface ExportedReply {
  id: string
  qaId: string
  text: string
  contentHash: string
  msgId?: string
  ts: number
  hasEmbedding: number
}

/** 导出知识库条目(向量剥离;enabled/source/docId/chunkKind/sectionSeq 原样保留) */
export interface ExportedKnowledge {
  id: string
  title: string
  content: string
  questionHash: string
  hasEmbedding: number
  enabled: number
  source?: 'manual' | 'doc'
  docId?: string
  /**
   * 块类型(v0.16 起导出;旧文件没有这两个字段,导入端按缺省处理)。
   * 缺了它,导入的文档块会退化成"来源不明"的条目 —— 重新分块要靠它判断
   * 这段是问答体还是小节,分块器版本号也要靠它对齐。
   */
  chunkKind?: 'qa' | 'section'
  /** 源节在文档中的序号(0 起);同一节被拆成多块时共享 */
  sectionSeq?: number
  createdAt: number
  updatedAt: number
}

/**
 * 导出知识库文档原文(v0.16):kbDocs 是"按新分块规则重切"的唯一事实源。
 * 不带它,导入到新机器上的文档块就是一坨无法重切的死数据 —— 旧版导出正是如此,
 * 结果是知识库页常年挂一条"请重新上传原文"的提示,而原文在用户手里、只是没人告诉他要传。
 */
export interface ExportedKbDoc {
  docId: string
  content: string
  /** 导出时的分块器版本;导入后与当前版本不符即自动重切(见 kbResplit.ts) */
  splitterVersion: string
  chunkCount: number
  createdAt: number
  updatedAt: number
}

export interface ExportEnvelope {
  version: string
  exportedAt: number
  settings: PddSettings
  folders: FolderRecord[]
  goldens: ExportedGolden[]
  /** 知识库:人工精选数据,与金标准同级,始终导出(不受 includeMemory 门控) */
  knowledge?: ExportedKnowledge[]
  /** 知识库文档原文(v0.16 新增;旧文件无此字段,导入端按空数组处理) */
  kbDocs?: ExportedKbDoc[]
  qaRecords?: ExportedQa[]
  replies?: ExportedReply[]
}
