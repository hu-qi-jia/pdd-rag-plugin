// 记忆行操作布局单测 — **v3.1 命令台设计**(2026-10-12 重写:原第十八/十九轮的口径已被页面重写作废,
// 断言按新契约重定向,见 src/popup/MemoryListTab.tsx 顶部注与 ui/components.tsx#IconBtn)。
//
// **旧契约(已不存在,勿再按它写)**:
//  - 每条回复后面一枚文字按钮「+ 设为标准」→ 现在是 ★ **图标钮**,title「将此回复设为标准回答」;
//  - 已设金标显示 `[标准回答]` 琥珀徽标 → 现在由 ★ 钮的**琥珀常显**(active → tk.goldenText)表达;
//  - 每行一个「折叠该问题」disclosure 钮 → 命令台只有**一个**光标,点行即选中并就地展开;
//  - 元信息行通栏常显 → 现在只在**选中行**内展开(见文件末尾 describe)。
//
// **被保留下来的不变量(断言已指向新 DOM)**:
//  ① ★/⧉ 钮**逐条回复各自一枚**(不共享一行按钮),且长在该条回复的行内;
//  ② 「已设 / 未设」是可分辨的两种态;
//  ③ 删除是**常驻**的行级图标钮;点它出原位二次确认,取消不发请求、确认才发 DELETE_QA;
//  ④ 元信息(时间 · 条数 · 剩余)只在选中行内,不占每行的高度。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  GetMemoryListResponse,
  MemoryListItem,
  MemoryReplyItem,
  PanelCategory,
} from '../../../src/types/messages'

vi.mock('../../../src/shared/message-passing', () => ({
  sendMessage: vi.fn(),
}))
const { sendMessage } = await import('../../../src/shared/message-passing')
const mockedSend = vi.mocked(sendMessage)

const { MemoryListTab } = await import('../../../src/popup/MemoryListTab')
const { lightTheme } = await import('../../../src/ui/theme')
const { size } = await import('../../../src/ui/design')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const reply = (id: string, goldenId?: string): MemoryReplyItem => ({
  id,
  text: `回复${id}`,
  ts: 1,
  ...(goldenId ? { goldenId } : {}),
})

const CATEGORIES: PanelCategory[] = [
  { id: 'preset:size', name: '尺码', kind: 'preset', filterable: true, position: 1 },
]

function page(items: MemoryListItem[]): GetMemoryListResponse {
  return { type: 'GET_MEMORY_LIST_RESPONSE', payload: { items, total: items.length, hasMore: false } }
}

let container: HTMLDivElement
let root: Root

/** 按**文字**找按钮 —— v3.1 起行内动作都是图标钮(无文字),这个 helper 只用于确认旧文字钮确已退场、
 *  以及取确认条上的「确认 / 取消」 */
const btns = (text: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button')).filter((el) =>
    el.textContent?.includes(text),
  )

/** 按 title 精确取一枚图标钮(IconBtn 的 title 是它唯一的可读名,同时也是 aria-label) */
const iconBtn = (title: string): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>(`button[title="${title}"]`)

/** 按 title 取全部同名图标钮(多条回复时用来验证「逐条各自一枚」) */
const iconBtns = (title: string): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(`button[title="${title}"]`))

/** 最近的块级祖先 div —— 用它把图标钮与它**所属的那一行**对起来,不依赖写死层数
 *  (回复行的末列是一个 <span> 包着两枚钮,再往上一层才是回复行 div) */
const rowDivOf = (btn: HTMLElement): HTMLElement => btn.closest('div') as HTMLElement

/** 问题行的可点容器(序号 + 问题文本 + 行尾动作的那个 34px 行) */
const rowOf = (question: string): HTMLElement => {
  const span = Array.from(container.querySelectorAll('span')).find(
    (s) => s.children.length === 0 && s.textContent === question,
  )
  if (!span) throw new Error(`找不到问题行:${question}`)
  return span.parentElement as HTMLElement
}

/** 该元素的内联色是否等于某设计令牌(经同款探针归一,避开 hex/rgb 表示差异) */
function colorIs(el: HTMLElement, token: string): boolean {
  const probe = document.createElement('div')
  probe.style.color = token
  return el.style.color === probe.style.color
}

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

