// AI 整合行纯逻辑单测:状态流转 / 文案 / 插入位 / 重试语义。
import { describe, it, expect } from 'vitest'
import {
  AI_LOADING_DELAY_MS,
  aiRowBusy,
  aiRowDraft,
  aiRowHint,
  aiRowInitialSelection,
  aiRowInsertIndex,
  aiRowLabel,
  aiRowRetryLabel,
  aiRowRetryable,
  reduceAiRow,
  type AiRowState,
} from '../../../src/pdd/ai-row'

const delta = (text: string) => ({ type: 'DELTA' as const, payload: { text } })

describe('reduceAiRow', () => {
  it('DELTA 逐条累加成草稿', () => {
    let s: AiRowState = { phase: 'working' }
    s = reduceAiRow(s, delta('不防水,'))
    expect(s).toEqual({ phase: 'streaming', draft: '不防水,' })
    s = reduceAiRow(s, delta('请注意防雨防潮。'))
    expect(s).toEqual({ phase: 'streaming', draft: '不防水,请注意防雨防潮。' })
  })

  it('DONE 覆盖草稿为最终文本', () => {
    let s: AiRowState = { phase: 'streaming', draft: '不防' }
    s = reduceAiRow(s, { type: 'DONE', payload: { text: '不防水。' } })
    expect(s).toEqual({ phase: 'done', text: '不防水。' })
  })

  it('NO_ANSWER / ERROR 各自成态', () => {
    expect(reduceAiRow({ phase: 'working' }, { type: 'NO_ANSWER' })).toEqual({ phase: 'noanswer' })
    expect(reduceAiRow({ phase: 'working' }, { type: 'ERROR', payload: { error: 'timeout' } })).toEqual({
      phase: 'error',
      error: 'timeout',
    })
  })

  it('首字之前收到 DELTA 也能正确起底(working → streaming)', () => {
    expect(reduceAiRow({ phase: 'working' }, delta('甲'))).toEqual({ phase: 'streaming', draft: '甲' })
  })
})

describe('aiRowLabel', () => {
  it('idle 是入口文案', () => {
    expect(aiRowLabel({ phase: 'idle' })).toBe('根据知识库内容整合并回复')
  })

  it('请求在途 <200ms 不宣称"正在整合"(防闪烁)', () => {
    expect(aiRowLabel({ phase: 'working' }, false)).toBe('根据知识库内容整合并回复')
    expect(aiRowLabel({ phase: 'working' }, true)).toBe('正在整合知识库…')
  })

  it('已开始吐字后一直显示正在整合', () => {
    expect(aiRowLabel({ phase: 'streaming', draft: '甲' })).toBe('正在整合知识库…')
    expect(aiRowLabel({ phase: 'streaming', draft: '甲' }, false)).toBe('正在整合知识库…')
  })

  it('终态各自有明确说法', () => {
    expect(aiRowLabel({ phase: 'done', text: 'x' })).toBe('✓ 已填入输入框')
    expect(aiRowLabel({ phase: 'noanswer' })).toBe('知识库内容不足以回答')
  })

  it('错误标签翻译成用户能看懂的话,未知标签走兜底文案', () => {
    expect(aiRowLabel({ phase: 'error', error: 'timeout' })).toBe('整合超时,请检查 API 配置')
    expect(aiRowLabel({ phase: 'error', error: 'unconfigured' })).toBe('请先在设置中配置 LLM API')
    expect(aiRowLabel({ phase: 'error', error: '谁知道呢' })).toBe('整合失败,请检查 API 配置')
  })
})

