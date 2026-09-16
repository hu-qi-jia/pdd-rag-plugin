// ─── 检索与候选消息(content UI → SW,P2)───────────────────────────────────────
// query = 买家问题(合并全文);SW 混合检索后返回折叠排序的候选。

// ─── GET_SUGGESTIONS:候选查询 ────────────────────────────────────────────────

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

// ─── ADD_GOLDEN:弹窗"设为标准回答"(P2 最小版)────────────────────────────────
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