async function renderWith(items: MemoryListItem[]) {
  mockedSend.mockResolvedValueOnce(page(items))
  await act(async () => {
    root.render(
      <MemoryListTab
        tk={lightTheme}
        retentionDays={90}
        categories={CATEGORIES}
        onDataChanged={vi.fn()}
      />,
    )
  })
  await act(async () => {})
}

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('MemoryListTab:「设置标准回答」位置(v3.1:每条回复各带 ★ 图标钮)', () => {
  it('单回复:★ 钮长在该回复行内(与回复文本同容器),旧的「设为标准」文字钮已退场', async () => {
    await renderWith([
      { id: 'qa-1', question: '问题一', questionTs: 1, replyCount: 1, categoryId: 'preset:size', replies: [reply('r1')] },
    ])
    // 旧版每个回复行一枚文字按钮「+ 设为标准」—— 图标钮无文字,这类按钮应当一枚都不剩
    expect(btns('设为标准')).toHaveLength(0)
    const stars = iconBtns('将此回复设为标准回答')
    expect(stars).toHaveLength(1)
    // 枚钮所属的回复行同时含该条回复的文本(而不是挂在问题行 / 共享操作列上)
    expect(rowDivOf(stars[0]).textContent).toContain('回复r1')
  })

  it('多回复:每条回复各带自己的 ★ 与 ⧉(不共享一行按钮)', async () => {
    await renderWith([
      {
        id: 'qa-2',
        question: '问题二',
        questionTs: 1,
        replyCount: 2,
        categoryId: 'preset:size',
        replies: [reply('r1'), reply('r2')],
      },
    ])
    const stars = iconBtns('将此回复设为标准回答')
    expect(stars).toHaveLength(2)
    expect(rowDivOf(stars[0]).textContent).toContain('回复r1')
    expect(rowDivOf(stars[1]).textContent).toContain('回复r2')
    // 两枚 ★ 分属不同回复行 —— 这正是「各自独立、不共享一行按钮」的旧不变量
    expect(rowDivOf(stars[0])).not.toBe(rowDivOf(stars[1]))
    // 每条回复同时各带一枚复制钮
    expect(iconBtns('复制该条回复')).toHaveLength(2)
  })

  it('已设金标:★ 钮转琥珀常显且 title 变「已设」态(取代旧的 [标准回答] 徽标)', async () => {
    await renderWith([
      {
        id: 'qa-3',
        question: '问题三',
        questionTs: 1,
        replyCount: 1,
        categoryId: 'preset:size',
        replies: [reply('r1', 'gd-1')],
      },
    ])
    // 未设态的 ★ 钮不再存在(这一条回复已是标准回答)
    expect(iconBtns('将此回复设为标准回答')).toHaveLength(0)
    const star = iconBtn('已设为标准回答;再点一次取消')
    expect(star, '已设态应当是一枚 title 不同的 ★ 钮').toBeTruthy()
    // 已设 = 琥珀常显(IconBtn 的 active),不再是「按钮 vs 徽标」的形态差别
    expect(colorIs(star!, lightTheme.goldenText)).toBe(true)
    expect(colorIs(star!, lightTheme.textFaint)).toBe(false)
    // 图标钮没有文字,title 就是它唯一的可读名 —— aria-label 与之一致
    expect(star!.getAttribute('aria-label')).toBe('已设为标准回答;再点一次取消')
    // 旧版的方括号徽标 `[标准回答]` 已不在正文里
    expect(container.textContent).not.toContain('[标准回答]')
  })

  it('★ / ⧉ 取全站统一图标钮规格(20×20),不再挤压内容区(第十九轮的 mini 文字钮已作废)', async () => {
    await renderWith([
      { id: 'qa-1', question: '问题一', questionTs: 1, replyCount: 1, categoryId: 'preset:size', replies: [reply('r1')] },
    ])
    const star = iconBtn('将此回复设为标准回答')!
    const copy = iconBtn('复制该条回复')!
    for (const b of [star, copy]) {
      expect(b.style.width).toBe(`${size.iconBtn}px`)
      expect(b.style.height).toBe(`${size.iconBtn}px`)
    }
    // 旧版 24px 高、10.5px 字的文字按钮已不存在
    expect(btns('设为标准')).toHaveLength(0)
  })
})

