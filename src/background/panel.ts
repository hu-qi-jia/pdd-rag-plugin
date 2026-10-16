/**
 * 面板数据编排(P3):记忆列表 / 面板数据拉取 / 标准回答的类型改派。
 * 树与分组等纯逻辑见 popup/logic.ts;本文件只做 DB 读取与形状组装。
 *
 * 第五十七轮把「回复文件夹」的 CRUD 整体换成了「问题类型」(categories),UI 侧与其
 * 消息处理器一并移除;`folders` 表本身仍保留(旧备份导入与 `folderId` 回滚用,见
 * 设计文档 §10.5),但面板已不再对它做任何写入。
 */
import { db } from "./db";
import { UNCATEGORIZED_CATEGORY_ID } from '../shared/constants';
import type {
  ClearMemoryDataRequest,
  DeleteQaRequest,
  GetPanelDataRequest,
  GetPanelDataResponse,
  GetMemoryListRequest,
  MemoryListItem,
  MemoryReplyItem,
  UpdateGoldenCategoryRequest,
} from "../types/messages";

/** 记忆列表单页条数(PM2:默认 100,底部"加载更早"显式翻页,不再静默截断) */
const MEMORY_LIST_LIMIT = 100;

/** 记忆列表分页:问答 + 挂载回复一次拉全(按时间升序排列回复);回复回带 goldenId(PM1) */
export async function getMemoryList(
  message: GetMemoryListRequest,
): Promise<{ items: MemoryListItem[]; total: number; hasMore: boolean }> {
  const raw = (message.payload ?? {}) as { offset?: number; limit?: number };
  const offset = Math.max(0, Math.floor(Number(raw.offset) || 0));
  const limit = Math.min(
    200,
    Math.max(1, Math.floor(Number(raw.limit) || MEMORY_LIST_LIMIT)),
  );

  const [{ rows: qas, total }, goldens] = await Promise.all([
    db.listQaRecordsPage(offset, limit),
    db.goldens.toArray(),
  ]);
  const replies = await db.getRepliesByQaIds(qas.map((q) => q.id));

  // 持久金标徽标(2026-09-15 PM1):回复 id → 金标准 id;
  // 只认 sourceReplyId 溯源(手工新建的金标准不属于任何回复)
  const goldenByReply = new Map<string, string>();
  for (const g of goldens) {
    if (g.sourceReplyId) goldenByReply.set(g.sourceReplyId, g.id);
  }

  const byQa = new Map<string, MemoryReplyItem[]>();
  for (const r of replies) {
    const list = byQa.get(r.qaId) ?? [];
    const goldenId = goldenByReply.get(r.id);
    list.push({ id: r.id, text: r.text, ts: r.ts, ...(goldenId ? { goldenId } : {}) });
    byQa.set(r.qaId, list);
  }

  const items = qas.map((q) => ({
    id: q.id,
    question: q.question,
    questionTs: q.questionTs,
    replyCount: q.replyCount,
    replies: (byQa.get(q.id) ?? []).sort((a, b) => a.ts - b.ts),
    // 出口归一(裁决 I2):库里三种形态(undefined / null / 具体 id)在这里收敛成一种
    categoryId: q.categoryId ?? UNCATEGORIZED_CATEGORY_ID,
    // 来源与概率**不归一**:它们是"这条判得准不准"的证据,缺省本身就是信息。
    // 面板据此标「低置信」,故必须原样送到 UI —— 归成 undefined 就再也看不出机器判过
    ...(q.categorySource !== undefined ? { categorySource: q.categorySource } : {}),
    ...(q.categoryConfidence !== undefined
      ? { categoryConfidence: q.categoryConfidence }
      : {}),
  }));
  return { items, total, hasMore: offset + items.length < total };
}

