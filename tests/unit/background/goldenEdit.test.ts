/**
 * 标准回答写入口径单测(新增 + 编辑)。
 * 口径变更(2026-09-15 用户指定):同一问题可挂多条标准回答,合计上限 3 条;
 * 唯一性粒度 = 问题 + 答案;问题变更才作废重嵌(答案不影响问题锚向量)。
 */
import { describe, it, expect } from 'vitest'
import {
  planGoldenAdd,
  planGoldenEdit,
  type GoldenEditContext,
} from '../../../src/background/goldenEdit'
import { hashText } from '../../../src/shared/text'

const MAX = 3

/** 编辑校验上下文:默认"无同题兄弟" */
const ctx = (answers: string[] = [], max = MAX): GoldenEditContext => ({
  siblingAnswerHashes: new Set(answers.map((a) => hashText(a))),
  siblingCount: answers.length,
  maxPerQuestion: max,
})

const existing = {
  question: '这个支持7天无理由退换吗',
  questionHash: hashText('这个支持7天无理由退换吗'),
  answer: '支持的,7 天内都可以',
}

// ─── 新增 ─────────────────────────────────────────────────────────────────────

describe('planGoldenAdd', () => {
  it('问题或答案为空 → invalid', () => {
    expect(planGoldenAdd([], { question: '  ', answer: 'x' }, MAX).action).toBe('invalid')
    expect(planGoldenAdd([], { question: 'x', answer: '  ' }, MAX).action).toBe('invalid')
  })

  it('首次设置 → create', () => {
    expect(planGoldenAdd([], { question: '支持退换吗', answer: '支持' }, MAX)).toEqual({
      action: 'create',
    })
  })

  it('同问题 + 不同答案 → create(可以设置其他回答为标准回答)', () => {
    const siblings = [{ id: 'g1', answer: '支持7天无理由' }]
    expect(
      planGoldenAdd(siblings, { question: '支持退换吗', answer: '支持7天,包运费' }, MAX),
    ).toEqual({ action: 'create' })
  })

  it('同问题 + 同答案(含空白差异)→ exists 幂等命中,返回已有 id', () => {
    const siblings = [{ id: 'g1', answer: '支持7天无理由' }]
    expect(
      planGoldenAdd(siblings, { question: '支持退换吗', answer: ' 支持7天无理由 ' }, MAX),
    ).toEqual({ action: 'exists', id: 'g1', count: 1 })
  })

  it('已满 3 条 → limit(答案重复时优先判重返回 exists)', () => {
    const siblings = [
      { id: 'g1', answer: 'a' },
      { id: 'g2', answer: 'b' },
      { id: 'g3', answer: 'c' },
    ]
    expect(planGoldenAdd(siblings, { question: '支持退换吗', answer: 'd' }, MAX)).toEqual({
      action: 'limit',
      count: 3,
    })
    expect(planGoldenAdd(siblings, { question: '支持退换吗', answer: 'b' }, MAX).action).toBe(
      'exists',
    )
  })

  it('上限可配(2 条时即满)', () => {
    const siblings = [
      { id: 'g1', answer: 'a' },
      { id: 'g2', answer: 'b' },
    ]
    expect(planGoldenAdd(siblings, { question: 'q', answer: 'c' }, 2).action).toBe('limit')
  })
})

// ─── 编辑 ─────────────────────────────────────────────────────────────────────

describe('planGoldenEdit', () => {
  it('问题改成空/纯空白 → 拒绝', () => {
    expect(planGoldenEdit(existing, { question: '   ' }, ctx()).ok).toBe(false)
    expect(planGoldenEdit(existing, { question: '' }, ctx()).ok).toBe(false)
  })

  it('答案改成空 → 拒绝', () => {
    expect(planGoldenEdit(existing, { answer: '  ' }, ctx()).ok).toBe(false)
  })

  it('问题改成与另一条同题条目一致 → 允许(同问题可多条)', () => {
    const plan = planGoldenEdit(existing, { question: '什么时候发货' }, ctx())
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.reembed).toBe(true)
      expect(plan.updates.question).toBe('什么时候发货')
    }
  })

  it('搬到已满上限的问题下 → 拒绝', () => {
    const plan = planGoldenEdit(existing, { question: '什么时候发货' }, ctx(['a', 'b', 'c']))
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.error).toContain('上限')
  })

  it('问题实质变更 → 更新归一化问题与 hash,且 reembed=true', () => {
    const plan = planGoldenEdit(existing, { question: '这个支持 7 天无理由退换吗' }, ctx())
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.reembed).toBe(true)
      expect(plan.updates.question).toBe('这个支持 7 天无理由退换吗')
      expect(plan.updates.questionHash).toBe(hashText('这个支持 7 天无理由退换吗'))
    }
  })

  it('问题仅空白差异(归一化后同 hash)→ 不算变更,不重嵌', () => {
    const plan = planGoldenEdit(existing, { question: '  这个支持7天无理由退换吗  ' }, ctx())
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.reembed).toBe(false)
      expect(plan.updates.question).toBeUndefined()
      expect(plan.updates.questionHash).toBeUndefined()
    }
  })

  it('只改答案 → updates 含归一化答案,reembed=false(问题锚向量仍有效)', () => {
    const plan = planGoldenEdit(existing, { answer: ' 支持的,7 天内都可以 ' }, ctx())
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.reembed).toBe(false)
      expect(plan.updates.answer).toBe('支持的,7 天内都可以')
    }
  })

  it('答案改成同题另一条已有的答案 → 拒绝(问题+答案唯一)', () => {
    const plan = planGoldenEdit(existing, { answer: '不支持' }, ctx(['不支持']))
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.error).toContain('相同回复')
  })

  it('只迁移文件夹 → reembed=false(不触发唯一性判定)', () => {
    const plan = planGoldenEdit(existing, { folderId: 'f1' }, ctx([existing.answer]))
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.reembed).toBe(false)
      expect(plan.updates.folderId).toBe('f1')
    }
  })
})