describe('MemoryListTab:删除入口(v3.1:问题行尾的常驻 ✕ 图标钮)', () => {
  it('删除是问题行尾常驻的图标钮(title 标识);旧的「删除」文字钮与每行折叠钮都已移除', async () => {
    await renderWith([
      { id: 'qa-1', question: '问题一', questionTs: 1, replyCount: 1, categoryId: 'preset:size', replies: [reply('r1')] },
    ])
    // 旧底部文字按钮已不存在(图标钮无文字)
    expect(btns('删除')).toHaveLength(0)
    const del = iconBtn('删除该问答(需确认)')
    expect(del, '删除应当是行尾一枚常驻图标钮').toBeTruthy()
    // 命令台没有 per-row 折叠钮(每个问题行不再是各自的 disclosure)
    expect(iconBtn('折叠该问题')).toBeNull()
    // 它长在**问题行**内,且是行尾最后一枚(行级动作,常驻可见)
    const row = rowDivOf(del!)
    expect(row.textContent).toContain('问题一')
    expect(row.children[row.children.length - 1]).toBe(del)
    // 与 ★/⧉ 同一图标钮规格(等高铁律 → 20×20,jsdom 下比对内联样式)
    expect(del!.style.width).toBe(`${size.iconBtn}px`)
    expect(del!.style.height).toBe(`${size.iconBtn}px`)
  })

  it('点删除图标 → 选中行内出确认条;取消可退出;确认调 DELETE_QA', async () => {
    mockedSend
      .mockResolvedValueOnce(
        page([{ id: 'qa-9', question: '问题九', questionTs: 1, replyCount: 1, categoryId: 'preset:size', replies: [reply('r1')] }]),
      )
      .mockResolvedValueOnce({
        type: 'DELETE_QA_RESPONSE',
        payload: { success: true },
      } as never)
      .mockResolvedValueOnce(page([]))
    await renderWith([
      { id: 'qa-9', question: '问题九', questionTs: 1, replyCount: 1, categoryId: 'preset:size', replies: [reply('r1')] },
    ])
    // 光标默认停在第 1 条(即 qa-9),确认条就长在它的展开块里
    await click(iconBtn('删除该问答(需确认)')!)
    expect(container.textContent).toContain('删除该问答及其全部回复?')
    // 取消 → 确认条消失,未发删除请求
    await click(btns('取消')[0])
    expect(container.textContent).not.toContain('删除该问答及其全部回复?')
    expect(mockedSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_QA' }))
    // 再点图标 → 确认 → 发 DELETE_QA
    await click(iconBtn('删除该问答(需确认)')!)
    await click(btns('确认')[0])
    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DELETE_QA', payload: { id: 'qa-9' } }),
    )
  })
})

