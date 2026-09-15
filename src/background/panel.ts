/**
 * 面板数据编排(P3):记忆列表 / 面板数据拉取 / 文件夹 CRUD。
 * 树构建等纯逻辑见 utils/panelLogic.ts;本文件只做 DB 读取与形状组装。
 */
import { db } from "./db";
import { UNCATEGORIZED_FOLDER_ID } from "../types/memory";
import type {
  CreateFolderRequest,
  DeleteFolderRequest,
  DeleteQaRequest,
  GetPanelDataRequest,
  GetPanelDataResponse,
  GetMemoryListRequest,
  MemoryListItem,
  MemoryReplyItem,
  RenameFolderRequest,
} from "../types/messages";

/** 记忆列表上限(360px 面板流式展示;翻页留待需要时再做) */
const MEMORY_LIST_LIMIT = 100;

/** 记忆列表:问答 + 挂载回复一次拉全(按时间升序排列回复);回复回带 goldenId(PM1) */
export async function getMemoryList(
  _message: GetMemoryListRequest,
): Promise<{ items: MemoryListItem[] }> {
  const [qas, goldens] = await Promise.all([
    db.listQaRecords(MEMORY_LIST_LIMIT),
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
  }));
  return { items };
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

/** 面板数据:文件夹 + 金标准 + 知识库(剥离向量字段) */
export async function getPanelData(
  _message: GetPanelDataRequest,
): Promise<Pick<GetPanelDataResponse["payload"], "folders" | "goldens" | "knowledge">> {
  const [folders, goldens, knowledge] = await Promise.all([
    db.listFolders(),
    db.goldens.toArray(),
    db.listKnowledge(),
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
    })),
    knowledge: knowledge.map((k) => ({
      id: k.id,
      title: k.title,
      content: k.content,
      hasEmbedding: k.hasEmbedding,
      enabled: k.enabled,
      ...(k.source !== undefined ? { source: k.source } : {}),
      updatedAt: k.updatedAt,
    })),
  };
}

// ─── 文件夹 CRUD ───────────────────────────────────────────────────────────────

const newId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function createFolder(
  message: CreateFolderRequest,
): Promise<{ id?: string; error?: string }> {
  const name = (message.payload.name ?? "").trim();
  if (!name) return { error: "文件夹名不能为空" };
  const parentId = message.payload.parentId ?? null;

  if (parentId) {
    const parent = await db.folders.get(parentId);
    if (!parent) return { error: "父文件夹不存在" };
    if (parent.parentId !== null) return { error: "最多两层,子文件夹下不能再建" };
  }

  const siblings = (await db.listFolders()).filter(
    (f) => (f.parentId ?? null) === parentId,
  );
  const id = newId("fd");
  await db.addFolder({
    id,
    parentId,
    name,
    position: siblings.length,
    createdAt: Date.now(),
  });
  return { id };
}

export async function renameFolder(
  message: RenameFolderRequest,
): Promise<{ success: boolean; error?: string }> {
  const name = (message.payload.name ?? "").trim();
  if (!name) return { success: false, error: "文件夹名不能为空" };
  if (message.payload.id === UNCATEGORIZED_FOLDER_ID) {
    return { success: false, error: "预置文件夹不可重命名" };
  }
  try {
    await db.renameFolder(message.payload.id, name);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function deleteFolder(
  message: DeleteFolderRequest,
): Promise<{ success: boolean; error?: string }> {
  if (message.payload.id === UNCATEGORIZED_FOLDER_ID) {
    return { success: false, error: "预置文件夹不可删除" };
  }
  try {
    // 其下金标准移出(folderId→null,展示时归"未分类"),不删数据
    await db.deleteFolder(message.payload.id);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
