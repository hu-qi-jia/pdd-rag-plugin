// 检索编排层单测(编排层原是测试盲区,评审"其余"项点名)。
// searchSuggestions 的 IO/装配在 search.ts,纯逻辑在 retrieval.ts(已有单测);
// 此处 mock 掉 offscreen 嵌入,用确定性向量锁住编排行为:
// 阈值门控 → 候选展开 → 折叠配额,以及工程5b 缓存接线后"写入即失效"的端到端语义。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { QaRecord, ReplyRecord, GoldenRecord } from '../../../src/types/memory'
import { hashText } from '../../../src/shared/text'
import { saveSettings } from '../../../src/background/settings'

// offscreen 依赖 chrome.runtime 消息通道:编排测试不关心嵌入实现,
// mock 为确定性函数 —— 含"发票"→[1,0],否则→[0,1](正交 ⇒ 余弦 0/1 可预测)。
vi.mock('../../../src/background/offscreen', () => ({
  embedViaOffscreen: vi.fn(async (text: string) =>
    text.includes('发票') ? Float32Array.from([1, 0]) : Float32Array.from([0, 1]),
  ),
  queueEmbedding: vi.fn(),
}))

// 埋点是本组要钉的一条路径(size-only 早返回也必须记,R29),因此把它换成一个可断言的桩。
// search.ts 只从 metrics 取这一个符号,不会牵连别的导出。
vi.mock('../../../src/background/metrics', () => ({
  recordSearchOutcome: vi.fn(),
}))

async function freshSearch() {
  vi.resetModules()
  const { searchSuggestions } = await import('../../../src/background/search')
  const { db } = await import('../../../src/background/db')
  return { searchSuggestions, db }
}

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '能开发票吗?',
    questionHash: hashText('能开发票吗?'),
    questionTs: now,
    hasEmbedding: 0,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function makeReply(over: Partial<ReplyRecord> & { id: string }): ReplyRecord {
  const text = over.text ?? '可以,支持电子发票。'
  return {
    qaId: 'qa-1',
    text,
    contentHash: hashText(text),
    ts: Date.now(),
    hasEmbedding: 0,
    ...over,
  }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('searchSuggestions:编排行为', () => {
  it('历史源:问题过阈 → 展开回复为历史候选', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: Float32Array.from([1, 0]) }),
    )
    await db.addReply(makeReply({ id: 'r-1', qaId: 'qa-1', text: '可以,支持电子发票。' }))

    const out = await searchSuggestions('能开发票吗?')
    expect(out.error).toBeUndefined()
    expect(out.suggestions.some((s) => s.kind === 'history' && s.text.includes('电子发票'))).toBe(
      true,
    )
  })

  it('金标准源:过阈 → 返回标准回答正文', async () => {
    const { searchSuggestions, db } = await freshSearch()
    const now = Date.now()
    await db.goldens.add({
      id: 'g-1',
      folderId: null,
      question: '退货政策是什么?',
      answer: '7 天无理由退货,邮费我们承担。',
      questionHash: hashText('退货政策是什么?'),
      qEmbedding: Float32Array.from([0, 1]),
      hasEmbedding: 1,
      createdAt: now,
      updatedAt: now,
    } satisfies GoldenRecord)

    // 查询"退货"不含"发票" → [0,1],与金标准向量余弦 1,过 goldenThreshold 0.4
    const out = await searchSuggestions('退货政策是什么?')
    expect(out.suggestions.some((s) => s.kind === 'golden' && s.text.includes('7 天无理由'))).toBe(
      true,
    )
  })

  it('正交向量不过阈 → 无候选(阈值门控生效)', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: Float32Array.from([1, 0]) }),
    )
    // "退货"查询 → [0,1],与 qa 向量余弦 0,低于 history 阈值 0.5
    const out = await searchSuggestions('退货政策')
    expect(out.suggestions).toHaveLength(0)
  })
})

