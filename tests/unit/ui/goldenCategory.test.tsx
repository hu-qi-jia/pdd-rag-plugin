// 标准回答页 · 类型分区与「移到其他类型」的渲染单测(第五十七轮 Task 6)。
// 数据来源仍是 GET_PANEL_DATA(此时已回带 categories);分区复用 logic#groupByCategory。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  ExtensionMessageResponse,
  GetPanelDataResponse,
  PanelCategory,
  PanelGolden,
} from '../../../src/types/messages'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { FoldersTab } = await import('../../../src/popup/FoldersTab')
const { lightTheme } = await import('../../../src/ui/theme')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const CATEGORIES: PanelCategory[] = [
  { id: 'preset:size', name: '尺码', kind: 'preset', filterable: true, position: 1 },
  { id: 'preset:logistics', name: '物流', kind: 'preset', filterable: true, position: 2 },
  {
    id: 'uncategorized',
    name: '未分类',
    kind: 'uncategorized',
    filterable: false,
    position: 9999,
  },
]

const golden = (id: string, over: Partial<PanelGolden> = {}): PanelGolden => ({
  id,
  folderId: null,
  question: `问题${id}`,
  answer: `回复${id}`,
  hasEmbedding: 1,
  updatedAt: 0,
  categoryId: 'uncategorized',
  ...over,
})

let container: HTMLDivElement
let root: Root
let panelData: { goldens: PanelGolden[]; categories: PanelCategory[] }
let sent: Array<{ type: string; payload?: Record<string, unknown> }>

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {})
}

const btns = (title: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[title]')).filter((el) =>
    el.title.includes(title),
  )

/** 按问题文字定位它所在的那一行(问题 div 无子元素,取值即整行) */
const rowOf = (question: string): HTMLElement => {
  const q = Array.from(container.querySelectorAll('div')).find(
    (d) => d.children.length === 0 && d.textContent === question,
  )
  expect(q, `找不到问题行「${question}」`).toBeTruthy()
  return q!.parentElement!.parentElement as HTMLElement
}

async function render() {
  mockedSend.mockImplementation(async (m: { type: string; payload?: Record<string, unknown> }) => {
    sent.push(m)
    if (m.type === 'GET_PANEL_DATA') {
      return {
        type: 'GET_PANEL_DATA_RESPONSE',
        payload: {
          folders: [],
          goldens: panelData.goldens,
          knowledge: [],
          categories: panelData.categories,
        },
      } as GetPanelDataResponse
    }
    return {
      type: `${m.type}_RESPONSE`,
      payload: { success: true },
    } as unknown as ExtensionMessageResponse
  })
  await act(async () => {
    root.render(<FoldersTab tk={lightTheme} onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockedSend.mockReset()
  sent = []
  panelData = { goldens: [], categories: CATEGORIES }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('标准回答页 · 类型分区', () => {
  it('按类型分区,未分类排最后', async () => {
    panelData.goldens = [
      golden('g1', { question: '尺码问题', categoryId: 'preset:size' }),
      golden('g2', { question: '物流问题', categoryId: 'preset:logistics' }),
      golden('g3', { question: '未分类问题', categoryId: 'uncategorized' }),
    ]
    await render()
    const text = container.textContent ?? ''
    expect(text).toContain('尺码 · 1')
    expect(text).toContain('物流 · 1')
    expect(text).toContain('未分类 · 1')
    expect(text.indexOf('尺码 ·')).toBeLessThan(text.indexOf('未分类 ·'))
    expect(text.indexOf('物流 ·')).toBeLessThan(text.indexOf('未分类 ·'))
  })

  it('★ 手动指定过的标答要有可辨认的标记(不像机器打的那样)', async () => {
    panelData.goldens = [
      golden('g1', { question: '手工摆的', categoryId: 'preset:size', categorySource: 'manual' }),
      golden('g2', { question: '机器打的', categoryId: 'preset:size', categorySource: 'jev' }),
    ]
    await render()
    expect(rowOf('手工摆的').textContent).toContain('已指定')
    expect(rowOf('机器打的').textContent).not.toContain('已指定')
  })

  it('点类型标签旁的按钮 → 出现类型下拉,选中即发 UPDATE_GOLDEN_CATEGORY', async () => {
    panelData.goldens = [golden('g1', { categoryId: 'preset:size' })]
    await render()
    const move = btns('移到其他类型')
    expect(move).toHaveLength(1)
    await click(move[0])

    const sel = container.querySelector<HTMLSelectElement>('select')
    expect(sel).toBeTruthy()
    expect(sel!.value).toBe('preset:size')

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        sel!,
        'preset:logistics',
      )
      sel!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})

    const req = sent.find((m) => m.type === 'UPDATE_GOLDEN_CATEGORY')
    expect(req?.payload).toEqual({ id: 'g1', categoryId: 'preset:logistics' })
    // 成功后 refresh:重新拉面板数据
    expect(sent.filter((m) => m.type === 'GET_PANEL_DATA')).toHaveLength(2)
  })

  it('下拉里的选项来自类型表(含未分类),不含已删除的类型', async () => {
    // 类型表里没有 'ghost'(旧库删掉的自定义类型),条目仍挂在它上面
    panelData.goldens = [golden('g1', { categoryId: 'ghost' })]
    await render()
    await click(btns('移到其他类型')[0])

    const values = Array.from(container.querySelectorAll('option')).map((o) => o.value)
    expect(values).toEqual(['preset:size', 'preset:logistics', 'uncategorized'])
    expect(values).not.toContain('ghost')
  })

  it('空类型不渲染分区容器', async () => {
    panelData.goldens = [golden('g1', { question: '物流问题', categoryId: 'preset:logistics' })]
    await render()
    expect(container.textContent).toContain('物流 · 1')
    expect(container.textContent).not.toContain('尺码 ·')
  })
})
