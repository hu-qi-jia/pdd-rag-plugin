// ─── 系统诊断消息(P0 底座):自检 / 统计 ────────────────────────────────────────

import type { PddSettings } from '../memory'

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
    /** 读取失败兜底时的错误说明(成功路径无) */
    error?: string
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
