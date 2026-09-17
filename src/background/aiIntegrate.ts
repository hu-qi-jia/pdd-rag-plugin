/**
 * AI 整合编排(P4 AI 整合):门禁 → 取材料 → 流式生成 → 转发给面板。
 *
 * 门禁先于一切 IO:开关关闭、未配 API、「自动回复」开启、本轮无知识库候选 ——
 * 四条任一不成立就直接返回,**一次 fetch 都不发**。这是 ADR-0006 里那条
 * 「不开启则扩展保持完全本地」的落点。
 *
 * 与 llm.ts 的分工:这里管"该不该发、发什么",llm.ts 只管"怎么发"。
 */
import { loadSettings } from './settings'
import { collectMaterials } from './aiMaterials'
import { NO_ANSWER_SENTINEL, integrateReply, isLlmConfigured, llmConfigFromSettings } from './llm'
import type { PddSettings } from '../types/memory'
import type { AiIntegrateRequest, AiPortEvent } from '../types/messages/ai'

/** 面板整合行的渲染门禁(与 handleAiIntegrate 的前三条门禁同源,不可分叉) */
export function aiRowAvailable(s: PddSettings, hasKnowledgeCandidate: boolean): boolean {
  // 「自动回复」开 → 走直接填充,不弹面板,也就没有整合行
  if (!s.aiIntegrateEnabled || s.directFillEnabled) return false
  if (!isLlmConfigured(llmConfigFromSettings(s))) return false
  return hasKnowledgeCandidate
}

export async function handleAiIntegrate(
  payload: AiIntegrateRequest['payload'],
  emit: (e: AiPortEvent) => void,
): Promise<void> {
  const settings = await loadSettings()
  if (!settings.aiIntegrateEnabled || settings.directFillEnabled) {
    emit({ type: 'ERROR', payload: { error: 'disabled' } })
    return
  }
  const config = llmConfigFromSettings(settings)
  if (!isLlmConfigured(config)) {
    emit({ type: 'ERROR', payload: { error: 'unconfigured' } })
    return
  }

  const materials = await collectMaterials(payload.knowledgeIds ?? [])
  if (materials.length === 0) {
    emit({ type: 'ERROR', payload: { error: 'no material' } })
    return
  }

  // 哨兵是流式吐出来的,不能等生成完才发现 —— 否则面板会先把「[无法回答]」
  // 当草稿渲染出来、再整行抹掉。前几个字符先扣住:一旦确定不是哨兵前缀就放行。
  let acc = ''
  let released = false
  const forward = (piece: string): void => {
    acc += piece
    if (released) {
      emit({ type: 'DELTA', payload: { text: piece } })
      return
    }
    const t = acc.trimStart()
    if (t.length <= NO_ANSWER_SENTINEL.length && NO_ANSWER_SENTINEL.startsWith(t)) return
    released = true
    emit({ type: 'DELTA', payload: { text: acc } })
  }

  const r = await integrateReply({
    query: payload.query,
    materials,
    config,
    onDelta: forward,
  })

  if (!r.ok) {
    emit({ type: 'ERROR', payload: { error: r.error } })
    return
  }
  // 哨兵是"资料不足以回答"的约定信号,不是可以发出去的回复
  if (r.text === NO_ANSWER_SENTINEL) {
    emit({ type: 'NO_ANSWER' })
    return
  }
  emit({ type: 'DONE', payload: { text: r.text } })
}

/** 挂 Port 长连接:一个端口一次整合,终态后由 content 侧关闭 */
export function registerAiPort(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'pddcs:ai') return
    port.onMessage.addListener((raw: unknown) => {
      const msg = raw as AiIntegrateRequest | undefined
      if (msg?.type !== 'AI_INTEGRATE') return
      void handleAiIntegrate(msg.payload, (e) => {
        try {
          port.postMessage(e)
        } catch {
          /* 面板已关闭:丢弃即可 */
        }
      }).catch((err) => console.error('[PDD CS] ai integrate failed:', err))
    })
  })
}
