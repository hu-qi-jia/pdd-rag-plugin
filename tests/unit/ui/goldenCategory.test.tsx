// 标准回答页 · 分类导航与「移到其他类型」的渲染单测(v3.0)。
//
// v2.6 的形态是「页内类型分区」,类型管理钮挂在分区标题右侧;v3.0 把类型提到顶部
// 导航栏,**管理入口跟着选中项走**。本文件钉住新形态,并保留 v2.6 就有的两条口径:
//  ① 同问题的多条答案,最近设置的排在前(不按库内 id 序);
//  ② 手工摆放过的标答要有「已指定」标记,与机器打的区分得开。
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

const golden = (id: string, over: Partial<PanelGolden> = {}): PanelGolden => ({
  id,
  folderId: null,
  question: `问题${id}`,
  answer: `回复${id}`,
  hasEmbedding: 1,
  updatedAt: 0,
  categoryId: 'uncategorized',
  ...over,
})

let container: HTMLDivElement
let root: Root
let panelData: { goldens: PanelGolden[]; categories: PanelCategory[] }
let sent: Array<{ type: string; payload?: Record<string, unknown> }>

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {})
}

const btns = (title: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button[title]')).filter((el) =>
    el.title.includes(title),
  )

/** 分类导航里的某一项(按稳定的 data-cat-id 锚点,不按文字) */
const navItem = (catId: string): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>(`.pddcs-catnav button[data-cat-id="${catId}"]`)

/** 某条标准回答所在的卡片 */
const cardOf = (question: string): HTMLElement | undefined =>
  Array.from(container.querySelectorAll<HTMLElement>('.pddcs-gcard')).find((el) =>
    el.textContent?.includes(question),
  )

