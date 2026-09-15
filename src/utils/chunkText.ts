/**
 * 文档分块 —— 基础滑窗与原项目(personal-ai-memory 改造前)chunkText 同参数:
 * 500 字符滑动窗口、75 字符重叠:bge-small-zh-v1.5 上下文 512 token,
 * 混排中英文按 ~100-125 token 估算;重叠保留跨边界语义。
 * 2026-09-15 截断点吸附:窗口末端不再硬切,向前回退到最近的自然边界
 * (空行 \n\n 之后,或句号「。」之后);边界早于最小块长时放弃吸附防碎片;
 * 无边界保持原硬切行为。
 */

export const CHUNK_SIZE_CHARS = 500
export const CHUNK_OVERLAP_CHARS = 75
/** 吸附下限:截断点向前吸附要求块长不小于此值,否则保持硬切 */
export const CHUNK_MIN_CHARS = 250

/**
 * 在 [start + CHUNK_MIN_CHARS, end] 内从 end 向前找最近的自然截断点:
 * 「。」之后,或空行(\n\n)之后;找不到返回 end(硬切)。
 * 仅在确有截断(end 之后还有内容)时调用;调用方保证 end ≤ text.length。
 */
function snapCut(text: string, start: number, end: number): number {
  const min = start + CHUNK_MIN_CHARS
  for (let j = end; j >= min; j--) {
    if (text[j - 1] === '。') return j
    if (text[j - 1] === '\n' && text[j - 2] === '\n') return j
  }
  return end
}

export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE_CHARS) return [text]

  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    const end = Math.min(i + CHUNK_SIZE_CHARS, text.length)
    // 尾段(剩余 ≤ 窗口)无截断,不吸附
    const cut = end < text.length ? snapCut(text, i, end) : end
    chunks.push(text.slice(i, cut))
    if (cut >= text.length) break
    // 重叠语义不变:下一窗起点 = 截断点 - 重叠(吸附保证 cut ≥ start+250,必然前进)
    i = cut - CHUNK_OVERLAP_CHARS
  }
  return chunks
}
