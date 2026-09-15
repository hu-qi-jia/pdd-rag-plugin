/**
 * 金标准编辑决策(纯逻辑,单测覆盖)。
 * 设计依据:设计文档 §6.3 —— 可编辑,保存即作废旧向量自动重嵌。
 * v1 检索锚 = 问题向量:仅问题实质变更才作废重嵌;答案/文件夹调整不影响向量有效性。
 */
import type { GoldenRecord } from '../types/memory'
import { normalizeText, hashText } from '../utils/text'

export type GoldenEditPlan =
  | { ok: false; error: string }
  | { ok: true; updates: Partial<GoldenRecord>; reembed: boolean }

/**
 * 计算一次编辑的落库增量:
 *  - 问题置空 / 答案置空 → 拒绝;
 *  - 问题改成与其他金标准相同 hash → 拒绝(维持"一问题一金标准"幂等约束);
 *  - 问题实质变更(归一化 hash 不同)→ 更新 question/questionHash 且 reembed=true;
 *  - 答案归一化后入库;folderId 原样透传。
 */
export function planGoldenEdit(
  existing: Pick<GoldenRecord, 'question' | 'questionHash'>,
  patch: { question?: string; answer?: string; folderId?: string | null },
  otherQuestionHashes: Set<string>,
): GoldenEditPlan {
  const updates: Partial<GoldenRecord> = {}
  let reembed = false

  if (patch.question !== undefined) {
    const question = normalizeText(patch.question)
    if (!question) return { ok: false, error: '问题不能为空' }
    const hash = hashText(question)
    if (hash !== existing.questionHash) {
      if (otherQuestionHashes.has(hash)) {
        return { ok: false, error: '已存在相同问题的标准回答' }
      }
      updates.question = question
      updates.questionHash = hash
      reembed = true
    }
  }

  if (patch.answer !== undefined) {
    const answer = normalizeText(patch.answer)
    if (!answer) return { ok: false, error: '回复不能为空' }
    updates.answer = answer
  }

  if (patch.folderId !== undefined) {
    updates.folderId = patch.folderId
  }

  return { ok: true, updates, reembed }
}
