// 文件夹重命名入口单测(2026-09-15 用户反馈"父文件夹不能改名"):
// 功能本就有(悬浮铅笔钮 / 双击文件夹名),但入口纯悬浮显现不可发现 ——
// 现改为常驻可见(不再挂 pddcs-row-ops 悬浮显隐),默认文件夹除外。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GetPanelDataResponse, PanelFolder } from '../../../src/types/messages'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { FoldersTab } = await import('../../../src/popup/FoldersTab')
const { lightTheme } = await import('../../../src/ui/theme')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const folder = (id: string, name: string): PanelFolder => ({
  id,
  parentId: null,
  name,
  position: 0,
})

let container: HTMLDivElement
let root: Root

const btns = (title: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(`button[title]`)).filter((el) =>
    el.title.includes(title),
  )

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

async function renderWith(folders: PanelFolder[]) {
  mockedSend.mockResolvedValueOnce({
    type: 'GET_PANEL_DATA_RESPONSE',
    payload: { folders, goldens: [], knowledge: [] },
  } as GetPanelDataResponse)
  await act(async () => {
    root.render(<FoldersTab tk={lightTheme} onDataChanged={vi.fn()} />)
  })
  await act(async () => {})
}

describe('FoldersTab:文件夹重命名入口', () => {
  it('父(根)文件夹的重命名钮常驻可见:不挂悬浮显隐类,普通文件夹都有', async () => {
    await renderWith([folder('f1', '售后'), folder('f2', '物流')])
    const pens = btns('重命名')
    expect(pens).toHaveLength(2)
    // 常驻可见 = 所在操作行容器不带 pddcs-row-ops(悬浮才 opacity:1)
    for (const b of pens) {
      const opsRow = b.parentElement as HTMLElement
      expect(opsRow.className).not.toContain('pddcs-row-ops')
    }
  })

  it('点重命名钮 → 原位出现改名输入框(预填当前名),默认文件夹无此入口', async () => {
    await renderWith([
      folder('f1', '售后'),
      { id: 'uncategorized', parentId: null, name: '默认文件夹', position: 99 },
    ])
    const pens = btns('重命名')
    expect(pens).toHaveLength(1) // 默认文件夹不给改名钮
    await act(async () => {
      pens[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const input = container.querySelector<HTMLInputElement>('input.pddcs-input')
    expect(input).not.toBeNull()
    expect(input!.value).toBe('售后')
  })
})
