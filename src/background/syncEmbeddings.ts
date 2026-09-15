import { db } from "./db";
import { MODEL_NAME, EMBEDDING_VERSION } from "./embedding";
import { embedBatchViaOffscreen } from "./offscreen";
import { kbAnchorText } from "./kbAnchor";

// 启动/导入后批量补嵌:把所有 hasEmbedding=0 的问答/金标准/知识库拉齐向量。
// 100 条/批 → 每次批处理一次 IPC 往返(原项目习惯保留)。

const BATCH_SIZE = 100;

let _isProcessing = false;

type PendingTarget = { id: string; text: string; kind: "qa" | "golden" | "knowledge" };

/** 返回本批中失败的记录 id(调用方据此在本次运行内排除,防止"查到→失败→再查到"死循环) */
async function embedPendingBatch(targets: PendingTarget[]): Promise<Set<string>> {
  const failedIds = new Set<string>();
  // 一次 EMBED_BATCH 调用;offscreen 内串行推理(单线程约束)
  let embeddings: Array<Float32Array | null>;
  try {
    embeddings = await embedBatchViaOffscreen(targets.map((t) => t.text));
  } catch (err) {
    console.error("[PDD CS] EMBED_BATCH failed for batch:", err);
    // 整批标记失败,避免无限循环
    for (const t of targets) {
      failedIds.add(t.id);
      await db.markEmbeddingFailed(t.kind, t.id);
    }
    return failedIds;
  }

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const embedding = embeddings[i];
    if (!embedding) {
      console.error(
        `[PDD CS] Embedding failed in offscreen (${target.kind}: ${target.id})`,
      );
      failedIds.add(target.id);
      await db.markEmbeddingFailed(target.kind, target.id);
      continue;
    }
    try {
      if (target.kind === "qa") {
        await db.updateQaEmbedding(
          target.id,
          embedding,
          MODEL_NAME,
          EMBEDDING_VERSION,
        );
      } else if (target.kind === "golden") {
        await db.updateGoldenEmbedding(
          target.id,
          embedding,
          MODEL_NAME,
          EMBEDDING_VERSION,
        );
      } else {
        await db.updateKnowledgeEmbedding(
          target.id,
          embedding,
          MODEL_NAME,
          EMBEDDING_VERSION,
        );
      }
    } catch (err) {
      console.error(
        `[PDD CS] DB update failed (${target.kind}: ${target.id}):`,
        err,
      );
      failedIds.add(target.id);
      await db.markEmbeddingFailed(target.kind, target.id);
    }
  }
  return failedIds;
}

export async function processPendingEmbeddings(): Promise<void> {
  if (_isProcessing) return;
  _isProcessing = true;

  // 本轮运行内已失败者:下次运行(下次 SW 启动/导入后)再重试,
  // 本次不再入批 —— 否则 -1 记录被查询命中、失败、再命中,循环永不终止
  const failedGoldens = new Set<string>();
  const failedKb = new Set<string>();
  const failedQas = new Set<string>();

  try {
    for (;;) {
      // 三源交替补嵌:金标准 → 知识库(小表先清) → 问答记录
      const pendingGoldens = await db.getPendingGoldenEmbeddings(
        BATCH_SIZE,
        failedGoldens,
      );
      if (pendingGoldens.length > 0) {
        const failed = await embedPendingBatch(
          pendingGoldens.map((g) => ({
            kind: "golden" as const,
            id: g.id,
            text: g.question,
          })),
        );
        for (const id of failed) failedGoldens.add(id);
        continue; // 同一批清完后再看下一源
      }
      const pendingKb = await db.getPendingKnowledgeEmbeddings(
        BATCH_SIZE,
        failedKb,
      );
      if (pendingKb.length > 0) {
        const failed = await embedPendingBatch(
          pendingKb.map((k) => ({
            kind: "knowledge" as const,
            id: k.id,
            text: kbAnchorText(k),
          })),
        );
        for (const id of failed) failedKb.add(id);
        continue;
      }
      const pendingQas = await db.getPendingQaEmbeddings(BATCH_SIZE, failedQas);
      if (pendingQas.length === 0) break;
      const failed = await embedPendingBatch(
        pendingQas.map((q) => ({
          kind: "qa" as const,
          id: q.id,
          text: q.question,
        })),
      );
      for (const id of failed) failedQas.add(id);
    }
  } finally {
    _isProcessing = false;
  }
}
