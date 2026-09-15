// 记忆卡片「设置标准回答」按钮位置单测(2026-09-15 用户要求):
// 单回复卡片 → 按钮移到底部操作行、紧挨「删除」右侧(回复行内不再出现);
// 多回复卡片 → 逐回复各自携带按钮(放底部无法区分对应哪条回复);
// 已设金标 → 原按钮位置显示「已设为标准回答」徽标(同样跟随 placement 规则)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetMemoryListResponse, MemoryListItem, MemoryReplyItem } from '../../../src/types/messages'

vi.mock('../../../src/utils/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/utils/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { MemoryListTab } = await import('../../../src/popup/MemoryListTab')
const { lightTheme } = await import('../../../src/ui/theme')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const reply = (id: string, goldenId?: string): MemoryReplyItem => ({
  id,
  text: `回复${id}`,
  ts: 1,
  ...(goldenId ? { goldenId } : {}),
})

function page(items: MemoryListItem[]): GetMemoryListResponse {
  return { type: 'GET_MEMORY_LIST_RESPONSE', payload: { items, total: items.length, hasMore: false } }
}

let container: HTMLDivElement
let root: Root

const btns = (text: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button')).filter((el) =>
    el.textContent?.includes(text),
  )

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

async function renderWith(items: MemoryListItem[]) {
  mockedSend.mockResolvedValueOnce(page(items))
  await act(async () => {
    root.render(<MemoryListTab tk={lightTheme} retentionDays={90} onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

describe('MemoryListTab:「设置标准回答」按钮位置', () => {
  it('单回复卡片:按钮在底部操作行、与「删除」同容器,回复行内不再出现', async () => {
    await renderWith([
      { id: 'qa-1', question: '问题一', questionTs: 1, replyCount: 1, replies: [reply('r1')] },
    ])
    const goldenBtns = btns('设置标准回答')
    expect(goldenBtns).toHaveLength(1)
    const delBtn = btns('删除')[0]
    expect(delBtn).not.toBeUndefined()
    // 与删除按钮同一个操作行容器 = 紧挨其右侧
    expect(goldenBtns[0].parentElement).toBe(delBtn.parentElement)
    // 且在删除按钮之后(DOM 顺序 = 视觉右侧)
    expect(Array.from(delBtn.parentElement!.children).indexOf(goldenBtns[0])).toBeGreaterThan(
      Array.from(delBtn.parentElement!.children).indexOf(delBtn),
    )
  })

  it('多回复卡片:每条回复各带按钮(留在回复行内),底部操作行只有「删除」', async () => {
    await renderWith([
      {
        id: 'qa-2',
        question: '问题二',
        questionTs: 1,
        replyCount: 2,
        replies: [reply('r1'), reply('r2')],
      },
    ])
    const goldenBtns = btns('设置标准回答')
    expect(goldenBtns).toHaveLength(2)
    const delBtn = btns('删除')[0]
    // 两个按钮都不在删除所在的底部操作行
    for (const b of goldenBtns) expect(b.parentElement).not.toBe(delBtn.parentElement)
  })

  it('单回复已设金标:底部操作行显示「已设为标准回答」徽标而非按钮', async () => {
    await renderWith([
      {
        id: 'qa-3',
        question: '问题三',
        questionTs: 1,
        replyCount: 1,
        replies: [reply('r1', 'gd-1')],
      },
    ])
    expect(btns('设置标准回答')).toHaveLength(0)
    expect(container.textContent).toContain('已设为标准回答')
  })
})
