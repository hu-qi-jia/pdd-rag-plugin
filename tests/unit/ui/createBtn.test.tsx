// 工具栏「新建」主钮公共组件(2026-09-15 用户要求):
// 文件夹页"新建文件夹"与知识库页"新建条目"原本各写一份(一份手搓 button、
// 一份 Btn+图标 span),样式有微差;抽成 CreateBtn(加号图标 + 文字,Btn primary 承载)两页共用。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const { CreateBtn } = await import('../../../src/ui/components')
const { lightTheme } = await import('../../../src/ui/theme')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function renderBtn(props: {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  await act(async () => {
    root.render(<CreateBtn tk={lightTheme} {...props} />)
  })
}

describe('CreateBtn:工具栏新建主钮(公共组件)', () => {
  it('渲染图标 + 文字,点击回调 onClick', async () => {
    const onClick = vi.fn()
    await renderBtn({ label: '新建条目', onClick })

    const btn = container.querySelector('button')
    expect(btn).not.toBeNull()
    // 主钮视觉由 .pddcs-btn(Btn)承载,内部为加号图标 + 文字
    expect(btn!.className).toContain('pddcs-btn')
    expect(btn!.querySelector('svg')).not.toBeNull()
    expect(btn!.textContent).toContain('新建条目')

    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled 透传:禁用时点击不回调', async () => {
    const onClick = vi.fn()
    await renderBtn({ label: '新建文件夹', onClick, disabled: true })

    const btn = container.querySelector('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('title 透传(悬浮说明)', async () => {
    await renderBtn({ label: '新建', onClick: vi.fn(), title: '创建后自动向量化' })
    const btn = container.querySelector('button')
    expect(btn?.getAttribute('title')).toBe('创建后自动向量化')
  })
})
