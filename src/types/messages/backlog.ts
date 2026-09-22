// ─── 待沉淀清单(v0.16,popup → SW)─────────────────────────────────────────────
// 回答的问题:哪些问题被反复问到,却始终没有沉淀成标准回答?
// 历史记录按 90 天保留期自然衰退,同一件事问得越多、越说明它值得固化 ——
// 这个页签就是把那批"问过多遍但还没定稿"的问题挑出来,一键提升为标准回答。
// 聚合口径见 background/backlogPlan.ts(纯函数,含单测)。

/** 待沉淀条目下的一条历史回复(提升为标准回答时的答案来源) */
export interface BacklogReply {
  /** 回复 id(提升时作为 sourceReplyId 溯源) */
  id: string
  /** 回复所属问答记录 id(提升时作为 sourceRecordId) */
  qaId: string
  text: string
  ts: number
}

/** 待沉淀条目:同一问题被问过多次、却还没有标准回答 */
export interface BacklogItem {
  /**
   * 分组键 = 问题归一化哈希。**精确归一化匹配**(折叠空白与大小写),
   * 「能不能退货」和「可以退货吗」算两条 —— 语义合并留待后续版本,
   * 页面上如实写明口径,而不是假装合并了。
   */
  questionHash: string
  /** 代表问题原文(该组最近一次出现的问法) */
  question: string
  /** 出现次数 */
  count: number
  /** 最近一次出现时间 */
  lastTs: number
  /** 该问题下出现过的回复(按内容去重,最近优先,至多 BACKLOG_REPLIES_PER_ITEM 条) */
  replies: BacklogReply[]
}

export interface GetBacklogRequest {
  type: 'GET_BACKLOG'
}

export interface GetBacklogResponse {
  type: 'GET_BACKLOG_RESPONSE'
  payload: {
    /** 待沉淀问题,按出现次数倒序(至多 BACKLOG_LIMIT 条) */
    items: BacklogItem[]
    /** 待沉淀问题总数(截断前)—— 页脚据此写"共 N 条,已显示前 50 条" */
    total: number
    error?: string
  }
}

/** 「不再提示」:把某个问题从清单里划掉(按问题哈希,与 qaRecords 同口径) */
export interface IgnoreBacklogRequest {
  type: 'IGNORE_BACKLOG'
  payload: { questionHash: string; question: string }
}

export interface IgnoreBacklogResponse {
  type: 'IGNORE_BACKLOG_RESPONSE'
  payload: { success: boolean; error?: string }
}
