// 设置页「问题分类」区单测(第五十七轮 · Task 3)。
//
// 与 settingsLlmSave.test.tsx 同构:两套外部端点的配置卡片长在同一页上,
// 结构、保存路径、草稿与自查提示都必须逐段对应。这组用例钉住分类卡片独有的四件事:
//  ① 开关开着但字段没填全时**一行红字**说清"不会生效",且**一个请求都不发**(ADR-0007 零远程);
//  ② 「测试连接」拿草稿去测,结论就地显示在按钮右侧(不弹 Notice);
//  ③ 保存先按 origin 申请主机权限(MV3 optional_host_permissions);
//  ④ 未保存的改动落进 jev 草稿(弹窗销毁后能续上)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetStatsResponse, UpdateSettingsRequest } from '../../../src/types/messages'
import type { PddSettings } from '../../../src/types/memory'
import { DEFAULT_SETTINGS, JEV_DRAFT_STORAGE_KEY } from '../../../src/shared/constants'
import { JEV_DRAFT_DEBOUNCE_MS } from '../../../src/popup/jevDraft'

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
/** popup 发出去的全部消息(按发送顺序) */
let sent: { type: string; payload?: unknown }[]
/** TEST_JEV 的回报(每条用例自定) */
let testJevResult: { ok: boolean; error?: string }

const JEV_URL_TYPED = 'https://api.typesafe.ai/'
const JEV_URL_SAVED = 'https://api.typesafe.ai' // 后台夹取去尾斜杠后的样子

/**
 * 迷你后台:UPDATE_SETTINGS 按**设置自己的字段名**夹取后回存 ——
 * 与 src/background/settings.ts 的 clampSettings 同构(去空白、URL 去尾斜杠)。
 */
function applySettings(patch: Partial<PddSettings>, base: PddSettings): PddSettings {
  const merged = { ...base, ...patch }
  const url = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '')
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    ...merged,
    llmBaseUrl: url(merged.llmBaseUrl),
    llmApiKey: text(merged.llmApiKey),
    llmModel: text(merged.llmModel),
    jevBaseUrl: url(merged.jevBaseUrl),
    jevApiKey: text(merged.jevApiKey),
    jevModel: text(merged.jevModel),
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

/** 卡内查输入框:API Key 的占位符与「AI 整合」卡相同,必须限定在本卡内 */
const inputIn = (root: HTMLElement, p: string): HTMLInputElement => {
  const el = root.querySelector<HTMLInputElement>(`input[placeholder="${p}"]`)
  if (!el) throw new Error(`卡片内找不到输入框:${p}`)
  return el
}

/**
 * 「问题分类」卡片本身 —— 同页的「AI 整合」卡片有同名的「保存 / 测试连接」按钮,
 * 全页查按钮会拿到上面那一张卡的(它默认禁用),测的就不是本卡。一律在卡内查。
 */
function classifyCard(): HTMLElement {
  const title = Array.from(container.querySelectorAll<HTMLElement>('div')).find(
    (e) => e.children.length === 0 && e.textContent?.trim() === '问题分类',
  )
  if (!title?.parentElement) throw new Error('找不到「问题分类」卡片')
  return title.parentElement
}

const textBtnIn = (root: HTMLElement, label: string): HTMLButtonElement => {
  const b = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (x) => x.textContent?.trim() === label,
  )
  if (!b) throw new Error(`找不到按钮:${label}`)
  return b
}

/** 分类开关(aria-label 区分同页的 AI 整合开关) */
const classifySwitch = () =>
  container.querySelector<HTMLElement>('[role="switch"][aria-label="自动分类"]')!

