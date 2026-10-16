// 类型 CRUD 的 UI 行为(第五十七轮 Task 7)。
//
// 覆盖:新建表单(名字 + 判定说明)→ 发 CREATE_CATEGORY;分区头的改名/删除只在自定义类型上出现;
// 改名走内联输入;删除走 ConfirmRow 二次确认并提示标答落回未分类。
// 断言落在「发出什么消息 + 显示什么提示 + 哪些钮在」,不发真消息(mock)。
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
  { id: 'preset:size', name: '尺码推荐', kind: 'preset', filterable: true, route: 'retrieve', position: 0 },
  { id: 'cat-1', name: '发票', kind: 'custom', filterable: true, route: 'retrieve', position: 6 },
  { id: 'cat-2', name: '催件', kind: 'custom', filterable: true, route: 'retrieve', position: 7 },
  { id: 'uncategorized', name: '未分类', kind: 'uncategorized', filterable: false, route: 'retrieve', position: 9999 },
]

const golden = (id: string, overrides: Partial<PanelGolden> = {}): PanelGolden => ({
  id,
  folderId: null,
  question: `问题${id}`,
  answer: `回复${id}`,
  hasEmbedding: 1,
  updatedAt: 0,
  categoryId: 'uncategorized',
  ...overrides,
})

let container: HTMLDivElement
let root: Root
let panelData: { goldens: PanelGolden[]; knowledge: unknown[]; categories: PanelCategory[] }
let respOverrides: Record<string, Record<string, unknown>>
let sent: Array<{ type: string; payload?: Record<string, unknown> }>

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {})
}

/** 按 title 包含匹配的图标/迷你钮 */
const btns = (title: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[title]')).filter((el) =>
    el.title.includes(title),
  )

/** 按可见文字精确匹配的按钮 */
const textBtn = (label: string): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  ) ?? null

