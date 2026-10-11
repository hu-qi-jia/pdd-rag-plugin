// ─── 运行时消息集 · 问题自动分类(补存量)─────────────────────────────────────
//
// 补分类的后台状态 DTO **在这里声明**,不从 `background/` import:types/messages 是共享
// 类型层,依赖方向只能是 background → types。`runBackfill` 返回的 `BackfillProgress`
// 在 background 里、同样不能从这里引用 —— 依赖方向反了会成环。所以 DTO 自带形状,
// `background/backfillState.ts` 反过来 import 它。

/**
 * 补分类的后台状态(面板轮询 GET_BACKFILL_STATE 读回)。
 *
 * 用轮询而不是长连接:补分类跑在 SW 里,弹窗关掉连接就没了 —— 后台留一份状态、
 * 面板按需读,关/开弹窗都能如实反映,也不用管端口生命周期。
 */
export interface BackfillStatus {
  phase: 'idle' | 'running' | 'done'
  /** 待办条数(快照长度);manual 记录在快照阶段就被排除,不计入 */
  total: number
  done: number
  ok: number
  failed: number
  /** 跑的过程中被保留期清掉、写不回去的条数(不是 manual) */
  skipped: number
  /** 上一次的失败原因(门禁未过 / 运行期异常);无则为 undefined */
  error?: string
  /** 本次是被中断结束的 */
  stopped?: boolean
}

/**
 * 待办条数(设置页按钮文案就是它)—— 与快照同一个口径。
 * 分「历史问答 / 标准回答」两档:文案要分别写出两个数字,不能只给一个总数。
 */
export interface BackfillPending {
  history: number
  golden: number
}

export interface GetBackfillStateRequest {
  type: 'GET_BACKFILL_STATE'
}
export interface GetBackfillStateResponse {
  type: 'GET_BACKFILL_STATE_RESPONSE'
  payload: { status: BackfillStatus; pending: BackfillPending }
}

export interface StartBackfillRequest {
  type: 'START_BACKFILL'
}
export interface StartBackfillResponse {
  type: 'START_BACKFILL_RESPONSE'
  payload: { started: boolean; error?: string }
}

/** 中断:已跑完的条目结果保留,`runBackfill` 的 worker 会在下一轮循环顶部退出 */
export interface StopBackfillRequest {
  type: 'STOP_BACKFILL'
}
export interface StopBackfillResponse {
  type: 'STOP_BACKFILL_RESPONSE'
  payload: { stopping: boolean }
}