describe('searchSuggestions × 检索缓存(工程5b):写入即失效', () => {
  it('补嵌完成后的下一次检索能看到新记录(缓存被写路径失效)', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addReply(makeReply({ id: 'r-1', qaId: 'qa-1', text: '支持电子发票。' }))

    // 未嵌:无候选,同时缓存以"空集"建立
    const before = await searchSuggestions('能开发票吗?')
    expect(before.suggestions).toHaveLength(0)

    // 补嵌完成(走 db 写路径 → 必须失效缓存)
    await db.updateQaEmbedding('qa-1', Float32Array.from([1, 0]), 'mock-model', 'v1')

    const after = await searchSuggestions('能开发票吗?')
    expect(after.suggestions.some((s) => s.text.includes('电子发票'))).toBe(true)
  })

  it('删除问答后的下一次检索不再返回其回复', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: Float32Array.from([1, 0]) }),
    )
    await db.addReply(makeReply({ id: 'r-1', qaId: 'qa-1', text: '支持电子发票。' }))
    expect((await searchSuggestions('能开发票吗?')).suggestions).toHaveLength(1)

    await db.deleteQaWithReplies('qa-1')
    expect((await searchSuggestions('能开发票吗?')).suggestions).toHaveLength(0)
  })
})

// ─── 类型路由(第五十八轮):分类影响检索 ────────────────────────────────────────
//
// 这组要钉住的核心不变量:
//  ① 无 jev ⇒ 检索结果与改动前**逐字节相同**(不变量头号);
//  ② 判出类型 ⇒ 池收窄(该类型外的历史不再出现);
//  ③ 切片相对全池没有显著更优 ⇒ 放宽到全池(误判不至于静默丢答案);
//  ④ 纯尺码 ⇒ 不检索 + settings.sizeRoute,且埋点照样记(R29);
//  ⑤ jev 报错/超时/没配好 ⇒ 一律退化成不过滤,Classification 绝不阻塞检索。
//
// 分类链路走真 jev.ts + 假 fetch(协议层真实),类型表走真库的 ensurePresetCategories。

/** chrome.storage.local 内存桩:settings 必须能真往返(classify.test.ts 同源手法) */
const settingsStore: Record<string, unknown> = {}

