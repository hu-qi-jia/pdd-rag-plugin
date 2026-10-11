/**
 * jev(TypeSafe System One)分类调用层(第五十六轮 · 问题自动分类)。
 *
 * 数据边界(ADR-0007,修订 ADR-0006):只有在本模块被显式调用时才出网,
 * 且外发内容仅限**问题文本、类型名/判定说明与请求参数**(见下方 body:state=问题,
 * criteria=每个选项的名称与说明,以及 model 等)。历史问答的回复正文与标准回答的
 * 正文永不出本机 —— 本模块的入参里根本没有它们,这是结构性保证,不是纪律。
 *
 * 与 llm.ts 的差别:jev 不是生成模型。它拿一个 state 和若干类型化问题,
 * 返回带概率的结构化判断;协议是 /v1/systemone,不是 /chat/completions,也不支持流式。
 */
import type { PddSettings } from '../types/memory'

export interface JevConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

/** 一个可选项(发给模型看的是 name 与 criteria,id 只用于回传后定位) */
export interface JevCategoryOption {
  id: string
  name: string
  criteria: string
}

export type ClassifyResult =
  | { ok: true; probabilities: Record<string, number>; top: string; confidence: number }
  | { ok: false; error: string }

export function isJevConfigured(c: Pick<JevConfig, 'baseUrl' | 'apiKey' | 'model'>): boolean {
  return !!c.baseUrl.trim() && !!c.apiKey.trim() && !!c.model.trim()
}

/** 从设置取 jev 配置(字段名不同,集中在这里,免得散落各处) */
export function jevConfigFromSettings(s: PddSettings): JevConfig {
  return {
    baseUrl: s.jevBaseUrl,
    apiKey: s.jevApiKey,
    model: s.jevModel,
    timeoutMs: s.jevTimeoutMs,
  }
}

/** System One 端点(baseUrl 已由设置层规整为无尾斜杠) */
export function systemOneUrl(baseUrl: string): string {
  return `${baseUrl}/v1/systemone`
}

/**
 * 问题 id(`category`)只是回传用的字典键 —— 官方明确它不会发给模型,
 * 语义要写在 instructions 里。
 */
const INSTRUCTIONS = '这是买家发来的消息。判断它属于哪一类问题。'

/** 概率最高者的 id;并列取先遇到的(与 jev 平局取第一的口径一致) */
export function argmaxId(probabilities: Record<string, number>): string {
  let best = ''
  let bestP = -Infinity
  for (const [id, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      bestP = p
      best = id
    }
  }
  return best
}

export async function classifyQuestion(opts: {
  question: string
  categories: JevCategoryOption[]
  config: JevConfig
}): Promise<ClassifyResult> {
  const { question, categories, config } = opts
  // 没有选项可问 —— 发了也是浪费一次请求和一次外发
  if (categories.length === 0) return { ok: false, error: 'no categories' }

  // criteria 的 key 是发给模型的**选项标签**,用中文名;返回后按名字映射回本地 id
  const idByName = new Map<string, string>()
  const criteria: Record<string, string> = {}
  for (const c of categories) {
    idByName.set(c.name, c.id)
    criteria[c.name] = c.criteria
  }

  // 超时由本函数自己拥有:调用方不持有 AbortController,免得生命周期错配
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort('timeout'), config.timeoutMs)
  let timedOut = false
  const onAbort = () => {
    timedOut = true
  }
  ac.signal.addEventListener('abort', onAbort)

  try {
    const res = await fetch(systemOneUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        state: question,
        questions: {
          category: { type: 'choice', instructions: INSTRUCTIONS, criteria },
        },
      }),
      signal: ac.signal,
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }

    const body = (await res.json()) as {
      answers?: Record<
        string,
        { choice?: unknown; probabilities?: Record<string, unknown>; confidence?: unknown }
      >
    }
    const ans = body?.answers?.category
    if (!ans || typeof ans.probabilities !== 'object' || ans.probabilities === null) {
      return { ok: false, error: 'bad response' }
    }

    // 只保留能映射回本地类型的项 —— 模型理论上不会返回选项外的答案,
    // 但真返回了也不能让它变成一条指向不存在类型的分类结果
    const probabilities: Record<string, number> = {}
    for (const [name, p] of Object.entries(ans.probabilities)) {
      const id = idByName.get(name)
      if (!id) continue
      const n = Number(p)
      if (Number.isFinite(n)) probabilities[id] = n
    }
    if (Object.keys(probabilities).length === 0) return { ok: false, error: 'bad response' }

    const top = typeof ans.choice === 'string' ? (idByName.get(ans.choice) ?? '') : ''
    const confidence = Number.isFinite(Number(ans.confidence)) ? Number(ans.confidence) : 0
    return { ok: true, probabilities, top: top || argmaxId(probabilities), confidence }
  } catch {
    return { ok: false, error: timedOut ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    ac.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 「测试连接」:打真正会用的那个端点、真正会用的那个模型 ——
 * 只校验端点通不通会漏掉"模型名写错""该 key 没这个模型的权限"这两类最常见的配错。
 * 用最简单的一个 noul 问题,成本约一次 10 token 的请求。
 */
export async function testJevConnection(
  config: JevConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort('timeout'), Math.min(config.timeoutMs, 10000))
  let timedOut = false
  const onAbort = () => {
    timedOut = true
  }
  ac.signal.addEventListener('abort', onAbort)

  try {
    const res = await fetch(systemOneUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        state: '你好',
        questions: { ping: { type: 'noul', instructions: '这条消息是问候语吗?' } },
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
