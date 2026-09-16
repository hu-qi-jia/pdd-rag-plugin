/**
 * 标准回答写入口径的纯逻辑(新增 + 编辑,单测覆盖)。
 * 设计依据:设计文档 §6.3(可编辑,保存即作废旧向量自动重嵌)。
 *
 * 口径(2026-09-15 用户指定,替代原"一问题一标准回答"):
 *  - **同一问题可挂多条标准回答**(一个问题常对应多种合格话术),合计上限 3 条;
 *  - 唯一性粒度 = 问题 + 答案(同问题同答案不重复建),问题相同但答案不同是允许的;
 *  - 最近设置的靠前由 createdAt 倒序保证(见 db.getGoldensByQuestionHash)。
 *
 * v1 检索锚 = 问题向量:仅问题实质变更才作废重嵌;答案/文件夹调整不影响向量有效性。
 */
import type { GoldenRecord } from '../types/memory'
import { normalizeText, hashText } from '../shared/text'

// ─── 新增 ─────────────────────────────────────────────────────────────────────

export type GoldenAddPlan =
  | { action: 'create' }
  /** 同问题 + 同答案已存在(幂等命中) */
  | { action: 'exists'; id: string; count: number }
  /** 该问题已达上限 */
  | { action: 'limit'; count: number }
  | { action: 'invalid'; error: string }

/**
 * 计算一次"设为标准回答":
 * @param siblings 该问题下已有标准回答(不限顺序)
 * @param input    待写入的问题与答案(未归一化,函数内归一化)
 * @param maxPerQuestion 每问题标准回答条数上限
 */
export function planGoldenAdd(
  siblings: Array<Pick<GoldenRecord, 'id' | 'answer'>>,
  input: { question: string; answer: string },
  maxPerQuestion: number,
): GoldenAddPlan {
  const question = normalizeText(input.question ?? '')
  const answer = normalizeText(input.answer ?? '')
  if (!question || !answer) return { action: 'invalid', error: '问题或回复为空' }

  const answerHash = hashText(answer)
  const dup = siblings.find((g) => hashText(g.answer) === answerHash)
  if (dup) return { action: 'exists', id: dup.id, count: siblings.length }

  if (siblings.length >= maxPerQuestion) return { action: 'limit', count: siblings.length }
  return { action: 'create' }
}

// ─── 编辑 ─────────────────────────────────────────────────────────────────────

export type GoldenEditPlan =
  | { ok: false; error: string }
  | { ok: true; updates: Partial<GoldenRecord>; reembed: boolean }

/** 编辑校验上下文:均以"编辑后的问题"为基准,且**不含被编辑的这条** */
export interface GoldenEditContext {
  /** 同题其它条目的答案哈希(问题+答案唯一性判定) */
  siblingAnswerHashes: ReadonlySet<string>
  /** 同题其它条目数(上限判定) */
  siblingCount: number
  /** 每问题标准回答上限 */
  maxPerQuestion: number
}

/**
 * 计算一次编辑的落库增量:
 *  - 问题置空 / 答案置空 → 拒绝;
 *  - 改后问题+答案与同题其它条目重复 → 拒绝;
 *  - 搬到别的问题下且目标问题已满 → 拒绝;
 *  - 问题实质变更(归一化 hash 不同)→ 更新 question/questionHash 且 reembed=true;
 *  - 答案归一化后入库;folderId 原样透传。
 */
export function planGoldenEdit(
  existing: Pick<GoldenRecord, 'question' | 'questionHash' | 'answer'>,
  patch: { question?: string; answer?: string; folderId?: string | null },
  ctx: GoldenEditContext,
): GoldenEditPlan {
  const updates: Partial<GoldenRecord> = {}
  let reembed = false

  const questionChangedInput = patch.question !== undefined
  let moved = false

  if (questionChangedInput) {
    const question = normalizeText(patch.question as string)
    if (!question) return { ok: false, error: '问题不能为空' }
    const hash = hashText(question)
    if (hash !== existing.questionHash) {
      if (ctx.siblingCount >= ctx.maxPerQuestion) {
        return { ok: false, error: `该问题的标准回答已达 ${ctx.maxPerQuestion} 条上限` }
      }
      moved = true
      updates.question = question
      updates.questionHash = hash
      reembed = true
    }
  }

  let nextAnswer = existing.answer
  let answerChanged = false
  if (patch.answer !== undefined) {
    const answer = normalizeText(patch.answer)
    if (!answer) return { ok: false, error: '回复不能为空' }
    nextAnswer = answer
    answerChanged = hashText(answer) !== hashText(existing.answer)
    updates.answer = answer
  }

  // 唯一性:改后(问题, 答案)对不得与同题其它条目撞
  if ((moved || answerChanged) && ctx.siblingAnswerHashes.has(hashText(nextAnswer))) {
    return { ok: false, error: '该问题下已存在相同回复的标准回答' }
  }

  if (patch.folderId !== undefined) {
    updates.folderId = patch.folderId
  }

  return { ok: true, updates, reembed }
}
