/**
 * AI 整合编排(P4 AI 整合):门禁 → 取材料 → 流式生成 → 转发给面板。
 *
 * 门禁先于一切 IO:开关关闭、未配 API、「自动选择首条」开启、本轮无知识库候选 ——
 * 四条任一不成立就直接返回,**一次 fetch 都不发**。这是 ADR-0006 里那条
 * 「不开启则扩展保持完全本地」的落点。
 *
 * 与 llm.ts 的分工:这里管"该不该发、发什么",llm.ts 只管"怎么发"。
 */
import { loadSettings } from './settings'
import { collectMaterials, collectSizeTableMaterials } from './aiMaterials'
import { NO_ANSWER_SENTINEL, integrateReply, isLlmConfigured, llmConfigFromSettings } from './llm'
import type { PddSettings } from '../types/memory'
import { AI_PORT_NAME, type AiIntegrateRequest, type AiPortEvent } from '../types/messages/ai'

/** 面板整合行的渲染门禁(与 handleAiIntegrate 的前三条门禁同源,不可分叉) */
export function aiRowAvailable(s: PddSettings, hasKnowledgeCandidate: boolean): boolean {
  // 「自动选择首条」开 → 走直接填充,不弹面板,也就没有整合行
  if (!s.aiIntegrateEnabled || s.directFillEnabled) return false
  if (!isLlmConfigured(llmConfigFromSettings(s))) return false
  return hasKnowledgeCandidate
}

/**
 * 尺码生成行的渲染门禁(spec §8.1 前提)——**与知识库整合行同一套外发闸门**,不新增开关:
 *   ① `aiIntegrateEnabled`(ADR-0006 的总开关)
 *   ② 已配 LLM
 *   ③ 非「自动选择首条」(那条路径不弹面板、不调 LLM)
 * 外加 §8.1 的前提 1:**至少一篇被标记的尺码表** —— 没有材料,发出去也无意义。
 *
 * 与 aiRowAvailable 的差别只在"候选"的含义:那边是本轮知识库候选,这边是尺码表文档。
 */
export function sizeRowAvailable(s: PddSettings, hasSizeTableDoc: boolean): boolean {
  if (!s.aiIntegrateEnabled || s.directFillEnabled) return false
  if (!isLlmConfigured(llmConfigFromSettings(s))) return false
  return hasSizeTableDoc
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

  // 材料来源按 payload.source 分叉:缺省('knowledge')即今天的语义 —— 本轮面板展示的
  // 知识库候选;'size' 取尺码表整篇原文。门禁、哨兵缓冲、流式、失败归一**全部复用**。
  const materials =
    payload.source === 'size'
      ? await collectSizeTableMaterials()
      : await collectMaterials(payload.knowledgeIds ?? [])
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
    // 材料来源同时决定提示词:尺码路由必须直接给码,不能套用知识库的保守口径
    source: payload.source ?? 'knowledge',
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
    if (port.name !== AI_PORT_NAME) return
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
