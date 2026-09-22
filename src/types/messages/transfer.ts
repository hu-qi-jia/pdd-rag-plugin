// ─── 导入导出消息(popup → SW,P3,v2)─────────────────────────────────────────
// 信封结构与幂等合并计划见 background/transferPlan.ts(线上类型在 types/transfer)。

import type { ExportEnvelope } from '../transfer'

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
    /** 知识库文档原文(v0.16):导入原文后,分块器版本不符时会自动重切 */
    addedKbDocs?: number
    skippedKbDocs?: number
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
