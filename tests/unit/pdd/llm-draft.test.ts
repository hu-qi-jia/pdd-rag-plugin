// AI 表单草稿单测:边填边存的落库/读回/清除,以及"草稿不是生效配置"这条边界。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LLM_DRAFT_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '../../../src/shared/constants'

/** chrome.storage.local 内存桩(callback 风格,与 chrome-storage.ts 一致) */
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
  local.remove = (keys: string | string[], cb?: () => void): Promise<void> => {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k]
    cb?.()
    return Promise.resolve()
  }
}

async function fresh() {
  vi.resetModules()
  stubLocalStorage()
  return import('../../../src/pdd/llm-draft')
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
})

describe('llm-draft:存 / 读 / 清', () => {
  it('存进去的字段原样读得回来', async () => {
    const { saveLlmDraft, loadLlmDraft } = await fresh()
    await saveLlmDraft({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: 'deepseek-chat' })
    expect(await loadLlmDraft()).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-x',
      model: 'deepseek-chat',
    })
  })

  it('没存过 → null(调用方据此回落到正式配置)', async () => {
    const { loadLlmDraft } = await fresh()
    expect(await loadLlmDraft()).toBeNull()
  })

  it('清除后读回 null', async () => {
    const { saveLlmDraft, loadLlmDraft, clearLlmDraft } = await fresh()
    await saveLlmDraft({ baseUrl: 'https://a.com', apiKey: 'k', model: 'm' })
    await clearLlmDraft()
    expect(await loadLlmDraft()).toBeNull()
    expect(LLM_DRAFT_STORAGE_KEY in store).toBe(false) // 是真删掉,不是存了个空值
  })

  it('空串也照存 —— "用户把地址清空了"本身就是要续上的状态', async () => {
    const { saveLlmDraft, loadLlmDraft } = await fresh()
    await saveLlmDraft({ baseUrl: '', apiKey: '', model: '' })
    expect(await loadLlmDraft()).toEqual({ baseUrl: '', apiKey: '', model: '' })
  })

  it('脏数据(缺字段/类型不对)→ null,不把半个对象当草稿用', async () => {
    const { loadLlmDraft } = await fresh()
    for (const bad of [{ baseUrl: 'x' }, { baseUrl: 1, apiKey: 'k', model: 'm' }, 'nope', 42, null]) {
      store[LLM_DRAFT_STORAGE_KEY] = bad
      expect(await loadLlmDraft()).toBeNull()
    }
  })
})

describe('llm-draft:草稿不是生效配置(数据边界)', () => {
  it('草稿写的是自己的键,绝不碰 pddcs:settings', async () => {
    const { saveLlmDraft } = await fresh()
    await saveLlmDraft({ baseUrl: 'https://evil.example.com', apiKey: 'sk-半途而废', model: 'm' })
    expect(store[LLM_DRAFT_STORAGE_KEY]).toBeTruthy()
    // 这是本模块存在的全部意义:没点「保存」的半截密钥永远不会变成生效配置,
    // 也就永远不会被拿去发请求。
    expect(SETTINGS_STORAGE_KEY in store).toBe(false)
  })

  it('存储键名固定,改动会让老草稿读不出来(视为破坏性变更)', () => {
    expect(LLM_DRAFT_STORAGE_KEY).toBe('pddcs:llmDraft')
  })

  it('防抖间隔是个"人手够用、存储不累"的中间值', async () => {
    const { LLM_DRAFT_DEBOUNCE_MS } = await fresh()
    expect(LLM_DRAFT_DEBOUNCE_MS).toBeGreaterThanOrEqual(200)
    expect(LLM_DRAFT_DEBOUNCE_MS).toBeLessThanOrEqual(1000)
  })
})
