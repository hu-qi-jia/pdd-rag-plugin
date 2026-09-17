// ─── 面板消息(popup → SW,P3):记忆列表 / 金标准 / 文件夹 ────────────────────
// 面板线类型:剥离向量字段,减小消息体积(向量只活在 SW/IndexedDB 内)。

// ─── 记忆列表 ─────────────────────────────────────────────────────────────────

export interface MemoryReplyItem {
  id: string
  text: string
  ts: number
  /** 该回复已被提升为标准回答时的金标准 id(goldens.sourceReplyId 反查,2026-09-15 PM1) */
  goldenId?: string
}

export interface MemoryListItem {
  id: string
  question: string
  questionTs: number
  replyCount: number
  replies: MemoryReplyItem[]
}

export interface GetMemoryListRequest {
  type: 'GET_MEMORY_LIST'
  /** 分页(PM2):offset 起始条数(缺省 0);limit 单页条数(缺省 100) */
  payload?: { offset?: number; limit?: number }
}

export interface GetMemoryListResponse {
  type: 'GET_MEMORY_LIST_RESPONSE'
  payload: {
    items: MemoryListItem[]
    /** 排除自检数据后的问答总数(与头部统计同口径) */
    total: number
    /** 是否还有更早记录 */
    hasMore: boolean
    error?: string
  }
}

export interface DeleteQaRequest {
  type: 'DELETE_QA'
  payload: { id: string }
}

export interface DeleteQaResponse {
  type: 'DELETE_QA_RESPONSE'
  payload: { success: boolean; error?: string }
}

/** 清空问答记忆(PM6a:qa+replies;金标准/知识库/文件夹保留) */
export interface ClearMemoryDataRequest {
  type: 'CLEAR_MEMORY_DATA'
}

export interface ClearMemoryDataResponse {
  type: 'CLEAR_MEMORY_DATA_RESPONSE'
  payload: { success: boolean; deletedQa: number; error?: string }
}

// ─── 金标准 / 文件夹 ──────────────────────────────────────────────────────────

export interface PanelFolder {
  id: string
  parentId: string | null
  name: string
  position: number
}

export interface PanelGolden {
  id: string
  folderId: string | null
  question: string
  answer: string
  hasEmbedding: number
  updatedAt: number
}

/** 知识库条目面板线类型(剥向量) */
export interface PanelKnowledge {
  id: string
  title: string
  content: string
  hasEmbedding: number
  enabled: number
  /** manual=手工;doc=md 文档分块(只读) */
  source?: 'manual' | 'doc'
  updatedAt: number
}

export interface GetPanelDataRequest {
  type: 'GET_PANEL_DATA'
}

export interface GetPanelDataResponse {
  type: 'GET_PANEL_DATA_RESPONSE'
  payload: {
    folders: PanelFolder[]
    goldens: PanelGolden[]
    knowledge: PanelKnowledge[]
    /** 升级前上传、无原文可重切的文档名(知识库页提示重新上传;缺省=无) */
    legacyDocs?: string[]
    error?: string
  }
}

/** 编辑保存即重嵌(问题实质变更时);folderId 兼作"迁移文件夹" */
export interface UpdateGoldenRequest {
  type: 'UPDATE_GOLDEN'
  payload: {
    id: string
    question?: string
    answer?: string
    folderId?: string | null
  }
}

export interface UpdateGoldenResponse {
  type: 'UPDATE_GOLDEN_RESPONSE'
  payload: { id?: string; reembed?: boolean; error?: string }
}

export interface DeleteGoldenRequest {
  type: 'DELETE_GOLDEN'
  payload: { id: string }
}

export interface DeleteGoldenResponse {
  type: 'DELETE_GOLDEN_RESPONSE'
  payload: { success: boolean; error?: string }
}

export interface CreateFolderRequest {
  type: 'CREATE_FOLDER'
  payload: { name: string; parentId: string | null }
}

export interface CreateFolderResponse {
  type: 'CREATE_FOLDER_RESPONSE'
  payload: { id?: string; error?: string }
}

export interface RenameFolderRequest {
  type: 'RENAME_FOLDER'
  payload: { id: string; name: string }
}

export interface RenameFolderResponse {
  type: 'RENAME_FOLDER_RESPONSE'
  payload: { success: boolean; error?: string }
}

export interface DeleteFolderRequest {
  type: 'DELETE_FOLDER'
  payload: { id: string }
}

export interface DeleteFolderResponse {
  type: 'DELETE_FOLDER_RESPONSE'
  payload: { success: boolean; error?: string }
}

/** 遗留子文件夹一键拍平(PM7):金标准上移父夹,删除子夹 */
export interface FlattenFoldersRequest {
  type: 'FLATTEN_FOLDERS'
}

export interface FlattenFoldersResponse {
  type: 'FLATTEN_FOLDERS_RESPONSE'
  payload: { success: boolean; flattened: number; error?: string }
}
