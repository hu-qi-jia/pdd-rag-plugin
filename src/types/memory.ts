// ─── 拼多多客服快捷回复工具 · 领域存储类型 ──────────────────────────────────────
// 语义定义见 CONTEXT.md;schema/DAO 见 background/db.ts
// 全部时间戳为 Unix 毫秒;向量一律 Float32Array(结构化克隆可直存 IndexedDB)

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
  createdAt: number
  updatedAt: number
}

export const UNCATEGORIZED_FOLDER_ID = 'uncategorized'
/** 预置默认夹显示名(2026-09-15 第十八轮由「未分类」改名;id 不变,存量由 ensurePresetFolders 迁移) */
export const UNCATEGORIZED_FOLDER_NAME = '默认文件夹'

/** 自检(示例)数据专用会话标识:统计时排除、一键清理 */
export const SELF_TEST_SESSION_KEY = '__pddcs_selftest__'

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

export const DEFAULT_HOTKEY: HotkeyConfig = {
  ctrl: true,
  alt: false,
  shift: false,
  key: 'Enter',
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
}

export const DEFAULT_SETTINGS: PddSettings = {
  directFillEnabled: false,
  simThreshold: 0.5,
  goldenThreshold: 0.4,
  kbThreshold: 0.4,
  retentionDays: 90,
  goldenPriorityEnabled: true,
  autoReplyHotkey: DEFAULT_HOTKEY,
}

export const SETTINGS_STORAGE_KEY = 'pddcs:settings'

/** 同一问题可保留的标准回答条数上限(用户指定:合计最多 3 条)。
 *  放在纯类型模块里,后台写入口径与聊天页 UI 提示共用同一个数字。 */
export const MAX_GOLDENS_PER_QUESTION = 3