/** React 受控输入赋值(原生 setter + input 事件,act 包裹消警告) */
const typeIn = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const noticeText = (): string => container.textContent ?? ''

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockedSend.mockReset()
  sent = []
  respOverrides = {}
  panelData = {
    goldens: [
      golden('g-preset', { categoryId: 'preset:size' }),
      golden('g-1', { categoryId: 'cat-1' }),
    ],
    knowledge: [],
    categories: CATEGORIES,
  }
  mockedSend.mockImplementation(async (msg: { type: string; payload?: Record<string, unknown> }) => {
    sent.push(msg)
    if (msg.type === 'GET_PANEL_DATA') {
      return { type: 'GET_PANEL_DATA_RESPONSE', payload: panelData } as GetPanelDataResponse
    }
    const base: Record<string, unknown> = {
      CREATE_CATEGORY: { id: 'cat-new' },
      RENAME_CATEGORY: { success: true },
      DELETE_CATEGORY: { success: true, movedGoldens: 0 },
    }[msg.type] ?? {}
    return {
      type: `${msg.type}_RESPONSE`,
      payload: { ...base, ...(respOverrides[msg.type] ?? {}) },
    } as unknown as ExtensionMessageResponse
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render() {
  await act(async () => {
    root.render(<FoldersTab onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

/** 分类导航里的某一项(按稳定的 data-cat-id 锚点,不按文字/位置) */
const navItem = (catId: string): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`.pddcs-catnav button[data-cat-id="${catId}"]`)!

const createFormOpen = () => container.querySelectorAll('input.pddcs-input').length > 0

describe('FoldersTab:新建类型', () => {
  it('点「新建类型」出表单;填名字与判定说明后发出 CREATE_CATEGORY', async () => {
    await render()
    await click(textBtn('新建类型')!)
    expect(createFormOpen()).toBe(true)

    const nameInput = container.querySelector<HTMLInputElement>('input.pddcs-input')!
    const criteriaInput = container.querySelector<HTMLTextAreaElement>('textarea.pddcs-input')!
    await typeIn(nameInput, '发票咨询')
    await typeIn(criteriaInput, '买家询问能不能开发票、开票抬头与发票类型。')
    await click(textBtn('创建')!)

    const req = sent.find((m) => m.type === 'CREATE_CATEGORY')
    expect(req?.payload).toEqual({
      name: '发票咨询',
      criteria: '买家询问能不能开发票、开票抬头与发票类型。',
    })
    expect(noticeText()).toContain('已新建')
  })

  it('判定说明空白就直接提交:后台拒绝的理由要原样给用户看见,且表单不关闭', async () => {
    respOverrides.CREATE_CATEGORY = { error: '判定说明不能为空:空描述会拉低全部类型的判断质量' }
    await render()
    await click(textBtn('新建类型')!)
    await typeIn(container.querySelector<HTMLInputElement>('input.pddcs-input')!, '发票咨询')
    await click(textBtn('创建')!)

    expect(noticeText()).toContain('判定说明不能为空')
    expect(createFormOpen()).toBe(true) // 失败不关闭,用户可改
  })

  it('重名被后台拒绝时把理由透出(名字唯一性是硬拦截)', async () => {
    respOverrides.CREATE_CATEGORY = { error: '类型名「发票」已存在:重名会让分类结果互相覆盖' }
    await render()
    await click(textBtn('新建类型')!)
    await typeIn(container.querySelector<HTMLInputElement>('input.pddcs-input')!, '发票')
    await click(textBtn('创建')!)
    expect(noticeText()).toContain('已存在')
  })
})

describe('FoldersTab:类型操作钮跟着选中的类型走', () => {
  it('默认「全部」时没有改名/删除钮 —— 没有"当前类型",就没有可改的东西', async () => {
    await render()
    expect(btns('重命名这个类型')).toHaveLength(0)
    expect(btns('删除这个类型')).toHaveLength(0)
  })

  it('选中预置类型:没有钮(预置不可改名/删除)', async () => {
    await render()
    await click(navItem('preset:size'))
    expect(btns('重命名这个类型')).toHaveLength(0)
    expect(btns('删除这个类型')).toHaveLength(0)
  })

  it('选中未分类:没有钮', async () => {
    await render()
    await click(navItem('uncategorized'))
    expect(btns('重命名这个类型')).toHaveLength(0)
  })

  it('选中自定义类型:两枚钮出现', async () => {
    await render()
    await click(navItem('cat-1'))
    expect(btns('重命名这个类型')).toHaveLength(1)
    expect(btns('删除这个类型')).toHaveLength(1)
  })

  it('改名:点钮出内联输入(预填被选中类型的原名),保存发出 RENAME_CATEGORY', async () => {
    await render()
    await click(navItem('cat-1'))
    await click(btns('重命名这个类型')[0])
    const input = container.querySelector<HTMLInputElement>('input.pddcs-input')!
    expect(input.value).toBe('发票')
    await typeIn(input, '发票与开票')
    await click(textBtn('保存')!)
    const req = sent.find((m) => m.type === 'RENAME_CATEGORY')
    expect(req?.payload).toEqual({ id: 'cat-1', name: '发票与开票' })
    expect(noticeText()).toContain('已改名')
  })

  it('删除:二次确认后发出 DELETE_CATEGORY,并提示标答落回未分类', async () => {
    respOverrides.DELETE_CATEGORY = { success: true, movedGoldens: 2 }
    await render()
    await click(navItem('cat-1'))
    await click(btns('删除这个类型')[0])
    // 未确认前不发消息
    expect(sent.filter((m) => m.type === 'DELETE_CATEGORY')).toHaveLength(0)
    await click(textBtn('确认')!)
    const req = sent.find((m) => m.type === 'DELETE_CATEGORY')
    expect(req?.payload).toEqual({ id: 'cat-1' })
    expect(noticeText()).toContain('2 条标准回答已移到未分类')
  })

  it('删除确认可取消:取消不发 DELETE_CATEGORY', async () => {
    await render()
    await click(navItem('cat-1'))
    await click(btns('删除这个类型')[0])
    await click(textBtn('取消')!)
    expect(sent.filter((m) => m.type === 'DELETE_CATEGORY')).toHaveLength(0)
  })

  it('切走选中项会收起改名态(改名输入不会跨类型粘住)', async () => {
    await render()
    await click(navItem('cat-1'))
    await click(btns('重命名这个类型')[0])
    expect(container.querySelectorAll('input.pddcs-input')).toHaveLength(1)
    await click(navItem('cat-2'))
    expect(container.querySelectorAll('input.pddcs-input')).toHaveLength(0)
  })
})
