/**
 * 检索源内存缓存(2026-09-15 工程5b):三源"已嵌条目"(锚文本 + 向量)驻留 SW 内存,
 * 检索不再每次全表 toArray 三表(几万条时 IndexedDB 结构化反序列化是主要劣化点)。
 *
 * 失效模型:任何改变"已嵌三源"集合的 db 写路径(补嵌完成/删除/启停/TTL 清除)
 * 调用 invalidateRetrievalCache(),下次检索整体重建 —— 单条增量维护的复杂度
 * 换不来收益(重建只发生在写入后的第一次检索,代价与旧方案单次全表读相同)。
 *
 * 定点更新(第五十八轮,分类进检索):上面反对的"增量维护"针对的是**增删条目**
 * (增删要同步重建排序/索引等派生结构,复杂度高)。分类写回是另一类形状 ——
 * 条目没增没减、只是某个字段变了,定点改一个对象即可,不存在那份复杂度。
 * 因此单开 updateCachedCategory() 走定点,而 deleteCategory 这类**批量搬动**
 * 仍走整体失效(见 categories.ts)。两条路不矛盾,别把定点更新当成对上面的违背。
 *
 * 缓存只存检索所需字段(id/kind/锚/时间/向量/类型),不存答案与正文 ——
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

/** id → 缓存下标。定点更新要 O(1) 找位,重建时一并建;失效时一并清 */
let index: Map<string, number> | null = null;

/** 影响"已嵌三源"集合的写入后调用;下次 getRetrievalEntries 重建 */
export function invalidateRetrievalCache(): void {
  cache = null;
  index = null;
}

/** 检索源条目(缓存命中时不触库) */
export async function getRetrievalEntries(): Promise<CachedEntry[]> {
  if (!cache) {
    const [qas, goldens, kbs, sizeTableDocIds] = await Promise.all([
      db.getEmbeddedQaRecords(),
      db.getEmbeddedGoldens(),
      db.getEmbeddedKnowledge(),
      // 尺码表不做向量检索(spec §八):被标记文档的块在投影处剔除。
      // 检索对尺码表是有害的 —— 买家问"165cm 50kg 穿什么码",向量可能只命中 M
      // 那一行、漏掉相邻的 L 行,而正确答案往往在边界上。整表原文改由
      // collectSizeTableMaterials 直接喂 prompt(见 aiMaterials.ts)。
      db.listSizeTableDocIds(),
    ]);
    cache = [
      ...qas.map(
        (q): CachedEntry => ({
          source: {
            id: q.id,
            kind: "history",
            question: q.question,
            questionTs: q.questionTs,
            // 归一在缓存边界做:库里 undefined/null 一律落到 null(见 RetSource 注释)
            categoryId: q.categoryId ?? null,
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
            categoryId: g.categoryId ?? null,
          },
          vec: g.qEmbedding as Float32Array,
        }),
      ),
      ...kbs
        // 尺码表的块不进池:标记是文档级(docId),这里按 docId 剔除整篇
        .filter((k) => !(k.docId && sizeTableDocIds.has(k.docId)))
        .map(
          (k): CachedEntry => ({
            source: {
              id: k.id,
              kind: "knowledge",
              // 锚文本统一走 kbAnchorText(嵌入/BM25/来源摘要同源,见 kbAnchor.ts)
              question: kbAnchorText(k),
              questionTs: k.updatedAt,
              // 知识库不分类(恒 null;不是"缺省归一",是它本就没有类型)
              categoryId: null,
            },
            vec: k.qEmbedding as Float32Array,
          }),
        ),
    ];
    // 建索引与缓存同生:定点更新靠它 O(1) 找位
    index = new Map(cache.map((entry, i) => [entry.source.id, i]));
  }
  return cache;
}

/**
 * 定点更新一条的类型(分类写回专用,第五十八轮)。
 *
 * 为什么不调 invalidateRetrievalCache():那个是**整体失效**,分类却是一条一条写的 ——
 * 补分类跑一轮会写上千次,每次整体失效都会让紧接着的搜索白重建一遍。
 *
 * 这正是**定点更新最安全的场景**:条目本身没增没减,只是其中一个字段变了,
 * 所以不存在"增量维护的复杂度"(本文件头部那段注释反对的是增删场景,两者不矛盾)。
 *
 * 只改 `source`(换成浅拷贝,避免把库里带出的对象就地改脏);缓存/索引数组不动,
 * 引用保持稳定。id 不在缓存里(或缓存尚未建立)是空操作 —— 无需调用方判存在性。
 */
export function updateCachedCategory(id: string, categoryId: string | null): void {
  if (!cache || !index) return;
  const i = index.get(id);
  if (i === undefined) return;
  const entry = cache[i];
  if (entry) entry.source = { ...entry.source, categoryId };
}
