/**
 * 导入导出编排(P3,设计文档 §8):信封组装 / 幂等恢复 / 排队重嵌。
 * 幂等合并的纯计划逻辑见 transferPlan.ts(单测覆盖);本文件只做 DB 读写与编队。
 */
import { db } from "./db";
import { queueEmbedding } from "./offscreen";
import { kbAnchorText } from "./kbAnchor";
import { loadSettings, saveSettings } from "./settings";
import {
  EXPORT_VERSION,
  buildExportEnvelope,
  goldenImportContext,
  planFolderImports,
  planGoldenImports,
  planKnowledgeImports,
  planMemoryImports,
} from "./transferPlan";
import type { ExportEnvelope } from "../types/transfer";
import { MAX_GOLDENS_PER_QUESTION } from "./goldens";
import type { ExportDataRequest, ImportDataRequest } from "../types/messages";

export async function exportData(
  message: ExportDataRequest,
): Promise<{ envelope?: ExportEnvelope; error?: string }> {
  try {
    const includeMemory = !!message.payload?.includeMemory;
    const [goldens, folders, knowledge, settings, qaRecords, replies] =
      await Promise.all([
        db.goldens.toArray(),
        db.listFolders(),
        db.knowledge.toArray(),
        loadSettings(),
        includeMemory ? db.qaRecords.toArray() : Promise.resolve([]),
        includeMemory ? db.replies.toArray() : Promise.resolve([]),
      ]);
    return {
      envelope: buildExportEnvelope({
        goldens,
        folders,
        knowledge,
        settings,
        qaRecords,
        replies,
        includeMemory,
        exportedAt: Date.now(),
      }),
    };
  } catch (err) {
    return { error: String(err) };
  }
}

export interface ImportOutcome {
  addedGoldens?: number;
  skippedGoldens?: number;
  /** 因目标问题已达上限而未导入的条数 */
  limitedGoldens?: number;
  addedFolders?: number;
  skippedFolders?: number;
  addedKnowledge?: number;
  skippedKnowledge?: number;
  addedQa?: number;
  skippedQa?: number;
  addedReplies?: number;
  skippedReplies?: number;
  error?: string;
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function importData(message: ImportDataRequest): Promise<ImportOutcome> {
  const raw = message.payload?.envelope;
  if (!raw || typeof raw !== "object") return { error: "导入文件格式无效" };
  const env = raw as ExportEnvelope;
  if (env.version !== EXPORT_VERSION) {
    return { error: `不支持的导出版本:${String(env.version ?? "未知")},需要 ${EXPORT_VERSION}` };
  }

  try {
    // ── 读取阶段(计划逻辑只依赖导入前的库内状态)─────────────────────────────
    // 1) 文件夹(金标准的挂载目标先就位)
    const existingFolderIds = new Set((await db.listFolders()).map((f) => f.id));
    const folderPlan = planFolderImports(
      asArray(env.folders),
      existingFolderIds,
    );

    // 2) 金标准((问题+答案) 幂等 + 每问题上限;悬空 folderId 归"默认文件夹")
    const goldenCtx = goldenImportContext(await db.goldens.toArray());
    const goldenPlan = planGoldenImports(
      asArray(env.goldens),
      goldenCtx,
      MAX_GOLDENS_PER_QUESTION,
    );
    const knownFolderIds = new Set([
      ...existingFolderIds,
      ...folderPlan.toAdd.map((f) => f.id),
    ]);
    for (const g of goldenPlan.toAdd) {
      if (g.folderId !== null && !knownFolderIds.has(g.folderId)) g.folderId = null;
    }

    // 2.5) 知识库(标题 hash 幂等;enabled 原样保留,向量一律重嵌)
    const existingKbHashes = new Set(
      (await db.knowledge.toArray()).map((k) => k.questionHash),
    );
    const kbPlan = planKnowledgeImports(asArray(env.knowledge), existingKbHashes);

    // 3) 记忆搬库(可选部分;问答重嵌排队)
    let addedQa = 0;
    let skippedQa = 0;
    let addedReplies = 0;
    let skippedReplies = 0;
    let memPlan: ReturnType<typeof planMemoryImports> | null = null;
    if (Array.isArray(env.qaRecords) || Array.isArray(env.replies)) {
      const [existingQaIds, existingReplyIds] = await Promise.all([
        db.qaRecords.toCollection().primaryKeys(),
        db.replies.toCollection().primaryKeys(),
      ]);
      memPlan = planMemoryImports(
        asArray(env.qaRecords),
        asArray(env.replies),
        new Set(existingQaIds as string[]),
        new Set(existingReplyIds as string[]),
      );
    }

    // ── 写库阶段(2026-09-15 审计:多个 bulkAdd 串行无事务,中途失败会留下
    // 半成品库;现整体包进一个 Dexie 事务,任一步失败全部回滚)──────────────────
    await db.transaction(
      "rw",
      [db.folders, db.goldens, db.knowledge, db.qaRecords, db.replies],
      async () => {
        if (folderPlan.toAdd.length > 0) await db.folders.bulkAdd(folderPlan.toAdd);
        if (goldenPlan.toAdd.length > 0) await db.goldens.bulkAdd(goldenPlan.toAdd);
        if (kbPlan.toAdd.length > 0) await db.knowledge.bulkAdd(kbPlan.toAdd);
        if (memPlan) {
          if (memPlan.toAddQa.length > 0) await db.qaRecords.bulkAdd(memPlan.toAddQa);
          if (memPlan.toAddReplies.length > 0) {
            await db.replies.bulkAdd(memPlan.toAddReplies);
          }
        }
      },
    );

    // 重嵌排队在事务提交后进行(回滚时不留幽灵队列)
    for (const g of goldenPlan.toAdd) queueEmbedding("golden", g.id, g.question);
    for (const k of kbPlan.toAdd) queueEmbedding("knowledge", k.id, kbAnchorText(k));
    if (memPlan) {
      for (const q of memPlan.toAddQa) queueEmbedding("qa", q.id, q.question);
      addedQa = memPlan.toAddQa.length;
      skippedQa = memPlan.skippedQa;
      addedReplies = memPlan.toAddReplies.length;
      skippedReplies = memPlan.skippedReplies;
    }

    // 4) 设置合并(clamp 与默认值兜底由 saveSettings 保证)
    if (env.settings && typeof env.settings === "object") {
      await saveSettings(env.settings);
    }

    return {
      addedGoldens: goldenPlan.toAdd.length,
      skippedGoldens: goldenPlan.skipped,
      limitedGoldens: goldenPlan.limited,
      addedFolders: folderPlan.toAdd.length,
      skippedFolders: folderPlan.skipped,
      addedKnowledge: kbPlan.toAdd.length,
      skippedKnowledge: kbPlan.skipped,
      addedQa,
      skippedQa,
      addedReplies,
      skippedReplies,
    };
  } catch (err) {
    return { error: String(err) };
  }
}
