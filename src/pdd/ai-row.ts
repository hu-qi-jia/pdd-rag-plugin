/**
 * 「根据知识库内容整合并回复」这一行的纯逻辑(面板状态机 + 文案 + 插入位)。
 * 从 pdd-ai-button.ts 抽出来:那段是原生 DOM 操作,没法在 jsdom 里可靠断言状态流转,
 * 而状态流转恰恰是最容易写错的部分。
 */
import { AI_ERROR_TEXT, type AiPortEvent } from '../types/messages/ai'
import type { Suggestion } from '../types/messages'

export type AiRowState =
  /** 尚未点击 */
  | { phase: 'idle' }
  /** 已发出请求,还没收到首个增量 */
  | { phase: 'working' }
  /** 正在流式产出草稿 */
  | { phase: 'streaming'; draft: string }
  /** 生成完成,已填入输入框 */
  | { phase: 'done'; text: string }
  /** 模型判定资料不足以回答 */
  | { phase: 'noanswer' }
  /** 失败,可重试 */
  | { phase: 'error'; error: string }

/** 请求发出后多久才显示"正在整合" —— 更短的等待走完就不闪这一下 */
export const AI_LOADING_DELAY_MS = 200

/** 行内主文案。loadingVisible=false 时不宣称"正在整合"(请求可能已经回来了) */
export function aiRowLabel(state: AiRowState, loadingVisible = true): string {
  switch (state.phase) {
    case 'idle':
      return '根据知识库内容整合并回复'
    case 'working':
      return loadingVisible ? '正在整合知识库…' : '根据知识库内容整合并回复'
    case 'streaming':
      return '正在整合知识库…'
    case 'done':
      return '✓ 已填入输入框'
    case 'noanswer':
      return '知识库内容不足以回答'
    case 'error':
      return AI_ERROR_TEXT[state.error] ?? '整合失败,请检查 API 配置'
  }
}

/** 流式草稿:只有这两个阶段有内容可展示 */
export function aiRowDraft(state: AiRowState): string {
  if (state.phase === 'streaming') return state.draft
  if (state.phase === 'done') return state.text
  return ''
}

/** 是否展示重试入口 */
export function aiRowRetryable(state: AiRowState): boolean {
  return state.phase === 'error' || state.phase === 'done'
}

/** 重试按钮文案:失败叫重试,已成功叫重新生成 */
export function aiRowRetryLabel(state: AiRowState): string {
  return state.phase === 'done' ? '重新生成' : '重试'
}

/** 请求是否还在途(决定点击是否被吞掉、是否要清定时器) */
export function aiRowBusy(state: AiRowState): boolean {
  return state.phase === 'working' || state.phase === 'streaming'
}

/** 状态机:收到一个 Port 事件后的新状态 */
export function reduceAiRow(state: AiRowState, event: AiPortEvent): AiRowState {
  switch (event.type) {
    case 'DELTA': {
      const prev = state.phase === 'streaming' ? state.draft : ''
      return { phase: 'streaming', draft: prev + event.payload.text }
    }
    case 'DONE':
      return { phase: 'done', text: event.payload.text }
    case 'NO_ANSWER':
      return { phase: 'noanswer' }
    case 'ERROR':
      return { phase: 'error', error: event.payload.error }
    default:
      return state
  }
}

/**
 * 整合行的插入位 = 首个知识库候选的下标;没有知识库候选时返回 -1(不渲染该行)。
 * 返回的是"插入到 items 的哪个下标之前",故等于首个知识库候选的下标。
 */
export function aiRowInsertIndex(items: Pick<Suggestion, 'kind'>[]): number {
  return items.findIndex((s) => s.kind === 'knowledge')
}
