// ─── 拼多多客服快捷回复工具 · 领域存储类型(纯类型,无运行时)──────────────────
// 语义定义见 CONTEXT.md;schema/DAO 见 background/db.ts
// 全部时间戳为 Unix 毫秒;向量一律 Float32Array(结构化克隆可直存 IndexedDB)
// 运行时常量(默认夹 id / 默认设置 / 存储键等)2026-09-16 工程审查③迁至 shared/constants.ts

/** 会话消息角色 —— 平台 JSON 中 from.role 的映射(user→buyer, mall_cs→agent) */
export type PddRole = 'buyer' | 'agent'

/** 问答记录(qaRecords):一次捕获单元 = 买家问题 + 挂载其下的客服回复;仅存保留期内 */
export interface QaRecord {
  /** 主键 uuid */
  id: string
  /** 会话标识(平台会话 id 归一化);捕获/去重/归并以会话为边界 */
  sessionKey: string
  /** 买家 uid 尾号 —— 仅会话内去重与未来筛选,不做检索维度 */
  buyerIdTail?: string
  /** 合并后问题全文(买家连续文本) */
  question: string
  /** 问题段首条买家消息的平台 msg_id —— 库级幂等锚(SW 重启后重放防御),索引 */
  msgId?: string
  /** 归一化哈希 —— 幂等/折叠用,索引 */
  questionHash: string
  /** 问题块首条消息时间;= 保留期起算点,索引 */
  questionTs: number
  /** 问题向量(检索锚);v1 由 offscreen 推理回填 */
  embedding?: Float32Array
  embeddingModel?: string
  embeddingVersion?: string
  /** 0=待嵌 1=已嵌 -1=失败(下次启动扫描重试) */
  hasEmbedding: number
  /** 冗余计数:挂载的回复条数 */
  replyCount: number
  createdAt: number
  updatedAt: number
}

/** 客服回复(replies):候选回复本体;同内容可跨问题复用,故用 contentHash 折叠 */
export interface ReplyRecord {
  /** 主键 uuid */
  id: string
  /** 归属问答记录,索引 */
  qaId: string
  /** 回复正文 */
  text: string
  /** 归一化哈希 —— 弹窗同内容折叠依据,索引 */
  contentHash: string
  /** 平台消息幂等键(网络层 msg_id) */
  msgId?: string
  /** 平台消息时间 */
  ts: number
  /** v1 回复不单独向量化:字段预留,恒 0 */
  hasEmbedding: number
  embeddingModel?: string
  embeddingVersion?: string
}

/** 金标准(goldens):提升时复制的独立"标准问答"文档,豁免保留期,可编辑/删除 */
export interface GoldenRecord {
  /** 主键 uuid */
  id: string
  /** 归属回复文件夹 id;null=尚未入夹(兜底) */
  folderId: string | null
  /** 标准问题字段(可编辑) */
  question: string
  /** 标准回复字段(可编辑) */
  answer: string
  /** 归一化哈希 —— 导入/提升幂等去重 */
  questionHash: string
  /** 问题锚向量;编辑保存即作废旧向量、自动重嵌 */
  qEmbedding?: Float32Array
  embeddingModel?: string
  embeddingVersion?: string
  /** 0=待嵌 1=已嵌 -1=失败 */
  hasEmbedding: number
  /** 提升来源溯源(展示用,不参与检索) */
  sourceRecordId?: string
  sourceReplyId?: string
  createdAt: number
  updatedAt: number
}

/** 回复文件夹(folders):金标准的分类树,两层(parentId 为 null 即在根层) */
export interface FolderRecord {
  /** 主键;预置"默认文件夹"使用固定 id UNCATEGORIZED_FOLDER_ID */
  id: string
  /** 父文件夹 id;null=根层(一层可挂根层) */
  parentId: string | null
  name: string
  /** 同层排序位置(0 起) */
  position: number
  createdAt: number
}

