// 记忆列表的**分类筛选**(v3.0 第四版:由"按类型分区"改为"顶部导航筛选")。
//
// 旧版是「每组一个分区容器 + 可折叠标题」;用户「不要按照文件夹的样式设计了…在顶部增加导航栏,
// 导航栏中展示全部分类」之后,分类只由顶部那条导航表达,列表**平铺不分组**。
// 本文件锁的就是这条新契约 —— 尤其是"计数与筛选同源"那条:两边各自实现一份
// "这条属于哪一类",迟早出现"导航写着 3 条、点进去一条都没有"。
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

/** 按 data-category-id 取导航项(不按文字找:文字里还拼着计数) */
const navBtn = (id: string): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>(`[data-category-id="${id}"]`)

async function click(btn: HTMLElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {})
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

describe('MemoryListTab:顶部分类导航', () => {
  const ITEMS = [
    mk('qa-1', '尺码问题', 'preset:size'),
    mk('qa-2', '物流问题', 'preset:logistics'),
    mk('qa-3', '未分类问题', 'uncategorized'),
    mk('qa-4', '幽灵类型问题', 'ghost'),
  ]

  it('★ 导航列出全部分类,第一项是「全部」;含当前 0 条的那些', async () => {
    await renderWith([mk('qa-1', '尺码问题', 'preset:size')])
    // 全部 + 三个分类(物流 / 未分类此时都是 0 条,照样在列 —— 藏掉会让人以为类型丢了)
    expect(navBtn('all')?.textContent).toContain('全部')
    expect(navBtn('preset:size')?.textContent).toContain('尺码')
    expect(navBtn('preset:logistics')?.textContent).toContain('物流')
    expect(navBtn('uncategorized')?.textContent).toContain('未分类')
    // 顺序:全部恒第一
    const ids = Array.from(container.querySelectorAll('[data-category-id]')).map((el) =>
      el.getAttribute('data-category-id'),
    )
    expect(ids[0]).toBe('all')
  })

  it('★ 默认选中「全部」:列表**平铺**,不再有分区标题', async () => {
    await renderWith(ITEMS)
    for (const q of ['尺码问题', '物流问题', '未分类问题', '幽灵类型问题']) {
      expect(container.textContent).toContain(q)
    }
    expect(navBtn('all')?.getAttribute('aria-current')).toBe('true')
    // 旧版的「名称 · 条数」分区标题不该再出现
    expect(container.textContent).not.toContain('尺码 · 1')
    expect(container.textContent).not.toContain('物流 · 1')
  })

  it('★ 点一个分类 → 只显示该类;再点「全部」回来', async () => {
    await renderWith(ITEMS)
    await click(navBtn('preset:logistics')!)
    expect(container.textContent).toContain('物流问题')
    expect(container.textContent).not.toContain('尺码问题')
    expect(container.textContent).not.toContain('未分类问题')
    expect(navBtn('preset:logistics')?.getAttribute('aria-current')).toBe('true')

    await click(navBtn('all')!)
    expect(container.textContent).toContain('尺码问题')
  })

  it('★ 计数与筛选同源:类型表里没有的 categoryId **并进未分类**,导航数字与点进去的条数一致', async () => {
    // ITEMS 里 'ghost' 不在类型表 → 归到未分类,故未分类 = 未分类问题 + 幽灵类型问题 = 2
    await renderWith(ITEMS)
    expect(navBtn('uncategorized')?.textContent).toContain('2')

    await click(navBtn('uncategorized')!)
    expect(container.textContent).toContain('未分类问题')
    expect(container.textContent).toContain('幽灵类型问题')
    expect(container.textContent).not.toContain('尺码问题')
  })

  it('类型表里没有「未分类」时也照样给它一个入口', async () => {
    // 迁移中途 / 测试夹具都可能没有它,而它恰恰是最容易被忽略的那一类
    mockedSend.mockResolvedValueOnce(page([mk('qa-1', '孤儿问题', 'ghost')]))
    await act(async () => {
      root.render(
        <MemoryListTab
          tk={lightTheme}
          retentionDays={90}
          categories={[CATEGORIES[0]]}
          onDataChanged={vi.fn()}
        />,
      )
    })
    await act(async () => {})
    expect(navBtn('uncategorized')?.textContent).toContain('未分类')
    await click(navBtn('uncategorized')!)
    expect(container.textContent).toContain('孤儿问题')
  })

  // v3.1:旧版那行**独立的**「未分类 N 条 · 在设置页点…」说明行已并入顶部统计行(同一类信息不占两行)。
  // 不变量不变 —— 未分类条数仍然如实暴露、且这一处是**只读**的(没有任何操作按钮)。
  /**
   * v3.1 第六版:用户要求删掉「命中 N / M 条」那一行,未分类提示因此**回到独立一行**。
   * 不变量不变 —— 未分类条数仍然如实暴露、且这一处是**只读**的(没有操作按钮)。
   * 位置有讲究:它在**分类导航之后**。放在前面的话,它一出现就把导航往下推,两个页签的导航栏又对不齐。
   */
  it('未分类条数单独成行(只读,无操作按钮),且排在分类导航**之后**', async () => {
    await renderWith(ITEMS)
    expect(container.textContent).toContain('未分类 2 条 · 在设置页点「开始分类全部历史」')
    const line = Array.from(container.querySelectorAll('div')).find(
      (d) => d.children.length === 0 && d.textContent?.includes('在设置页点「开始分类全部历史」'),
    )!
    expect(line, '这行应当是它自己(叶子节点),不是某个祖先容器').toBeTruthy()
    // 只读:没有可点控件
    expect(line.querySelector('button')).toBeNull()
    // 位置:导航在它前面(DOM 顺序 = 视觉顺序)
    const nav = container.querySelector('[data-category-id="all"]')!
    expect(nav.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('★ 「命中 N / M 条」统计行已按用户要求删除', async () => {
    await renderWith(ITEMS)
    expect(container.textContent).not.toContain('命中')
  })

  it('无未分类条目时不出现「开始分类全部历史」提示', async () => {
    await renderWith([mk('qa-1', '尺码问题', 'preset:size')])
    expect(container.textContent).not.toContain('开始分类全部历史')
  })
})