async function render() {
  mockedSend.mockImplementation(async (m: { type: string; payload?: Record<string, unknown> }) => {
    sent.push(m)
    if (m.type === 'GET_PANEL_DATA') {
      return {
        type: 'GET_PANEL_DATA_RESPONSE',
        payload: {
          folders: [],
          goldens: panelData.goldens,
          knowledge: [],
          categories: panelData.categories,
        },
      } as GetPanelDataResponse
    }
    return {
      type: `${m.type}_RESPONSE`,
      payload: { success: true },
    } as unknown as ExtensionMessageResponse
  })
  await act(async () => {
    root.render(<FoldersTab onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockedSend.mockReset()
  sent = []
  panelData = { goldens: [], categories: CATEGORIES }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('标准回答页 v3.0 · 分类导航', () => {
  it('导航含「全部」+ 各类型 + 「未分类」,每项带计数', async () => {
    panelData.goldens = [
      golden('g1', { question: '尺码问题', categoryId: 'preset:size' }),
      golden('g2', { question: '物流问题', categoryId: 'preset:logistics' }),
      golden('g3', { question: '未分类问题', categoryId: 'uncategorized' }),
    ]
    await render()
    expect(navItem('all')?.textContent).toBe('全部3')
    expect(navItem('preset:size')?.textContent).toBe('尺码1')
    expect(navItem('preset:logistics')?.textContent).toBe('物流1')
    expect(navItem('uncategorized')?.textContent).toBe('未分类1')
  })

  it('「未分类」恒排最后(不看它的 position)', async () => {
    await render()
    const ids = Array.from(container.querySelectorAll('.pddcs-catnav button')).map((b) =>
      b.getAttribute('data-cat-id'),
    )
    expect(ids).toEqual(['all', 'preset:size', 'preset:logistics', 'uncategorized'])
  })

  it('计数为 0 的类型照样在导航上(位置稳定,不随数据消失又跳回)', async () => {
    panelData.goldens = [golden('g1', { question: '物流问题', categoryId: 'preset:logistics' })]
    await render()
    expect(navItem('preset:size')?.textContent).toBe('尺码0')
    expect(container.textContent).not.toContain('尺码问题')
  })

  it('点某类型 → 列表只剩该类型的标答', async () => {
    panelData.goldens = [
      golden('g1', { question: '尺码问题', categoryId: 'preset:size' }),
      golden('g2', { question: '物流问题', categoryId: 'preset:logistics' }),
    ]
    await render()
    await click(navItem('preset:logistics')!)
    expect(navItem('preset:logistics')?.getAttribute('aria-current')).toBe('true')
    expect(cardOf('物流问题')).toBeTruthy()
    expect(cardOf('尺码问题')).toBeUndefined()
  })

  it('类型表里没有的 categoryId 并进未分类,一条都不丢', async () => {
    // 类型表里没有 'ghost'(旧库删掉的自定义类型),条目仍挂在它上面
    panelData.goldens = [
      golden('g1', { question: '幽灵问题', categoryId: 'ghost' }),
      golden('g2', { question: '未分类问题', categoryId: 'uncategorized' }),
    ]
    await render()
    expect(navItem('uncategorized')?.textContent).toBe('未分类2')
    await click(navItem('uncategorized')!)
    expect(cardOf('幽灵问题')).toBeTruthy()
    expect(cardOf('未分类问题')).toBeTruthy()
  })

  it('选中空的自定义类型:给一行说明,不留白', async () => {
    panelData.categories = [
      ...CATEGORIES,
      { id: 'custom:inv', name: '发票', kind: 'custom', filterable: true, position: 5 },
    ]
    panelData.goldens = [golden('g1', { categoryId: 'preset:size' })]
    await render()
    await click(navItem('custom:inv')!)
    expect(container.textContent).toContain('这个类型下还没有标准回答')
  })
})

describe('标准回答页 v3.0 · 卡片', () => {
  it('Q/A 两个字母各占一行锚,问题与答案都在卡里', async () => {
    panelData.goldens = [
      golden('g1', { question: '怎么申请退货?', answer: '订单页申请售后' }),
    ]
    await render()
    const card = cardOf('怎么申请退货?')!
    expect(card.querySelector('.q')?.textContent).toBe('怎么申请退货?')
    expect(card.querySelector('.a')?.textContent).toBe('订单页申请售后')
    expect(card.textContent).toContain('Q')
    expect(card.textContent).toContain('A')
  })

  it('答案是成品:完整直出,不做两行截断', async () => {
    panelData.goldens = [golden('g1', { question: '长答案问题', answer: '完整答案正文' })]
    await render()
    const a = cardOf('长答案问题')!.querySelector('.a') as HTMLElement
    expect(a.textContent).toBe('完整答案正文')
    // 平铺式:不在元素上挂任何行数截断
    expect(a.style.webkitLineClamp || '').toBe('')
  })

  it('手工指定过的标答挂 [已指定],机器打的不挂', async () => {
    panelData.goldens = [
      golden('g1', { question: '手工摆的', categoryId: 'preset:size', categorySource: 'manual' }),
      golden('g2', { question: '机器打的', categoryId: 'preset:size', categorySource: 'jev' }),
    ]
    await render()
    expect(cardOf('手工摆的')!.textContent).toContain('已指定')
    expect(cardOf('机器打的')!.textContent).not.toContain('已指定')
  })

  it('[被用 0 次] 不渲染:零信息标签不占版面', async () => {
    panelData.goldens = [golden('g1', { question: '零用量条目' })]
    await render()
    expect(cardOf('零用量条目')!.textContent).not.toContain('被用')
  })

  it('同问题的多条答案,最近设置的排在前(不按库内 id 序)', async () => {
    // 库里 goldens.toArray() 是 id 序(最旧在前),渲染前必须补排一次,
    // 否则最旧的会顶到最前 —— 与聊天页候选口径相反
    panelData.goldens = [
      golden('g-old', { question: '怎么发货', answer: '旧答案', updatedAt: 1000 }),
      golden('g-new', { question: '怎么发货', answer: '新答案', updatedAt: 2000 }),
    ]
    await render()
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.pddcs-gcard'))
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('新答案')
    expect(cards[1].textContent).toContain('旧答案')
    expect(cards[0].textContent).toContain('同问题 2 条')
  })

  it('每张卡带 data-category-id 锚点(验收脚本按类型 id 定位,不靠文字)', async () => {
    panelData.goldens = [golden('g1', { categoryId: 'preset:size' })]
    await render()
    const cards = container.querySelectorAll('[data-category-id="preset:size"]')
    expect(cards).toHaveLength(1)
  })
})

describe('标准回答页 v3.0 · 移到其他类型', () => {
  it('点 ⇢ → 出现类型下拉,选中即发 UPDATE_GOLDEN_CATEGORY', async () => {
    panelData.goldens = [golden('g1', { categoryId: 'preset:size' })]
    await render()
    const move = btns('移到其他类型')
    expect(move).toHaveLength(1)
    await click(move[0])

    const sel = container.querySelector<HTMLSelectElement>('select')
    expect(sel).toBeTruthy()
    expect(sel!.value).toBe('preset:size')

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        sel!,
        'preset:logistics',
      )
      sel!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})

    const req = sent.find((m) => m.type === 'UPDATE_GOLDEN_CATEGORY')
    expect(req?.payload).toEqual({ id: 'g1', categoryId: 'preset:logistics' })
    // 成功后 refresh:重新拉面板数据
    expect(sent.filter((m) => m.type === 'GET_PANEL_DATA')).toHaveLength(2)
  })

  it('下拉里的选项来自类型表(含未分类),不含已删除的类型', async () => {
    panelData.goldens = [golden('g1', { categoryId: 'ghost' })]
    await render()
    await click(btns('移到其他类型')[0])

    const values = Array.from(container.querySelectorAll('option')).map((o) => o.value)
    expect(values).toEqual(['preset:size', 'preset:logistics', 'uncategorized'])
    expect(values).not.toContain('ghost')
  })
})

// ─── 低置信标记 ────────────────────────────────────────────────────────────────
//
// `categoryConfidence` 长期只写不读:0.23 与 0.95 的机器判定在界面上长得一模一样,
// 用户无从知道哪条该复核。这一组钉住"该标的标、不该标的一律不标"。

describe('标准回答卡:低置信标记', () => {
  const withCat = (over: Partial<PanelGolden>): PanelGolden =>
    golden('g1', { categoryId: 'preset:size', ...over })

  it('★ 机器打的标 + 概率低于复核线 → 卡上写明概率', async () => {
    panelData.goldens = [withCat({ categorySource: 'jev', categoryConfidence: 0.23 })]
    await render()
    expect(cardOf('问题g1')?.textContent).toContain('低置信 0.23')
  })

  it('概率够高 → 不标(满屏灰标等于没标)', async () => {
    panelData.goldens = [withCat({ categorySource: 'jev', categoryConfidence: 0.91 })]
    await render()
    expect(cardOf('问题g1')?.textContent).not.toContain('低置信')
  })

  it('★ 人工摆放 → 只显示「已指定」,绝不显示低置信', async () => {
    // 标错了比不标更糟:用户会开始怀疑所有 [已指定] 的条目
    panelData.goldens = [withCat({ categorySource: 'manual' })]
    await render()
    const text = cardOf('问题g1')?.textContent ?? ''
    expect(text).toContain('已指定')
    expect(text).not.toContain('低置信')
  })

  it('★ 继承来的分类不算低置信', async () => {
    panelData.goldens = [withCat({ categorySource: 'inherit' })]
    await render()
    expect(cardOf('问题g1')?.textContent).not.toContain('低置信')
  })

  it('★ 有来源但没概率的旧数据不算低置信', async () => {
    // 不挡这条的话,功能上线当天所有历史记录会一起变成「低置信」
    panelData.goldens = [withCat({ categorySource: 'jev' })]
    await render()
    expect(cardOf('问题g1')?.textContent).not.toContain('低置信')
  })

  it('两种标互不串台:同页一张挂「已指定」、另一张挂「低置信」', async () => {
    // 现实里两者不会同卡出现(人工路径不写概率),但同一屏会共存 ——
    // 钉子是为了防止有人把判据写成"有来源就标"
    panelData.goldens = [
      golden('gA', { categoryId: 'preset:size', categorySource: 'manual' }),
      golden('gB', {
        categoryId: 'preset:logistics',
        categorySource: 'jev',
        categoryConfidence: 0.3,
      }),
    ]
    await render()
    const a = cardOf('问题gA')?.textContent ?? ''
    const b = cardOf('问题gB')?.textContent ?? ''
    expect(a).toContain('已指定')
    expect(a).not.toContain('低置信')
    expect(b).toContain('低置信 0.30')
    expect(b).not.toContain('已指定')
  })
})
