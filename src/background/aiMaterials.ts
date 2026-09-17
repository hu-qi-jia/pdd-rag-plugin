/**
 * AI 整合的材料组装(P4 AI 整合)。
 *
 * 口径「所见即所发」:材料就是本轮面板展示的知识库候选 —— 外发内容完全可预期,
 * 客服看到哪些就会发出哪些,不存在"界面上没显示却被偷偷发出去"的内容。
 *
 * 唯一例外:section 型候选要补上同节续块。长节被拆开意味着答案本来就被切断,
 * 只发命中那一块等于给模型半句话。qa 型候选答案自足,不扩展(问答体本来就是
 * 一条一个问题)。
 *
 * 三个键缺一不可(同 docId + 同 chunkKind + 同 sectionSeq):同一节里可能既有
 * section 型的引言行又有 qa 型问答块,只按 sectionSeq 匹配会把不相关的拉进来。
 */
import { db } from './db'
import { hashText } from '../shared/text'
import type { KnowledgeRecord } from '../types/memory'

/** 单次外发材料的总字数上限(约 2000 token);超出的尾部整块丢弃,不切半截 */
export const MAX_MATERIAL_CHARS = 3000

/** 块在文档中的序号:importKbDocument 写的是 `${rootId}-c${i}`;取不到返回 -1 */
function chunkOrdinal(id: string): number {
  const m = /-c(\d+)$/.exec(id)
  return m ? Number(m[1]) : -1
}

/** 去掉分块器加的「(续n)」后缀:整节拼回后这个标记会误导模型以为正文是残片 */
function baseTitle(title: string): string {
  return title.replace(/\s*\(续\d+\)$/, '')
}

/**
 * 同 docId + 同 chunkKind + 同 sectionSeq 的兄弟块,按文档内序排列。
 * 用 id 里的 `-c<n>` 数字比较而非字符串字典序 —— 否则 c10 会排到 c2 前面。
 */
async function siblingsOf(k: KnowledgeRecord): Promise<KnowledgeRecord[]> {
  if (k.chunkKind !== 'section' || !k.docId || k.sectionSeq === undefined) return [k]
  const all = await db.listKnowledgeByDoc(k.docId)
  const sib = all.filter(
    (c) => c.chunkKind === 'section' && c.sectionSeq === k.sectionSeq && c.enabled === 1,
  )
  sib.sort((a, b) => chunkOrdinal(a.id) - chunkOrdinal(b.id))
  return sib.length ? sib : [k]
}

/**
 * 候选 id → 材料文本数组(顺序即候选顺序,已去重、已截断)。
 * 返回空数组时调用方应直接放弃本次整合,不发起网络请求。
 */
export async function collectMaterials(knowledgeIds: string[]): Promise<string[]> {
  const seenId = new Set<string>()
  const seenHash = new Set<string>()
  const out: string[] = []
  let total = 0

  for (const id of knowledgeIds) {
    if (seenId.has(id)) continue
    seenId.add(id)

    const k = await db.getKnowledge(id)
    if (!k || k.enabled !== 1) continue

    const parts = await siblingsOf(k)
    const merged = parts.map((p) => p.content).join('\n')
    const text = `${parts.length > 1 ? baseTitle(k.title) : k.title}\n${merged}`
    const h = hashText(merged)
    if (seenHash.has(h)) continue
    seenHash.add(h)

    // 尾部整块丢弃而非截断:半句话喂给模型比少一块更糟
    if (total + text.length > MAX_MATERIAL_CHARS) break
    total += text.length
    out.push(text)
  }
  return out
}
