/**
 * 知识库编辑决策(纯逻辑,单测覆盖)—— 与 goldenEdit 同构。
 * v1 检索锚 = 标题向量:仅标题实质变更才作废重嵌;正文编辑不动向量;
 * enabled 停用切换不归编辑决策管(编排层直改,不重嵌)。
 */
import { describe, it, expect } from 'vitest'
import { planKnowledgeEdit } from '../../../src/background/knowledgeEdit'
import { hashText } from '../../../src/shared/text'

describe('planKnowledgeEdit', () => {
  it('标题置空或正文置空 → 拒绝', () => {
    expect(
      planKnowledgeEdit({ title: 't', questionHash: 'h' }, { title: '  ' }, new Set()).ok,
    ).toBe(false)
    const r = planKnowledgeEdit({ title: 't', questionHash: 'h' }, { content: '' }, new Set())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不能为空')
  })

  it('标题实质变更 → 更新 title/questionHash 且 reembed=true', () => {
    const r = planKnowledgeEdit(
      { title: '退货政策', questionHash: hashText('退货政策') },
      { title: ' 发货时间 ' },
      new Set(),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reembed).toBe(true)
      expect(r.updates.title).toBe('发货时间')
      expect(r.updates.questionHash).toBe(hashText('发货时间'))
    }
  })

  it('标题与其他条目真实同 hash → 拒绝', () => {
    const r = planKnowledgeEdit(
      { title: '旧标题', questionHash: hashText('旧标题') },
      { title: '已有标题' },
      new Set([hashText('已有标题')]),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('已存在')
  })

  it('仅改正文 → reembed=false,更新 content', () => {
    const r = planKnowledgeEdit(
      { title: '退货政策', questionHash: hashText('退货政策') },
      { content: '七天无理由' },
      new Set(),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reembed).toBe(false)
      expect(r.updates.content).toBe('七天无理由')
      expect(r.updates.title).toBeUndefined()
    }
  })

  it('标题归一化后未变(仅空白差异)→ 不重嵌', () => {
    const r = planKnowledgeEdit(
      { title: '退货政策', questionHash: hashText('退货政策') },
      { title: '  退货政策  ' },
      new Set(),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.reembed).toBe(false)
  })
})
