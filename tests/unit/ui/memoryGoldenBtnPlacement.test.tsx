// 记忆页的操作布局(v3.0 重写)。
//
// v2.6 的形态:折叠行里并排「设为标准」文字钮 + 删除垃圾桶图标 + 展开箭头,
// 三个控件挤在 34px 的问题行里,其中两个还是不可逆操作与展开开关同权。
// v3.0 之后:
//  · ★/⧉ 收进**展开区里每条回复的行尾**(每条各带一对,单/多回复口径统一);
//  · 删除退到展开区底部 —— 一个破坏性操作不该和"展开"挤在同一行。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  GetMemoryListResponse,
  MemoryListItem,
  MemoryReplyItem,
  PanelCategory,
} from '../../../src/types/messages'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { MemoryListTab } = await import('../../../src/popup/MemoryListTab')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const reply = (id: string, goldenId?: string): MemoryReplyItem => ({
  id,
  text: `回复${id}`,
  ts: 1,
  ...(goldenId ? { goldenId } : {}),
})

const CATEGORIES: PanelCategory[] = [
  { id: 'preset:size', name: '尺码', kind: 'preset', filterable: true, position: 1 },
]

function page(items: MemoryListItem[]): GetMemoryListResponse {
  return { type: 'GET_MEMORY_LIST_RESPONSE', payload: { items, total: items.length, hasMore: false } }
}

let container: HTMLDivElement
let root: Root

const qa = (id: string, replies: MemoryReplyItem[]): MemoryListItem => ({
  id,
  question: `问题${id}`,
  questionTs: Date.now(),
  replyCount: replies.length,
  categoryId: 'preset:size',
  replies,
})

const textBtn = (label: string): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  ) ?? null

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {})
}

/** 展开第一个问题行 */
async function openFirstRow() {
  await click(container.querySelector('.pddcs-qrow') as HTMLElement)
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

async function renderWith(items: MemoryListItem[]) {
  mockedSend.mockResolvedValueOnce(page(items))
  await act(async () => {
    root.render(<MemoryListTab categories={CATEGORIES} onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

describe('记忆页 v3.0:★/⧉ 在每条回复的行尾', () => {
  it('单回复:展开后该回复行尾恰好一对图标钮,且与回复文本同容器', async () => {
    await renderWith([qa('qa-1', [reply('r1')])])
    await openFirstRow()
    const row = container.querySelector('.pddcs-reply') as HTMLElement
    const icons = row.querySelectorAll('.pddcs-iconbtn')
    expect(icons).toHaveLength(2)
    expect(row.textContent).toContain('回复r1')
    expect(icons[0].getAttribute('title')).toBe('设为标准回答')
    expect(icons[1].getAttribute('title')).toBe('复制该条回复')
  })

  it('多回复:每条各带一对,互不共用', async () => {
    await renderWith([qa('qa-2', [reply('r1'), reply('r2')])])
    await openFirstRow()
    const rows = Array.from(container.querySelectorAll('.pddcs-reply'))
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('回复r1')
    expect(rows[1].textContent).toContain('回复r2')
    for (const r of rows) expect(r.querySelectorAll('.pddcs-iconbtn')).toHaveLength(2)
  })

  it('已设金标:★ 呈 data-on 态,title 改为「取消标准回答」', async () => {
    await renderWith([qa('qa-3', [reply('r1', 'gd-1')])])
    await openFirstRow()
    const star = container.querySelector('.pddcs-reply .pddcs-iconbtn') as HTMLElement
    expect(star.getAttribute('data-on')).toBe('true')
    expect(star.getAttribute('title')).toBe('取消标准回答')
  })

  it('未设金标:★ 无 data-on 态', async () => {
    await renderWith([qa('qa-1', [reply('r1')])])
    await openFirstRow()
    expect(
      container.querySelector('.pddcs-reply .pddcs-iconbtn')!.getAttribute('data-on'),
    ).toBeNull()
  })

  it('折叠态下展开区不存在 —— ★/⧉ 只随展开出现', async () => {
    await renderWith([qa('qa-1', [reply('r1')])])
    expect(container.querySelector('.pddcs-reply')).toBeNull()
    expect(container.querySelector('.pddcs-qopen')).toBeNull()
    // 行尾那两枚是删除与折叠指示,不是 ★/⧉
    expect(container.querySelector('button[title="设为标准回答"]')).toBeNull()
  })
})

describe('记忆页 v4.0:删除入口', () => {
  it('★ 删除是**折叠行上常驻的图标**(不再藏在展开区底部),与折叠指示同排', async () => {
    await renderWith([qa('qa-1', [reply('r1')])])
    const row = container.querySelector('.pddcs-qrow') as HTMLElement
    const del = row.querySelector('button[title="删除该问答(需确认)"]') as HTMLButtonElement
    expect(del).toBeTruthy()
    // 图标在问题后方(第一行内),折叠指示紧随其后
    const line1 = row.querySelector('.line1') as HTMLElement
    expect(line1.contains(del)).toBe(true)
    expect(line1.querySelector('.chev')).toBeTruthy()
    // 展开区里不再有"删除此问答"文字钮 —— 入口只有一个
    expect(textBtn('删除此问答')).toBeNull()
  })

  it('行是 div+role=button 而不是 <button> —— 按钮不能套按钮', async () => {
    await renderWith([qa('qa-1', [reply('r1')])])
    const row = container.querySelector('.pddcs-qrow') as HTMLElement
    expect(row.tagName).toBe('DIV')
    expect(row.getAttribute('role')).toBe('button')
    // 行内确实有真正的 <button>(删除),这正是不能把行做成 <button> 的原因
    expect(row.querySelectorAll('button').length).toBeGreaterThan(0)
  })

  it('点删除 → 该行就地展开并出确认条;取消可退出;确认发 DELETE_QA', async () => {
    mockedSend.mockResolvedValueOnce(page([qa('qa-9', [reply('r1')])]))
    mockedSend.mockResolvedValueOnce({ type: 'DELETE_QA_RESPONSE', payload: { success: true } } as never)
    mockedSend.mockResolvedValueOnce(page([]))
    await act(async () => {
      root.render(<MemoryListTab categories={CATEGORIES} onDataChanged={vi.fn()} />)
    })
    await act(async () => {})

    await click(container.querySelector('button[title="删除该问答(需确认)"]') as HTMLElement)
    expect(container.textContent).toContain('删除该问答及其全部回复?')

    // 取消 → 确认条消失,未发删除请求
    await click(textBtn('取消')!)
    expect(container.textContent).not.toContain('删除该问答及其全部回复?')
    expect(mockedSend.mock.calls.map((c) => (c[0] as { type: string }).type)).not.toContain(
      'DELETE_QA',
    )

    // 再点 → 确认 → 发 DELETE_QA
    await click(container.querySelector('button[title="删除该问答(需确认)"]') as HTMLElement)
    await click(textBtn('确认')!)
    expect(mockedSend).toHaveBeenCalledWith({ type: 'DELETE_QA', payload: { id: 'qa-9' } })
  })
})
