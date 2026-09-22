// ─── 使用统计消息(content/popup → SW,v0.16)────────────────────────────────────
// 为什么 content 要专门上报:候选填充与面板打开都在**页面里当场完成**
// (fillInput 直接写官方输入框,不经 SW),SW 没有别的途径知道发生过 ——
// 这不是"再多存一份",是同一件事只能由当事方记账。
//
// 读侧不单开消息:计数快照随 GET_STATS 一起回(见 system.ts 的 metrics 字段),
// 弹窗打开本来就取一次统计,不必为此多跑一趟。

import type { MetricEventKey, MetricItemKind } from '../../shared/metrics'

/** 上报一次使用事件。键按**白名单**收(MetricEventKey),后台不接受任意字符串。 */
export interface TrackEventRequest {
  type: 'TRACK_EVENT'
  payload: {
    event: MetricEventKey
    /**
     * 逐条用量锚(可选):金标准/知识库候选被填充时带上来源 id,
     * 后台据此额外记一条 `item.<类别>:<id>` —— 面板里"哪条话术真被用过"。
     * 历史候选不带:问答记录 90 天就没了,给它计数只会攒下孤儿键。
     */
    itemKind?: MetricItemKind
    itemId?: string
  }
}

export interface TrackEventResponse {
  type: 'TRACK_EVENT_RESPONSE'
  payload: { success: boolean; error?: string }
}

/** 清空全部统计(设置页「重置统计」;不动任何业务数据) */
export interface ClearMetricsRequest {
  type: 'CLEAR_METRICS'
}

export interface ClearMetricsResponse {
  type: 'CLEAR_METRICS_RESPONSE'
  payload: { success: boolean; cleared: number; error?: string }
}
