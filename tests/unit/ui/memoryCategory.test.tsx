// 记忆页(v3.0):分类导航 + 折叠问题行 的渲染单测。
//
// v2.6 的形态是「页内可折叠分区」;v3.0 把类型提到顶部导航栏,列表回到纯行流,
// 且**问题行默认折叠**。这三件事的可见后果在本文件里逐条钉住。
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

const mk = (
  id: string,
  question: string,
  categoryId: string,
  replies: Array<{ id: string; text: string }> = [],
): MemoryListItem => ({
  id,
  question,
  // 取"现在":剩余天数按 questionTs + 保留期 - now 算,写死 1(1970)会一律得 0 天
  questionTs: Date.now(),
  replyCount: replies.length,
  replies: replies.map((r) => ({ ...r, ts: 1 })),
  categoryId,
})

function page(items: MemoryListItem[]): GetMemoryListResponse {
  return { type: 'GET_MEMORY_LIST_RESPONSE', payload: { items, total: items.length, hasMore: false } }
}

let container: HTMLDivElement
let root: Root

/** 分类导航里的某一项(按纯文字前缀找,计数是独立 span,不参与匹配) */
const navBtn = (label: string): HTMLButtonElement | null =>
  (Array.from(container.querySelectorAll('.pddcs-catnav button')).find((el) =>
    el.textContent?.startsWith(label),
  ) as HTMLButtonElement | undefined) ?? null

/** 折叠问题行(按问题文字找) */
const qrow = (question: string): HTMLButtonElement | null =>
  (Array.from(container.querySelectorAll('.pddcs-qrow')).find((el) =>
    el.textContent?.includes(question),
  ) as HTMLButtonElement | undefined) ?? null

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {})
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {})
}

