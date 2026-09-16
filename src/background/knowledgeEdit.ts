/**
 * 知识库编辑决策(纯逻辑,单测覆盖)—— 与 goldenEdit 同构。
 * v1 检索锚 = 标题向量:仅标题实质变更才作废旧向量自动重嵌;
 * 正文编辑不动向量;enabled 停用切换不归此管(编排层直改,不重嵌)。
 */
import type { KnowledgeRecord } from '../types/memory'
import { normalizeText, hashText } from '../shared/text'

export type KnowledgeEditPlan =
  | { ok: false; error: string }
  | { ok: true; updates: Partial<KnowledgeRecord>; reembed: boolean }

/**
 * 计算一次编辑的落库增量:
 *  - 标题置空 / 正文置空 → 拒绝;
 *  - 标题改成与其他条目相同 hash → 拒绝(维持"一标题一条目"幂等约束);
 *  - 标题实质变更(归一化 hash 不同)→ 更新 title/questionHash 且 reembed=true;
 *  - 正文归一化后入库。
 */
export function planKnowledgeEdit(
  existing: Pick<KnowledgeRecord, 'title' | 'questionHash'>,
  patch: { title?: string; content?: string },
  otherTitleHashes: Set<string>,
): KnowledgeEditPlan {
  const updates: Partial<KnowledgeRecord> = {}
  let reembed = false

  if (patch.title !== undefined) {
    const title = normalizeText(patch.title)
    if (!title) return { ok: false, error: '标题不能为空' }
    const hash = hashText(title)
    if (hash !== existing.questionHash) {
      if (otherTitleHashes.has(hash)) {
        return { ok: false, error: '已存在相同标题的知识条目' }
      }
      updates.title = title
      updates.questionHash = hash
      reembed = true
    }
  }

  if (patch.content !== undefined) {
    const content = normalizeText(patch.content)
    if (!content) return { ok: false, error: '正文不能为空' }
    updates.content = content
  }

  return { ok: true, updates, reembed }
}
