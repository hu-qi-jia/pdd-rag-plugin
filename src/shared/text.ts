// 文本归一化与哈希 —— 幂等去重、同内容折叠的公共基础。

/**
 * 归一化文本:折叠任意空白、去首尾空白。
 * PDD 消息为纯文本(无 HTML),中文无大小写概念,故归一化仅做空白处理。
 */
export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** FNV-1a 32-bit —— 同步、跨上下文确定,足够幂等去重使用 */
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * 内容稳定哈希:`{fnv1a(归一化文本)}-{长度}`。
 * 用于 qaRecords.questionHash / replies.contentHash / goldens.questionHash 的
 * 幂等与折叠索引;长度后缀降低碰撞风险(命中后再比对原文由调用方负责)。
 */
export function hashText(text: string): string {
  const normalized = normalizeText(text)
  if (!normalized) return 'empty'
  return `${fnv1a(normalized).toString(16)}-${normalized.length}`
}
