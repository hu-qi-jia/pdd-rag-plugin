// AI 整合编排单测:门禁(开关/配置/自动回复)+ 流式转发 + 哨兵。
// 门禁是数据边界的关键——每一条都必须"直接返回,且一次 fetch 都不发"。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NO_ANSWER_SENTINEL } from '../../../src/background/llm'
import type { AiPortEvent } from '../../../src/types/messages/ai'

const loadSettings = vi.fn()
vi.mock('../../../src/background/settings', () => ({
  loadSettings: () => loadSettings(),
}))

const collectMaterials = vi.fn()
vi.mock('../../../src/background/aiMaterials', () => ({
  collectMaterials: (ids: string[]) => collectMaterials(ids),
}))

const BASE = {
  aiIntegrateEnabled: true,
  llmBaseUrl: 'https://api.example.com/v1',
  llmApiKey: 'sk-test',
  llmModel: 'fast-model',
  llmTimeoutMs: 8000,
  directFillEnabled: false,
}

function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const payload = chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
    .join('')
  const bytes = new TextEncoder().encode(payload + 'data: [DONE]\n\n')
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes)
      c.close()
    },
  })
}

async function run(over: Partial<typeof BASE> = {}, ids: string[] = ['k1']) {
  loadSettings.mockResolvedValue({ ...BASE, ...over })
  const { handleAiIntegrate } = await import('../../../src/background/aiIntegrate')
  const events: AiPortEvent[] = []
  await handleAiIntegrate({ query: '防水吗', knowledgeIds: ids }, (e) => events.push(e))
  return events
}

beforeEach(() => {
  collectMaterials.mockReset().mockResolvedValue(['常见问答 · 防水吗？\n不防水。'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleAiIntegrate · 门禁', () => {
  it('开关关闭 → disabled,零网络请求', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await run({ aiIntegrateEnabled: false })).toEqual([
      { type: 'ERROR', payload: { error: 'disabled' } },
    ])
    expect(f).not.toHaveBeenCalled()
    expect(collectMaterials).not.toHaveBeenCalled()
  })

  it('「自动回复」开启 → 拒绝(该路径只做检索填充,绝不调 LLM)', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await run({ directFillEnabled: true })).toEqual([
      { type: 'ERROR', payload: { error: 'disabled' } },
    ])
    expect(f).not.toHaveBeenCalled()
  })

  it('API 未配置(缺 key / 缺 model / 缺 url)→ unconfigured,零网络请求', async () => {
    for (const over of [{ llmApiKey: '' }, { llmModel: '' }, { llmBaseUrl: '' }]) {
      const f = vi.fn()
      vi.stubGlobal('fetch', f)
      expect(await run(over)).toEqual([{ type: 'ERROR', payload: { error: 'unconfigured' } }])
      expect(f).not.toHaveBeenCalled()
    }
  })

  it('没有可用材料 → 报错且不发请求(不让模型凭空编)', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    collectMaterials.mockResolvedValue([])
    expect(await run()).toEqual([{ type: 'ERROR', payload: { error: 'no material' } }])
    expect(f).not.toHaveBeenCalled()
  })

  it('空的 knowledgeIds → 不发请求', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    collectMaterials.mockResolvedValue([])
    expect(await run({}, [])).toEqual([{ type: 'ERROR', payload: { error: 'no material' } }])
    expect(f).not.toHaveBeenCalled()
  })
})

describe('handleAiIntegrate · 流式转发', () => {
  it('增量逐条推 DELTA,收尾推 DONE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(['不防水,', '请注意防雨防潮。']), { status: 200 })))
    expect(await run()).toEqual([
      { type: 'DELTA', payload: { text: '不防水,' } },
      { type: 'DELTA', payload: { text: '请注意防雨防潮。' } },
      { type: 'DONE', payload: { text: '不防水,请注意防雨防潮。' } },
    ])
  })

  it('模型输出哨兵 → 推 NO_ANSWER,不推 DONE(调用方不填充)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse([NO_ANSWER_SENTINEL]), { status: 200 })))
    expect(await run()).toEqual([{ type: 'NO_ANSWER' }])
  })

  it('哨兵分片吐出来也识别得到,且不把它当草稿渲染出去', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(['[无法', '回答]']), { status: 200 })))
    expect(await run()).toEqual([{ type: 'NO_ANSWER' }])
  })

  it('开头像哨兵但后面还有内容 → 正常流式产出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sse(['[无法', '回答]但是可以先看下说明书。']), { status: 200 })),
    )
    const events = await run()
    expect(events.at(-1)).toEqual({
      type: 'DONE',
      payload: { text: '[无法回答]但是可以先看下说明书。' },
    })
    // 扣住的片段在放行时一次性补发,面板端不会丢字
    const streamed = events
      .filter((e) => e.type === 'DELTA')
      .map((e) => (e as { payload: { text: string } }).payload.text)
      .join('')
    expect(streamed).toBe('[无法回答]但是可以先看下说明书。')
  })

  it('普通回复首字不被扣住(逐条 DELTA 与流一致)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(['不', '防水。']), { status: 200 })))
    expect(await run()).toEqual([
      { type: 'DELTA', payload: { text: '不' } },
      { type: 'DELTA', payload: { text: '防水。' } },
      { type: 'DONE', payload: { text: '不防水。' } },
    ])
  })

  it('HTTP 错误 → ERROR,不推 DONE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 429 })))
    expect(await run()).toEqual([{ type: 'ERROR', payload: { error: 'http 429' } }])
  })

  it('材料按 content 传来的候选顺序取', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(['x']), { status: 200 })))
    await run({}, ['k2', 'k1'])
    expect(collectMaterials).toHaveBeenCalledWith(['k2', 'k1'])
  })
})

describe('aiRowAvailable(面板行的渲染门禁)', () => {
  it('四条同时成立才为 true', async () => {
    const { aiRowAvailable } = await import('../../../src/background/aiIntegrate')
    const on = { ...BASE }
    expect(aiRowAvailable(on as never, true)).toBe(true)
    expect(aiRowAvailable({ ...on, aiIntegrateEnabled: false } as never, true)).toBe(false)
    expect(aiRowAvailable({ ...on, llmApiKey: '' } as never, true)).toBe(false)
    expect(aiRowAvailable({ ...on, directFillEnabled: true } as never, true)).toBe(false)
    expect(aiRowAvailable(on as never, false)).toBe(false) // 本轮无知识库候选
  })
})
