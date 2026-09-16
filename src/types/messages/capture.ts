// ─── 捕获链路消息(content 桥 → SW,P1)────────────────────────────────────────
// 页面内采集到的会话事件批量上报;SW 侧做 msgId 幂等 + 分段状态机落盘。

import type { PddRole } from '../memory'

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
