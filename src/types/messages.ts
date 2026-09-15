// ─── 运行时消息集 ──────────────────────────────────────────────────────────────
// P0 只保留底座所需(自检/统计);P1 捕获、P2 检索、P3 金标准 CRUD 消息随阶段扩展。

import type { PddRole, PddSettings } from './memory'
import type { ExportEnvelope } from '../background/transferPlan'

// ─── PING_EMBED:嵌入链路自检(popup → SW)───────────────────────────────────────
// SW 经 offscreen 嵌入一段样本文本,返回模型名与向量维度 —— P0 验收用。

export interface PingEmbedRequest {
  type: 'PING_EMBED'
}

export interface PingEmbedResponse {
  type: 'PING_EMBED_RESPONSE'
  payload: {
    success: boolean
    model?: string
    dimensions?: number
    elapsedMs?: number
    error?: string
  }
}

// ─── GET_STATS:库统计(popup → SW)───────────────────────────────────────────────

export interface GetStatsRequest {
  type: 'GET_STATS'
}

export interface GetStatsResponse {
  type: 'GET_STATS_RESPONSE'
  payload: {
    qaCount: number
    replyCount: number
    goldenCount: number
    folderCount: number
    knowledgeCount: number
    settings: PddSettings
    embeddingModel: string
  }
}

// ─── SELF_TEST_WRITE:写入/清除自检示例问答(popup → SW)──────────────────────────
// write: 落一条完整 qaRecords+replies(带真实嵌入回填)用于 P0 入库验证;
// clean:  按 SELF_TEST_SESSION_KEY 一键清除。

export interface SelfTestWriteRequest {
  type: 'SELF_TEST_WRITE'
  payload: { action: 'write' | 'clean' }
}

export interface SelfTestWriteResponse {
  type: 'SELF_TEST_WRITE_RESPONSE'
  payload: {
    success: boolean
    qaId?: string
    deletedCount?: number
    error?: string
  }
}

// ─── PDD_INGEST:捕获链路(content 桥 → SW)─────────────────────────────────────
// 页面内采集到的会话事件批量上报;SW 侧做 msgId 幂等 + 分段状态机落盘。

/** 单条捕获消息(网络层解析产物或 DOM 兜底) */
export interface PddCapturedMsg {
  /** 会话标识;DOM 兜底消息可能缺失,由 SW 按来源 tab 回填 */
  sessionKey?: string
  source: 'net' | 'dom'
  role: PddRole
  text: string
  /** 平台消息幂等键(网络层 msg_id) */
  msgId?: string
  /** 平台时间(毫秒);缺失由接收端补 now */
  ts?: number
  buyerIdTail?: string
}

/**
 * 捕获事件:
 *  - msg    新消息(买家或客服文本)
 *  - active 会话激活(可选:回填流开始 / 会话切换提示)
 *  - idle   该会话超过 3 分钟无动静(页面侧定时器触发,兜底无回复问题落盘)
 *  - leave  会话失活/页面卸载(关闭未结问题段)
 */
export interface PddCapturedEvent {
  kind: 'msg' | 'active' | 'idle' | 'leave'
  sessionKey?: string
  buyerIdTail?: string
  msg?: PddCapturedMsg
}

export interface PddIngestRequest {
  type: 'PDD_INGEST'
  payload: { events: PddCapturedEvent[] }
}

export interface PddIngestResponse {
  type: 'PDD_INGEST_RESPONSE'
  payload: { queued: number; skipped: number; error?: string; detail?: string }
}

// ─── GET_SUGGESTIONS:候选查询(content UI → SW,P2)─────────────────────────────
// query = 买家问题(合并全文);SW 混合检索后返回折叠排序的候选。

