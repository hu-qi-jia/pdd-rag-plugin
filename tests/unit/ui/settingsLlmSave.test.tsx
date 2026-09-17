// 设置页「AI 整合」保存单测(2026-09-17 第四十八轮用户反馈修复)。
//
// 用户报的现象:「输入模型配置后点击保存,输入的内容会全部消失,并且不可使用」。
// 根因不是失焦丢数据(那是前一轮已经解决的草稿问题),而是**保存路径根本没写进去**:
// 表单状态用的是 { baseUrl, apiKey, model },而 PddSettings 的字段叫
// { llmBaseUrl, llmApiKey, llmModel } —— 保存时 `{...draft, ...llm}` 把前者摊进后者,
// 多出来的键 TS 不报错(展开表达式不走多余属性检查),后台按自己的字段名一读全是旧值。
// 于是:① 提交的配置没有任何一项落库;② 回填拿的是后台返回的旧设置,当场把表单清空;
// ③ 草稿又被 clearLlmDraft 清掉 —— 关掉重开也回不来,观感就是"填了就消失,而且没用"。
//
// 这组用例钉住三件事:提交的 payload 必须带 llm* 键、保存后框里还是用户填的字、
// 保存后「测试连接」仍然可用(用户说的"不可使用"就是它变灰)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetStatsResponse, UpdateSettingsRequest } from '../../../src/types/messages'
import type { PddSettings } from '../../../src/types/memory'
import { DEFAULT_SETTINGS, LLM_DRAFT_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '../../../src/shared/constants'
import { LLM_DRAFT_DEBOUNCE_MS } from '../../../src/pdd/llm-draft'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { SettingsTab } = await import('../../../src/popup/SettingsTab')
const { lightTheme } = await import('../../../src/ui/theme')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
/** chrome.storage.local 的内存后端(草稿读写要能真正往返) */
let store: Record<string, unknown>
/** 后台收到的 UPDATE_SETTINGS payload(按发送顺序) */
let sentSettings: Partial<PddSettings>[]

const URL_TYPED = 'https://api.deepseek.com/v1/'
const URL_SAVED = 'https://api.deepseek.com/v1' // 后台夹取去尾斜杠后的样子

/**
 * 迷你后台:UPDATE_SETTINGS 按**设置自己的字段名**夹取后回存 ——
 * 与 src/background/settings.ts 的 clampSettings 同构(去空白、URL 去尾斜杠)。
 * 不这么写的话,测试就只是在断言 mock 自己。
 */
function applySettings(patch: Partial<PddSettings>, base: PddSettings): PddSettings {
  const merged = { ...base, ...patch }
  return {
    ...merged,
    llmBaseUrl: typeof merged.llmBaseUrl === 'string' ? merged.llmBaseUrl.trim().replace(/\/+$/, '') : '',
    llmApiKey: typeof merged.llmApiKey === 'string' ? merged.llmApiKey.trim() : '',
    llmModel: typeof merged.llmModel === 'string' ? merged.llmModel.trim() : '',
  }
}

const typeIn = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const inputByPlaceholder = (p: string): HTMLInputElement => {
  const el = container.querySelector<HTMLInputElement>(`input[placeholder="${p}"]`)
  if (!el) throw new Error(`找不到输入框:${p}`)
  return el
}

const textBtn = (label: string): HTMLButtonElement => {
  const b = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (x) => x.textContent?.trim() === label,
  )
  if (!b) throw new Error(`找不到按钮:${label}`)
  return b
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** 渲染并等到设置与草稿都读回来(draft → 再异步读草稿,两跳) */
async function renderSettings(settings: PddSettings) {
  const stats: GetStatsResponse = {
    type: 'GET_STATS_RESPONSE',
    payload: {
      qaCount: 0,
      replyCount: 0,
      goldenCount: 0,
      folderCount: 0,
      knowledgeCount: 0,
      settings,
      embeddingModel: 'test',
    },
  }
  let current = settings
  mockedSend.mockImplementation(async (msg: { type: string; payload?: Record<string, unknown> }) => {
    if (msg.type === 'GET_STATS') return { ...stats, payload: { ...stats.payload, settings: current } }
    if (msg.type === 'UPDATE_SETTINGS') {
      const payload = (msg as unknown as UpdateSettingsRequest).payload
      sentSettings.push(payload)
      current = applySettings(payload, current)
      return { type: 'UPDATE_SETTINGS_RESPONSE', payload: { settings: current } }
    }
    return { type: 'UPDATE_SETTINGS_RESPONSE', payload: { settings: current } }
  })
  await act(async () => {
    root.render(<SettingsTab tk={lightTheme} onDataChanged={vi.fn()} />)
  })
  await flush()
}

/** 填满三个框并点保存 */
async function fillAndSave() {
  await typeIn(inputByPlaceholder('https://api.deepseek.com/v1'), URL_TYPED)
  await typeIn(inputByPlaceholder('sk-…'), 'sk-test-key')
  await typeIn(inputByPlaceholder('deepseek-chat'), 'deepseek-chat')
  await act(async () => {
    textBtn('保存').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockedSend.mockReset()
  store = {}
  sentSettings = []

  // 内存版 chrome.storage.local:草稿的存/读/清要真的能往返
  const local = chrome.storage.local as unknown as {
    get: (keys: string[], cb: (items: Record<string, unknown>) => void) => Promise<unknown>
    set: (items: Record<string, unknown>, cb: () => void) => Promise<unknown>
    remove: (key: string, cb: () => void) => Promise<unknown>
  }
  local.get = (keys, cb) => {
    const out: Record<string, unknown> = {}
    for (const k of keys) if (k in store) out[k] = store[k]
    cb(out)
    return Promise.resolve(out)
  }
  local.set = (items, cb) => {
    Object.assign(store, items)
    cb()
    return Promise.resolve()
  }
  local.remove = (key, cb) => {
    delete store[key]
    cb()
    return Promise.resolve()
  }

  // 申请主机权限必须成功,否则 saveLlm 会走到"未授权"分支另发一条提示
  ;(chrome as unknown as Record<string, unknown>).permissions = {
    request: vi.fn(async () => true),
  }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SettingsTab:AI 整合表单保存(第四十八轮回归)', () => {
  it('保存后输入框里还是用户填的内容(不是被回填的旧设置清空)', async () => {
    await renderSettings({ ...DEFAULT_SETTINGS })
    await fillAndSave()

    expect(inputByPlaceholder('https://api.deepseek.com/v1').value).toBe(URL_SAVED)
    expect(inputByPlaceholder('sk-…').value).toBe('sk-test-key')
    expect(inputByPlaceholder('deepseek-chat').value).toBe('deepseek-chat')
  })

  it('提交给后台的是设置自己的字段名 llmBaseUrl/llmApiKey/llmModel', async () => {
    await renderSettings({ ...DEFAULT_SETTINGS })
    await fillAndSave()

    expect(sentSettings).toHaveLength(1)
    expect(sentSettings[0].llmBaseUrl).toBe(URL_TYPED) // 夹取是后台的事,popup 不预改用户输入
    expect(sentSettings[0].llmApiKey).toBe('sk-test-key')
    expect(sentSettings[0].llmModel).toBe('deepseek-chat')
  })

  it('保存后「测试连接」仍可用(用户说的"不可使用"就是它变灰)', async () => {
    await renderSettings({ ...DEFAULT_SETTINGS })
    await fillAndSave()

    expect(textBtn('测试连接').disabled).toBe(false)
    expect(textBtn('保存').disabled).toBe(true) // 已无未保存改动
    expect(container.textContent).not.toContain('有未保存的修改')
  })

  it('保存成功后草稿被清掉,且不会被挂起的防抖定时器写回来', async () => {
    await renderSettings({ ...DEFAULT_SETTINGS })
    await fillAndSave()

    expect(store[LLM_DRAFT_STORAGE_KEY]).toBeUndefined()
    // 等过草稿防抖(300ms):保存前那最后一次敲字排的定时器若不掐掉,会在这期间
    // 把旧值(还没被后台去尾斜杠的那份)重新写回草稿 —— 再打开就是"草稿复活",
    // 而它永远比正式配置多一个斜杠,「有未保存的修改」从此怎么点保存都消不掉。
    await act(async () => {
      await new Promise((r) => setTimeout(r, LLM_DRAFT_DEBOUNCE_MS + 50))
    })
    expect(store[LLM_DRAFT_STORAGE_KEY]).toBeUndefined()
  })

  it('重新打开时读回的是已保存的配置(不是空表单)', async () => {
    await renderSettings({ ...DEFAULT_SETTINGS })
    await fillAndSave()

    act(() => root.unmount())
    container.remove()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    sentSettings = []
    const saved = applySettings(
      { llmBaseUrl: URL_TYPED, llmApiKey: 'sk-test-key', llmModel: 'deepseek-chat' },
      { ...DEFAULT_SETTINGS },
    )
    await renderSettings(saved)

    expect(inputByPlaceholder('https://api.deepseek.com/v1').value).toBe(URL_SAVED)
    expect(inputByPlaceholder('sk-…').value).toBe('sk-test-key')
    expect(inputByPlaceholder('deepseek-chat').value).toBe('deepseek-chat')
  })
})
