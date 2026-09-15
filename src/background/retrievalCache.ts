/**
 * 检索源内存缓存(2026-09-15 工程5b):三源"已嵌条目"(锚文本 + 向量)驻留 SW 内存,
 * 检索不再每次全表 toArray 三表(几万条时 IndexedDB 结构化反序列化是主要劣化点)。
 *
 * 失效模型:任何改变"已嵌三源"集合的 db 写路径(补嵌完成/删除/启停/TTL 清除)
 * 调用 invalidateRetrievalCache(),下次检索整体重建 —— 单条增量维护的复杂度
 * 换不来收益(重建只发生在写入后的第一次检索,代价与旧方案单次全表读相同)。
 *
 * 缓存只存检索所需字段(id/kind/锚/时间/向量),不存答案与正文 ——
 * 候选正文按过阈 id 即时取,内存占用约 = 记录数 × (向量 + 锚文本)。
 */
import { db } from "./db";
import { kbAnchorText } from "./kbAnchor";
import type { RetSource } from "./retrieval";

/** 检索管线输入条目(= rankCandidates 的 entries 元素) */
export interface CachedEntry {
  source: RetSource;
  vec: Float32Array;
}

let cache: CachedEntry[] | null = null;

/** 影响"已嵌三源"集合的写入后调用;下次 getRetrievalEntries 重建 */
export function invalidateRetrievalCache(): void {
  cache = null;
}

/** 检索源条目(缓存命中时不触库) */
export async function getRetrievalEntries(): Promise<CachedEntry[]> {
  if (!cache) {
    const [qas, goldens, kbs] = await Promise.all([
      db.getEmbeddedQaRecords(),
      db.getEmbeddedGoldens(),
      db.getEmbeddedKnowledge(),
    ]);
    cache = [
      ...qas.map(
        (q): CachedEntry => ({
          source: {
            id: q.id,
            kind: "history",
            question: q.question,
            questionTs: q.questionTs,
          },
          vec: q.embedding as Float32Array,
        }),
      ),
      ...goldens.map(
        (g): CachedEntry => ({
          source: {
            id: g.id,
            kind: "golden",
            question: g.question,
            questionTs: g.updatedAt,
          },
          vec: g.qEmbedding as Float32Array,
        }),
      ),
      ...kbs.map(
        (k): CachedEntry => ({
          source: {
            id: k.id,
            kind: "knowledge",
            // 锚文本统一走 kbAnchorText(嵌入/BM25/来源摘要同源,见 kbAnchor.ts)
            question: kbAnchorText(k),
            questionTs: k.updatedAt,
          },
          vec: k.qEmbedding as Float32Array,
        }),
      ),
    ];
  }
  return cache;
}
