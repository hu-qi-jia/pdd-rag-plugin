import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetStatsResponse, UpdateSettingsRequest } from '../../../src/types/messages'
import type { PddSettings } from '../../../src/types/memory'
import { DEFAULT_SETTINGS } from '../../../src/shared/constants'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))

const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)
const { SettingsTab } = await import('../../../src/popup/SettingsTab')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let sentSettings: Partial<PddSettings>[]

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderSettings(settings: PddSettings = { ...DEFAULT_SETTINGS }) {
  let current = settings
  const stats: GetStatsResponse = {
    type: 'GET_STATS_RESPONSE',
    payload: {
      qaCount: 0,
      replyCount: 0,
      goldenCount: 0,
      folderCount: 0,
      knowledgeCount: 0,
      categories: [],
      settings,
      embeddingModel: 'test',
    },
  }
  mockedSend.mockImplementation(async (msg: { type: string }) => {
    if (msg.type === 'GET_STATS') {
      return { ...stats, payload: { ...stats.payload, settings: current } }
    }
    if (msg.type === 'GET_BACKFILL_STATE') {
      return {
        type: 'GET_BACKFILL_STATE_RESPONSE',
        payload: {
          status: { phase: 'idle', total: 0, done: 0, ok: 0, failed: 0, skipped: 0 },
          pending: { history: 0, golden: 0 },
        },
      }
    }
    if (msg.type === 'UPDATE_SETTINGS') {
      const payload = (msg as UpdateSettingsRequest).payload
      sentSettings.push(payload)
      current = { ...current, ...payload }
      return { type: 'UPDATE_SETTINGS_RESPONSE', payload: { settings: current } }
    }
    return { type: 'UPDATE_SETTINGS_RESPONSE', payload: { settings: current } }
  })
  await act(async () => {
    root.render(<SettingsTab onDataChanged={vi.fn()} />)
  })
  await flush()
}

/** 分页后的设置页:先切到目标分区,再断言。 */
async function gotoPage(label: string) {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('.pddcs-catnav button')).find(
    (b) => b.textContent?.trim() === label,
  )
  if (!btn) throw new Error(`找不到设置分区:${label}`)
  await act(async () => {
    btn.click()
  })
  await flush()
}

const choiceGroup = (label: string): HTMLElement => {
  const group = container.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${label}"]`)
  if (!group) throw new Error(`找不到档位组:${label}`)
  return group
}

const choose = async (label: string, text: string) => {
  const button = Array.from(choiceGroup(label).querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent?.trim() === text,
  )
  if (!button) throw new Error(`找不到档位:${label}/${text}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

describe('设置页文字档位', () => {
  it('三类相似度阈值都显示低/中/高,不再渲染数值滑杆', async () => {
    await renderSettings()
    for (const label of ['历史相似度', '标准回答阈值', '知识库阈值']) {
      expect(choiceGroup(label).querySelectorAll('[role="radio"]')).toHaveLength(3)
      expect(choiceGroup(label).textContent).toContain('低')
      expect(choiceGroup(label).textContent).toContain('中')
      expect(choiceGroup(label).textContent).toContain('高')
    }
    expect(container.querySelector('input.pddcs-slider[aria-label="历史相似度阈值"]')).toBeNull()
  })

  it('选择历史阈值高档后立即保存为 0.8', async () => {
    await renderSettings()
    await choose('历史相似度', '高')
    expect(sentSettings.at(-1)?.simThreshold).toBe(0.8)
  })

  it('标准回答与知识库分别保存各自的档位值', async () => {
    await renderSettings()
    await choose('标准回答阈值', '中')
    await choose('知识库阈值', '低')
    expect(sentSettings.at(-2)?.goldenThreshold).toBe(0.65)
    expect(sentSettings.at(-1)?.kbThreshold).toBe(0.5)
  })
})

describe('设置页保留期档位', () => {
  it('提供 7天/30天/90天/自定义 四个档位', async () => {
    await renderSettings()
    const labels = Array.from(
      choiceGroup('保留期').querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ).map((button) => button.textContent?.trim())
    expect(labels).toEqual(['7天', '30天', '90天', '自定义'])
  })

  it('选择 7 天立即保存,后台最少保留 7 天', async () => {
    await renderSettings()
    await choose('保留期', '7天')
    expect(sentSettings.at(-1)?.retentionDays).toBe(7)
  })

  it('自定义天数只在 7~365 的整数范围内保存', async () => {
    await renderSettings({ ...DEFAULT_SETTINGS, retentionDays: 45 })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="自定义保留天数"]')
    expect(input).toBeTruthy()
    expect(input!.value).toBe('45')

    const type = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input!.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await type('6')
    await act(async () => {
      input!.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })
    expect(sentSettings.at(-1)?.retentionDays).toBeUndefined()

    await type('45')
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(sentSettings.at(-1)?.retentionDays).toBe(45)
  })

  it('从「自定义」点回与当前值相同的预设,选中态必须回到预设', async () => {
    // draft.retentionDays 没变(90→90),同步 effect 的依赖不变、不会重跑;
    // 若点击只 persist 不改 retentionMode,档位会一直卡在"自定义"(回归)。
    await renderSettings({ ...DEFAULT_SETTINGS, retentionDays: 90 })
    await choose('保留期', '自定义')
    expect(container.querySelector('input[aria-label="自定义保留天数"]')).toBeTruthy()

    await choose('保留期', '90天')
    const checked = Array.from(
      choiceGroup('保留期').querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    )
      .filter((button) => button.getAttribute('aria-checked') === 'true')
      .map((button) => button.textContent?.trim())
    expect(checked).toEqual(['90天'])
    expect(container.querySelector('input[aria-label="自定义保留天数"]')).toBeNull()
  })
})

describe('设置页操作与文案', () => {
  it('AI 整合与问题分类的保存、测试连接都带图标按钮', async () => {
    await renderSettings()
    const seen: HTMLButtonElement[] = []
    for (const page of ['AI 整合', '问题分类']) {
      await gotoPage(page)
      for (const label of ['保存', '测试连接']) {
        const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(
          (button) => button.textContent?.trim() === label,
        )
        expect(buttons.length).toBeGreaterThanOrEqual(1)
        expect(buttons.every((button) => button.querySelector('svg'))).toBe(true)
        seen.push(...buttons)
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(4)
  })

  it('关于区压缩为两行,不再展开长段外发说明', async () => {
    await renderSettings()
    await gotoPage('关于')
    const section = container.querySelector<HTMLElement>('[data-section="set-about"]')
    expect(section).toBeTruthy()
    const rows = section!.querySelectorAll('.pddcs-srow-blk > span')
    expect(rows.length).toBeLessThanOrEqual(2)
    expect(section!.textContent!.length).toBeLessThan(90)
  })

  it('关于区给出更新日志入口,点开用新标签页打开 GitHub 上的 CHANGELOG', async () => {
    await renderSettings()
    await gotoPage('关于')
    const section = container.querySelector<HTMLElement>('[data-section="set-about"]')
    expect(section!.textContent).toContain('版本')

    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const button = Array.from(section!.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === '打开',
    )
    expect(button).toBeTruthy()
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 新标签页打开:弹窗本身不导航走(不是 location.href)
    expect(open).toHaveBeenCalledWith(
      'https://github.com/hu-qi-jia/pdd-rag-plugin/blob/main/CHANGELOG.md',
      '_blank',
      'noopener,noreferrer',
    )
    open.mockRestore()
  })
})
