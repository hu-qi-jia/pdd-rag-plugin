// 尺码表标记的界面(第五十八轮 Task 5 引入,**v3.0 第二版改入口**)。
//
// 旧版是"每篇文档的第一块挂一个 `Toggle` 尺码表":一篇 20 块的文档列表里,
// 每个文档各挂一枚,用户要在列表里逐条找、找到了再打开开关 —— 而"标记"这件事
// 与"上传"本来就是同一次动作(用户手上就是那张表)。
// 用户原话:「不用将每条都增加尺码表的开关,在顶部上传按钮右侧增加一个上传尺码表就好」。
//
// 现口径:
//   ① 列表里**没有任何**尺码表开关(`[role=switch]` 一个都不该有);
//   ② 工具栏「上传尺码表」= 导入 + 标记合成一次动作;
//   ③ 尺码表**只有一张**:上传新的会先摘掉旧的;
//   ④ 状态行只在有尺码表时出现,取消入口就在那一行。
//
// 后半段(尺码生成行的门禁)与本次改动无关,原样保留。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetPanelDataResponse, PanelKnowledge } from '../../../src/types/messages'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { KnowledgeTab } = await import('../../../src/popup/KnowledgeTab')
const { lightTheme } = await import('../../../src/ui/theme')
const { sizeRowAvailable } = await import('../../../src/background/aiIntegrate')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

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

function chunk(over: Partial<PanelKnowledge> & { id: string }): PanelKnowledge {
  return {
    title: over.id,
    content: '正文',
    hasEmbedding: 1,
    enabled: 1,
    source: 'doc',
    updatedAt: 1,
    ...over,
  }
}

function panel(knowledge: PanelKnowledge[]): GetPanelDataResponse {
  return {
    type: 'GET_PANEL_DATA_RESPONSE',
    payload: { folders: [], goldens: [], knowledge, categories: [] },
  }
}

/**
 * 渲染并让首帧的 `GET_PANEL_DATA` 落地。
 * 之后的 `sendMessage` 一律走 `route`:上传流程里一次会连发好几条
 * (UPLOAD_KB_DOC → SET_KB_SIZE_TABLE ×N → 重新拉面板),按类型分流比逐个
 * `mockResolvedValueOnce` 好读,也不会因为多发/少发一条就错位。
 */
async function renderTab(knowledge: PanelKnowledge[]) {
  mockedSend.mockImplementation(async (msg: { type: string }) => {
    if (msg.type === 'GET_PANEL_DATA') return panel(knowledge) as never
    if (msg.type === 'UPLOAD_KB_DOC') {
      return {
        type: 'UPLOAD_KB_DOC_RESPONSE',
        payload: { docId: '尺码表', chunkCount: 3 },
      } as never
    }
    if (msg.type === 'SET_KB_SIZE_TABLE') {
      return { type: 'SET_KB_SIZE_TABLE_RESPONSE', payload: { success: true } } as never
    }
    return {} as never
  })
  await act(async () => {
    root.render(<KnowledgeTab tk={lightTheme} onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

const btns = (label: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === label)

/** 走一次「上传尺码表」:直接给隐藏 input 塞一个假 File 再派发 change */
async function uploadSizeTable(name = '尺码表.md', content = '| 尺码 | 胸围 |') {
  const input = container.querySelector<HTMLInputElement>('input[data-upload="size-table"]')!
  expect(input, '找不到尺码表文件输入').toBeTruthy()
  Object.defineProperty(input, 'files', {
    value: [{ name, text: async () => content }],
    configurable: true,
  })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {})
}

const sentTypes = () => mockedSend.mock.calls.map((c) => (c[0] as { type: string }).type)
const sizeTableCalls = () =>
  mockedSend.mock.calls
    .map((c) => c[0] as { type: string; payload?: { docId?: string; on?: boolean } })
    .filter((m) => m.type === 'SET_KB_SIZE_TABLE')
    .map((m) => `${m.payload!.docId}:${m.payload!.on}`)

describe('知识库页:尺码表入口在工具栏,不在列表里', () => {
  it('★ 列表里一个尺码表开关都没有(用户要求:不用每条都加)', async () => {
    await renderTab([
      chunk({ id: '尺码表-c0', docId: '尺码表', title: '尺码表 · c0' }),
      chunk({ id: '尺码表-c1', docId: '尺码表', title: '尺码表 · c1' }),
      chunk({ id: '发货-c0', docId: '发货', title: '发货 · c0' }),
    ])
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0)
  })

  it('工具栏有「上传尺码表」,且排在「上传 .md」之后(用户口径:在它右侧)', async () => {
    await renderTab([])
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).toContain('上传 .md')
    expect(labels).toContain('上传尺码表')
    expect(labels.indexOf('上传 .md')).toBeLessThan(labels.indexOf('上传尺码表'))
  })

  it('没有尺码表时不显示状态行(新装的库不该多一行空状态)', async () => {
    await renderTab([chunk({ id: '发货-c0', docId: '发货' })])
    expect(container.textContent).not.toContain('尺码表:')
    expect(btns('取消')).toHaveLength(0)
  })
})

describe('知识库页:上传尺码表 = 导入 + 标记,合成一次动作', () => {
  it('★ 先导文档、后标尺码表,顺序不能反', async () => {
    await renderTab([])
    await uploadSizeTable()
    expect(sentTypes()).toEqual(['GET_PANEL_DATA', 'UPLOAD_KB_DOC', 'SET_KB_SIZE_TABLE', 'GET_PANEL_DATA'])
    expect(sizeTableCalls()).toEqual(['尺码表:true'])
  })

  it('★ 尺码表只有一张:上传新的会先摘掉旧的', async () => {
    await renderTab([chunk({ id: '旧表-c0', docId: '旧表', isSizeTable: true })])
    await uploadSizeTable('新表.md')
    // 摘旧在前、标新在后 —— 反过来的话中途失败会留下"两张尺码表"
    expect(sizeTableCalls()).toEqual(['旧表:false', '尺码表:true'])
  })

  it('已标记的文档就是当前这一张时,不自己摘自己', async () => {
    // 重传同名尺码表:docId 与旧的相同 —— 同一篇文档,不该先关再开
    await renderTab([chunk({ id: '尺码表-c0', docId: '尺码表', isSizeTable: true })])
    await uploadSizeTable('尺码表.md')
    expect(sizeTableCalls()).toEqual(['尺码表:true'])
  })

  it('导入成功但后台没返回 docId:明确说是"标记没成",不谎报整件事成功', async () => {
    mockedSend.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_PANEL_DATA') return panel([]) as never
      if (msg.type === 'UPLOAD_KB_DOC') {
        return { type: 'UPLOAD_KB_DOC_RESPONSE', payload: { chunkCount: 3 } } as never
      }
      return {} as never
    })
    await act(async () => {
      root.render(<KnowledgeTab tk={lightTheme} onDataChanged={vi.fn()} />)
    })
    await act(async () => {})
    await uploadSizeTable()
    expect(sizeTableCalls()).toEqual([]) // 没有 docId 就没得标
    expect(container.textContent).toContain('没能标记为尺码表')
  })
})

