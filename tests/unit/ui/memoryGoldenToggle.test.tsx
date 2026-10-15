// 记忆页 ★ 的**双向**行为单测(v3.0)。
//
// v2.6 的记忆页只有"设为标准回答"这一条路:已设之后行内控件变成一枚**死的琥珀徽标**,
// title 写着「可在文件夹页取消」—— 用户必须记住"取消要去另一页"才用得了。
// 后端 DELETE_GOLDEN 一直都在(标准回答页在用),只是记忆页没接。
//
// 本文件钉住三件事:
//  ① 未设的回复点 ☆ → ADD_GOLDEN,载荷与 v2.6 完全一致(不多发一个字段);
//  ② 已设的回复点 ★ → DELETE_GOLDEN(带 goldenId),**绝不发 ADD_GOLDEN**;
//  ③ 两条路都在成功后重拉列表并刷新头部统计(★ 由数据派生,不是会话级 state)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetMemoryListResponse, MemoryListItem, PanelCategory } from '../../../src/types/messages'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { MemoryListTab } = await import('../../../src/popup/MemoryListTab')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const CATEGORIES: PanelCategory[] = [
  { id: 'preset:size', name: '尺码', kind: 'preset', filterable: true, position: 1 },
  { id: 'uncategorized', name: '未分类', kind: 'uncategorized', filterable: false, position: 9999 },
]

const withReply = (goldenId?: string): MemoryListItem => ({
  id: 'qa-1',
  question: '退货运费谁承担?',
  questionTs: 1,
  replyCount: 1,
  replies: [{ id: 'r-1', text: '质量问题我们承担', ts: 1, ...(goldenId ? { goldenId } : {}) }],
  categoryId: 'preset:size',
})

const page = (items: MemoryListItem[]): GetMemoryListResponse => ({
  type: 'GET_MEMORY_LIST_RESPONSE',
  payload: { items, total: items.length, hasMore: false },
})

let container: HTMLDivElement
let root: Root
let onDataChanged: ReturnType<typeof vi.fn>

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {})
}

/** 展开唯一的那个问题行,拿到回复行尾的两枚图标钮(☆ 在前、⧉ 在后) */
async function openReply() {
  const row = container.querySelector('.pddcs-qrow') as HTMLButtonElement
  await click(row)
  const btns = Array.from(container.querySelectorAll('.pddcs-reply .pddcs-iconbtn')) as HTMLElement[]
  expect(btns).toHaveLength(2)
  return { star: btns[0], copy: btns[1] }
}

async function renderWith(items: MemoryListItem[]) {
  onDataChanged = vi.fn()
  mockedSend.mockResolvedValueOnce(page(items))
  await act(async () => {
    root.render(
      <MemoryListTab categories={CATEGORIES} onDataChanged={onDataChanged} />,
    )
  })
  await act(async () => {})
}

/** 取出第 n 次 sendMessage 调用的请求体(0 基) */
const callAt = (n: number) => mockedSend.mock.calls[n][0] as { type: string; payload?: unknown }

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

describe('记忆页 ★:设为标准回答', () => {
  it('点 ☆ 发 ADD_GOLDEN,载荷与 v2.6 一致', async () => {
    await renderWith([withReply()])
    mockedSend.mockResolvedValueOnce({
      type: 'ADD_GOLDEN_RESPONSE',
      payload: { id: 'g-1', count: 1 },
    })
    mockedSend.mockResolvedValueOnce(page([withReply('g-1')]))

    const { star } = await openReply()
    expect(star.getAttribute('data-on')).toBeNull()
    await click(star)

    expect(callAt(1)).toEqual({
      type: 'ADD_GOLDEN',
      payload: {
        question: '退货运费谁承担?',
        answer: '质量问题我们承担',
        sourceRecordId: 'qa-1',
        sourceReplyId: 'r-1',
      },
    })
  })

  it('成功后重拉列表并刷新头部统计', async () => {
    await renderWith([withReply()])
    mockedSend.mockResolvedValueOnce({ type: 'ADD_GOLDEN_RESPONSE', payload: { count: 1 } })
    mockedSend.mockResolvedValueOnce(page([withReply('g-1')]))

    const { star } = await openReply()
    await click(star)

    expect(callAt(2).type).toBe('GET_MEMORY_LIST')
    expect(onDataChanged).toHaveBeenCalled()
  })

  it('达到每问上限时给出原口径提示,且不谎称成功', async () => {
    await renderWith([withReply()])
    mockedSend.mockResolvedValueOnce({
      type: 'ADD_GOLDEN_RESPONSE',
      payload: { limitReached: true, count: 3 },
    })
    mockedSend.mockResolvedValueOnce(page([withReply()]))

    const { star } = await openReply()
    await click(star)
    expect(container.textContent).toContain('该问题已有 3 条标准回答(上限 3 条),请先取消一条')
  })
})

describe('记忆页 ★:取消标准回答(v2.6 缺失的那条路)', () => {
  it('已设的回复点 ★ 发 DELETE_GOLDEN,而不是再发一次 ADD_GOLDEN', async () => {
    await renderWith([withReply('g-1')])
    mockedSend.mockResolvedValueOnce({
      type: 'DELETE_GOLDEN_RESPONSE',
      payload: { success: true },
    })
    mockedSend.mockResolvedValueOnce(page([withReply()]))

    const { star } = await openReply()
    expect(star.getAttribute('data-on')).toBe('true')
    await click(star)

    expect(callAt(1)).toEqual({ type: 'DELETE_GOLDEN', payload: { id: 'g-1' } })
    expect(mockedSend.mock.calls.map((c) => (c[0] as { type: string }).type)).not.toContain(
      'ADD_GOLDEN',
    )
  })

  it('取消成功后重拉列表、刷新统计,并给出"历史记录不受影响"的回执', async () => {
    await renderWith([withReply('g-1')])
    mockedSend.mockResolvedValueOnce({ type: 'DELETE_GOLDEN_RESPONSE', payload: { success: true } })
    mockedSend.mockResolvedValueOnce(page([withReply()]))

    const { star } = await openReply()
    await click(star)

    expect(callAt(2).type).toBe('GET_MEMORY_LIST')
    expect(onDataChanged).toHaveBeenCalled()
    expect(container.textContent).toContain('已取消该条标准回答,历史记录不受影响')
  })

  it('取消失败时如实报错,不静默', async () => {
    await renderWith([withReply('g-1')])
    mockedSend.mockResolvedValueOnce({
      type: 'DELETE_GOLDEN_RESPONSE',
      payload: { success: false, error: '库里没有这条' },
    })
    mockedSend.mockResolvedValueOnce(page([withReply('g-1')]))

    const { star } = await openReply()
    await click(star)
    expect(container.textContent).toContain('取消失败:库里没有这条')
  })
})

describe('记忆页 ⧉:复制', () => {
  it('点 ⧉ 把该条回复正文写进剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    // happy-dom 的 navigator.clipboard 是只读 getter,不能 Object.assign
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await renderWith([withReply()])
    const { copy } = await openReply()
    await click(copy)

    expect(writeText).toHaveBeenCalledWith('质量问题我们承担')
    expect(container.textContent).toContain('已复制到剪贴板')
  })
})
