// AI 整合行纯逻辑单测:状态流转 / 文案 / 插入位 / 重试语义。
import { describe, it, expect } from 'vitest'
import {
  AI_LOADING_DELAY_MS,
  aiRowBusy,
  aiRowDraft,
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
