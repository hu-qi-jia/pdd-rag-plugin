// 记忆卡片操作布局单测(2026-09-15 第十八轮用户要求):
// ①「设置标准回答」放回每个回答条目后方(单/多回复口径统一,不再按回复数分流);
// ②「删除」移至问题行折叠钮左侧、以垃圾桶图标展示(原底部文字按钮行整体移除,
//    确认条改为点图标后在问题行下方出现);
// 已设金标 → 原按钮位置显示「已设为标准回答」徽标。
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

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('MemoryListTab:「设置标准回答」位置(第十八轮:放回每条回答后方)', () => {
  it('单回复卡片:按钮在该回复行内(与回复文本同容器)', async () => {
    await renderWith([
      { id: 'qa-1', question: '问题一', questionTs: 1, replyCount: 1, replies: [reply('r1')] },
    ])
    const goldenBtns = btns('设为标准')
    expect(goldenBtns).toHaveLength(1)
    // 回复行容器同时包含回复文本与按钮
    expect(goldenBtns[0].parentElement!.textContent).toContain('回复r1')
  })

  it('多回复卡片:每条回复各带按钮', async () => {
    await renderWith([
      {
        id: 'qa-2',
        question: '问题二',
        questionTs: 1,
        replyCount: 2,
        replies: [reply('r1'), reply('r2')],
      },
    ])
    const goldenBtns = btns('设为标准')
    expect(goldenBtns).toHaveLength(2)
    expect(goldenBtns[0].parentElement!.textContent).toContain('回复r1')
    expect(goldenBtns[1].parentElement!.textContent).toContain('回复r2')
  })

  it('已设金标:回复行内显示「标准回答」琥珀徽标而非按钮', async () => {
    await renderWith([
      {
        id: 'qa-3',
        question: '问题三',
        questionTs: 1,
        replyCount: 1,
        replies: [reply('r1', 'gd-1')],
      },
    ])
    expect(btns('设为标准')).toHaveLength(0)
    expect(container.textContent).toContain('标准回答')
  })

  it('金标控件为 mini 尺寸(24px 高、caption 字号),减少对内容区的挤压(第十九轮)', async () => {
    await renderWith([
      { id: 'qa-1', question: '问题一', questionTs: 1, replyCount: 1, replies: [reply('r1')] },
    ])
    const b = btns('设为标准')[0]
    expect(b.style.height).toBe('24px')
    expect(b.style.fontSize).toBe('10.5px')
  })
})

describe('MemoryListTab:删除入口(第十八轮:折叠钮左侧图标)', () => {
  it('删除是问题行内的图标钮(title 标识),位于折叠钮左侧,不再有「删除」文字按钮', async () => {
    await renderWith([
      { id: 'qa-1', question: '问题一', questionTs: 1, replyCount: 1, replies: [reply('r1')] },
    ])
    // 旧底部文字按钮已不存在(图标钮无文字)
    expect(btns('删除')).toHaveLength(0)
    const del = container.querySelector('button[title="删除该问答(需确认)"]') as HTMLButtonElement
    const chevron = container.querySelector('button[aria-expanded]') as HTMLButtonElement
    expect(del).toBeTruthy()
    expect(chevron).toBeTruthy()
    // 同一问题行,删除在折叠钮左侧(DOM 顺序在前 = 视觉左侧)
    expect(del.parentElement).toBe(chevron.parentElement)
    const kids = Array.from(del.parentElement!.children)
    expect(kids.indexOf(del)).toBeLessThan(kids.indexOf(chevron))
    // 图标钮与折叠钮同尺寸(等高铁律;jsdom 下比对内联样式)
    expect(del.style.height).toBe(chevron.style.height)
    expect(del.style.width).toBe(chevron.style.width)
  })

  it('点删除图标 → 问题行下方出确认条;取消可退出;确认调 DELETE_QA', async () => {
    mockedSend
      .mockResolvedValueOnce(
        page([{ id: 'qa-9', question: '问题九', questionTs: 1, replyCount: 1, replies: [reply('r1')] }]),
      )
      .mockResolvedValueOnce({
        type: 'DELETE_QA_RESPONSE',
        payload: { success: true },
      } as never)
      .mockResolvedValueOnce(page([]))
    await renderWith([
      { id: 'qa-9', question: '问题九', questionTs: 1, replyCount: 1, replies: [reply('r1')] },
    ])
    await click(container.querySelector('button[title="删除该问答(需确认)"]') as HTMLButtonElement)
    expect(container.textContent).toContain('删除该问答及其全部回复?')
    // 取消 → 确认条消失,未发删除请求
    await click(btns('取消')[0])
    expect(container.textContent).not.toContain('删除该问答及其全部回复?')
    expect(mockedSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_QA' }))
    // 再点图标 → 确认 → 发 DELETE_QA
    await click(container.querySelector('button[title="删除该问答(需确认)"]') as HTMLButtonElement)
    await click(btns('确认')[0])
    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DELETE_QA', payload: { id: 'qa-9' } }),
    )
  })
})
