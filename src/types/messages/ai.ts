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
}