// v3.1 命令台:结果是一列 34px 编号行,**同时只有一个光标**;光标行反白并**就地展开**(元信息 + 回复)。
// 旧版「主行 + 通栏元信息行」的两段式骨架已被命令台取代 —— 于是旧的两条不变量这样落地:
//   ①「元信息不挤在标题行里」→ 现在更进一步:元信息只在**选中行**内,其余行是纯 34px 行;
//   ②「点整行不缩小点击面积」→ 现在点行 = 移光标 + 就地展开(旧版是每行各自的折叠钮)。
describe('记忆行:单光标 · 就地展开(v3.1 取代旧「两段式骨架」)', () => {
  const TWO: MemoryListItem[] = [
    { id: 'qa-1', question: '问题一', questionTs: 1, replyCount: 1, categoryId: 'preset:size', replies: [reply('r1')] },
    { id: 'qa-2', question: '问题二', questionTs: 1, replyCount: 1, categoryId: 'preset:size', replies: [reply('r2')] },
  ]

  const countOf = (needle: string): number => container.textContent!.split(needle).length - 1

  /**
   * v3.1 第六版按用户第 3 条改:「时间、回复条数、剩余时间放在问题的下方」——
   * 它原来是**只在选中行**的展开块里,于是"这条还剩几天过期"要选中才看得见,
   * 而它恰恰是决定"要不要用这条"的信息之一。现在它**常驻在每一行的问题下面**。
   * 展开的仍然只有光标那一行(回复不外溢)。
   */
  it('★ 元信息**常驻在问题下方**(每行都有);回复仍只展开光标那一行', async () => {
    await renderWith(TWO)
    // 两行都带元信息 —— 不再依赖光标
    expect(countOf('条回复')).toBe(2)
    // `rowOf` 给的是那条 34px 的**主行**(序号 + 问题 + 行尾动作);
    // 元信息是它的**兄弟节点**(在问题下方),所以要在整张卡上看
    const cardOf = (q: string) => rowOf(q).parentElement as HTMLElement
    expect(rowOf('问题二').textContent).not.toContain('条回复')
    expect(cardOf('问题二').textContent).toContain('条回复')
    // 元信息站在问题文字那条左缘上(与回复同一个左内边距 = ROW_TEXT_X)
    const meta = rowOf('问题二').nextElementSibling as HTMLElement
    expect(meta.style.paddingLeft).toBe(`${16 + 16 + 10}px`)
    // 但回复只属于光标那一行
    expect(container.textContent).toContain('回复r1')
    expect(container.textContent).not.toContain('回复r2')
    expect(cardOf('问题二').textContent).not.toContain('回复r2')
  })

  it('★ 点一行 = 光标移过去并就地展开它的回复(取代旧版每行独立的折叠钮)', async () => {
    await renderWith(TWO)
    // 初始光标在第 1 条
    expect(container.textContent).toContain('回复r1')
    expect(container.textContent).not.toContain('回复r2')

    await click(rowOf('问题二'))

    expect(container.textContent).toContain('回复r2')
    expect(container.textContent).not.toContain('回复r1')
    // 展开的仍然只有一处 —— 同时只有一个光标(元信息恒为每行一条,故计数是 2)
    expect(countOf('条回复')).toBe(2)
    // 旧的每行折叠钮不再存在
    expect(iconBtn('折叠该问题')).toBeNull()
  })


  it('★ 已设的 ★ 再点一次 = **取消**标准回答(发 DELETE_GOLDEN{该条的 goldenId})', async () => {
    // 用户第 3 条「在记忆页中设置标准回答,也可以取消,目前不支持取消」。
    // 取消**不能**走"再 ADD 一次"——那只会命中 exists 幂等分支,永远取消不掉。
    mockedSend.mockReset()
    const item = {
      id: 'qa-9',
      question: '问题九',
      questionTs: 1,
      replyCount: 1,
      categoryId: 'preset:size',
      replies: [reply('r1', 'gd-9')],
    }
    mockedSend.mockImplementation(async (m: { type: string }) => {
      if (m.type === 'GET_MEMORY_LIST') return page([item]) as never
      if (m.type === 'DELETE_GOLDEN') {
        return { type: 'DELETE_GOLDEN_RESPONSE', payload: { success: true } } as never
      }
      return {} as never
    })
    await act(async () => {
      root.render(
        <MemoryListTab
          tk={lightTheme}
          retentionDays={90}
          categories={CATEGORIES}
          onDataChanged={vi.fn()}
        />,
      )
    })
    await act(async () => {})

    const star = iconBtn('已设为标准回答;再点一次取消')
    expect(star, '已设态 ★ 应存在').toBeTruthy()
    await click(star!)

    const del = mockedSend.mock.calls
      .map((c) => c[0] as { type: string; payload?: { id?: string } })
      .find((m) => m.type === 'DELETE_GOLDEN')
    expect(del, '应发出 DELETE_GOLDEN').toBeTruthy()
    expect(del!.payload).toEqual({ id: 'gd-9' })
    // 不能再用 ADD_GOLDEN 去"取消"(那条路只会命中 exists 幂等分支)
    expect(
      mockedSend.mock.calls.some(
        (c) => (c[0] as { type: string }).type === 'ADD_GOLDEN',
      ),
    ).toBe(false)
    expect(container.textContent).toContain('已取消标准回答')
  })
})
