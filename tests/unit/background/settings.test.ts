// 设置读写单测:默认值合并 + 脏数据夹取。
// 重点在 AI 整合字段 —— 它们决定扩展是否会发起网络请求,夹取错了就是数据边界问题。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/constants'
// 问题分类设置用例直接调 loadSettings/saveSettings(与上面各 describe 的 fresh() 动态导入等价,
// 这里用静态导入即可 —— 它们读写的都是同一个 chrome.storage.local 桩)
import { loadSettings, saveSettings } from '../../../src/background/settings'

/** chrome.storage.local 内存桩(callback 风格,与 chrome-storage.ts 的调用方式一致) */
const store: Record<string, unknown> = {}

function stubLocalStorage(): void {
  const local = chrome.storage.local as unknown as Record<string, unknown>
  local.get = (
    keys: string | string[] | null,
    cb?: (r: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> => {
    const wanted = keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]
    const out: Record<string, unknown> = {}
    for (const k of wanted) if (k in store) out[k] = store[k]
    cb?.(out)
    return Promise.resolve(out)
  }
  local.set = (items: Record<string, unknown>, cb?: () => void): Promise<void> => {
    Object.assign(store, items)
    cb?.()
    return Promise.resolve()
  }
}

async function fresh() {
  vi.resetModules()
  stubLocalStorage()
  return import('../../../src/background/settings')
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
})

describe('AI 整合设置项', () => {
  it('缺省:关闭、空配置、超时 8000 —— 扩展保持完全本地', async () => {
    const { loadSettings } = await fresh()
    const s = await loadSettings()
    expect(s.aiIntegrateEnabled).toBe(false)
    expect(s.llmBaseUrl).toBe('')
    expect(s.llmApiKey).toBe('')
    expect(s.llmModel).toBe('')
    expect(s.llmTimeoutMs).toBe(8000)
  })

  it('存取往返:配置持久化到 chrome.storage.local', async () => {
    const { loadSettings, saveSettings } = await fresh()
    await saveSettings({
      aiIntegrateEnabled: true,
      llmBaseUrl: 'https://api.deepseek.com/v1',
      llmApiKey: 'sk-test',
      llmModel: 'deepseek-chat',
    })
    const s = await loadSettings()
    expect(s.aiIntegrateEnabled).toBe(true)
    expect(s.llmBaseUrl).toBe('https://api.deepseek.com/v1')
    expect(s.llmApiKey).toBe('sk-test')
    expect(s.llmModel).toBe('deepseek-chat')
  })

  it('baseUrl 只认 http(s) 绝对地址,其余归一为空串(=未配置)', async () => {
    const { loadSettings } = await fresh()
    for (const bad of ['不是网址', '/v1', 'javascript:alert(1)', 'ftp://x.com/v1', '   ']) {
      store['pddcs:settings'] = { ...DEFAULT_SETTINGS, llmBaseUrl: bad }
      expect((await loadSettings()).llmBaseUrl).toBe('')
    }
  })

  it('baseUrl 去掉尾部斜杠,避免拼出 //chat/completions', async () => {
    const { loadSettings } = await fresh()
    store['pddcs:settings'] = { ...DEFAULT_SETTINGS, llmBaseUrl: 'https://a.com/v1///' }
    expect((await loadSettings()).llmBaseUrl).toBe('https://a.com/v1')
  })

  it('超时夹取在 2000~30000,脏值回退默认', async () => {
    const { loadSettings } = await fresh()
    const cases: Array<[unknown, number]> = [
      [1, 2000],
      [999999, 30000],
      [0, 8000],
      ['abc', 8000],
      [5000, 5000],
    ]
    for (const [input, want] of cases) {
      store['pddcs:settings'] = { ...DEFAULT_SETTINGS, llmTimeoutMs: input }
      expect((await loadSettings()).llmTimeoutMs).toBe(want)
    }
  })

  it('非字符串 key/model 归一为空串,不抛错', async () => {
    const { loadSettings } = await fresh()
    store['pddcs:settings'] = { ...DEFAULT_SETTINGS, llmApiKey: 123, llmModel: { a: 1 } }
    const s = await loadSettings()
    expect(s.llmApiKey).toBe('')
    expect(s.llmModel).toBe('')
  })

  it('saveSettings 局部更新不冲掉其他 AI 字段', async () => {
    const { loadSettings, saveSettings } = await fresh()
    await saveSettings({ llmBaseUrl: 'https://a.com/v1', llmModel: 'm1' })
    await saveSettings({ aiIntegrateEnabled: true })
    const s = await loadSettings()
    expect(s.llmBaseUrl).toBe('https://a.com/v1')
    expect(s.llmModel).toBe('m1')
    expect(s.aiIntegrateEnabled).toBe(true)
  })
})

