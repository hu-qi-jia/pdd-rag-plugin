// 尺码表的两件事:
//  ① 知识库页的**上传入口**(v3.0)—— 尺码表是文档级标记,但入口不再是"每篇文档的
//     第一块上一个开关",而是工具栏上独立的「上传尺码表」;页面顶部一行状态条是它
//     唯一的显示与撤销处。旧口径(每块一个开关)连同 `firstChunkIds` 一起删除。
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
    root.render(<KnowledgeTab onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

/** 两个隐藏的文件选择框:按 data-kind 锚点取,不按 DOM 顺序 */
const fileInput = (kind: 'doc' | 'size'): HTMLInputElement =>
  container.querySelector<HTMLInputElement>(`input[type="file"][data-kind="${kind}"]`)!

async function pickFile(kind: 'doc' | 'size', name: string, body = '# 尺码表\n肩宽 38') {
  const input = fileInput(kind)
  const file = new File([body], name, { type: 'text/markdown' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {})
}

const sizeLine = (): HTMLElement | null => container.querySelector('.pddcs-sizeline')
const textBtn = (label: string): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  ) ?? null

describe('知识库页:尺码表改成上传入口(v3.0)', () => {
  it('★ 列表里不再有任何"尺码表开关" —— 每块一个开关的形态已随 v3.0 撤掉', async () => {
    await renderTab([
      chunk({ id: '尺码表-c0', docId: '尺码表', title: '尺码表 · c0' }),
      chunk({ id: '尺码表-c1', docId: '尺码表', title: '尺码表 · c1' }),
      chunk({ id: '尺码表-c2', docId: '尺码表', title: '尺码表 · c2' }),
    ])
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0)
  })

  it('工具栏上有独立的「上传尺码表」按钮', async () => {
    await renderTab([])
    expect(textBtn('上传尺码表')).toBeTruthy()
    expect(textBtn('上传 .md')).toBeTruthy()
  })

  it('没有尺码表时不显示状态条', async () => {
    await renderTab([chunk({ id: '发货-c0', docId: '发货' })])
    expect(sizeLine()).toBeNull()
  })

  it('已有尺码表时状态条报出文档名与块数', async () => {
    await renderTab([
      chunk({ id: '尺码表-c0', docId: '尺码表', isSizeTable: true }),
      chunk({ id: '尺码表-c1', docId: '尺码表', isSizeTable: true }),
    ])
    expect(sizeLine()!.textContent).toContain('尺码表')
    expect(sizeLine()!.textContent).toContain('2 块')
  })

  it('★ 上传尺码表 = UPLOAD_KB_DOC + SET_KB_SIZE_TABLE{on:true}(两步,不缺标记那一步)', async () => {
    await renderTab([])
    mockedSend.mockResolvedValue({
      type: 'UPLOAD_KB_DOC_RESPONSE',
      payload: { docId: '尺码表', chunkCount: 3 },
    })
    mockedSend.mockResolvedValueOnce({
      type: 'UPLOAD_KB_DOC_RESPONSE',
      payload: { docId: '尺码表', chunkCount: 3 },
    })
    mockedSend.mockResolvedValueOnce({
      type: 'SET_KB_SIZE_TABLE_RESPONSE',
      payload: { success: true },
    })
    // 之后 refresh 的 GET_PANEL_DATA
    mockedSend.mockResolvedValue({
      type: 'GET_PANEL_DATA_RESPONSE',
      payload: { folders: [], goldens: [], knowledge: [], categories: [] },
    })

    await pickFile('size', '尺码表.md')

    const types = mockedSend.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(types).toContain('UPLOAD_KB_DOC')
    expect(types).toContain('SET_KB_SIZE_TABLE')
    expect(types.indexOf('UPLOAD_KB_DOC')).toBeLessThan(types.indexOf('SET_KB_SIZE_TABLE'))
    const mark = mockedSend.mock.calls.find(
      (c) => (c[0] as { type: string }).type === 'SET_KB_SIZE_TABLE',
    )![0] as { payload: { docId: string; on: boolean } }
    expect(mark.payload).toEqual({ docId: '尺码表', on: true })
  })

  it('后台顶替了旧尺码表时如实说明替换了谁', async () => {
    await renderTab([])
    mockedSend.mockResolvedValueOnce({
      type: 'UPLOAD_KB_DOC_RESPONSE',
      payload: { docId: '新尺码表', chunkCount: 2 },
    })
    mockedSend.mockResolvedValueOnce({
      type: 'SET_KB_SIZE_TABLE_RESPONSE',
      payload: { success: true, replaced: '旧尺码表' },
    })
    mockedSend.mockResolvedValue({
      type: 'GET_PANEL_DATA_RESPONSE',
      payload: { folders: [], goldens: [], knowledge: [], categories: [] },
    })

    await pickFile('size', '新尺码表.md')
    expect(container.textContent).toContain('已替换原尺码表《旧尺码表》')
  })

  it('标记失败时如实报错,不谎称成功', async () => {
    await renderTab([])
    mockedSend.mockResolvedValueOnce({
      type: 'UPLOAD_KB_DOC_RESPONSE',
      payload: { docId: '尺码表', chunkCount: 1 },
    })
    mockedSend.mockResolvedValueOnce({
      type: 'SET_KB_SIZE_TABLE_RESPONSE',
      payload: { success: false, error: '文档原文不存在' },
    })
    mockedSend.mockResolvedValue({
      type: 'GET_PANEL_DATA_RESPONSE',
      payload: { folders: [], goldens: [], knowledge: [], categories: [] },
    })

    await pickFile('size', '尺码表.md')
    expect(container.textContent).toContain('标记为尺码表失败')
  })

  it('取消标记:走二次确认,确认后发 SET_KB_SIZE_TABLE{on:false}', async () => {
    await renderTab([chunk({ id: '尺码表-c0', docId: '尺码表', isSizeTable: true })])
    mockedSend.mockResolvedValue({
      type: 'SET_KB_SIZE_TABLE_RESPONSE',
      payload: { success: true },
    })

    await act(async () => {
      textBtn('取消标记')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})
    // 未确认前不发消息
    expect(
      mockedSend.mock.calls.filter((c) => (c[0] as { type: string }).type === 'SET_KB_SIZE_TABLE'),
    ).toHaveLength(0)

    await act(async () => {
      textBtn('确认')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})
    const mark = mockedSend.mock.calls.find(
      (c) => (c[0] as { type: string }).type === 'SET_KB_SIZE_TABLE',
    )![0] as { payload: { docId: string; on: boolean } }
    expect(mark.payload).toEqual({ docId: '尺码表', on: false })
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