describe('aiRowHint:行内第二行(v2.6.34 重设计)', () => {
  it('idle 说清"发出去的是哪几条、发给谁" —— 这条动作会出网,点之前就得写在脸上', () => {
    const hint = aiRowHint({ phase: 'idle' }, 3)
    expect(hint).toContain('3')
    expect(hint).toContain('知识库')
    expect(hint).toContain('接口')
    // 条数是**实数**,不是泛泛的"几条"
    expect(aiRowHint({ phase: 'idle' }, 1)).toContain('1')
  })

  it('两行分工:上行说"什么出去",下行说"去哪儿 + 什么留下"(语义换行,不是宽度折行)', () => {
    const lines = aiRowHint({ phase: 'idle' }, 3).split('\n')
    expect(lines).toHaveLength(2)
    const [out, stays] = lines
    // 上行 = 外发内容清单(知识库内容 + 买家问题),ADR-0006「外发内容仅限」的逐字对应
    expect(out).toContain('3 条知识库内容')
    expect(out).toContain('买家问题')
    // 下行 = 去向 + 不出网声明
    expect(stays).toContain('发给你配置的接口')
    expect(stays).toContain('历史')
    expect(stays).toContain('标准回答')
    expect(stays).toContain('不出本机')
    // 在途也得留着这句 —— 内容正在路上,此刻最该被看见
    expect(aiRowHint({ phase: 'working' }, 3).split('\n')[1]).toBe(stays)
  })

  it('第五十轮"文案简化":不复述 —— 外发清单与去向/不出网各说一次,不重复主语', () => {
    const hint = aiRowHint({ phase: 'idle' }, 3)
    // 旧版下行还写着「只发送这条买家问题,…」,与上行重复;简化后"买家问题"只出现一次
    expect(hint.match(/买家问题/g)).toHaveLength(1)
    expect(hint).not.toContain('只发送这条买家问题')
    expect(hint).not.toContain('命中的')
    // 信息量不减:外发清单、去向、不出网声明三件事一件不少
    for (const must of ['知识库内容', '买家问题', '发给你配置的接口', '不出本机']) {
      expect(hint).toContain(must)
    }
  })

  it('每句都短到一行放得下(第二块字号 = 生成结果的 13.5px,放不下就会把行撑高)', () => {
    // 面板可用宽度:360 − PANEL_PAD_X×2 − BADGE_PAD_X = 311px;13.5px 中文字 ≈ 13.5px/字
    const MAX_CHARS = 22
    for (const count of [1, 3, 12]) {
      for (const phase of [{ phase: 'idle' as const }, { phase: 'working' as const }]) {
        for (const line of aiRowHint(phase, count).split('\n')) {
          expect(line.length).toBeLessThanOrEqual(MAX_CHARS)
        }
      }
    }
  })

  it('在途沿用同一个条数,前后说的是同一件事', () => {
    expect(aiRowHint({ phase: 'working' }, 2)).toContain('2')
    expect(aiRowHint({ phase: 'streaming', draft: '甲' }, 2)).not.toContain('2') // 已在生成,不再重复发送口径
  })

  it('完成态**没有**说明行:正文占的就是第二块,行高才不会长到三层', () => {
    expect(aiRowHint({ phase: 'done', text: '甲' }, 2)).toBe('')
  })

  it('终态各自给出下一步动作,而不是复述主行', () => {
    const noanswer = aiRowHint({ phase: 'noanswer' }, 2)
    expect(noanswer).not.toContain('不足以回答') // 主行已经说了
    expect(noanswer).toContain('知识库') // 指向可操作的出口:补内容
    const err = aiRowHint({ phase: 'error', error: 'timeout' }, 2)
    expect(err).toContain('设置')
  })

  it('行内第二块一次只有一块:完成态由正文占位,说明行让开', () => {
    // done 必有正文(后台把空答案映射成 NO_ANSWER),第二块归正文,说明行让位 ——
    // 两块一起渲染,行高就会比候选行高出一整行
    expect(aiRowDraft({ phase: 'done', text: '甲' })).not.toBe('')
    expect(aiRowHint({ phase: 'done', text: '甲' }, 2)).toBe('')
    // streaming 的说明只是**首字未到时的兜底**(组件在正文非空时本就不渲染说明行);
    // 兜底留成非空,行高才不会在"已开始生成、还没有字"那一瞬塌回一行
    expect(aiRowHint({ phase: 'streaming', draft: '' }, 2)).not.toBe('')
  })

  it('每个状态都有话可说(只有完成态是刻意的空)', () => {
    const all: AiRowState[] = [
      { phase: 'idle' },
      { phase: 'working' },
      { phase: 'streaming', draft: '' },
      { phase: 'noanswer' },
      { phase: 'error', error: 'x' },
    ]
    for (const s of all) expect(aiRowHint(s, 1).length).toBeGreaterThan(0)
  })
})