describe('既有设置项不受影响(回归)', () => {
  it('快捷键与阈值照旧夹取', async () => {
    const { loadSettings } = await fresh()
    store['pddcs:settings'] = {
      ...DEFAULT_SETTINGS,
      simThreshold: 5,
      retentionDays: 1,
      autoReplyHotkey: { key: 'k' },
    }
    const s = await loadSettings()
    expect(s.simThreshold).toBe(1)
    expect(s.retentionDays).toBe(30)
    expect(s.autoReplyHotkey).toEqual({ ctrl: false, alt: false, shift: false, key: 'k' })
  })
})

// ─── 问题分类设置(第五十六轮) ──────────────────────────────────────────────────
//
// 这一组字段的失败模式是静默失效:clampSettings 是逐字段手写的,
// 漏一个字段不会报错,只会让设置页填的值永远读不回来。所以每个字段都要有断言。

describe('问题分类设置', () => {
  // 静态导入的是同一个模块;这里显式装一次 storage 桩,保证每个用例都从空配置起步
  beforeEach(stubLocalStorage)

  it('默认全关、Key 为空 —— 未配置时扩展必须保持完全本地', async () => {
    const s = await loadSettings()
    expect(s.classifyEnabled).toBe(false)
    // 地址有默认值(官方端点),用户要填的只有 key;下面那几条共同保证"未配置 ⇒ 零请求"
    expect(s.jevBaseUrl).toBe('https://api.typesafe.ai')
    expect(s.jevApiKey).toBe('')
    expect(s.jevModel).toBe('jev-latest')
    expect(s.jevTimeoutMs).toBe(3000)
    expect(s.classifyProbThreshold).toBe(0.2)
  })

  it('六个字段都能存能读(漏 clamp 会在这里露馅)', async () => {
    await saveSettings({
      classifyEnabled: true,
      jevBaseUrl: 'https://api.example.com',
      jevApiKey: 'sk-test',
      jevModel: 'jev-1.13.0',
      jevTimeoutMs: 5000,
      classifyProbThreshold: 0.35,
    })
    const s = await loadSettings()
    expect(s.classifyEnabled).toBe(true)
    expect(s.jevBaseUrl).toBe('https://api.example.com')
    expect(s.jevApiKey).toBe('sk-test')
    expect(s.jevModel).toBe('jev-1.13.0')
    expect(s.jevTimeoutMs).toBe(5000)
    expect(s.classifyProbThreshold).toBe(0.35)
  })

  it('地址只认 http(s),尾斜杠剔掉,非法值归一为空串', async () => {
    await saveSettings({ jevBaseUrl: 'https://api.example.com/v1/' })
    expect((await loadSettings()).jevBaseUrl).toBe('https://api.example.com/v1')
    await saveSettings({ jevBaseUrl: 'javascript:alert(1)' })
    expect((await loadSettings()).jevBaseUrl).toBe('')
  })

  it('超时夹在 1000~30000 之间', async () => {
    await saveSettings({ jevTimeoutMs: 1 })
    expect((await loadSettings()).jevTimeoutMs).toBe(1000)
    await saveSettings({ jevTimeoutMs: 999999 })
    expect((await loadSettings()).jevTimeoutMs).toBe(30000)
  })

  it('概率阈值夹在 0~1 之间', async () => {
    await saveSettings({ classifyProbThreshold: -1 })
    expect((await loadSettings()).classifyProbThreshold).toBe(0)
    await saveSettings({ classifyProbThreshold: 5 })
    expect((await loadSettings()).classifyProbThreshold).toBe(1)
  })
})
