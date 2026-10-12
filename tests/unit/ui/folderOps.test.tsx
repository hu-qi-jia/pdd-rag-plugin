// 标准回答页行为特征测试(第三十一轮,第五十七轮 Task 6 适配)。
//
// 原文件覆盖「新建 / 删除文件夹(内联确认)/ 遗留子夹拍平 / 金标准编辑 / 删除 / 迁移」。
// 第五十七轮把文件夹 CRUD 的 UI 整体移除(改按问题类型分区),因此:
//   · 新建文件夹 / 删除文件夹 / 遗留子夹拍平 / 迁移到其他文件夹 —— 测的是**被移除的 UI**,
//     用例连同实现一起删(FLATTEN_FOLDERS 的 handler 仍在,其行为由
//     tests/unit/background/panel.test.ts 直接覆盖,不经 UI);
//   · 标准回答编辑 / 删除 / 操作组常驻可见 —— 这些 UI 仍在,保留(迁移换类型后
//     断言随之更新;v3.1 方向 5 改手册卡片后,操作组从"靠右顶行尾"收成"卡片右下角",
//     标签行由 ` · ` 元信息改成方括号灰标)。
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

const { FoldersTab } = await import('../../../src/popup/FoldersTab')
const { lightTheme } = await import('../../../src/ui/theme')
// v3.1:图标尺寸的真源是 design.ts#size.icon( FoldersTab 不再自曝 ICON_SIZE )
const { size } = await import('../../../src/ui/design')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const CATEGORIES: PanelCategory[] = [
  { id: 'preset:size', name: '尺码', kind: 'preset', filterable: true, position: 1 },
  { id: 'preset:logistics', name: '物流', kind: 'preset', filterable: true, position: 2 },
  { id: 'uncategorized', name: '未分类', kind: 'uncategorized', filterable: false, position: 9999 },
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
const typeIn = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** 按纯文字找那个叶子 <span>(问题 / 答案正文)—— 手册卡片里正文都是 span */
const spanOf = (text: string): HTMLElement => {
  const el = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
    (s) => s.children.length === 0 && s.textContent === text,
  )
  expect(el, `找不到正文节点「${text}」`).toBeTruthy()
  return el!
}

