// 记忆列表按问题类型分区(第五十七轮 Task 5)的渲染单测。
// 只读设计(spec D8):分区容器 + 顶部只读说明行;未分类组默认折叠,其余组默认展开。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  GetMemoryListResponse,
  MemoryListItem,
  PanelCategory,
} from '../../../src/types/messages'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { MemoryListTab } = await import('../../../src/popup/MemoryListTab')
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

const mk = (id: string, question: string, categoryId: string): MemoryListItem => ({
  id,
  question,
  questionTs: 1,
  replyCount: 0,
  replies: [],
  categoryId,
})

function page(items: MemoryListItem[]): GetMemoryListResponse {
  return { type: 'GET_MEMORY_LIST_RESPONSE', payload: { items, total: items.length, hasMore: false } }
}

let container: HTMLDivElement
let root: Root

const groupHeader = (name: string): HTMLButtonElement | null =>
  (Array.from(container.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(`${name} ·`),
  ) as HTMLButtonElement | undefined) ?? null

async function click(btn: HTMLElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function renderWith(items: MemoryListItem[]) {
  mockedSend.mockResolvedValueOnce(page(items))
  await act(async () => {
    root.render(
      <MemoryListTab
        tk={lightTheme}
        retentionDays={90}
        categories={CATEGORIES}
        onDataChanged={vi.fn()}
      />,
    )
  })
  await act(async () => {})
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockedSend.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('MemoryListTab:按问题类型分区(只读)', () => {
  const ITEMS = [
    mk('qa-1', '尺码问题', 'preset:size'),
    mk('qa-2', '物流问题', 'preset:logistics'),
    mk('qa-3', '未分类问题', 'uncategorized'),
    mk('qa-4', '幽灵类型问题', 'ghost'),
  ]

  it('每组一个分区容器,标题为「名称 · 条数」', async () => {
    await renderWith(ITEMS)
    expect(container.textContent).toContain('尺码 · 1')
    expect(container.textContent).toContain('物流 · 1')
    expect(container.textContent).toContain('未分类 · 2')
  })

  it('未分类组排在最后', async () => {
    await renderWith(ITEMS)
    const text = container.textContent ?? ''
    expect(text.indexOf('尺码 ·')).toBeLessThan(text.indexOf('未分类 ·'))
    expect(text.indexOf('物流 ·')).toBeLessThan(text.indexOf('未分类 ·'))
  })

  it('其余组默认展开;未分类组默认折叠(条目不可见)', async () => {
    await renderWith(ITEMS)
    expect(container.textContent).toContain('尺码问题')
    expect(container.textContent).toContain('物流问题')
    // 未分类组默认折叠:标题在,条目不在
    expect(container.textContent).not.toContain('未分类问题')
    expect(container.textContent).not.toContain('幽灵类型问题')
    expect(groupHeader('未分类')!.getAttribute('aria-expanded')).toBe('false')
  })

  it('展开未分类组后,未分类与未知类型的条目都出现(不丢条目)', async () => {
    await renderWith(ITEMS)
    await click(groupHeader('未分类')!)
    expect(container.textContent).toContain('未分类问题')
    expect(container.textContent).toContain('幽灵类型问题')
    expect(groupHeader('未分类')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('顶部只读说明行给出未分类条数与设置页入口,且无操作按钮', async () => {
    await renderWith(ITEMS)
    expect(container.textContent).toContain('未分类 2 条 · 在设置页点「开始分类全部历史」')
    // 只读:该行本身没有可点的按钮(设置页入口只是文字)
    const notice = Array.from(container.querySelectorAll('div')).find(
      (d) => d.textContent === '未分类 2 条 · 在设置页点「开始分类全部历史」',
    )!
    expect(notice).toBeTruthy()
    expect(notice.querySelector('button')).toBeNull()
  })

  it('无未分类条目时不显示只读说明行', async () => {
    await renderWith([mk('qa-1', '尺码问题', 'preset:size')])
    expect(container.textContent).not.toContain('开始分类全部历史')
  })
})
