// 记忆列表"加载更早"分页单测(2026-09-15 评审 PM2):
// 列表默认取最近 100 条,底部显式"加载更早(已显示 X/Y 条)"追加下一页,
// 全部载入后显示"已显示全部 Y 条" —— 消除静默截断与头部统计的口径差。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetMemoryListResponse, MemoryListItem, PanelCategory } from '../../../src/types/messages'

// sendMessage 是 popup → SW 的唯一通道:mock 掉后按序返回分页响应
vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { MemoryListTab } = await import('../../../src/popup/MemoryListTab')
const { lightTheme } = await import('../../../src/ui/theme')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// 第五十七轮 Task 5 起条目按类型分区;用非未分类的类型,分组默认展开,不影响本页分页断言
const CATEGORIES: PanelCategory[] = [
  { id: 'preset:size', name: '尺码', kind: 'preset', filterable: true, position: 1 },
]

function makeItem(id: string): MemoryListItem {
  return {
    id,
    question: `问题${id}`,
    questionTs: 1,
    replyCount: 0,
    replies: [],
    categoryId: 'preset:size',
  }
}

function page(items: MemoryListItem[], total: number, hasMore: boolean): GetMemoryListResponse {
  return { type: 'GET_MEMORY_LIST_RESPONSE', payload: { items, total, hasMore } }
}

let container: HTMLDivElement
let root: Root

const $ = (text: string): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(text),
  ) ?? null

async function click(btn: HTMLElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
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

describe('MemoryListTab:加载更早(PM2)', () => {
  it('hasMore 时显示"加载更早";点击追加下一页并携带 offset', async () => {
    // 第一页:2 条,共 3 条
    mockedSend.mockResolvedValueOnce(page([makeItem('qa-3'), makeItem('qa-2')], 3, true))
    act(() => {
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

    const moreBtn = $('加载更早')
    expect(moreBtn).not.toBeNull()
    expect(container.textContent).toContain('已显示 2/3 条')

    // 第二页:剩 1 条,hasMore=false;断言请求携带 offset=已加载条数
    mockedSend.mockResolvedValueOnce(page([makeItem('qa-1')], 3, false))
    await click(moreBtn!)
    expect(mockedSend).toHaveBeenLastCalledWith({
      type: 'GET_MEMORY_LIST',
      payload: { offset: 2 },
    })

    expect($('加载更早')).toBeNull()
    expect(container.textContent).toContain('已显示全部 3 条')
    expect(container.textContent).toContain('问题qa-1')
  })

  it('无更多记录(hasMore=false)时不出现加载入口', async () => {
    mockedSend.mockResolvedValueOnce(page([makeItem('qa-1')], 1, false))
    act(() => {
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

    expect($('加载更早')).toBeNull()
    expect(container.textContent).toContain('已显示全部 1 条')
  })
})
