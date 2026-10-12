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

/** 按 data-category-id 取导航项(不按文字找:文字里还拼着计数) */
const navBtn = (id: string): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>(`[data-category-id="${id}"]`)

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

describe('标准回答页 · 分类导航', () => {
  it('★ 导航列出全部类型,默认「全部」平铺 —— 不再有分区标题', async () => {
    panelData.goldens = [
      golden('g1', { question: '尺码问题', categoryId: 'preset:size' }),
      golden('g2', { question: '物流问题', categoryId: 'preset:logistics' }),
      golden('g3', { question: '未分类问题', categoryId: 'uncategorized' }),
    ]
    await render()
    const text = container.textContent ?? ''
    for (const q of ['尺码问题', '物流问题', '未分类问题']) expect(text).toContain(q)
    // 旧版的「名称 · 条数」分区标题不该再出现(类型已由导航表达,不在列表里重复一遍)
    expect(text).not.toContain('尺码 · 1')
    expect(text).not.toContain('物流 · 1')
    for (const id of ['all', 'preset:size', 'preset:logistics', 'uncategorized']) {
      expect(navBtn(id), `导航缺少 ${id}`).toBeTruthy()
    }
    expect(navBtn('all')?.getAttribute('aria-current')).toBe('true')
  })

  it('★ 点一个类型 → 只剩该类的标答;再点「全部」回来', async () => {
    panelData.goldens = [
      golden('g1', { question: '尺码问题', categoryId: 'preset:size' }),
      golden('g2', { question: '物流问题', categoryId: 'preset:logistics' }),
    ]
    await render()
    await click(navBtn('preset:logistics')!)
    expect(container.textContent).toContain('物流问题')
    expect(container.textContent).not.toContain('尺码问题')

    await click(navBtn('all')!)
    expect(container.textContent).toContain('尺码问题')
  })

  it('★ 空类型:导航里照样在列(计数 0),点进去给空态而不是白屏', async () => {
    panelData.goldens = [golden('g1', { question: '物流问题', categoryId: 'preset:logistics' })]
    await render()
    expect(navBtn('preset:size')?.textContent).toContain('0')
    await click(navBtn('preset:size')!)
    expect(container.textContent).toContain('这个分类下还没有标准回答')
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

  it('同一类型内:同问题的多条答案最近设置的在前(不按库内 id 序)', async () => {
    // 库里 goldens.toArray() 是 id 序(最旧在前),排序必须补一次,
    // 否则最旧的会顶到最前 —— 与聊天页候选口径相反
    panelData.goldens = [
      golden('g-old', {
        question: '怎么发货',
        answer: '旧答案',
        categoryId: 'preset:logistics',
        updatedAt: 1000,
      }),
      golden('g-new', {
        question: '怎么发货',
        answer: '新答案',
        categoryId: 'preset:logistics',
        updatedAt: 2000,
      }),
    ]
    await render()
    const text = container.textContent ?? ''
    expect(text.indexOf('新答案')).toBeLessThan(text.indexOf('旧答案'))
  })
})

// v3.0 第四版:类型改名 / 删除的入口从"每个分区的标题行"搬到**顶部导航行** ——
// 分区一没,入口就得有个新家。这里只验"入口什么时候出现";
// 改名 / 删除的完整流程在 categoryCrud.test.tsx。
describe('标准回答页:类型改名 / 删除入口跟着导航走', () => {
  const CUSTOM: PanelCategory = {
    id: 'custom:1',
    name: '发票咨询',
    kind: 'custom',
    filterable: true,
    position: 3,
  }

  it('预置类型没有改名/删除钮(不可改不可删,挂上再禁用还得解释为什么)', async () => {
    panelData.goldens = [golden('g1', { categoryId: 'preset:logistics' })]
    await render()
    await click(navBtn('preset:logistics')!)
    expect(btns('重命名类型')).toHaveLength(0)
    expect(btns('删除类型')).toHaveLength(0)
  })

  it('★ 选中自定义类型才出现两个钮;预置 / 未分类都没有', async () => {
    panelData.categories = [...CATEGORIES, CUSTOM]
    panelData.goldens = [golden('g1', { categoryId: 'custom:1' })]
    await render()
    await click(navBtn('preset:logistics')!)
    expect(btns('重命名类型')).toHaveLength(0)

    await click(navBtn('custom:1')!)
    expect(btns('重命名类型')).toHaveLength(1)
    expect(btns('删除类型')).toHaveLength(1)
  })

  it('切走时收起改名 / 删除态(它们只对当前选中的那个类型有意义)', async () => {
    panelData.categories = [...CATEGORIES, CUSTOM]
    panelData.goldens = [golden('g1', { categoryId: 'custom:1' })]
    await render()
    await click(navBtn('custom:1')!)
    await click(btns('删除类型')[0])
    expect(container.textContent).toContain('删除「发票咨询」')

    await click(navBtn('preset:logistics')!)
    expect(container.textContent).not.toContain('删除「发票咨询」')
  })
})
