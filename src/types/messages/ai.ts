// ─── AI 整合 · Port 长连接协议(P4 AI 整合)────────────────────────────────────
// 不走 onMessage 一问一答:整合是流式的,SW 要在生成过程中持续把增量推回 content。
// content 打开 `pddcs:ai` 端口 → 发一次 AI_INTEGRATE → 收 DELTA* → 收终态一条。
//
// 数据边界(ADR-0006):knowledgeIds 由 content 传入,只能是本轮面板已展示的知识库
// 候选 —— 「所见即所发」,不发任何界面上没出现过的东西。

export const AI_PORT_NAME = 'pddcs:ai'

export interface AiIntegrateRequest {
  type: 'AI_INTEGRATE'
  payload: {
    /** 本轮买家问题(合并后的全文) */
    query: string
    /** 本轮面板展示的知识库候选 id,按展示顺序 */
    knowledgeIds: string[]
  }
}

export type AiPortRequest = AiIntegrateRequest

export type AiPortEvent =
  /** 增量文本(逐句渲染草稿用) */
  | { type: 'DELTA'; payload: { text: string } }
  /** 生成完成;调用方据此直接填入输入框 */
  | { type: 'DONE'; payload: { text: string } }
  /** 模型判定资料不足以回答 → 不填充,面板给提示 */
  | { type: 'NO_ANSWER' }
  /** 失败;error 是稳定的短标签,不是给用户看的文案 */
  | { type: 'ERROR'; payload: { error: string } }

/** 失败标签 → 面板文案(集中一处,免得两端各写一份) */
export const AI_ERROR_TEXT: Record<string, string> = {
  disabled: 'AI 整合未开启',
  unconfigured: '请先在设置中配置 LLM API',
  'no material': '本轮没有可用的知识库内容',
  timeout: '整合超时,请检查 API 配置',
  empty: '整合结果为空,请重试',
  network: '整合失败,请检查 API 配置',
  // llm.ts 在响应没有 body 时现拼的标签(2026-09-17 审查:此前落到兜底,
  // 用户看到的和"网络挂了"是同一句,丢掉了可行动的信息)
  'no body': '接口没有返回内容,请检查接口地址',
}

/** `http <status>`:4xx 是这次请求本身的问题(地址/密钥),5xx 是对方服务的问题 —— 兜底话术分开 */
const HTTP_4XX = /^http 4\d\d$/
const HTTP_5XX = /^http 5\d\d$/

/**
 * 失败标签 → 面板文案。查表优先,再按前缀判 http 状态 ——
 * `http 401` 这类标签是 llm.ts 运行时现拼的,没法进静态表。
 */
export function aiErrorText(error: string): string {
  const exact = AI_ERROR_TEXT[error]
  if (exact) return exact
  if (HTTP_4XX.test(error)) return '接口拒绝了这次请求,请检查接口地址与密钥'
  if (HTTP_5XX.test(error)) return '接口返回服务端错误,请稍后再试'
  return '整合失败,请检查 API 配置'
}