/** 该元素的内联色是否等于某设计令牌(经同款探针归一,避开 hex/rgb 表示差异) */
function colorIs(el: HTMLElement, token: string): boolean {
  const probe = document.createElement('div')
  probe.style.color = token
  return el.style.color === probe.style.color
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** 渲染并等到设置与草稿都读回来(draft → 再异步读草稿,两跳) */
async function renderSettings(settings: PddSettings) {
  let current = settings
  mockedSend.mockImplementation(async (msg: { type: string; payload?: Record<string, unknown> }) => {
    sent.push(msg)
    if (msg.type === 'GET_STATS') {
      const stats: GetStatsResponse = {
        type: 'GET_STATS_RESPONSE',
        payload: {
          qaCount: 0,
          replyCount: 0,
          goldenCount: 0,
          folderCount: 0,
          knowledgeCount: 0,
          settings: current,
          embeddingModel: 'test',
        },
      }
      return stats
    }
    if (msg.type === 'UPDATE_SETTINGS') {
      const payload = (msg as unknown as UpdateSettingsRequest).payload
      current = applySettings(payload, current)
      return { type: 'UPDATE_SETTINGS_RESPONSE', payload: { settings: current } }
    }
    if (msg.type === 'TEST_JEV') {
      return { type: 'TEST_JEV_RESPONSE', payload: testJevResult }
    }
    return { type: 'UPDATE_SETTINGS_RESPONSE', payload: { settings: current } }
  })
  await act(async () => {
    root.render(<SettingsTab tk={lightTheme} onDataChanged={vi.fn()} />)
  })
  await flush()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockedSend.mockReset()
  store = {}
  sent = []
  testJevResult = { ok: true }

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

  // 申请主机权限必须成功,否则保存会走"未授权"分支另发一条提示
  ;(chrome as unknown as Record<string, unknown>).permissions = {
    request: vi.fn(async () => true),
  }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('设置页 · 问题分类区', () => {
  it('默认关闭,且三个字段从设置回填', async () => {
    await renderSettings({
      ...DEFAULT_SETTINGS,
      classifyEnabled: false,
      jevApiKey: 'sk-jev',
      jevModel: 'jev-latest',
    })

    expect(classifySwitch().getAttribute('aria-checked')).toBe('false')
    // API Key 输入框默认是 password(密码形态),值来自设置
    expect(inputIn(classifyCard(), 'sk-…').type).toBe('password')
    expect(inputIn(classifyCard(), 'sk-…').value).toBe('sk-jev')
    expect(inputByPlaceholder('jev-latest').value).toBe('jev-latest')
  })

  it('★ 开着但没填全 → 一行红字说清"不会生效",且不发任何请求', async () => {
    await renderSettings({
      ...DEFAULT_SETTINGS,
      classifyEnabled: true,
      jevApiKey: '', // 三项缺一 —— 未配置
    })

    // 按钮渲染出来了(不是"看不见所以没点"),但缺字段时禁用
    expect(textBtnIn(classifyCard(), '测试连接').disabled).toBe(true)

    // 一行红字:先说"已开启,但…尚未填全"
    const hint = Array.from(container.querySelectorAll<HTMLElement>('div')).find(
      (e) => e.children.length === 0 && e.textContent?.includes('尚未填全') && e.textContent?.includes('已开启'),
    )
    expect(hint).toBeTruthy()
    expect(colorIs(hint!, lightTheme.errorText)).toBe(true)

    // ADR-0007 零远程:渲染过程中(未点击任何测试按钮)不得发出 TEST_JEV
    expect(sent.some((m) => m.type === 'TEST_JEV')).toBe(false)
    expect(mockedSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'TEST_JEV' }))
  })

  it('点「测试连接」→ 发 TEST_JEV,并把结论显示在按钮右侧(不弹 Notice)', async () => {
    testJevResult = { ok: false, error: 'http 401' }
    await renderSettings({
      ...DEFAULT_SETTINGS,
      classifyEnabled: true,
      jevBaseUrl: '',
      jevApiKey: '',
      jevModel: '',
    })

    await typeIn(inputByPlaceholder('https://api.typesafe.ai'), 'https://api.typesafe.ai')
    await typeIn(inputIn(classifyCard(), 'sk-…'), 'sk-jev')
    await typeIn(inputByPlaceholder('jev-latest'), 'jev-latest')

    const btn = textBtnIn(classifyCard(), '测试连接')
    expect(btn.disabled).toBe(false)
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    // 发出了 TEST_JEV,且带的是草稿里的那份配置
    const testCall = sent.find((m) => m.type === 'TEST_JEV')
    expect(testCall).toBeTruthy()
    expect(testCall!.payload).toMatchObject({
      baseUrl: 'https://api.typesafe.ai',
      apiKey: 'sk-jev',
      model: 'jev-latest',
    })

    // 结论显示在按钮**右侧**(同一行的兄弟节点),含 401 这条可动手的线索
    const row = btn.parentElement!
    const inline = Array.from(row.children).find((c) => c.textContent?.includes('401'))
    expect(inline).toBeTruthy()

    // 不弹 Notice:页面上没有"失败"字样的提示条(结论只走按钮右侧那一行)
    expect(container.textContent).not.toContain('失败')
  })

  it('保存时会为该地址申请主机权限', async () => {
    await renderSettings({
      ...DEFAULT_SETTINGS,
      jevBaseUrl: '',
      jevApiKey: '',
      jevModel: '',
    })

    await typeIn(inputByPlaceholder('https://api.typesafe.ai'), JEV_URL_TYPED)
    await typeIn(inputIn(classifyCard(), 'sk-…'), 'sk-jev')
    await typeIn(inputByPlaceholder('jev-latest'), 'jev-latest')
    await act(async () => {
      textBtnIn(classifyCard(), '保存').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    const request = (chrome as unknown as { permissions: { request: ReturnType<typeof vi.fn> } })
      .permissions.request
    expect(request).toHaveBeenCalled()
    const origins = request.mock.calls[0][0].origins as string[]
    expect(origins).toContain('https://api.typesafe.ai/*')
    // 提交的 payload 必须带 jev* 键(表单叫 baseUrl,设置叫 jevBaseUrl)
    const upd = sent.find((m) => m.type === 'UPDATE_SETTINGS')
    expect(upd!.payload).toMatchObject({ jevBaseUrl: JEV_URL_TYPED, jevApiKey: 'sk-jev', jevModel: 'jev-latest' })
  })

  it('改完没保存 → 有未保存提示', async () => {
    await renderSettings({ ...DEFAULT_SETTINGS, jevModel: 'jev-latest' })

    await typeIn(inputByPlaceholder('jev-latest'), 'jev-other')

    expect(container.textContent).toContain('有未保存的修改。')
  })

  it('未保存的改动会落进草稿(弹窗销毁后能续上)', async () => {
    await renderSettings({ ...DEFAULT_SETTINGS, jevApiKey: '' })

    await typeIn(inputIn(classifyCard(), 'sk-…'), 'sk-new')
    await act(async () => {
      await new Promise((r) => setTimeout(r, JEV_DRAFT_DEBOUNCE_MS + 50))
    })

    expect(store[JEV_DRAFT_STORAGE_KEY]).toEqual({
      baseUrl: DEFAULT_SETTINGS.jevBaseUrl,
      apiKey: 'sk-new',
      model: DEFAULT_SETTINGS.jevModel,
    })
  })
})