/** 知识库条目(knowledge,P4-KB v1):人工维护的"标题+正文"话术卡,豁免保留期 */
export interface KnowledgeRecord {
  /** 主键 uuid;文档分块为 `${doc根id}-c${序号}`(与原项目 chunk id 同风格) */
  id: string
  /** 条目标题(手工条目=检索锚,类比金标准 question;文档块=展示标签"文档名 · 段n") */
  title: string
  /** 正文(候选填充/复制的内容,类比金标准 answer) */
  content: string
  /** 归一化哈希 —— 手工条目按标题幂等去重;文档块按"文档名#序号"占位唯一 */
  questionHash: string
  /** 向量锚:手工条目=标题;文档块=块正文(source 区分,见 importKbDocument) */
  qEmbedding?: Float32Array
  embeddingModel?: string
  embeddingVersion?: string
  /** 0=待嵌 1=已嵌 -1=失败(下次启动扫描重试) */
  hasEmbedding: number
  /** 1=参与检索 0=停用(停用不删数据、不重嵌) */
  enabled: number
  /** 条目来源:manual=面板手工创建(默认);doc=md 文档分块(只读,重传替换) */
  source?: 'manual' | 'doc'
  /** 文档块所属文档名(去扩展名,索引);手工条目缺省 */
  docId?: string
  /** 块类型:qa=问答体切出的单条(答案自足);section=按标题切出的节(含长节续块) */
  chunkKind?: 'qa' | 'section'
  /** 源节在文档中的序号(0 起,文档顺序):同一节被拆成多块时这些块共享同一 sectionSeq */
  sectionSeq?: number
  createdAt: number
  updatedAt: number
}

/** 知识库文档原文(kbDocs):重分块的事实源;豁免保留期 */
export interface KbDocRecord {
  /** 主键:文档名(去扩展名),与 KnowledgeRecord.docId 同口径 */
  docId: string
  /** markdown 原文,原样保存 */
  content: string
  /** 落块时的分块器版本;不等于当前 SPLITTER_VERSION → 待重分块 */
  splitterVersion: string
  /** 最近一次分块产出的块数(展示用) */
  chunkCount: number
  createdAt: number
  updatedAt: number
}

// ─── 使用统计(v0.16) ───────────────────────────────────────────────────────────

/**
 * 使用统计计数器(metrics):本地自用的埋点,回答"这工具到底帮没帮上忙"。
 * 键的口径(事件键、逐条用量键)统一定义在 shared/metrics.ts,此处只声明存储形状。
 */
export interface MetricRecord {
  /** 主键:`<事件>`(全局计数)或 `item.<类别>:<条目id>`(逐条用量,条目删则键删) */
  key: string
  count: number
  /** 最近一次自增时间 —— 让"这周还在用吗"这类问题可答,也便于排查僵尸键 */
  updatedAt: number
}

/** 错误日志(errors) */
export interface ErrorLog {
  id?: number
  timestamp: number
  message: string
  context?: Record<string, unknown>
}

// ─── 快捷键 ───────────────────────────────────────────────────────────────────

/** 推荐回复快捷键(主键取 KeyboardEvent.key,如 Enter / a / ArrowDown) */
export interface HotkeyConfig {
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

// ─── 设置(chrome.storage.local) ────────────────────────────────────────────────

export interface PddSettings {
  /** 直接填充开关:开 → 不弹窗,按优先级填充;默认关 */
  directFillEnabled: boolean
  /** 历史回答相似度阈值(0~1),默认 0.5 */
  simThreshold: number
  /** 金标准命中阈值(0~1),放宽,默认 0.4 */
  goldenThreshold: number
  /** 知识库命中阈值(0~1),放宽,默认 0.4(独立于金标准可调) */
  kbThreshold: number
  /** 问答记录保留期天数(30~365),默认 90;金标准/文件夹豁免 */
  retentionDays: number
  /** 候选排序"金标准优先"开关,默认开 */
  goldenPriorityEnabled: boolean
  /** 「自动回复」快捷键(默认 Ctrl+Enter):关=弹推荐回复面板再按 Enter 填第一条;开=直接填第一条 */
  autoReplyHotkey: HotkeyConfig
  /** 推荐面板「下一候选」键(默认 Tab,可单键)。反向键与 Shift+同键已于第二十四轮移除,只保留正向循环 */
  panelNavHotkey: HotkeyConfig
  /**
   * 「AI 整合」开关,默认关。关闭或未配置 API 时扩展保持完全本地:
   * 不发起任何网络请求,面板与未引入该功能时零差异。
   */
  aiIntegrateEnabled: boolean
  /** LLM API 端点(OpenAI 兼容 base url,如 https://api.example.com/v1),默认 '' */
  llmBaseUrl: string
  /** API key,默认 ''。仅存 chrome.storage.local,永不同步到云端 */
  llmApiKey: string
  /** 模型名,默认 ''。建议选不带深度思考的快速模型 */
  llmModel: string
  /** 单次整合超时(毫秒),默认 8000,夹取 2000~30000 */
  llmTimeoutMs: number
}
