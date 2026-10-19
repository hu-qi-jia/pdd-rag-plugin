/**
 * LLM 整合调用层(P4 AI 整合)。
 *
 * 数据边界(ADR-0006):只有在本模块被显式调用时才出网,且外发内容仅限
 * 「本轮面板展示的知识库候选文本 + 当前买家问题」。历史回答与标准回答永不外发。
 *
 * 只走 OpenAI 兼容的 /chat/completions + SSE 流式:流式把首字延迟(TTFT)暴露出来,
 * 面板能边收边渲染,感知等待远短于等整段生成。
 * **不做深度思考**:DeepSeek 端点在请求体里显式关闭 thinking(其 V4 默认开启),
 * 其它兼容服务不发任何 reasoning / thinking 参数 —— 思考型模型的首字延迟会让
 * "整合"这件事失去意义。
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

/**
 * 尺码路由的系统提示词(2026-10-19)。
 *
 * 为什么不能复用知识库那份:通用提示词的默认姿态是"资料没写的一律不说、判断不了
 * 就用更保守的说法"。放在尺码上,这个姿态会退化成"身高不在建议区间 → 建议联系客服" ——
 * 买家要的是**一个码**,不是一次转人工。实测回复正是这样(170cm/55kg 明明体重落在 M,
 * 却因为身高超出 M 的「建议身高」而被推去联系客服)。
 *
 * 所以这份提示词把"必须报一个具体尺码"写成硬要求,并把"以体重为主"解释清楚:
 * 身高超出建议区间**不等于**超出尺码表范围。仍然只依据尺码表,仍然保留哨兵。
 */
const SIZE_SYSTEM_PROMPT = `你是拼多多服装店铺的客服,正在根据店铺的尺码表回答买家"我该穿哪个码"。你写的这段话会被直接复制发出去,所以要像真人客服在打字。

【必须给出明确尺码】
只依据下面【尺码表】里的内容作答。买家提供了身高和体重时,必须**直接报出一个具体尺码**(例如「建议穿 M 码」),不要只复述表格,也不要用「建议联系客服确认」代替回答 —— 只有当尺码表**明确写了**该情况超出范围、需要联系客服时,才可以那样说。
买家没有提供身高或体重时,只问缺的那一项(例如「方便说一下身高体重吗?」),不要凭空推荐。

【怎么选】
严格按尺码表里的选码规则执行,尤其注意:
1. 尺码表说「以体重为主」时,就按体重选码。**即使身高超出所选尺码的「建议身高」区间,也不要因此改口或让买家联系客服** —— 身高不在区间内不等于超出尺码表范围;只有当身高或体重触发了尺码表里**明确写的**超出范围规则时,才按那条规则回答。
2. 体重落在两个尺码的重叠区间时,按尺码表写的偏好规则选;尺码表没写偏好时,选较大的那一码,并补一句「喜欢修身可以选小一码」。
3. 只用尺码表里出现的尺码名与数值,不编造表格里没有的尺码、测量值或政策。

【怎么写】
1. 只输出回复正文本身。不要开场白、不要复述买家的问题、不要解释思路、不要加任何 markdown 标记或列表 —— 这段话会原样进入聊天输入框。
2. 先说结论,再用一句话说依据,例如「建议穿 M 码,体重 90-110 斤对应 M 码。」
3. 数字、单位、尺码名必须与尺码表逐字一致:不换算、不四舍五入、不换同义词。
4. 简短优先,总长控制在 60 字以内。

尺码表内容不足以判断买家该穿哪个码时,只输出这五个字:${NO_ANSWER_SENTINEL}`

export type MaterialSource = 'knowledge' | 'size'

export function buildMessages(
  query: string,
  materials: string[],
  source: MaterialSource = 'knowledge',
): ChatMessage[] {
  const list = materials
    .map((m, i) => `(${i + 1}) ${m}`)
    .join('\n\n')
  const size = source === 'size'
  return [
    { role: 'system', content: size ? SIZE_SYSTEM_PROMPT : SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${size ? '【尺码表】' : '【知识库资料】'}\n${list}\n\n【买家问题】\n${query}`,
    },
  ]
}

/** 聊天补全端点(baseUrl 已由设置层规整为无尾斜杠)。测试与整合共用,免得两处拼错两回事 */
export function endpointUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`
}

/**
 * 是否为 DeepSeek 端点。
 *
 * 为什么需要它:DeepSeek 自 V4 起**默认开启思考模式**(effort 默认 high),思维链走
 * `reasoning_content`,与最终正文共用 `max_tokens`。本模块只要"照着资料整合成一句话",
 * 不要思考;不显式关掉时,256 token 的预算会被思维链吃光,流里只有 reasoning_content、
 * `content` 始终为空 —— 面板于是报「整合结果为空」,看起来像密钥配错了。
 *
 * 只对 DeepSeek 发这个参数:任意 OpenAI 兼容服务对未知字段的宽容度不一,
 * 全局塞一个 `thinking` 会把别的接口打成 400。
 */
function isDeepSeek(c: Pick<LlmConfig, 'baseUrl' | 'model'>): boolean {
  return /deepseek/i.test(c.baseUrl) || /deepseek/i.test(c.model)
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
  /** 材料来源决定系统提示词:尺码路由要"必须给出具体尺码",不能沿用知识库的保守姿态 */
  source?: MaterialSource
  onDelta: (text: string) => void
}): Promise<LlmResult> {
  const { query, materials, config, source = 'knowledge', onDelta } = opts

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
    const res = await fetch(endpointUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(query, materials, source),
        stream: true,
        temperature: 0.2,
        max_tokens: 256,
        // DeepSeek V4 默认思考:不关掉会只剩 reasoning_content、content 为空(见 isDeepSeek)
        ...(isDeepSeek(config) ? { thinking: { type: 'disabled' } } : {}),
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

/**
 * 「测试连接」:打的是**真正会用的那个端点**、真正会用的那个模型 ——
 * 只校验 /models 列表会漏掉"模型名写错""该 key 没有这个模型的权限"这两类最常见的配错,
 * 而这两类恰恰是用户点测试时最想知道的。
 *
 * 代价是一次 1 token 的请求。非流式、max_tokens 压到 1:
 * 这里只要"通不通",不在测试环节花用户的钱和时间。
 */
export async function testLlmConnection(
  config: LlmConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ac = new AbortController()
  // 测试用的超时上限收紧到 10s:等这么久还没通,配置本身就该改了
  const timer = setTimeout(() => ac.abort('timeout'), Math.min(config.timeoutMs, 10000))
  let timedOut = false
  const onAbort = () => {
    timedOut = true
  }
  ac.signal.addEventListener('abort', onAbort)

  try {
    const res = await fetch(endpointUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: '你好' }],
        stream: false,
        max_tokens: 1,
      }),
      signal: ac.signal,
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    return { ok: true }
  } catch {
    return { ok: false, error: timedOut ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    ac.signal.removeEventListener('abort', onAbort)
  }
}
