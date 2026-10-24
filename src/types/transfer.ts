// ─── 导入导出 v2 · 线上类型(信封与剥离向量后的导出形状)────────────────────────
// 纯类型,无运行时。构建/计划逻辑见 background/transferPlan.ts。
// 设计依据:设计文档 §8(信封 2.0:默认 goldens+folders+settings,记忆可选;
// 恢复按 id/内容幂等,不覆盖本地编辑)。导出统一剥离向量字段、hasEmbedding 归 0,
// 导入端全量重新嵌入 —— 终态与"含向量搬库"一致,免去跨模型版本校验。
//
// ⚠️ **只剥离向量,不剥离分类**。第五十六轮引入 categories 之后,导出曾长期漏带
// 分类(记录级的 categoryId 与类型表本身都没有),导入端于是把分类全丢、重新变回
// 补分类候选 —— 而补分类要花 API 额度。本文件现在把分类一并往返,理由见下方
// categoryId 字段的注释。
//
// **字段是加法,EXPORT_VERSION 不动**:transfer.ts 的版本校验是**严格相等**,
// 一改 '2.0' → '2.1' 会把用户手里所有存量备份直接拒收。新增字段一律走
// "旧文件没有该字段 → 导入端按缺省处理"这条路(KbDoc.isSizeTable 当年就是这么做的)。

import type { CategoryRecord, FolderRecord, ImageAttachment, PddSettings } from './memory'

/**
 * 分类字段在导出记录上的公共形状。
 *
 * 为什么必须往返:分类是**用户看得见、且被检索依赖**的状态 ——
 *   - `categoryId` 决定这条记录在按类型过滤时进不进池;
 *   - `categorySource='manual'` 让机器补分类**永不覆盖**它(见 db.updateGoldenCategory 的守卫)。
 * 丢了它,一次"导出→换机器导入"就会让用户手工摆好的分类静默消失,
 * 且因为丢失后重新成为补分类候选,还会平白再烧一轮 API。
 *
 * `categoryConfidence` 一并带上:它是"这条判得有多虚"的唯一证据,
 * 丢了就再也说不清哪些是勉强过线的(标准回答页据此标「低置信」)。
 */
export interface ExportedCategoryFields<
  S extends string = 'jev' | 'inherit' | 'manual',
> {
  categoryId?: string | null
  /**
   * 与记录上的同名字段同义:谁打的标。
   *
   * **泛型不是花招**:`'inherit'` 只可能出现在金标准上(它是"从来源问答继承"的标记),
   * 问答记录只有 `'jev' | 'manual'`。收窄成泛型参数,导出侧就不可能把
   * 一个问答记录写成 `'inherit'` —— 这条约束是 `tsc` 在守,不是靠注释。
   */
  categorySource?: S
  /** 打标时间;判定说明改动后据此只重跑旧的 */
  categoryAt?: number
  /** 打标时该标签的概率(0~1) */
  categoryConfidence?: number
}

/** 导出金标准(向量剥离,导入端统一重嵌;分类一并往返) */
export interface ExportedGolden extends ExportedCategoryFields {
  id: string
  folderId: string | null
  question: string
  answer: string
  questionHash: string
  hasEmbedding: number
  /** 随答案沉淀的图片(URL);旧备份没有该字段 → 按无图处理 */
  attachments?: ImageAttachment[]
  sourceRecordId?: string
  sourceReplyId?: string
  createdAt: number
  updatedAt: number
}

/** 导出问答记录(问题向量剥离;分类一并往返)。问答不可能有 `'inherit'` */
export interface ExportedQa extends ExportedCategoryFields<'jev' | 'manual'> {
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
  /** 图片附件(URL);旧备份没有该字段 → 按无图处理 */
  attachments?: ImageAttachment[]
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
  /**
   * 是否尺码表(文档级标记)。**必须随导出往返** —— 漏了它,用户标好的尺码表
   * 换台机器恢复后标记就没了:该文档的块重新进向量检索、尺码生成材料也没了,
   * 全程无任何提示。旧导出文件没有这个字段,导入端保持缺省(等价"未标记")。
   */
  isSizeTable?: boolean
  createdAt: number
  updatedAt: number
}

/**
 * 导出信封里的设置:**刻意不含任何 API Key**。
 *
 * ADR-0006/0007 的硬约束是「Key 只进 chrome.storage.local,不随导出外发」——
 * 用类型把这条边界钉死,未来往信封里加字段时也不会手滑把 Key 带出去。
 * 构建侧的唯一剥除点在 transferPlan.buildExportEnvelope(见 stripSettingsSecrets)。
 */
export type ExportedSettings = Omit<PddSettings, 'jevApiKey' | 'llmApiKey'>

export interface ExportEnvelope {
  version: string
  exportedAt: number
  settings: ExportedSettings
  /**
   * ⚠️ **legacy**:v8 起文件夹体系已被 categories 取代,这张表 `db.ts` 里写着
   * "迁移后不再被读写",UI 上也早已没有任何入口。仍然导出只是为了**读得动旧文件**
   * (旧备份里没有 categories,只有 folders)—— 新写入端保留它是零成本的包袱,
   * 但不要据此认为文件夹还活着。真正的类型在下面的 `categories`。
   */
  folders: FolderRecord[]
  /**
   * 问题类型表。**必须随导出往返**:记录级的 categoryId 是外键,不带类型表的话
   * 导入端只能把这批 id 全判成悬空、退回未分类。
   *
   * 旧导出文件(第五十八轮之前)没有这个字段 → 导入端按空数组处理,
   * 行为与从前一致(记录落回未分类)。
   */
  categories?: CategoryRecord[]
  goldens: ExportedGolden[]
  /** 知识库:人工精选数据,与金标准同级,始终导出(不受 includeMemory 门控) */
  knowledge?: ExportedKnowledge[]
  /** 知识库文档原文(v0.16 新增;旧文件无此字段,导入端按空数组处理) */
  kbDocs?: ExportedKbDoc[]
  qaRecords?: ExportedQa[]
  replies?: ExportedReply[]
}
