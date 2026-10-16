// 打标编排单测:纯逻辑用 makeCats 直接喂,端到端路径走 fake-indexeddb + mock fetch
import 'fake-indexeddb/auto'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { PddDatabase } from '../../../src/background/db'
import { classifiableCategories, pickRecordCategory } from '../../../src/background/classify'
import { saveSettings } from '../../../src/background/settings'
import type { CategoryRecord } from '../../../src/types/memory'

// chrome.storage.local 内存桩:共享桩的 local 是 no-op,设置存不进去也读不回来。
// 本组门禁测的正是"设置怎么说就怎么走",必须让 saveSettings/loadSettings 真往返
// (与 settings.test.ts 同源的桩,只是那里的作用域在一个 describe 内)。
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

function makeCat(over: Partial<CategoryRecord> & { id: string }): CategoryRecord {
  const now = Date.now()
  return {
    name: over.id,
    criteria: '描述',
    kind: 'preset',
    route: 'retrieve',
    filterable: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

describe('classifiableCategories', () => {
  // 作用域用例共用的三类:记录级可打的、查询级专有的(尺码)、永远不是选项的(未分类)
  const cats = [
    makeCat({ id: 'preset:order', name: '订单物流', route: 'retrieve' }),
    makeCat({ id: 'preset:size', name: '尺码推荐', route: 'size' }),
    makeCat({ id: 'uncategorized', name: '未分类', kind: 'uncategorized', filterable: false }),
  ]

  it('query:只取 filterable=true —— 查询级与改前逐字节相同', () => {
    const mixed = [
      makeCat({ id: 'preset:order', name: '订单物流' }),
      makeCat({ id: 'uncategorized', name: '未分类', kind: 'uncategorized', filterable: false }),
      makeCat({ id: 'legacy:f1', name: '双十一', kind: 'custom', filterable: false }),
    ]
    expect(classifiableCategories(mixed, 'query').map((c) => c.id)).toEqual(['preset:order'])
  })

  it('只带 id/name/criteria,不带 kind/route 之类的本地字段', () => {
    const out = classifiableCategories(
      [makeCat({ id: 'a', name: '甲', criteria: '甲乙丙' })],
      'query',
    )
    expect(out[0]).toEqual({ id: 'a', name: '甲', criteria: '甲乙丙' })
  })

  it("record:排除 route='size' —— 尺码不该有存档记录", () => {
    expect(classifiableCategories(cats, 'record').map((c) => c.id)).toEqual(['preset:order'])
  })

  it('query:包含 route=size —— 意图识别要用它', () => {
    expect(classifiableCategories(cats, 'query').map((c) => c.id)).toEqual([
      'preset:order',
      'preset:size',
    ])
  })

  it('两个作用域都不含 filterable=false 的(未分类永远不是选项)', () => {
    for (const scope of ['record', 'query'] as const) {
      expect(classifiableCategories(cats, scope).map((c) => c.id)).not.toContain('uncategorized')
    }
  })
})

describe('pickRecordCategory', () => {
  it('取概率最高者,并回带它的概率', () => {
    expect(pickRecordCategory({ a: 0.8, b: 0.2 }, 0.2)).toEqual({
      categoryId: 'a',
      confidence: 0.8,
    })
  })

  it('最高概率低于阈值 → null(落未分类,而不是硬塞进一个不确定的类)', () => {
    expect(pickRecordCategory({ a: 0.18, b: 0.17, c: 0.17 }, 0.2)).toBeNull()
  })

  it('恰好等于阈值算过(边界取含)', () => {
    expect(pickRecordCategory({ a: 0.2, b: 0.8 }, 0.2)!.categoryId).toBe('b')
  })

  it('空分布 → null', () => {
    expect(pickRecordCategory({}, 0.2)).toBeNull()
  })
})

// ─── 端到端:classifyRecord 的门禁 ─────────────────────────────────────────────
//
// 这组测的是**门禁**:什么时候必须一个请求都不发。
// 门禁漏一条,用户在没配好的情况下也会被静默外发问题文本。
// 手法与 search.test.ts 同源:真库(fake-indexeddb)+ vi.resetModules + 动态 import,
// 不 mock db 模块 —— 打标读的是真实类型表,这条链路值得端到端跑。

describe('classifyRecord 门禁', () => {
  let testDb: PddDatabase

  beforeEach(async () => {
    for (const k of Object.keys(settingsStore)) delete settingsStore[k]
    stubLocalStorage()
    await Dexie.delete('PddCSDB')
    testDb = new PddDatabase()
    await testDb.open()
    await testDb.ensurePresetCategories()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function freshClassify() {
    vi.resetModules()
    const { classifyRecord } = await import('../../../src/background/classify')
    return classifyRecord
  }

  it('总开关关着 → 不发请求,返回 null', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await saveSettings({ classifyEnabled: false, jevApiKey: 'sk-test' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('开着但没填 key → 不发请求,返回 null', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await saveSettings({ classifyEnabled: true, jevApiKey: '' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('开着且配好 → 发一次请求,返回类型与该标签的概率;请求体不含尺码', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            answers: {
              category: {
                type: 'choice',
                choice: '发货与物流',
                probabilities: { 发货与物流: 0.91, 尺码推荐: 0.09 },
                confidence: 0.85,
              },
            },
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toEqual({
      categoryId: 'preset:order',
      confidence: 0.91,
    })

    // 记录级作用域的**端到端**落点:选项集由 classifiableCategories(cats,'record') 算出、
    // 再由 jev 拼进请求体。这里不看中间函数,直接读**真要外发的那份 body** ——
    // 尺码(route='size')的名不该出现在 criteria 的 key 里(它是查询级专用的选项)。
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    const optionNames = Object.keys(body.questions.category.criteria)
    expect(optionNames).not.toContain('尺码推荐')
    // 反向对照:同一份 body 里确实有记录级选项。少了这行,上一个断言在**空对象**上也会绿
    // (选项集为空时形状不变,只是没有 key)。
    expect(optionNames).toContain('发货与物流')
  })

  it('jev 报错 → 返回 null,不抛错(单条失败不能打断调用方)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toBeNull()
  })

  it('类型表里全是 filterable=false 时 → 不发请求(没有选项可问)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await testDb.categories.toCollection().modify({ filterable: false })
    await saveSettings({ classifyEnabled: true, jevApiKey: 'sk-test' })
    const classifyRecord = await freshClassify()
    expect(await classifyRecord('快递到哪了')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