async function renderWith(items: MemoryListItem[]) {
  mockedSend.mockResolvedValueOnce(page(items))
  await act(async () => {
    root.render(<MemoryListTab categories={CATEGORIES} onDataChanged={vi.fn()} />)
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

describe('记忆页 v3.0:分类导航', () => {
  const ITEMS = [
    mk('qa-1', '尺码问题', 'preset:size'),
    mk('qa-2', '物流问题', 'preset:logistics'),
    mk('qa-3', '未分类问题', 'uncategorized'),
    mk('qa-4', '幽灵类型问题', 'ghost'),
  ]

  it('导航含「全部」+ 各类型 + 「未分类」,每项带计数', () => {
    return renderWith(ITEMS).then(() => {
      expect(navBtn('全部')?.textContent).toBe('全部4')
      expect(navBtn('尺码')?.textContent).toBe('尺码1')
      expect(navBtn('物流')?.textContent).toBe('物流1')
      // 未分类 = 显式未分类 + 类型表里没有的 ghost
      expect(navBtn('未分类')?.textContent).toBe('未分类2')
    })
  })

  it('默认选中「全部」,所有条目可见', async () => {
    await renderWith(ITEMS)
    expect(navBtn('全部')?.getAttribute('aria-current')).toBe('true')
    for (const q of ['尺码问题', '物流问题', '未分类问题', '幽灵类型问题']) {
      expect(qrow(q)).toBeTruthy()
    }
  })

  it('点某类型后只剩该类型的条目', async () => {
    await renderWith(ITEMS)
    await click(navBtn('尺码')!)
    expect(navBtn('尺码')?.getAttribute('aria-current')).toBe('true')
    expect(qrow('尺码问题')).toBeTruthy()
    expect(qrow('物流问题')).toBeNull()
    expect(qrow('未分类问题')).toBeNull()
  })

  it('计数为 0 的类型照样出现在导航上', async () => {
    await renderWith([mk('qa-1', '尺码问题', 'preset:size')])
    expect(navBtn('物流')?.textContent).toBe('物流0')
  })

  it('搜索后导航计数按筛后结果走(不是库存总数)', async () => {
    await renderWith(ITEMS)
    const input = container.querySelector('.pddcs-search input') as HTMLInputElement
    await type(input, '物流')
    expect(navBtn('全部')?.textContent).toBe('全部1')
    expect(navBtn('尺码')?.textContent).toBe('尺码0')
    expect(navBtn('物流')?.textContent).toBe('物流1')
  })

  it('未分类说明行只在选中未分类且有存量时出现', async () => {
    await renderWith(ITEMS)
    expect(container.textContent).not.toContain('开始分类全部历史')
    await click(navBtn('未分类')!)
    expect(container.textContent).toContain('开始分类全部历史')
  })

  it('未分类为空时不出现说明行', async () => {
    await renderWith([mk('qa-1', '尺码问题', 'preset:size')])
    await click(navBtn('未分类')!)
    expect(container.textContent).not.toContain('开始分类全部历史')
  })
})

describe('记忆页 v3.0:折叠问题行', () => {
  const ITEMS = [
    mk('qa-1', '退货运费谁承担?', 'preset:size', [
      { id: 'r-1', text: '质量问题我们承担' },
      { id: 'r-2', text: '带运费险会自动理赔' },
    ]),
    mk('qa-2', '怎么申请退货?', 'preset:size', [{ id: 'r-3', text: '订单页申请售后' }]),
  ]

  it('默认折叠:回复正文不可见', async () => {
    await renderWith(ITEMS)
    expect(qrow('退货运费谁承担?')).toBeTruthy()
    expect(container.textContent).not.toContain('质量问题我们承担')
    expect(qrow('退货运费谁承担?')!.getAttribute('aria-expanded')).toBe('false')
  })

  it('点击展开:回复列表出现,行变展开态', async () => {
    await renderWith(ITEMS)
    await click(qrow('退货运费谁承担?')!)
    expect(container.textContent).toContain('质量问题我们承担')
    expect(container.textContent).toContain('带运费险会自动理赔')
    expect(qrow('退货运费谁承担?')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('单展开:展开另一行会收起上一行', async () => {
    await renderWith(ITEMS)
    await click(qrow('退货运费谁承担?')!)
    expect(container.textContent).toContain('质量问题我们承担')
    await click(qrow('怎么申请退货?')!)
    expect(container.textContent).toContain('订单页申请售后')
    expect(container.textContent).not.toContain('质量问题我们承担')
  })

  it('再点一次收起', async () => {
    await renderWith(ITEMS)
    await click(qrow('退货运费谁承担?')!)
    await click(qrow('退货运费谁承担?')!)
    expect(container.textContent).not.toContain('质量问题我们承担')
  })

  it('★ 问题行是两行:问题在上,时间 · 回复条数在下', async () => {
    await renderWith(ITEMS)
    const row = qrow('退货运费谁承担?')!
    const line1 = row.querySelector('.line1') as HTMLElement
    const line2 = row.querySelector('.line2') as HTMLElement
    expect(line1.textContent).toContain('退货运费谁承担?')
    expect(line2.textContent).toContain('2 条回复')
    // 元信息里有日期时间(MM-DD HH:mm)
    expect(line2.textContent).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/)
  })

  it('★ 序号列与分类标都已去掉 —— 行内容整体靠左', async () => {
    await renderWith(ITEMS)
    const row = qrow('退货运费谁承担?')!
    expect(row.querySelector('.no')).toBeNull()
    expect(row.querySelector('.cat')).toBeNull()
    // 问题文字就是第一行的开头,前面不再有任何槽位
    expect((row.querySelector('.line1') as HTMLElement).textContent).toMatch(/^退货运费谁承担\?/)
  })

  it('行尾有常驻的删除图标与折叠指示;折叠指示随展开翻转', async () => {
    await renderWith(ITEMS)
    const row = qrow('退货运费谁承担?')!
    expect(row.querySelector('.chev')).toBeTruthy()
    expect(row.querySelector('button[title="删除该问答(需确认)"]')).toBeTruthy()
    expect(row.querySelector('.chev')!.closest('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
    await click(row)
    expect(qrow('退货运费谁承担?')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('★ 「剩 N 天」字段已删除 —— 折叠行与展开区都不再出现', async () => {
    await renderWith(ITEMS)
    const row = qrow('退货运费谁承担?')!
    expect(row.textContent).not.toContain('剩')
    await click(row)
    expect(container.textContent).not.toContain('剩')
    expect(container.textContent).not.toContain('天')
  })

  it('已设标准的条目在折叠行尾带星(未设的没有)', async () => {
    await renderWith([
      {
        ...mk('qa-1', '有标准回答的问题', 'preset:size', [{ id: 'r-1', text: '答案' }]),
        // goldenId 由 GET_MEMORY_LIST 按 goldens.sourceReplyId 反查回带(PM1)
        replies: [{ id: 'r-1', text: '答案', ts: 1, goldenId: 'g-1' }],
      },
      mk('qa-2', '没有标准回答的问题', 'preset:size', [{ id: 'r-2', text: '答案' }]),
    ])
    expect(qrow('有标准回答的问题')!.querySelector('.star')).toBeTruthy()
    expect(qrow('没有标准回答的问题')!.querySelector('.star')).toBeNull()
  })
})