describe('知识库页:状态行显示当前尺码表,取消就在那里', () => {
  it('有尺码表时状态行写出文档名(数据来自 isSizeTable,不是本地状态)', async () => {
    await renderTab([chunk({ id: '尺码表-c0', docId: '尺码表', isSizeTable: true })])
    expect(container.textContent).toContain('尺码表:《尺码表》')
  })

  it('点「取消」发 SET_KB_SIZE_TABLE { on: false } 并重载', async () => {
    await renderTab([chunk({ id: '尺码表-c0', docId: '尺码表', isSizeTable: true })])
    act(() => btns('取消')[0].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => {})
    expect(sizeTableCalls()).toEqual(['尺码表:false'])
    expect(sentTypes().at(-1)).toBe('GET_PANEL_DATA')
  })

  it('同一文档的多块只算一张(状态行按 docId 去重,不按块数重复列出)', async () => {
    await renderTab([
      chunk({ id: '尺码表-c0', docId: '尺码表', isSizeTable: true }),
      chunk({ id: '尺码表-c1', docId: '尺码表', isSizeTable: true }),
      chunk({ id: '尺码表-c2', docId: '尺码表', isSizeTable: true }),
    ])
    expect(container.textContent!.match(/《尺码表》/g)).toHaveLength(1)
  })
})

describe('尺码行的门禁', () => {
  const base = {
    aiIntegrateEnabled: true,
    directFillEnabled: false,
    llmBaseUrl: 'https://api.example.com/v1',
    llmApiKey: 'sk-test',
    llmModel: 'fast-model',
    llmTimeoutMs: 8000,
  }

  it('★ 没配 LLM → 不渲染(与知识库整合行同一套外发闸门)', () => {
    expect(sizeRowAvailable({ ...base, llmApiKey: '' } as never, true)).toBe(false)
    expect(sizeRowAvailable({ ...base, llmBaseUrl: '' } as never, true)).toBe(false)
    expect(sizeRowAvailable({ ...base, llmModel: '' } as never, true)).toBe(false)
  })

  it('AI 整合总开关关着 → 不渲染', () => {
    expect(sizeRowAvailable({ ...base, aiIntegrateEnabled: false } as never, true)).toBe(false)
  })

  it('没标记尺码表 → 不渲染(没有材料,发出去也无意义)', () => {
    expect(sizeRowAvailable(base as never, false)).toBe(false)
  })

  it('★ directFillEnabled 打开 → 不渲染(那条路径不弹面板、不调 LLM)', () => {
    expect(sizeRowAvailable({ ...base, directFillEnabled: true } as never, true)).toBe(false)
  })

  it('三条齐备 → 渲染', () => {
    expect(sizeRowAvailable(base as never, true)).toBe(true)
  })
})
