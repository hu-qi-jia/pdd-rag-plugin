/**
 * LLM 整合调用层(P4 AI 整合)。
 *
 * 数据边界(ADR-0006):只有在本模块被显式调用时才出网,且外发内容仅限
 * 「本轮面板展示的知识库候选文本 + 当前买家问题」。历史回答与标准回答永不外发。
 *
 * 只走 OpenAI 兼容的 /chat/completions + SSE 流式:流式把首字延迟(TTFT)暴露出来,
 * 面板能边收边渲染,感知等待远短于等整段生成。
 * **不发送任何 reasoning / thinking 参数** —— 用户明确要求不做深度思考,
 * 思考型模型的首字延迟会让"整合"这件事失去意义。
 */
import type { PddSettings } from '../types/memory'

/** 资料不足以回答时模型只输出这个哨兵;调用方据此不填充输入框 */
export const NO_ANSWER_SENTINEL = '[无法回答]'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

export type LlmResult = { ok: true; text: string } | { ok: false; error: string }

export function isLlmConfigured(c: Pick<LlmConfig, 'baseUrl' | 'apiKey' | 'model'>): boolean {
  return !!c.baseUrl.trim() && !!c.apiKey.trim() && !!c.model.trim()
}

/** 从设置取 LLM 配置(字段名不同,集中在这里,免得散落各处) */
export function llmConfigFromSettings(s: PddSettings): LlmConfig {
  return {
    baseUrl: s.llmBaseUrl,
    apiKey: s.llmApiKey,
    model: s.llmModel,
    timeoutMs: s.llmTimeoutMs,
  }
}

/**
 * 系统提示词 —— 以客服身份写。三条硬约束:
 *  1. 只用给定资料,资料没写的一律不说(客服说错话是要赔钱的);
 *  2. 只输出正文,不带任何 markdown —— 这段话会被原样填进聊天输入框;
 *  3. 数字与型号逐字照抄,限制条件必须一并说出(不能只讲好的一面)。
 */
const SYSTEM_PROMPT = `你是拼多多店铺的资深客服,正在给买家回消息。你写的这段话会被直接复制发出去,所以要像真人客服在打字,而不是像机器在答题。

【只用资料,不外推】
只依据下面【知识库资料】里的内容作答。资料没写到的,一律不说 —— 不编造、不猜测、不补充、不引用常识或行业惯例、不替店铺做资料之外的承诺(尤其是退换、赔付、时效、保修范围)。资料不足以回答买家的问题时,只输出这五个字:${NO_ANSWER_SENTINEL}

【怎么写】
1. 只输出回复正文本身。不要开场白(如"好的""收到""根据资料"),不要复述买家的问题,不要解释你的思路,不要加任何 markdown 标记(如 #、*、-、\`)、标题或编号列表 —— 这段话会原样进入聊天输入框。
2. 语气自然、礼貌、口语化,像真人客服在打字;不要官方腔,不要客套话堆砌。
3. 简短优先:一两句能说清就不展开,总长控制在 150 字以内。买家一次问了多个点时才逐点说,用「;」或「、」分隔,不用列表符号。
4. 数字、单位、型号、专有名词必须与资料逐字一致,照抄不改:不换算、不四舍五入、不写"约"、不换同义词(例如资料写「11.5 小时」就不能写成「11 个多小时」,写「USB-C」就不能写成「type-c」,写「Osmo Pocket 3」就不能改成别的叫法)。
5. 资料里的限制条件、例外、注意事项必须一并说出来,不能只挑对买家有利的那半句(例如「不防水」「穿墙会缩短」「进水不在保修范围」这类,出现就要带上)。
6. 资料可能来自多篇文档、彼此不连贯,也可能夹着不相关的内容。只取与买家问题相关的部分,拼成一段通顺、完整的话;不要把不相关的内容也写进去。
7. 资料之间若有冲突,以更具体、更明确的那条为准;判断不了就用更保守的说法(对买家不做额外承诺)。`

export function buildMessages(query: string, materials: string[]): ChatMessage[] {
  const list = materials
    .map((m, i) => `(${i + 1}) ${m}`)
    .join('\n\n')
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `【知识库资料】\n${list}\n\n【买家问题】\n${query}` },
  ]
}

/** SSE data 行里取出增量文本;非增量事件(role 帧、心跳、[DONE])返回 '' */
function pickDelta(raw: string): string {
  try {
    const obj = JSON.parse(raw)
    return String(obj?.choices?.[0]?.delta?.content ?? '')
  } catch {
    return ''
  }
}

export async function integrateReply(opts: {
  query: string
  materials: string[]
  config: LlmConfig
  onDelta: (text: string) => void
}): Promise<LlmResult> {
  const { query, materials, config, onDelta } = opts

  // 超时由本函数自己拥有:调用方(content script 侧)不持有 AbortController,
  // 免得生命周期错配导致该中止的没中止、已完成的被误中止。
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort('timeout'), config.timeoutMs)
  let timedOut = false
  const onAbort = () => {
    timedOut = true
  }
  ac.signal.addEventListener('abort', onAbort)

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(query, materials),
        stream: true,
        temperature: 0.2,
        max_tokens: 256,
      }),
      signal: ac.signal,
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    if (!res.body) return { ok: false, error: 'no body' }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let text = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // SSE 事件以空行分隔;只处理完整的 data: 行,残片留到下一片
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        const piece = pickDelta(raw)
        if (!piece) continue
        text += piece
        onDelta(piece)
      }
    }

    text = text.trim()
    // 空回复不返回 ok:否则会把输入框里已有的内容清成空白
    if (!text) return { ok: false, error: 'empty' }
    return { ok: true, text }
  } catch {
    return { ok: false, error: timedOut ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    ac.signal.removeEventListener('abort', onAbort)
  }
}
