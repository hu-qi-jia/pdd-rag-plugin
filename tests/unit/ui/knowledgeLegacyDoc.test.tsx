// 知识库页「旧文档需重新上传」提示单测(第四十八轮)。
// 升级前上传的文档检索不到,却看起来一切正常 —— 提示条是用户唯一能知道
// 该动手的地方,所以它出现/消失的条件值得钉住。
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

const chunk: PanelKnowledge = {
  id: 'c1',
  title: '常见问答 · 段1',
  content: '防水吗? 不防水。',
  hasEmbedding: 1,
  enabled: 1,
  source: 'doc',
  updatedAt: 1,
}

async function renderWith(legacyDocs?: string[]) {
  const resp: GetPanelDataResponse = {
    type: 'GET_PANEL_DATA_RESPONSE',
    payload: {
      folders: [],
      goldens: [],
      knowledge: [chunk],
      ...(legacyDocs !== undefined ? { legacyDocs } : {}),
    },
  }
  mockedSend.mockResolvedValueOnce(resp)
  await act(async () => {
    root.render(<KnowledgeTab tk={lightTheme} onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

describe('KnowledgeTab:旧文档提示', () => {
  it('有旧文档 → 提示条点名该文档并给出动作', async () => {
    await renderWith(['常见问答'])
    expect(container.textContent).toContain('《常见问答》')
    expect(container.textContent).toContain('上传 .md')
  })

  it('无旧文档 → 不提示(平时不占地方)', async () => {
    await renderWith([])
    expect(container.textContent).not.toContain('旧版规则切分')
  })

  it('后台没给这个字段(旧版 SW / 出错兜底)→ 不提示,也不报错', async () => {
    await renderWith(undefined)
    expect(container.textContent).not.toContain('旧版规则切分')
    expect(container.textContent).toContain('常见问答 · 段1') // 列表照常渲染
  })
})
