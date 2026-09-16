// FoldersTab 行为特征测试(第三十一轮):folderRename 之外的操作流补测 ——
// 新建 / 删除文件夹(内联确认)/ 遗留子夹拍平(PM7)/ 金标准编辑 / 删除 / 迁移。
// 断言落在「发出什么消息 + 显示什么提示 + 界面状态机流转」,不发真消息(mock)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  ExtensionMessageResponse,
  GetPanelDataResponse,
  PanelFolder,
  PanelGolden,
} from '../../../src/types/messages'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { FoldersTab, ICON_SIZE } = await import('../../../src/popup/FoldersTab')
const { lightTheme } = await import('../../../src/ui/theme')
const { controlH } = await import('../../../src/ui/design')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const folder = (id: string, name: string, parentId: string | null = null): PanelFolder => ({
  id,
  parentId,
  name,
  position: 0,
})

const golden = (id: string, overrides: Partial<PanelGolden> = {}): PanelGolden => ({
  id,
  folderId: null,
  question: `问题${id}`,
  answer: `回复${id}`,
  hasEmbedding: 1,
  updatedAt: 0,
  ...overrides,
})

let container: HTMLDivElement
let root: Root
/** load()/refresh() 读的数据,测试可改;mutation 响应由 overrides 覆盖 */
let panelData: { folders: PanelFolder[]; goldens: PanelGolden[]; knowledge: unknown[] }
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

