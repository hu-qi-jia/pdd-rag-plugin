// Notice 自动消失单测(2026-09-15 评审 PM6):
// 「设置页每次拖滑杆都弹已保存,提示永不消失还推挤布局」——成功提示 4s 自动消失
// (Notice 回调父级清 state),失败提示常驻(用户需要读错因)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Notice, NOTICE_OK_AUTO_DISMISS_MS } from '../../../src/ui/components'
import { lightTheme } from '../../../src/ui/theme'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function renderNotice(msg: { ok: boolean; text: string }, onDismiss: () => void) {
  act(() => {
    root.render(<Notice tk={lightTheme} msg={msg} onDismiss={onDismiss} />)
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('Notice:成功提示自动消失', () => {
  it(`成功提示 ${NOTICE_OK_AUTO_DISMISS_MS}ms 后回调 onDismiss 恰好一次`, () => {
    const onDismiss = vi.fn()
    renderNotice({ ok: true, text: '已保存' }, onDismiss)
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(NOTICE_OK_AUTO_DISMISS_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('失败提示常驻,不自动消失', () => {
    const onDismiss = vi.fn()
    renderNotice({ ok: false, text: '保存失败:xxx' }, onDismiss)
    act(() => vi.advanceTimersByTime(30_000))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('文本变化重置计时(拖滑杆连续弹提示,以最后一次为准)', () => {
    const onDismiss = vi.fn()
    act(() => {
      root.render(<Notice tk={lightTheme} msg={{ ok: true, text: '已保存 50' }} onDismiss={onDismiss} />)
    })
    act(() => vi.advanceTimersByTime(NOTICE_OK_AUTO_DISMISS_MS - 100))
    act(() => {
      root.render(<Notice tk={lightTheme} msg={{ ok: true, text: '已保存 60' }} onDismiss={onDismiss} />)
    })
    act(() => vi.advanceTimersByTime(NOTICE_OK_AUTO_DISMISS_MS - 200))
    expect(onDismiss).not.toHaveBeenCalled() // 旧计时已作废
    act(() => vi.advanceTimersByTime(200))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