/** 检索候选(弹窗/直填消费);来源 kind 决定徽标与直填优先级 */
export interface Suggestion {
  kind: 'golden' | 'knowledge' | 'history'
  /** 回复正文(填充/复制的内容) */
  text: string
  /** 来源问题的原始全文(UI 截断展示) */
  sourceQuestion: string
  /** 展示得分 = 来源问题的原始余弦(0~1) */
  score: number
  sourceId: string
  /** history 命中的具体回复 id(设为金标准溯源用) */
  replyId?: string
  /** 折叠前同内容候选数(≥2 显示"同内容×n") */
  foldCount?: number
}

export interface GetSuggestionsRequest {
  type: 'GET_SUGGESTIONS'
  payload: { query: string }
}

/** UI 状态机所需设置快照(随响应回传,免 content 直读 storage) */
export interface UiSettings {
  directFillEnabled: boolean
  goldenPriorityEnabled: boolean
}

export interface GetSuggestionsResponse {
  type: 'GET_SUGGESTIONS_RESPONSE'
  payload: { suggestions: Suggestion[]; settings?: UiSettings; error?: string }
}

// ─── ADD_GOLDEN:弹窗"设为标准回答"(content UI → SW,P2 最小版)─────────────────
// 同一问题可有 **多条** 标准回答(一个问题的问法常对应多种合格话术),上限
// MAX_GOLDENS_PER_QUESTION(见 background/goldens.ts);幂等粒度 = 问题 + 答案:
//  - exists       同问题 + 同答案已存在 → 不重复建
//  - limitReached 该问题标准回答已达上限 → 提示先取消一条
export interface AddGoldenRequest {
  type: 'ADD_GOLDEN'
  payload: {
    question: string
    answer: string
    sourceRecordId?: string
    sourceReplyId?: string
  }
}

export interface AddGoldenResponse {
  type: 'ADD_GOLDEN_RESPONSE'
  payload: {
    id?: string
    exists?: boolean
    limitReached?: boolean
    /** 该问题当前标准回答条数(新建后;UI 展示 n/上限 用) */
    count?: number
    error?: string
  }
}

// ─── P3 面板:记忆列表(popup → SW)────────────────────────────────────────────

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
}

export interface GetMemoryListResponse {
  type: 'GET_MEMORY_LIST_RESPONSE'
  payload: { items: MemoryListItem[]; error?: string }
}

export interface DeleteQaRequest {
  type: 'DELETE_QA'
  payload: { id: string }
}

export interface DeleteQaResponse {
  type: 'DELETE_QA_RESPONSE'
  payload: { success: boolean; error?: string }
}

// ─── P3 面板:金标准 / 文件夹(popup → SW)────────────────────────────────────
// 面板线类型:剥离向量字段,减小消息体积(向量只活在 SW/IndexedDB 内)。

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
  payload: { folders: PanelFolder[]; goldens: PanelGolden[]; knowledge: PanelKnowledge[]; error?: string }
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

// ─── P4-KB 知识库 CRUD(popup → SW)───────────────────────────────────────────
// 幂等:标题归一化 hash 已存在则不重复建,返回 exists;
// 标题实质变更才重嵌;enabled 停用切换不重嵌。

export interface CreateKbRequest {
  type: 'CREATE_KB'
  payload: { title: string; content: string }
}

export interface CreateKbResponse {
  type: 'CREATE_KB_RESPONSE'
  payload: { id?: string; exists?: boolean; error?: string }
}

export interface UpdateKbRequest {
  type: 'UPDATE_KB'
  payload: { id: string; title?: string; content?: string; enabled?: number }
}

export interface UpdateKbResponse {
  type: 'UPDATE_KB_RESPONSE'
  payload: { id?: string; reembed?: boolean; error?: string }
}

export interface DeleteKbRequest {
  type: 'DELETE_KB'
  payload: { id: string }
}

export interface DeleteKbResponse {
  type: 'DELETE_KB_RESPONSE'
  payload: { success: boolean; error?: string }
}

// ─── P4-KB 文档上传(popup → SW)───────────────────────────────────────────────
// md 文本按原项目 chunkText(500 字/75 重叠)分块,每块一条知识条目,
// 锚向量=块正文;同名文档(docId)重复上传整篇替换。