/** 删除单条问答(连同其全部回复) */
export async function deleteQa(
  message: DeleteQaRequest,
): Promise<{ success: boolean; error?: string }> {
  try {
    await db.deleteQaWithReplies(message.payload.id);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** 清空问答记忆(PM6a:qa+replies 全清;金标准/知识库/文件夹保留) */
export async function clearMemoryData(
  _message: ClearMemoryDataRequest,
): Promise<{ success: boolean; deletedQa: number; error?: string }> {
  try {
    const deletedQa = await db.clearQaMemory();
    return { success: true, deletedQa };
  } catch (err) {
    return { success: false, deletedQa: 0, error: String(err) };
  }
}

/** 面板数据:文件夹 + 金标准 + 知识库(剥离向量字段)+ 逐条用量 */
export async function getPanelData(
  _message: GetPanelDataRequest,
): Promise<
  Pick<
    GetPanelDataResponse["payload"],
    "folders" | "goldens" | "knowledge" | "categories" | "legacyDocs" | "itemUsage"
  >
> {
  const [folders, goldens, knowledge, categories, legacyDocs, itemUsage, sizeTableDocIds] =
    await Promise.all([
      db.listFolders(),
      db.goldens.toArray(),
      db.listKnowledge(),
      db.listCategories(),
      db.getLegacyDocIds(),
      // 逐条用量随面板数据一起回:面板与知识库页本就每次开都取这份数据,
      // 顺手带上比再开一条"取用量"的消息少一趟往返(计数只有几十行,可忽略)
      db.listItemUsage(),
      // 尺码表标记是文档级的:每次现算一份 docId 集合,映射时按 docId 查,
      // **不**给每个块存一份 isSizeTable(那是会漂移的冗余 —— 重传/重切一块块地改)
      db.listSizeTableDocIds(),
    ]);
  return {
    folders: folders.map((f) => ({
      id: f.id,
      parentId: f.parentId,
      name: f.name,
      position: f.position,
    })),
    goldens: goldens.map((g) => ({
      id: g.id,
      folderId: g.folderId,
      question: g.question,
      answer: g.answer,
      hasEmbedding: g.hasEmbedding,
      updatedAt: g.updatedAt,
      categoryId: g.categoryId ?? UNCATEGORIZED_CATEGORY_ID,
      categorySource: g.categorySource,
      // 概率跟着来源一起送:缺它就没法在卡上标「低置信」,这个字段也就继续只写不读
      categoryConfidence: g.categoryConfidence,
    })),
    knowledge: knowledge.map((k) => ({
      id: k.id,
      title: k.title,
      content: k.content,
      hasEmbedding: k.hasEmbedding,
      enabled: k.enabled,
      ...(k.source !== undefined ? { source: k.source } : {}),
      ...(k.docId !== undefined ? { docId: k.docId } : {}),
      // 现算:只有被标记文档的块才带这个字段(手工条目永不带)
      ...(k.docId && sizeTableDocIds.has(k.docId) ? { isSizeTable: true } : {}),
      updatedAt: k.updatedAt,
    })),
    // 面板 DTO 不带 criteria(那是喂给 jev 的选项描述)
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      filterable: c.filterable,
      route: c.route,
      position: c.position,
    })),
    legacyDocs,
    itemUsage,
  };
}

// ─── 标准回答的类型摆放 ─────────────────────────────────────────────────────────

/**
 * 把一条标准回答移到另一个问题类型。
 *
 * 写完把 categorySource 置成 'manual' —— 这是本设计里"机器永不许覆盖用户手工摆放"的落点:
 * 补分类的候选判据对 manual 一律跳过(见 db#isBackfillCandidate / spec §11.2)。
 *
 * 刻意**不走 db.updateGolden()**:那条会整体作废检索缓存并带 updatedAt 变更语义,
 * 而分类**已进检索**(第五十八轮)——写入生效后只需定点同步缓存(条目没增没减,
 * 只改类型字段),一次纯摆放不必惊动整条检索管线。
 * 落库走 `db.setGoldenCategoryManual` —— 人工写入无条件生效,机器的 manual 守卫不挡它。
 *
 * 目标类型不存在 / 标答不存在都报错且**不改动**。
 */
export async function updateGoldenCategory(
  message: UpdateGoldenCategoryRequest,
): Promise<{ success: boolean; error?: string }> {
  const { id, categoryId } = message.payload;
  const cat = await db.categories.get(categoryId);
  if (!cat) return { success: false, error: "目标类型不存在" };
  const g = await db.getGolden(id);
  if (!g) return { success: false, error: "标准回答不存在" };
  await db.setGoldenCategoryManual(id, categoryId);
  return { success: true };
}
