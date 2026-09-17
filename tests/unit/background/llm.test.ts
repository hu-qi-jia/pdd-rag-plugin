// LLM 调用层单测(mock fetch + 自造 SSE 流)。
// 覆盖:提示词组装 / SSE 解析 / 超时中止 / HTTP 错误 / 哨兵 / 不发 reasoning 参数。
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  NO_ANSWER_SENTINEL,
  buildMessages,
  integrateReply,
  isLlmConfigured,
} from '../../../src/background/llm'

const CONFIG = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'fast-model',
  timeoutMs: 8000,
}

/** 把若干 SSE data 行拼成 ReadableStream(可注入分片边界,验证跨片解析) */
function sseStream(lines: string[], chunkSize = 1024): ReadableStream<Uint8Array> {
  const payload = lines.map((l) => `data: ${l}\n\n`).join('')
  const bytes = new TextEncoder().encode(payload)
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize))
      }
      controller.close()
    },
  })
}

const delta = (text: string) => JSON.stringify({ choices: [{ delta: { content: text } }] })

function mockFetch(stream: ReadableStream<Uint8Array>, status = 200) {
  return vi.fn(async () => new Response(stream, { status }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isLlmConfigured', () => {
  it('三要素齐全才算已配置', () => {
    expect(isLlmConfigured(CONFIG)).toBe(true)
    expect(isLlmConfigured({ ...CONFIG, baseUrl: '' })).toBe(false)
    expect(isLlmConfigured({ ...CONFIG, apiKey: '' })).toBe(false)
    expect(isLlmConfigured({ ...CONFIG, model: '  ' })).toBe(false)
  })
})

describe('buildMessages', () => {
  const msgs = buildMessages('防水吗', ['常见问答 · 防水吗？\n不防水,请注意防雨防潮。'])
  const sys = msgs.find((m) => m.role === 'system')!.content
  const user = msgs.find((m) => m.role === 'user')!.content

  it('system 以客服身份写,首条即 system', () => {
    expect(msgs[0].role).toBe('system')
    expect(sys).toContain('客服')
  })

  it('system 约束:只用资料、不编造、直接输出正文、不加 markdown', () => {
    expect(sys).toMatch(/只依据|只使用/)
    expect(sys).toContain('不编造')
    expect(sys).toMatch(/不要复述/)
    expect(sys).toContain('markdown')
  })

  it('system 约束:数字/型号逐字照抄,限制条件必须一并说出', () => {
    expect(sys).toMatch(/逐字|完全一致/)
    expect(sys).toMatch(/限制条件|例外/)
  })

  it('system 声明哨兵值', () => {
    expect(sys).toContain(NO_ANSWER_SENTINEL)
  })

  it('user 消息同时含资料与买家问题', () => {
    expect(user).toContain('知识库资料')
    expect(user).toContain('常见问答 · 防水吗？')
    expect(user).toContain('不防水,请注意防雨防潮。')
    expect(user).toContain('防水吗')
    expect(user).toContain('买家问题')
  })

  it('多份资料按序编号,不合并成一段', () => {
    const m = buildMessages('q', ['资料甲', '资料乙'])
    const u = m.find((x) => x.role === 'user')!.content
    expect(u.indexOf('资料甲')).toBeLessThan(u.indexOf('资料乙'))
  })

  it('面板配额内的资料**一份不落**全部入提示词(第五十轮:top-k=3,不是只发一条)', () => {
    // 用户口径:「ai整合是根据检索到的 top-k=3 的内容整合,而不是只有一条」——
    // 上游(面板配额 → knowledgeIds → collectMaterials)给了几条,这里就必须带几条
    const three = ['资料甲\n正文甲', '资料乙\n正文乙', '资料丙\n正文丙']
    const u = buildMessages('q', three).find((x) => x.role === 'user')!.content
    for (const mat of three) {
      for (const line of mat.split('\n')) expect(u).toContain(line)
    }
  })
})

describe('integrateReply', () => {
  it('SSE 增量回调 + 拼接完整文本', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(sseStream([delta('不防水,'), delta('请注意防雨防潮。'), '[DONE]'])),
    )
    const deltas: string[] = []
    const r = await integrateReply({
      query: '防水吗',
      materials: ['资料'],
      config: CONFIG,
      onDelta: (t) => deltas.push(t),
    })
    expect(r).toEqual({ ok: true, text: '不防水,请注意防雨防潮。' })
    expect(deltas).toEqual(['不防水,', '请注意防雨防潮。'])
  })

  it('分片边界落在 SSE 行中间也能正确解析', async () => {
    vi.stubGlobal('fetch', mockFetch(sseStream([delta('甲'), delta('乙'), '[DONE]'], 7)))
    const r = await integrateReply({
      query: 'q',
      materials: ['m'],
      config: CONFIG,
      onDelta: () => {},
    })
    expect(r).toEqual({ ok: true, text: '甲乙' })
  })

  it('请求体:stream=true、不发任何 reasoning/thinking 参数', async () => {
    const f = mockFetch(sseStream([delta('x'), '[DONE]']))
    vi.stubGlobal('fetch', f)
    await integrateReply({ query: 'q', materials: ['m'], config: CONFIG, onDelta: () => {} })

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('fast-model')
    expect(body.messages[0].role).toBe('system')
    const keys = Object.keys(body).join(',').toLowerCase()
    for (const banned of ['reason', 'thinking', 'think', 'effort', 'budget']) {
      expect(keys).not.toContain(banned)
    }
  })

  it('HTTP 非 2xx → 归一为错误,不外泄响应体细节', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const r = await integrateReply({ query: 'q', materials: ['m'], config: CONFIG, onDelta: () => {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('401')
  })

  it('网络异常 → 归一为错误,不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    const r = await integrateReply({ query: 'q', materials: ['m'], config: CONFIG, onDelta: () => {} })
    expect(r).toEqual({ ok: false, error: 'network' })
  })

  it('超时中止 → error=timeout', async () => {
    // 永不结束的流:模拟模型长时间不吐字
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        const signal = init.signal!
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            signal.addEventListener('abort', () => c.error(new Error('aborted')))
          },
        })
        return new Response(stream, { status: 200 })
      }),
    )
    const r = await integrateReply({
      query: 'q',
      materials: ['m'],
      config: { ...CONFIG, timeoutMs: 2000 },
      onDelta: () => {},
    })
    expect(r).toEqual({ ok: false, error: 'timeout' })
  }, 10000)

  it('模型判定无法回答 → 原样返回哨兵,由调用方决定不填充', async () => {
    vi.stubGlobal('fetch', mockFetch(sseStream([delta(NO_ANSWER_SENTINEL), '[DONE]'])))
    const r = await integrateReply({ query: 'q', materials: ['m'], config: CONFIG, onDelta: () => {} })
    expect(r).toEqual({ ok: true, text: NO_ANSWER_SENTINEL })
  })

  it('空回复 → 视为失败(不拿空串覆盖输入框)', async () => {
    vi.stubGlobal('fetch', mockFetch(sseStream([delta('   '), '[DONE]'])))
    const r = await integrateReply({ query: 'q', materials: ['m'], config: CONFIG, onDelta: () => {} })
    expect(r).toEqual({ ok: false, error: 'empty' })
  })

  it('流中途报错 → 返回错误,不返回半截文本', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(`data: ${delta('半截')}\n\n`))
            c.error(new Error('conn reset'))
          },
        })
        return new Response(stream, { status: 200 })
      }),
    )
    const r = await integrateReply({ query: 'q', materials: ['m'], config: CONFIG, onDelta: () => {} })
    expect(r).toEqual({ ok: false, error: 'network' })
  })
})
