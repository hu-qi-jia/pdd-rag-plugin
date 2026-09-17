/**
 * 设置页滑杆的「单位契约」回归(2026-09-17 第五十二轮用户反馈)。
 *
 * 用户报:「整合超时的默认项数值太高了,滚动条有问题,拖动无变化」。
 * 根因不在滑杆组件,而在调用点把**毫秒**喂给了以**秒**为界的滑杆:
 * llmTimeoutMs 默认 8000、而 min/max 是 2/30 —— 值恒大于上限,浏览器把滑块钉在最右端;
 * 每次拖动算出的新值(2~30 秒)落回设置又变成 2000~30000 毫秒,再次超上限、再次被钉回右端,
 * 于是肉眼看到的正是"拖不动",读数还写着「8000 秒」。
 *
 * 这组用例钉住一条**通用不变量**:每个滑杆显示的数值必须落在它自己的 [min, max] 内 ——
 * 值域与显示同源,单位错配在这里当场现形,不必逐个滑杆记住换算。
 * (第二、三条钉住整合超时这一处的两个方向:毫秒 → 秒的读数、秒 → 毫秒的落库。)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetStatsResponse, UpdateSettingsRequest } from '../../../src/types/messages'
import type { PddSettings } from '../../../src/types/memory'
import { DEFAULT_SETTINGS, LLM_TIMEOUT_MAX_MS, LLM_TIMEOUT_MIN_MS } from '../../../src/shared/constants'

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
/** 后台收到的 UPDATE_SETTINGS payload(按发送顺序) */
let sentSettings: Partial<PddSettings>[]

interface SliderProbe {
  label: string
  /** 行内显示的数值(从格式化文本解出,如「8 秒」→ 8、「0.50」→ 0.5) */
  shown: number
  min: number
  max: number
  input: HTMLInputElement
}

/**
 * 读出页面上每个滑杆的「标签 / 显示值 / 量程」。
 * 滑杆块的 DOM 形状由 Slider 组件固定:块 = [标签行(标签, 当前值), 轨道]。
 */
function probeSliders(): SliderProbe[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input.pddcs-slider')).map(
    (input) => {
      const labelRow = input.parentElement!.children[0]
      const label = labelRow.children[0].textContent ?? ''
      const shown = Number.parseFloat(labelRow.children[1].textContent ?? '')
      return { label, shown, min: Number(input.min), max: Number(input.max), input }
    },
  )
}

const probe = (label: string): SliderProbe => {
  const p = probeSliders().find((s) => s.label === label)
  if (!p) throw new Error(`找不到滑杆:${label}`)
  return p
}

/** 拖动滑杆:React 对 range 的 onChange 监听 input 事件,须用原生 value setter 绕过值去重 */
const drag = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function renderSettings(settings: PddSettings = { ...DEFAULT_SETTINGS }) {
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
  mockedSend.mockImplementation(async (msg: { type: string }) => {
    if (msg.type === 'GET_STATS') return { ...stats, payload: { ...stats.payload, settings: current } }
    if (msg.type === 'UPDATE_SETTINGS') {
      const payload = (msg as unknown as UpdateSettingsRequest).payload
      sentSettings.push(payload)
      current = { ...current, ...payload }
      return { type: 'UPDATE_SETTINGS_RESPONSE', payload: { settings: current } }
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
  sentSettings = []
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('设置页滑杆:显示值必须落在自己的量程内(第五十二轮回归)', () => {
  it('每个滑杆的读数都在它的 [min, max] 里', async () => {
    await renderSettings()
    const all = probeSliders()
    // 反空转:设置页的滑杆一个都不能少(阈值三档 + 保留期 + 整合超时 = 5)
    expect(all.length).toBeGreaterThanOrEqual(5)
    for (const s of all) {
      expect(s.shown, `滑杆「${s.label}」读数 ${s.shown} 越出量程 [${s.min}, ${s.max}]`).toBeGreaterThanOrEqual(s.min)
      expect(s.shown, `滑杆「${s.label}」读数 ${s.shown} 越出量程 [${s.min}, ${s.max}]`).toBeLessThanOrEqual(s.max)
    }
  })

  it('整合超时:默认显示 8 秒、量程 2~30 秒(滑杆读秒,不再把毫秒当秒显示)', async () => {
    await renderSettings()
    const s = probe('整合超时')
    expect(s.min).toBe(LLM_TIMEOUT_MIN_MS / 1000)
    expect(s.max).toBe(LLM_TIMEOUT_MAX_MS / 1000)
    expect(s.min).toBe(2)
    expect(s.max).toBe(30)
    // DEFAULT_SETTINGS.llmTimeoutMs = 8000ms ⇒ 界面上是 8 秒。若把毫秒直接喂进来,
    // 这里读到的会是 8000,而 8000 越出 [2, 30] —— 上一条用例同时会红。
    expect(s.shown).toBe(DEFAULT_SETTINGS.llmTimeoutMs / 1000)
    expect(s.shown).toBe(8)
  })

  it('拖动整合超时:读数当场跟着走,落库的是毫秒', async () => {
    await renderSettings()
    const before = probe('整合超时')
    await drag(before.input, '9')
    // 拖动即时反馈(不等落库):这就是用户说的"拖动无变化"的反面
    expect(probe('整合超时').shown).toBe(9)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 650)) // 滑杆 500ms detent 防抖
    })
    expect(sentSettings).toHaveLength(1)
    expect(sentSettings[0].llmTimeoutMs).toBe(9000)
  })
})

describe('AI 表单三行不再带解释文案(第五十二轮用户要求)', () => {
  it('三行只剩标签与输入框,原本的说明文字不再出现', async () => {
    await renderSettings()
    // 先确认三行还在(否则"没出现"可以靠整块没渲染来蒙混)
    expect(container.textContent).toContain('接口地址')
    expect(container.textContent).toContain('API Key')
    expect(container.textContent).toContain('模型名')
    expect(container.textContent).not.toContain('OpenAI 兼容')
    expect(container.textContent).not.toContain('只存这台电脑')
    expect(container.textContent).not.toContain('非思考型模型')
  })
})