describe('aiRowDraft / 重试 / busy', () => {
  it('只有流式与完成态有正文', () => {
    expect(aiRowDraft({ phase: 'idle' })).toBe('')
    expect(aiRowDraft({ phase: 'working' })).toBe('')
    expect(aiRowDraft({ phase: 'streaming', draft: '甲' })).toBe('甲')
    expect(aiRowDraft({ phase: 'done', text: '乙' })).toBe('乙')
    expect(aiRowDraft({ phase: 'error', error: 'x' })).toBe('')
  })

  it('失败可重试,成功可重新生成,其余没有入口', () => {
    expect(aiRowRetryable({ phase: 'error', error: 'x' })).toBe(true)
    expect(aiRowRetryable({ phase: 'done', text: 'x' })).toBe(true)
    expect(aiRowRetryable({ phase: 'idle' })).toBe(false)
    expect(aiRowRetryable({ phase: 'working' })).toBe(false)
    expect(aiRowRetryable({ phase: 'noanswer' })).toBe(false)

    expect(aiRowRetryLabel({ phase: 'error', error: 'x' })).toBe('重试')
    expect(aiRowRetryLabel({ phase: 'done', text: 'x' })).toBe('重新生成')
  })

  it('在途 = working/streaming,点击应被吞掉', () => {
    expect(aiRowBusy({ phase: 'working' })).toBe(true)
    expect(aiRowBusy({ phase: 'streaming', draft: 'x' })).toBe(true)
    expect(aiRowBusy({ phase: 'idle' })).toBe(false)
    expect(aiRowBusy({ phase: 'done', text: 'x' })).toBe(false)
  })

  it('loading 延迟是 200ms(设计文档 6.4)', () => {
    expect(AI_LOADING_DELAY_MS).toBe(200)
  })
})

describe('aiRowInitialSelection:键盘模式的默认落点', () => {
  it('整合行在首位时跳过它,选中第一条真实候选', () => {
    // 知识库候选排在最前 → 整合行插到第 0 位:面板一开就选中整合行的话,
    // 老用户那一下 Enter 会从"填入第一条"变成"发起一次付费 API 请求"
    expect(aiRowInitialSelection([{ ai: true }, { ai: false }, { ai: false }])).toBe(1)
  })

  it('整合行在中间/无整合行时都是第 0 行', () => {
    expect(aiRowInitialSelection([{ ai: false }, { ai: true }, { ai: false }])).toBe(0)
    expect(aiRowInitialSelection([{ ai: false }, { ai: false }])).toBe(0)
  })

  it('全是整合行(不可能发生)兜底 0,不返回 -1', () => {
    expect(aiRowInitialSelection([{ ai: true }])).toBe(0)
    expect(aiRowInitialSelection([])).toBe(0)
  })

  it('与插入位配套:插完再算初始选中,落点永远不是整合行', () => {
    const items = [{ kind: 'knowledge' as const }, { kind: 'history' as const }]
    const at = aiRowInsertIndex(items)
    const rows: { ai: boolean }[] = items.map((s) => ({ ai: false, s }))
    rows.splice(at, 0, { ai: true })
    const sel = aiRowInitialSelection(rows)
    expect(at).toBe(0)
    expect(sel).toBe(1)
    expect(rows[sel].ai).toBe(false)
  })
})

describe('aiRowInsertIndex', () => {
  it('落在首个知识库候选之前', () => {
    expect(aiRowInsertIndex([{ kind: 'golden' }, { kind: 'history' }, { kind: 'knowledge' }])).toBe(2)
  })

  it('知识库候选在最前 → 插到第 0 位', () => {
    expect(aiRowInsertIndex([{ kind: 'knowledge' }, { kind: 'golden' }])).toBe(0)
  })

  it('无知识库候选 → -1(不渲染该行)', () => {
    expect(aiRowInsertIndex([{ kind: 'golden' }, { kind: 'history' }])).toBe(-1)
    expect(aiRowInsertIndex([])).toBe(-1)
  })
})
