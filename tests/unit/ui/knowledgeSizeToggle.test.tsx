// 尺码路由的界面(第五十八轮 Task 5):
//  ① 知识库页的「尺码表」开关 —— 一篇文档切成很多块,而「是不是尺码表」是**文档级**的,
//     开关只能在该文档的**第一块**上渲染一次(否则一篇 20 块的文档会冒出 20 个开关,
//     点哪一个都改同一篇文档,用户无从判断);
//  ② 尺码生成行的门禁 —— 与知识库整合行**同一套外发闸门**(ADR-0006/0007),
//     不新增开关。没配 LLM / 没标记尺码表 / 「自动回复」开着,一律不渲染。
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

async function renderTab(knowledge: PanelKnowledge[]) {
  const resp: GetPanelDataResponse = {
    type: 'GET_PANEL_DATA_RESPONSE',
    payload: { folders: [], goldens: [], knowledge, categories: [] },
  }
  mockedSend.mockResolvedValueOnce(resp)
  await act(async () => {
    root.render(<KnowledgeTab tk={lightTheme} onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

const switches = (): HTMLElement[] =>
  Array.from(container.querySelectorAll('[role="switch"]'))

describe('知识库页的尺码表开关', () => {
  it('★ 只在该文档的第一块上渲染 —— 不是每个块一个开关', async () => {
    // 同一文档三块(id 形态 `${docId}-c0/c1/c2`)+ 第二篇文档两块
    await renderTab([
      chunk({ id: '尺码表-c0', docId: '尺码表', title: '尺码表 · c0' }),
      chunk({ id: '尺码表-c1', docId: '尺码表', title: '尺码表 · c1' }),
      chunk({ id: '尺码表-c2', docId: '尺码表', title: '尺码表 · c2' }),
      chunk({ id: '发货-c0', docId: '发货', title: '发货 · c0' }),
      chunk({ id: '发货-c1', docId: '发货', title: '发货 · c1' }),
    ])
    // 两篇文档 ⇒ 恰好两个开关,且都只在各自的第一块卡片里
    expect(switches()).toHaveLength(2)
    const firstCard = switches()[0].closest('.pddcs-kb-card')
    expect(firstCard?.textContent).toContain('尺码表 · c0')
    expect(firstCard?.textContent).not.toContain('尺码表 · c1')
  })

  it('分块 id 不带 `-c<n>`(单块文档)时仍渲染开关', async () => {
    // importKbDocument 只有一块时 id 就是 rootId,不带 -c0 后缀 —— 若只认 `-c0`,
    // 单块文档将**永远标记不上尺码表**,功能静默失效
    await renderTab([chunk({ id: 'kbd-1-abc', docId: '尺码表', title: '尺码表' })])
    expect(switches()).toHaveLength(1)
  })

  it('勾选后发 SET_KB_SIZE_TABLE { docId, on: true },并带上响应重载', async () => {
    await renderTab([chunk({ id: '尺码表-c0', docId: '尺码表', title: '尺码表 · c0' })])
    mockedSend.mockResolvedValue({
      type: 'SET_KB_SIZE_TABLE_RESPONSE',
      payload: { success: true },
    })
    act(() => {
      switches()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})
    expect(mockedSend).toHaveBeenCalledWith({
      type: 'SET_KB_SIZE_TABLE',
      payload: { docId: '尺码表', on: true },
    })
  })

  it('手工条目(无 docId)不渲染开关;已标记的文档开关为开态', async () => {
    await renderTab([
      {
        id: 'manual-1',
        title: '手工话术',
        content: '正文',
        hasEmbedding: 1,
        enabled: 1,
        updatedAt: 1,
      },
      chunk({ id: '尺码表-c0', docId: '尺码表', isSizeTable: true }),
    ])
    expect(switches()).toHaveLength(1)
    expect(switches()[0].getAttribute('aria-checked')).toBe('true')
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
