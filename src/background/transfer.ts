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
  planCategoryImports,
  planFolderImports,
  planGoldenImports,
  planKbDocImports,
  planKnowledgeImports,
  planMemoryImports,
  resolveImportedCategory,
} from "./transferPlan";
import type { ExportEnvelope } from "../types/transfer";
import { MAX_GOLDENS_PER_QUESTION } from "./goldens";
import type { ExportDataRequest, ImportDataRequest } from "../types/messages";

export async function exportData(
  message: ExportDataRequest,
): Promise<{ envelope?: ExportEnvelope; error?: string }> {
  try {
    const includeMemory = !!message.payload?.includeMemory;
    const [goldens, folders, categories, knowledge, kbDocs, settings, qaRecords, replies] =
      await Promise.all([
        db.goldens.toArray(),
        db.listFolders(),
        // 类型表必须跟着走:记录级 categoryId 是裸 id,类型表缺席时导入端
        // 只能把它们全判成悬空、退回未分类(见 types/transfer.ts 文件头)
        db.listCategories(),
        db.knowledge.toArray(),
        // v0.16:文档原文一并导出 —— 换台机器导入后仍能按新规则重切,
        // 不必让用户重新找原文上传(见 types/transfer.ts#ExportedKbDoc)
        db.kbDocs.toArray(),
        loadSettings(),
        includeMemory ? db.qaRecords.toArray() : Promise.resolve([]),
        includeMemory ? db.replies.toArray() : Promise.resolve([]),
      ]);
    return {
      envelope: buildExportEnvelope({
        goldens,
        folders,
        categories,
        knowledge,
        kbDocs,
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
  /** 新建的问题类型条数(旧导出文件没有类型表 → 恒为 0) */
  addedCategories?: number;
  /** 已在本地命中(按 id 或按名字)而没新建的类型条数 */
  skippedCategories?: number;
  addedFolders?: number;
  skippedFolders?: number;
  addedKnowledge?: number;
  skippedKnowledge?: number;
  /** 知识库文档原文(v0.16;导入后由启动时的重切扫描按新规则切块) */
  addedKbDocs?: number;
  skippedKbDocs?: number;
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

    // 1.5)问题类型(记录级 categoryId 的外键目标先就位)
    //     旧导出文件没有 env.categories → 空数组 → 不新建、记录全落未分类,
    //     与从前行为一致(不需要为兼容性多加一个分支)
    const categoryPlan = planCategoryImports(
      asArray(env.categories),
      await db.listCategories(),
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
      // 导出 id → 本地 id。这一步**必须在落库之前、计划之后**:
      // 计划阶段还不知道哪些类型会被新建,而在计划里查库又会让它不再是纯函数
      // (folderId 的悬空处理同序,见上)
      resolveImportedCategory(g, categoryPlan.idMap);
    }

    // 2.5) 知识库(标题 hash 幂等;enabled 原样保留,向量一律重嵌)
    const existingKbHashes = new Set(
      (await db.knowledge.toArray()).map((k) => k.questionHash),
    );
    const kbPlan = planKnowledgeImports(asArray(env.knowledge), existingKbHashes);

    // 2.6) 文档原文(v0.16;旧导出文件没有 kbDocs 字段 → 空数组,行为与从前一致)
    const kbDocPlan = planKbDocImports(
      asArray(env.kbDocs),
      new Set(await db.kbDocs.toCollection().primaryKeys()),
    );

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
      for (const q of memPlan.toAddQa) resolveImportedCategory(q, categoryPlan.idMap);
    }

    // ── 写库阶段(2026-09-15 审计:多个 bulkAdd 串行无事务,中途失败会留下
    // 半成品库;现整体包进一个 Dexie 事务,任一步失败全部回滚)──────────────────
    await db.transaction(
      "rw",
      [
        db.folders,
        db.categories,
        db.goldens,
        db.knowledge,
        db.kbDocs,
        db.qaRecords,
        db.replies,
      ],
      async () => {
        if (folderPlan.toAdd.length > 0) await db.folders.bulkAdd(folderPlan.toAdd);
        // 类型必须先落:金标准/问答的 categoryId 指向它(同一事务内无外键约束,
        // 但顺序保证中断时不会留下"记录已进去、类型没进去"的半成品)
        if (categoryPlan.toAdd.length > 0) {
          await db.categories.bulkAdd(categoryPlan.toAdd);
        }
        if (goldenPlan.toAdd.length > 0) await db.goldens.bulkAdd(goldenPlan.toAdd);
        if (kbPlan.toAdd.length > 0) await db.knowledge.bulkAdd(kbPlan.toAdd);
        if (kbDocPlan.toAdd.length > 0) await db.kbDocs.bulkAdd(kbDocPlan.toAdd);
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
      addedCategories: categoryPlan.toAdd.length,
      skippedCategories: categoryPlan.skipped,
      addedFolders: folderPlan.toAdd.length,
      skippedFolders: folderPlan.skipped,
      addedKnowledge: kbPlan.toAdd.length,
      skippedKnowledge: kbPlan.skipped,
      addedQa,
      skippedQa,
      addedReplies,
      skippedReplies,
      addedKbDocs: kbDocPlan.toAdd.length,
      skippedKbDocs: kbDocPlan.skipped,
    };
  } catch (err) {
    return { error: String(err) };
  }
}