/** 该问答所属的**手册卡片** = 问题 span 的父级(Q 行)再上一级 */
const cardOf = (question: string): HTMLElement =>
  spanOf(question).parentElement!.parentElement as HTMLElement

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
    root.render(<FoldersTab tk={lightTheme} onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

describe('FoldersTab:标准回答编辑', () => {
  it('点编辑 → 问题框 / 答案域预填原问答 → 保存:发出 UPDATE_GOLDEN {id,question,answer}', async () => {
    panelData.goldens = [golden('g1', { question: '怎么发货', answer: '48小时内' })]
    await render()
    await click(btns('编辑')[0])
    // v3.1 手册卡片:问题行是 <input>,答案行是 <textarea>(两者共用 .pddcs-input)
    const q = container.querySelector<HTMLInputElement>('input.pddcs-input')!
    const a = container.querySelector<HTMLTextAreaElement>('textarea.pddcs-input')!
    expect(q.value).toBe('怎么发货')
    expect(a.value).toBe('48小时内')
    await typeIn(q, '多久发货')
    await typeIn(a, '48小时内发出')
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

// ── 第四十四轮(v2.6.31)立"常驻可见";v3.1 方向 5 改成**手册卡片**,操作收在卡片右下角 ──
describe('FoldersTab:手册卡片操作区(常驻可见 + 收在卡片右下角)', () => {
  it('四个图标钮默认可见:全树无 .pddcs-row-ops,且从钮到根节点没有 opacity:0', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    // 悬浮显隐的旧操作组类名不得回来
    expect(container.querySelectorAll('.pddcs-row-ops')).toHaveLength(0)
    for (const label of ['移动到其他类型', '复制这条回答', '编辑', '删除(历史记录不受影响)']) {
      const btn = btns(label)[0]
      expect(btn, `${label} 按钮应存在`).toBeTruthy()
      // 常驻可见 = 从按钮往上没有任何一层被 opacity:0 藏起来
      for (let el: HTMLElement | null = btn; el; el = el.parentElement) {
        expect(el.style.opacity).not.toBe('0')
      }
    }
  })

  it('★ 四枚操作钮收在**卡片之内**、答案之后(旧版"与标题同处主行"的骨架已随手册卡片退役)', async () => {
    // 旧版(v3.0 第三版)共用列表骨架:主行 = 标题 + 行尾操作列,答复预览的后面不再跟图标钮。
    // v3.1 方向 5 不再共用那个骨架:每条标准回答是一张**独立的手册卡片**,操作收在卡片**右下角**。
    // 保留的不变量只有一条 —— 不该再出现"共享一行 / 漂浮在列表外"的操作列,每条卡在自己卡片里。
    panelData.goldens = [golden('g1', { question: '物流问题', answer: '物流答复' })]
    await render()
    const card = cardOf('物流问题')
    const move = btns('移动到其他类型')[0]
    expect(move, '操作钮应存在').toBeTruthy()

    // 四枚图标都必须在这张卡片之内
    for (const label of ['移动到其他类型', '复制这条回答', '编辑', '删除(历史记录不受影响)']) {
      expect(card.contains(btns(label)[0]), `${label} 应在卡片内`).toBe(true)
    }
    // 操作组排在答案**之后**(= 卡片底部);与旧版"答复后不再跟图标钮"正好相反
    const answerEl = spanOf('物流答复')
    const after = answerEl.compareDocumentPosition(move)
    expect(after & Node.DOCUMENT_POSITION_FOLLOWING, '操作钮应排在答案之后(卡片底部)').not.toBe(0)
    const group = move.parentElement as HTMLElement
    // 用户第 4 条:四枚钮由"卡片右下角"改为**居左**,左缘与 Q/A 正文同一竖线
    //(槽宽 12 + 间距 8 = 20 的左内边距),于是"操作"和它作用的文字站在同一条线上
    expect(group.style.paddingLeft).toBe(`${12 + 8}px`)
  })

  it('★ 灰标在 **Q 行下方独立一行**、方括号包裹;不进问题行、零信息不渲染', async () => {
    // 旧版把标记与计数合并成"一条 ` · ` 分隔的元信息行";v3.1 改成方括号灰标(§④),
    // 且**零信息标签一律不上**。不变量照旧:标签与问题分居两行,不挤进问题行。
    panelData.goldens = [
      golden('g1', {
        question: '物流问题',
        answer: '物流答复',
        categorySource: 'manual',
        hasEmbedding: 0,
      }),
      golden('g2', { question: '物流问题', answer: '另一条答复' }),
      golden('g3', { question: '干净问题', answer: '干净答复' }),
    ]
    await render()
    // 问题行里只有 Q 槽 + 问题本身 —— 没有徽标、没有计数
    const qRow = spanOf('物流问题').parentElement as HTMLElement
    expect(qRow.textContent).not.toContain('已指定')
    expect(qRow.textContent).not.toContain('同问题')
    expect(qRow.textContent).not.toContain('向量生成中')

    // 它们收在问题**下面**的一行里,方括号包裹,同一档字号
    const tagRow = qRow.nextElementSibling as HTMLElement
    expect(tagRow, 'Q 行下应有灰标行').toBeTruthy()
    expect(tagRow.textContent).toContain('[已指定]')
    expect(tagRow.textContent).toContain('[同问题 2 条]')
    expect(tagRow.textContent).toContain('[向量生成中]')
    expect(tagRow.style.fontSize).toBe('10px')
    // v3.1 不再用 ` · ` 连接元信息 —— 方括号本身就是分隔符
    expect(tagRow.textContent).not.toContain(' · ')

    // 零信息(来源非手工、同问题仅 1 条、向量正常、没用过)一张标都不挂
    expect(cardOf('干净问题').textContent).not.toContain('[')
  })

  it('★ 操作组**居左**、左缘与正文同线,与上方文字的间距也收紧(用户第 4 条)', async () => {
    // v3.1 §五.4 原本写"操作图标钮收在卡片右下角";用户看过真机后要求改成居左。
    // 对齐方式与 v3.0 那条"负 margin 补偿"**不是一回事**:这里靠的是左内边距
    // (= Q/A 槽宽 12 + 间距 8),让钮的左缘落在问题/答案正文那条竖线上,
    // 不涉及"图标在 20px 钮盒里居中"那 4px 的补偿。
    panelData.goldens = [golden('g1')]
    await render()
    const group = btns('移动到其他类型')[0].parentElement as HTMLElement
    expect(group.style.paddingLeft).toBe(`${12 + 8}px`)
    expect(group.style.justifyContent).not.toBe('flex-end')
    // 与上方答案的间距收到 spacing.xs(4):整张卡更紧凑
    expect(group.style.marginTop).toBe('4px')
    // 图标仍是全站统一规格(尺寸与对齐是两件事,改对齐不该动尺寸)
    expect(btns('移动到其他类型')[0].querySelector('svg')?.getAttribute('width')).toBe(
      String(size.icon),
    )
  })

  it('★ 卡片的上下空隙收紧(用户第 4 条「每一个卡片中的上下空隙也减小」)', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    const card = cardOf('问题g1')
    expect(card.style.paddingTop).toBe('8px')
    expect(card.style.paddingBottom).toBe('6px')
  })

  it('删除确认是卡片**内**的 ConfirmRow(原位文字钮),确认前不发 DELETE_GOLDEN', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    await click(btns('删除(历史记录不受影响)')[0])
    expect(container.textContent).toContain('删除这条标准回答?(历史记录不受影响)')
    const ok = textBtn('确认')
    expect(ok, '确认钮应存在').toBeTruthy()
    // 原位:确认行落在被删的那张卡片里,不是弹窗、不挪到别处
    expect(cardOf('问题g1').contains(ok!), '确认行应在卡片内').toBe(true)
    expect(sent.filter((m) => m.type === 'DELETE_GOLDEN')).toHaveLength(0)
  })
})
