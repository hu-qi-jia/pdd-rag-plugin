/**
 * 金标准写入与编辑(P2 设为金标准 + P3 编辑重嵌/迁移)。
 * 幂等:normalize + questionHash 查重,已存在直接返回,不重复建、不重嵌。
 */
import { db } from "./db";
import { queueEmbedding } from "./offscreen";
import { hashText, normalizeText } from "../utils/text";
import { planGoldenEdit } from "./goldenEdit";
import { UNCATEGORIZED_FOLDER_ID } from "../types/memory";
import type {
  AddGoldenRequest,
  UpdateGoldenRequest,
} from "../types/messages";

export interface AddGoldenOutcome {
  id?: string;
  exists?: boolean;
  error?: string;
}

export async function addGoldenFromSuggestion(
  payload: AddGoldenRequest["payload"],
): Promise<AddGoldenOutcome> {
  const question = normalizeText(payload.question ?? "");
  const answer = normalizeText(payload.answer ?? "");
  if (!question || !answer) return { error: "问题或回复为空" };

  const questionHash = hashText(question);
  const dup = await db.findGoldenByQuestionHash(questionHash);
  if (dup) return { id: dup.id, exists: true };

  const now = Date.now();
  const id = `gd-${now}-${Math.random().toString(36).slice(2, 8)}`;
  await db.addGolden({
    id,
    // 默认入预置"未分类"夹(设计文档 §6.3);展示层另有 null→未分类兜底
    folderId: UNCATEGORIZED_FOLDER_ID,
    question,
    answer,
    questionHash,
    hasEmbedding: 0,
    sourceRecordId: payload.sourceRecordId,
    sourceReplyId: payload.sourceReplyId,
    createdAt: now,
    updatedAt: now,
  });
  queueEmbedding("golden", id, question);
  return { id };
}

export interface UpdateGoldenOutcome {
  id?: string;
  reembed?: boolean;
  error?: string;
}

/** 编辑金标准:双字段编辑/迁移文件夹;问题实质变更时作废旧向量并排队重嵌 */
export async function updateGoldenWithReembed(
  payload: UpdateGoldenRequest["payload"],
): Promise<UpdateGoldenOutcome> {
  const existing = await db.getGolden(payload.id);
  if (!existing) return { error: "标准回答不存在" };

  if (payload.folderId !== undefined && payload.folderId !== null) {
    const folder = await db.folders.get(payload.folderId);
    if (!folder) return { error: "目标文件夹不存在" };
  }

  const others = new Set(
    (await db.goldens.toArray())
      .filter((g) => g.id !== payload.id)
      .map((g) => g.questionHash),
  );
  const plan = planGoldenEdit(
    existing,
    { question: payload.question, answer: payload.answer, folderId: payload.folderId },
    others,
  );
  if (!plan.ok) return { error: plan.error };

  const patch = { ...plan.updates };
  if (plan.reembed) patch.hasEmbedding = 0;
  await db.updateGolden(payload.id, patch);
  if (plan.reembed) {
    queueEmbedding("golden", payload.id, patch.question ?? existing.question);
  }
  return { id: payload.id, reembed: plan.reembed };
}

/** 删除金标准(不影响历史问答记录) */
export async function deleteGolden(id: string): Promise<void> {
  await db.deleteGolden(id);
}
