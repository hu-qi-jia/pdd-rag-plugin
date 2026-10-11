// jev(System One)调用层单测 —— 全部 mock fetch,不打真实网络
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  argmaxId,
  classifyQuestion,
  isJevConfigured,
  systemOneUrl,
  testJevConnection,
  type JevConfig,
} from '../../../src/background/jev'

const CFG: JevConfig = {
  baseUrl: 'https://api.typesafe.ai',
  apiKey: 'sk-test',
  model: 'jev-latest',
  timeoutMs: 3000,
}

const CATS = [
  { id: 'preset:order', name: '订单物流', criteria: '发货时间、催发货、物流停滞…' },
  { id: 'preset:size', name: '尺码推荐', criteria: '身高体重、穿多大、偏大偏小…' },
]

/** 造一个返回给定 JSON 的 fetch */
function stubJson(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('jev 配置判定', () => {
  it('三项都非空才算配好', () => {
    expect(isJevConfigured(CFG)).toBe(true)
    expect(isJevConfigured({ ...CFG, apiKey: '' })).toBe(false)
    expect(isJevConfigured({ ...CFG, baseUrl: '' })).toBe(false)
    expect(isJevConfigured({ ...CFG, model: '' })).toBe(false)
    expect(isJevConfigured({ ...CFG, apiKey: '   ' })).toBe(false)
  })

  it('端点拼在 /v1/systemone(不是 OpenAI 的 /chat/completions)', () => {
    expect(systemOneUrl('https://api.typesafe.ai')).toBe(
      'https://api.typesafe.ai/v1/systemone',
    )
  })
})

describe('classifyQuestion', () => {
  it('把中文选项名映射回本地 id,并带出 top 与 confidence', async () => {
    stubJson({
      model: 'jev-1.13.0',
      answers: {
        category: {
          type: 'choice',
          choice: '订单物流',
          probabilities: { 订单物流: 0.93, 尺码推荐: 0.07 },
          confidence: 0.86,
        },
      },
      usage: { input_tokens: 120, output_tokens: 12 },
    })

    const r = await classifyQuestion({ question: '快递到哪了', categories: CATS, config: CFG })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.probabilities).toEqual({ 'preset:order': 0.93, 'preset:size': 0.07 })
    expect(r.top).toBe('preset:order')
    expect(r.confidence).toBeCloseTo(0.86, 5)
  })

  it('请求体走 System One 协议:state + questions.choice + criteria 用中文名', async () => {
    stubJson({
      answers: {
        category: {
          type: 'choice',
          choice: '尺码推荐',
          probabilities: { 尺码推荐: 0.8, 订单物流: 0.2 },
          confidence: 0.7,
        },
      },
    })
    await classifyQuestion({ question: '165 穿多大', categories: CATS, config: CFG })

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('jev-latest')
    expect(body.state).toBe('165 穿多大')
    expect(body.questions.category.type).toBe('choice')
    expect(Object.keys(body.questions.category.criteria)).toEqual(['订单物流', '尺码推荐'])
    // 外发只有问题文本与选项描述,不含任何回复内容
    expect(JSON.stringify(body)).not.toContain('answer')
  })

  it('HTTP 非 2xx 归一为 http <码>', async () => {
    stubJson({ error: 'nope' }, 401)
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r).toEqual({ ok: false, error: 'http 401' })
  })

  it('响应结构不对(缺 answers.category)归一为 bad response', async () => {
    stubJson({ answers: {} })
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r).toEqual({ ok: false, error: 'bad response' })
  })

  it('概率里全是没见过的选项名 → bad response(不静默返回空分布)', async () => {
    stubJson({
      answers: {
        category: { type: 'choice', probabilities: { 别的类: 1 }, confidence: 1 },
      },
    })
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r).toEqual({ ok: false, error: 'bad response' })
  })

  it('没有类型可问时直接失败,不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await classifyQuestion({ question: 'q', categories: [], config: CFG })
    expect(r).toEqual({ ok: false, error: 'no categories' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('超时中止归一为 timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const r = await classifyQuestion({
      question: 'q',
      categories: CATS,
      config: { ...CFG, timeoutMs: 10 },
    })
    expect(r).toEqual({ ok: false, error: 'timeout' })
  })

  it('网络异常归一为 network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))))
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r).toEqual({ ok: false, error: 'network' })
  })

  it('choice 字段缺失时用概率最高者兜底', async () => {
    stubJson({
      answers: {
        category: {
          type: 'choice',
          probabilities: { 订单物流: 0.4, 尺码推荐: 0.6 },
          confidence: 0.3,
        },
      },
    })
    const r = await classifyQuestion({ question: 'q', categories: CATS, config: CFG })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.top).toBe('preset:size')
  })
})

describe('argmaxId', () => {
  it('取概率最高者', () => {
    expect(argmaxId({ a: 0.1, b: 0.7, c: 0.2 })).toBe('b')
  })
  it('并列取先遇到的(与 jev 平局取第一的口径一致)', () => {
    expect(argmaxId({ a: 0.5, b: 0.5 })).toBe('a')
  })
  it('空对象返回空串', () => {
    expect(argmaxId({})).toBe('')
  })
})

describe('testJevConnection', () => {
  it('端点通且 2xx → { ok: true }', async () => {
    stubJson({ answers: { ping: { type: 'noul', probability: 0.98 } } })
    const r = await testJevConnection(CFG)
    expect(r).toEqual({ ok: true })
  })

  it('非 2xx 归一为 http <码>', async () => {
    stubJson({ error: 'nope' }, 401)
    const r = await testJevConnection(CFG)
    expect(r).toEqual({ ok: false, error: 'http 401' })
  })

  it('超时中止归一为 timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const r = await testJevConnection({ ...CFG, timeoutMs: 10 })
    expect(r).toEqual({ ok: false, error: 'timeout' })
  })

  it('网络异常归一为 network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))))
    const r = await testJevConnection(CFG)
    expect(r).toEqual({ ok: false, error: 'network' })
  })

  it('请求体走 System One 协议:state + questions.ping.type=noul', async () => {
    stubJson({ answers: { ping: { type: 'noul', probability: 0.98 } } })
    await testJevConnection(CFG)

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('jev-latest')
    expect(body.state).toBe('你好')
    expect(body.questions.ping.type).toBe('noul')
    // 探活只发一句问候,不含任何回复内容
    expect(JSON.stringify(body)).not.toContain('answer')
  })
})