const textInput = (): HTMLInputElement | null => container.querySelector<HTMLInputElement>('input.pddcs-input')

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
  panelData = { folders: [folder('f1', '售后')], goldens: [], knowledge: [] }
  mockedSend.mockImplementation(async (msg: { type: string; payload?: Record<string, unknown> }) => {
    sent.push(msg)
    if (msg.type === 'GET_PANEL_DATA') {
      return {
        type: 'GET_PANEL_DATA_RESPONSE',
        payload: panelData,
      } as GetPanelDataResponse
    }
    const base: Record<string, unknown> = {
      CREATE_FOLDER: { error: undefined },
      RENAME_FOLDER: { success: true },
      DELETE_FOLDER: { success: true },
      FLATTEN_FOLDERS: { success: true, flattened: 2 },
      UPDATE_GOLDEN: { error: undefined, reembed: false },
      DELETE_GOLDEN: { success: true },
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

describe('FoldersTab:新建文件夹', () => {
  it('点新建 → 原位表单 → 输入名 → 创建:发出 CREATE_FOLDER(parentId=null)并提示成功', async () => {
    await render()
    await click(textBtn('新建文件夹')!)
    const input = textInput()
    expect(input?.placeholder).toBe('文件夹名称')
    await click(textBtn('取消')!) // 先验取消:不发出消息、表单收起
    expect(sent.filter((m) => m.type === 'CREATE_FOLDER')).toHaveLength(0)
    expect(textInput()).toBeNull()

    await click(textBtn('新建文件夹')!)
    await typeIn(textInput()!, '物流')
    await click(textBtn('创建')!)
    const req = sent.find((m) => m.type === 'CREATE_FOLDER')
    expect(req?.payload).toEqual({ name: '物流', parentId: null })
    expect(noticeText()).toContain('文件夹已创建')
    // 成功后 refresh:重新拉取面板数据
    expect(sent.filter((m) => m.type === 'GET_PANEL_DATA')).toHaveLength(2)
  })

  it('后台返回 error:提示「新建失败:<原因>」,不刷新列表', async () => {
    respOverrides.CREATE_FOLDER = { error: '名称重复' }
    await render()
    await click(textBtn('新建文件夹')!)
    await typeIn(textInput()!, '售后')
    await click(textBtn('创建')!)
    expect(noticeText()).toContain('新建失败:名称重复')
    expect(sent.filter((m) => m.type === 'GET_PANEL_DATA')).toHaveLength(1)
  })
})

describe('FoldersTab:删除文件夹(内联二次确认)', () => {
  it('点删除钮 → 出现确认行;取消不发消息', async () => {
    await render()
    const del = btns('删除文件夹')
    expect(del).toHaveLength(1) // 默认文件夹场景外,普通根夹才有
    await click(del[0])
    expect(noticeText()).toContain('删除该文件夹?其下标准回答将移入「默认文件夹」')
    await click(textBtn('取消')!)
    expect(sent.filter((m) => m.type === 'DELETE_FOLDER')).toHaveLength(0)
  })

  it('确认删除:发出 DELETE_FOLDER {id} 并刷新', async () => {
    await render()
    await click(btns('删除文件夹')[0])
    await click(textBtn('确认')!)
    const req = sent.find((m) => m.type === 'DELETE_FOLDER')
    expect(req?.payload).toEqual({ id: 'f1' })
    expect(noticeText()).toContain('文件夹已删除')
    expect(sent.filter((m) => m.type === 'GET_PANEL_DATA')).toHaveLength(2)
  })
})

describe('FoldersTab:遗留子文件夹拍平(PM7)', () => {
  it('存量子夹出现拍平入口;确认后发出 FLATTEN_FOLDERS 并提示拍平数量', async () => {
    panelData.folders = [folder('f1', '父夹'), folder('sub', '子夹', 'f1')]
    await render()
    expect(noticeText()).toContain('检测到 1 个遗留子文件夹')
    await click(textBtn('一键拍平')!)
    expect(noticeText()).toContain('拍平 1 个子文件夹(子夹)')
    await click(textBtn('确认')!)
    expect(sent.find((m) => m.type === 'FLATTEN_FOLDERS')).toBeTruthy()
    expect(noticeText()).toContain('已拍平 2 个子文件夹')
  })

  it('无存量子夹时不出现拍平入口', async () => {
    await render()
    expect(textBtn('一键拍平')).toBeNull()
  })
})

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

describe('FoldersTab:标准回答迁移文件夹', () => {
  it('点迁移 → 下拉默认当前文件夹;改选后发出 UPDATE_GOLDEN {id,folderId}', async () => {
    panelData.folders = [folder('f1', '售后'), folder('f2', '物流')]
    panelData.goldens = [golden('g1', { folderId: 'f1' })]
    await render()
    const move = btns('迁移到其他文件夹')
    expect(move).toHaveLength(1)
    await click(move[0])
    const sel = container.querySelector<HTMLSelectElement>('select')
    expect(sel?.value).toBe('f1')
    // 改选「物流」
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel!, 'f2')
      sel!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {})
    const req = sent.find((m) => m.type === 'UPDATE_GOLDEN')
    expect(req?.payload).toEqual({ id: 'g1', folderId: 'f2' })
  })

  it('未归夹(默认文件夹)的金标准,下拉默认选 uncategorized', async () => {
    panelData.goldens = [golden('g1', { folderId: null })]
    await render()
    await click(btns('迁移到其他文件夹')[0])
    expect(container.querySelector<HTMLSelectElement>('select')?.value).toBe('uncategorized')
  })
})

// ── 第四十四轮(v2.6.31):操作组默认可见 + 图标左缘与正文左缘对齐 ──────────────
describe('FoldersTab:标准回答行操作组(常驻 + 左缘对齐)', () => {
  it('四个图标钮默认可见:全树无 .pddcs-row-ops,且从钮到根节点没有 opacity:0', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    expect(container.querySelectorAll('.pddcs-row-ops')).toHaveLength(0)
    for (const label of ['迁移到其他文件夹', '复制', '编辑', '删除(历史记录不受影响)']) {
      const btn = btns(label)[0]
      expect(btn, `${label} 按钮应存在`).toBeTruthy()
      // 悬浮显隐退役 = 从按钮往上没有任何一层被 opacity:0 藏起来
      for (let el: HTMLElement | null = btn; el; el = el.parentElement) {
        expect(el.style.opacity).not.toBe('0')
      }
    }
  })

  it('操作组左缘 = 正文左缘:负 margin 抵消图标钮盒内的图标留白 (24−13)/2', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    const group = btns('迁移到其他文件夹')[0].parentElement as HTMLElement
    expect(group.style.marginLeft).toBe(`${-(controlH.inline - ICON_SIZE) / 2}px`)
    expect(group.style.marginLeft).toBe('-5.5px')
    // 同排图标 13px:留白算式的输入,写死在断言里防止悄悄漂移
    expect(btns('迁移到其他文件夹')[0].querySelector('svg')?.getAttribute('width')).toBe(
      String(ICON_SIZE),
    )
    // 正文(问题)与操作组同处一个左内边距容器:组不再被 marginLeft:auto 顶到右边
    expect(group.style.marginLeft).not.toBe('auto')
  })

  it('确认删除态是文字钮:靠左但 marginLeft 归 0(钮盒贴正文左缘,不再补偿图标留白)', async () => {
    panelData.goldens = [golden('g1')]
    await render()
    await click(btns('删除(历史记录不受影响)')[0])
    const group = textBtn('确认')!.parentElement as HTMLElement
    expect(group.style.marginLeft).toBe('0px')
  })
})