export interface UploadKbDocRequest {
  type: 'UPLOAD_KB_DOC'
  payload: { name: string; content: string }
}

export interface UploadKbDocResponse {
  type: 'UPLOAD_KB_DOC_RESPONSE'
  payload: { docId?: string; chunkCount?: number; replaced?: boolean; error?: string }
}

// ─── P3 设置(popup → SW)───────────────────────────────────────────────────────

export interface UpdateSettingsRequest {
  type: 'UPDATE_SETTINGS'
  payload: Partial<PddSettings>
}

export interface UpdateSettingsResponse {
  type: 'UPDATE_SETTINGS_RESPONSE'
  payload: { settings?: PddSettings; error?: string }
}

// ─── P3 导入导出 v2(popup → SW)───────────────────────────────────────────────
// 信封结构与幂等合并计划见 background/transferPlan.ts。

export interface ExportDataRequest {
  type: 'EXPORT_DATA'
  payload: { includeMemory: boolean }
}

export interface ExportDataResponse {
  type: 'EXPORT_DATA_RESPONSE'
  payload: { envelope?: ExportEnvelope; error?: string }
}

export interface ImportDataResponse {
  type: 'IMPORT_DATA_RESPONSE'
  payload: {
    addedGoldens?: number
    skippedGoldens?: number
    /** 因目标问题已达上限而未导入的标准回答条数 */
    limitedGoldens?: number
    addedFolders?: number
    skippedFolders?: number
    addedKnowledge?: number
    skippedKnowledge?: number
    addedQa?: number
    skippedQa?: number
    addedReplies?: number
    skippedReplies?: number
    error?: string
  }
}

export interface ImportDataRequest {
  type: 'IMPORT_DATA'
  payload: { envelope: unknown }
}

// ─── P3 填充当前输入框(popup → SW → content)────────────────────────────────
// 金标准卡"填充"按钮:SW 找到聊天页 tab 经 tabs.sendMessage 转发到 content。

export interface FillInputRequest {
  type: 'FILL_INPUT'
  payload: { text: string }
}

export interface FillInputResponse {
  type: 'FILL_INPUT_RESPONSE'
  payload: { success: boolean; error?: string }
}

/** SW → content(不经 ExtensionMessage 并集,走 tabs.sendMessage) */
export interface ContentFillMessage {
  type: 'PDD_FILL_INPUT'
  payload: { text: string }
}

export interface ContentFillResponse {
  type: 'PDD_FILL_INPUT_RESPONSE'
  payload: { success: boolean; error?: string }
}

// ─── 并集 ──────────────────────────────────────────────────────────────────────

export type ExtensionMessage =
  | PingEmbedRequest
  | GetStatsRequest
  | SelfTestWriteRequest
  | PddIngestRequest
  | GetSuggestionsRequest
  | AddGoldenRequest
  | GetMemoryListRequest
  | DeleteQaRequest
  | GetPanelDataRequest
  | UpdateGoldenRequest
  | DeleteGoldenRequest
  | CreateFolderRequest
  | RenameFolderRequest
  | DeleteFolderRequest
  | CreateKbRequest
  | UpdateKbRequest
  | DeleteKbRequest
  | UploadKbDocRequest
  | UpdateSettingsRequest
  | ExportDataRequest
  | ImportDataRequest
  | FillInputRequest

export type ExtensionMessageResponse =
  | PingEmbedResponse
  | GetStatsResponse
  | SelfTestWriteResponse
  | PddIngestResponse
  | GetSuggestionsResponse
  | AddGoldenResponse
  | GetMemoryListResponse
  | DeleteQaResponse
  | GetPanelDataResponse
  | UpdateGoldenResponse
  | DeleteGoldenResponse
  | CreateFolderResponse
  | RenameFolderResponse
  | DeleteFolderResponse
  | CreateKbResponse
  | UpdateKbResponse
  | DeleteKbResponse
  | UploadKbDocResponse
  | UpdateSettingsResponse
  | ExportDataResponse
  | ImportDataResponse
  | FillInputResponse
