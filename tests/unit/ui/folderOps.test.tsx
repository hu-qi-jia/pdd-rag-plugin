// 标准回答页行为特征测试(第三十一轮,第五十七轮 Task 6 适配)。
//
// 原文件覆盖「新建 / 删除文件夹(内联确认)/ 遗留子夹拍平 / 金标准编辑 / 删除 / 迁移」。
// 第五十七轮把文件夹 CRUD 的 UI 整体移除(改按问题类型分区),因此:
//   · 新建文件夹 / 删除文件夹 / 遗留子夹拍平 / 迁移到其他文件夹 —— 测的是**被移除的 UI**,
//     用例连同实现一起删(FLATTEN_FOLDERS 的 handler 仍在,其行为由
//     tests/unit/background/panel.test.ts 直接覆盖,不经 UI);
//   · 标准回答编辑 / 删除 / 操作组常驻与左缘对齐 —— 这些 UI 仍在,保留(迁移换类型后
//     断言随之更新)。
// 断言落在「发出什么消息 + 显示什么提示 + 界面状态机流转」,不发真消息(mock)。
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

const { FoldersTab, ICON_SIZE } = await import('../../../src/popup/FoldersTab')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const CATEGORIES: PanelCategory[] = [
  { id: 'preset:size', name: '尺码', kind: 'preset', filterable: true, route: 'retrieve', position: 1 },
  { id: 'preset:logistics', name: '物流', kind: 'preset', filterable: true, route: 'retrieve', position: 2 },
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
/** load()/refresh() 读的数据,测试可改;mutation 响应由 overrides 覆盖 */
let panelData: { goldens: PanelGolden[]; knowledge: unknown[]; categories: PanelCategory[] }
/** 各 mutation 的响应覆盖(默认全部成功) */
let respOverrides: Record<string, Record<string, unknown>>
/** 收到的请求(断言发消息) */
let sent: Array<{ type: string; payload?: Record<string, unknown> }>

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {}) // 冲刷异步 handler
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
const typeIn = async (el: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
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
  panelData = { goldens: [], knowledge: [], categories: CATEGORIES }
  mockedSend.mockImplementation(async (msg: { type: string; payload?: Record<string, unknown> }) => {
    sent.push(msg)
    if (msg.type === 'GET_PANEL_DATA') {
      return {
        type: 'GET_PANEL_DATA_RESPONSE',
        payload: panelData,
      } as GetPanelDataResponse
    }
    const base: Record<string, unknown> = {
      UPDATE_GOLDEN: { error: undefined, reembed: false },
      DELETE_GOLDEN: { success: true },
      UPDATE_GOLDEN_CATEGORY: { success: true },
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

describe('FoldersTab:标准回答编辑', () => {
  it('点编辑 → 两文本域预填原问答 → 保存:发出 UPDATE_GOLDEN {id,question,answer}', async () => {
    panelData.goldens = [golden('g1', { question: '怎么发货', answer: '48小时内' })]
    await render()
    await click(btns('编辑')[0])
    const tas = container.querySelectorAll<HTMLTextAreaElement>('textarea.pddcs-input')
    expect(tas[0].value).toBe('怎么发货')
    expect(tas[1].value).toBe('48小时内')
    await typeIn(tas[0], '多久发货')
    await typeIn(tas[1], '48小时内发出')
    await click(btns('重新生成问题向量')[0]) // 保存钮(title 标识)
    const req = sent.find((m) => m.type === 'UPDATE_GOLDEN')
    expect(req?.payload).toEqual({ id: 'g1', question: '多久发货', answer: '48小时内发出' })
    expect(noticeText()).toContain('已保存')
  })

  it('响应 reembed=true 时提示正在重新生成问题向量', async () => {
    respOverrides.UPDATE_GOLDEN = { error: undefined, reembed: true }
    panelData.goldens = [golden('g1')]
    await render()
    await click(btns('编辑')[0])
    await click(btns('重新生成问题向量')[0])
    expect(noticeText()).toContain('正在重新生成问题向量')
  })
})

describe('FoldersTab:标准回答删除', () => {
  it('确认后发出 DELETE_GOLDEN {id};取消不发', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    await click(btns('历史记录不受影响')[0])
    await click(textBtn('取消')!)
    expect(sent.filter((m) => m.type === 'DELETE_GOLDEN')).toHaveLength(0)

    await click(btns('历史记录不受影响')[0])
    await click(textBtn('确认')!)
    const req = sent.find((m) => m.type === 'DELETE_GOLDEN')
    expect(req?.payload).toEqual({ id: 'g1' })
    expect(noticeText()).toContain('标准回答已删除,历史记录不受影响')
  })
})

// ── v3.0:操作组改为**卡片右下角的图标行**(v2.6 那套"靠左、负 margin 抵消
//    图标钮盒内留白"的算式随卡片改形态一并作废)────────────────────────────────
describe('FoldersTab:标准回答卡的操作行', () => {
  it('四枚图标钮常驻可见,且从钮到根节点没有一层被 opacity:0 藏起来', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    expect(container.querySelectorAll('.pddcs-row-ops')).toHaveLength(0)
    for (const label of ['编辑', '移到其他类型', '复制', '删除(历史记录不受影响)']) {
      const btn = btns(label)[0]
      expect(btn, `${label} 按钮应存在`).toBeTruthy()
      // 悬浮显隐退役 = 从按钮往上没有任何一层被 opacity:0 藏起来
      for (let el: HTMLElement | null = btn; el; el = el.parentElement) {
        expect(el.style.opacity).not.toBe('0')
      }
    }
  })

  it('操作行在卡片内的 .pddcs-gops 里(靠右),不再是左对齐的独立组', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    const group = btns('编辑')[0].parentElement as HTMLElement
    expect(group.classList.contains('pddcs-gops')).toBe(true)
    // 靠右由类的 justify-content 决定,不再靠任何内联 marginLeft 算式
    expect(group.style.marginLeft).toBe('')
    expect(btns('编辑')[0].querySelector('svg')?.getAttribute('width')).toBe(String(ICON_SIZE))
  })

  it('确认删除时用原位二次确认行替换整组图标钮', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    await click(btns('删除(历史记录不受影响)')[0])
    const group = container.querySelector('.pddcs-gops') as HTMLElement
    expect(group.querySelector('.pddcs-iconbtn')).toBeNull()
    expect(textBtn('确认')).toBeTruthy()
    expect(textBtn('取消')).toBeTruthy()
  })
})