function stubLocalStorage(): void {
  const local = chrome.storage.local as unknown as Record<string, unknown>
  local.get = (
    keys: string | string[] | null,
    cb?: (r: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> => {
    const wanted = keys === null ? Object.keys(settingsStore) : Array.isArray(keys) ? keys : [keys]
    const out: Record<string, unknown> = {}
    for (const k of wanted) if (k in settingsStore) out[k] = settingsStore[k]
    cb?.(out)
    return Promise.resolve(out)
  }
  local.set = (items: Record<string, unknown>, cb?: () => void): Promise<void> => {
    Object.assign(settingsStore, items)
    cb?.()
    return Promise.resolve()
  }
}

/** 假 jev 响应:probabilities 的 key 是**中文类型名**(jev.ts 按名字映射回本地 id) */
function jevResponse(probabilities: Record<string, number>): Response {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  return new Response(
    JSON.stringify({ answers: { category: { type: 'choice', choice, probabilities, confidence: 0.9 } } }),
    { status: 200 },
  )
}

describe('searchSuggestions 的类型路由', () => {
  beforeEach(async () => {
    for (const k of Object.keys(settingsStore)) delete settingsStore[k]
    stubLocalStorage()
    // 埋点桩在**本文件前面**的用例里也被调用过(空结果同样记一次),不清历史的话
    // 「纯尺码路径记过埋点」这条断言会被历史污染而假绿 —— 必须每次从零开始。
    const { recordSearchOutcome } = await import('../../../src/background/metrics')
    vi.mocked(recordSearchOutcome).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 造一条已嵌问答(可带类型),回复文本自定义 */
  async function seedQa(
    db: Awaited<ReturnType<typeof freshSearch>>['db'],
    id: string,
    opts: { question: string; embedding: number[]; categoryId?: string; replyText: string },
  ): Promise<void> {
    const now = Date.now()
    await db.addQaRecord({
      id,
      sessionKey: 'sess-1',
      question: opts.question,
      questionHash: hashText(opts.question),
      questionTs: now,
      hasEmbedding: 1,
      embedding: Float32Array.from(opts.embedding),
      replyCount: 0,
      categoryId: opts.categoryId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    const text = opts.replyText
    await db.addReply({
      id: `${id}-r`,
      qaId: id,
      text,
      contentHash: hashText(text),
      ts: now,
      hasEmbedding: 0,
    })
  }

  it('★ 无 jev(未配置) → 结果与改动前逐字节相同', async () => {
    const { searchSuggestions, db } = await freshSearch()
    const T = 1_700_000_000_000
    // 夹具刻意让三个来源的余弦与时间戳全相同 ⇒ 排名只由 RRF/BM25 决定,
    // 与 Date.now() 无关,输出对每次运行都精确可复现(见下方字面量)。
    const mkQa = (id: string, question: string): QaRecord => ({
      id,
      sessionKey: 'sess-1',
      question,
      questionHash: hashText(question),
      questionTs: T,
      hasEmbedding: 1,
      embedding: Float32Array.from([1, 0]),
      replyCount: 0,
      categoryId: null,
      createdAt: T,
      updatedAt: T,
    })
    await db.addQaRecord(mkQa('qa-order', '能开发票吗?'))
    await db.addQaRecord(mkQa('qa-price', '发票怎么开?'))
    const mkReply = (id: string, qaId: string, text: string): ReplyRecord => ({
      id,
      qaId,
      text,
      contentHash: hashText(text),
      ts: T,
      hasEmbedding: 0,
    })
    await db.addReply(mkReply('r-order', 'qa-order', '订单发货后可申请电子发票。'))
    await db.addReply(mkReply('r-dup', 'qa-price', '订单发货后可申请电子发票。'))
    await db.addReply(mkReply('r-price', 'qa-price', '发票由平台开具,不支持修改抬头。'))
    await db.goldens.add({
      id: 'g-1',
      folderId: null,
      question: '能开发票吗?',
      answer: '支持电子发票,可自助开具。',
      questionHash: hashText('能开发票吗?'),
      qEmbedding: Float32Array.from([1, 0]),
      hasEmbedding: 1,
      categoryId: null,
      createdAt: T,
      updatedAt: T,
    } satisfies GoldenRecord)
    await db.addKnowledge({
      id: 'k-1',
      title: '发票说明',
      content: '发票可以开电子发票。',
      questionHash: hashText('发票说明'),
      qEmbedding: Float32Array.from([1, 0]),
      hasEmbedding: 1,
      enabled: 1,
      createdAt: T,
      updatedAt: T,
    })

    // 捕获自改动前(HEAD 5f43644)的同夹具输出 —— 顺序、score、kind、foldCount 全等。
    const DUMP = [
      { id: 'g-1', score: 1, kind: 'golden', foldCount: 1 },
      { id: 'qa-order', score: 1, kind: 'history', foldCount: 2 },
      { id: 'qa-price', score: 1, kind: 'history', foldCount: 1 },
      { id: 'k-1', score: 1, kind: 'knowledge', foldCount: 1 },
    ]

    const out = await searchSuggestions('能开发票吗?')
    expect(out.error).toBeUndefined()
    expect(
      out.suggestions.map((s) => ({
        id: s.sourceId,
        score: s.score,
        kind: s.kind,
        foldCount: s.foldCount,
      })),
    ).toEqual(DUMP)
    // 且没有凭空多出 sizeRoute 之类的字段(下游 UiSettings 也应逐字节等价)
    expect(out.settings).toEqual({
      directFillEnabled: false,
      goldenPriorityEnabled: true,
      aiAvailable: false,
    })
  })

  it('★ 判成某个类型 → 池收窄,该类型外的历史不再出现', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.ensurePresetCategories()
    // 两条历史余弦都为 1(与查询完全同向),唯一差别是类型
    await seedQa(db, 'qa-order', {
      question: '快递到哪了?',
      embedding: [1, 0],
      categoryId: 'preset:order',
      replyText: '订单已发出,今天应该能到。',
    })
    await seedQa(db, 'qa-price', {
      question: '能便宜点吗?',
      embedding: [1, 0],
      categoryId: 'preset:price',
      replyText: '这个价格已经是最低了哦。',
    })
    vi.stubGlobal('fetch', vi.fn(async () => jevResponse({ 订单物流: 0.9 })))
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })

    const out = await searchSuggestions('能开发票吗?')
    expect(out.suggestions.some((s) => s.text.includes('订单已发出'))).toBe(true)
    // 池收窄:价格类的历史被挡在外面(两遍 pass 的余弦相同 ⇒ 余量判据保留切片)
    expect(out.suggestions.some((s) => s.text.includes('价格已经是最低'))).toBe(false)
  })

  it('★ 切片没有显著更优 → 放宽到全池,正确答案仍能回来', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.ensurePresetCategories()
    // 订单物流:中等相似(余弦 0.6),够过历史阈值 0.5
    await seedQa(db, 'qa-order', {
      question: '快递到哪了?',
      embedding: [0.6, 0.8],
      categoryId: 'preset:order',
      replyText: '订单已发出,今天应该能到。',
    })
    // 价格优惠:高度相似(余弦 1)—— 这才是正确答案,但分类没选它
    await seedQa(db, 'qa-price', {
      question: '能便宜点吗?',
      embedding: [1, 0],
      categoryId: 'preset:price',
      replyText: '这个价格已经是最低了哦。',
    })
    // jev 误判成订单物流(池子非空,但最高余弦 0.6 明显低于全池的 1.0)
    vi.stubGlobal('fetch', vi.fn(async () => jevResponse({ 订单物流: 0.9 })))
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })

    const out = await searchSuggestions('能开发票吗?')
    // 放宽到全池 ⇒ 正确答案(价格那条)回来;若只按"池子空了才放宽",它会被静默丢掉
    expect(out.suggestions.some((s) => s.text.includes('价格已经是最低'))).toBe(true)
    expect(out.suggestions.some((s) => s.text.includes('订单已发出'))).toBe(true)
  })

  it('★ 纯尺码 → 不检索,面板拿到的候选为空且 settings.sizeRoute 为真', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.ensurePresetCategories()
    // 库里有一条高度相似的历史,但纯尺码路径不该碰它(答案取决于买家个体参数)
    await seedQa(db, 'qa-any', {
      question: '我 165 穿多大?',
      embedding: [1, 0],
      categoryId: 'preset:attr',
      replyText: '这条历史绝不该出现在纯尺码的结果里。',
    })
    vi.stubGlobal('fetch', vi.fn(async () => jevResponse({ 尺码推荐: 0.9 })))
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })

    const out = await searchSuggestions('能开发票吗?')
    expect(out.suggestions).toHaveLength(0)
    expect(out.settings.sizeRoute).toBe(true)

    // ★ R29:早返回也必须记埋点,否则尺码类问题会系统性地把未命中率口径拉偏
    const { recordSearchOutcome } = await import('../../../src/background/metrics')
    expect(vi.mocked(recordSearchOutcome)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordSearchOutcome)).toHaveBeenCalledWith(0)
  })

  it('★ 混合意图(类型集合含尺码) → 池照常算,且额外挂尺码生成行(R31)', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.ensurePresetCategories()
    await seedQa(db, 'qa-order', {
      question: '什么时候发货?',
      // 本文件的嵌入桩:含"发票"→[1,0],否则→[0,1];查询里没有"发票" ⇒ 用 [0,1] 同向
      embedding: [0, 1],
      categoryId: 'preset:order',
      replyText: '48 小时内发货。',
    })
    // §8.1 尺码路由前提:至少一篇被标记的尺码表 + 已配 LLM
    await db.putKbDoc({
      docId: '尺码表',
      content: '165cm/M 170cm/L',
      splitterVersion: 'test',
      chunkCount: 1,
      isSizeTable: true,
      createdAt: 1,
      updatedAt: 1,
    })
    // 一单两意:订单 0.52 / 尺码 0.43,都过 0.2 阈值
    vi.stubGlobal('fetch', vi.fn(async () => jevResponse({ 订单物流: 0.52, 尺码推荐: 0.43 })))
    await saveSettings({
      classifyEnabled: true,
      jevApiKey: 'sk-test',
      aiIntegrateEnabled: true,
      llmBaseUrl: 'https://api.example.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'fast-model',
    })

    const out = await searchSuggestions('什么时候发货,165 穿多大?')
    // 池照常算:订单物流候选一条不少
    expect(out.suggestions.some((s) => s.text.includes('48 小时内发货'))).toBe(true)
    // 额外挂尺码生成行:路线信号 + 渲染门禁(§8.1 前提)都亮
    expect(out.settings.sizeRoute).toBe(true)
    expect(out.settings.sizeAvailable).toBe(true)
  })

  it('混合意图但没标记尺码表 → 有路线信号,却不挂生成行(没材料)', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.ensurePresetCategories()
    await seedQa(db, 'qa-order', {
      question: '什么时候发货?',
      embedding: [0, 1],
      categoryId: 'preset:order',
      replyText: '48 小时内发货。',
    })
    vi.stubGlobal('fetch', vi.fn(async () => jevResponse({ 订单物流: 0.52, 尺码推荐: 0.43 })))
    await saveSettings({
      classifyEnabled: true,
      jevApiKey: 'sk-test',
      aiIntegrateEnabled: true,
      llmBaseUrl: 'https://api.example.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'fast-model',
    })

    const out = await searchSuggestions('什么时候发货,165 穿多大?')
    expect(out.settings.sizeRoute).toBe(true)
    expect(out.settings.sizeAvailable).toBeUndefined()
  })

  it('★ 纯尺码 + §8.1 前提齐备(有尺码表 + 已配 LLM)→ 生成行可用', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.ensurePresetCategories()
    await db.putKbDoc({
      docId: '尺码表',
      content: '165cm/M 170cm/L',
      splitterVersion: 'test',
      chunkCount: 1,
      isSizeTable: true,
      createdAt: 1,
      updatedAt: 1,
    })
    vi.stubGlobal('fetch', vi.fn(async () => jevResponse({ 尺码推荐: 0.9 })))
    await saveSettings({
      classifyEnabled: true,
      jevApiKey: 'sk-test',
      aiIntegrateEnabled: true,
      llmBaseUrl: 'https://api.example.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'fast-model',
    })

    const out = await searchSuggestions('165 穿多大?')
    expect(out.suggestions).toHaveLength(0) // 池为空是设计意图
    expect(out.settings.sizeRoute).toBe(true)
    expect(out.settings.sizeAvailable).toBe(true)
  })

  it('尺码路由前提不满足(没配 key) → 退化成不过滤', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.ensurePresetCategories()
    await seedQa(db, 'qa-1', {
      question: '能开发票吗?',
      embedding: [1, 0],
      replyText: '支持电子发票。',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await saveSettings({ classifyEnabled: true, jevApiKey: '' })

    const out = await searchSuggestions('能开发票吗?')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(out.suggestions.some((s) => s.text.includes('电子发票'))).toBe(true)
    expect(out.settings.sizeRoute).toBeUndefined()
  })

  it('分类调用超时 → 退化成不过滤,不阻塞检索', async () => {
    const { searchSuggestions, db } = await freshSearch()
    await db.ensurePresetCategories()
    await seedQa(db, 'qa-1', {
      question: '能开发票吗?',
      embedding: [1, 0],
      replyText: '支持电子发票。',
    })
    // fetch 一直挂着,只有 classifyQuestion 自己的 AbortController 到点后拒掉它
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test', jevTimeoutMs: 1000 })

    const out = await searchSuggestions('能开发票吗?')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // 分类失败吞成 null → no-filter → 全池一遍,用户照样搜得到东西
    expect(out.error).toBeUndefined()
    expect(out.suggestions.some((s) => s.text.includes('电子发票'))).toBe(true)
    expect(out.settings.sizeRoute).toBeUndefined()
  }, 10_000)
})
