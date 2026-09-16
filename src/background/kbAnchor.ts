/**
 * 知识条目检索锚文本(P4-KB)。
 * 手工条目(source:'manual')锚 = 标题;文档块(source:'doc')锚 = 展示标题 + 块正文。
 * 嵌入、BM25、来源摘要(question 映射)必须同用本函数,保证向量与文本检索同源;
 * 重嵌/导入等任何补嵌路径也必须走它,否则失败重试会把错误的文本嵌进向量。
 */
import type { KnowledgeRecord } from '../types/memory'
export function kbAnchorText(k: Pick<KnowledgeRecord, 'source' | 'title' | 'content'>): string {
  return k.source === 'doc' ? `${k.title}\n${k.content}` : k.title
}
