/**
 * 标准回答写入与编辑(P2 设为标准回答 + P3 编辑重嵌/迁移)。
 *
 * 一个问题常对应多种合格话术,因此 **同一问题可挂多条标准回答**:
 *  - 幂等粒度 = 问题 + 答案(同问题同答案不重复建);
 *  - 每个问题上限 MAX_GOLDENS_PER_QUESTION(3)条,达到上限返回 limitReached;
 *  - 排序口径统一为 createdAt 倒序(最近设置的靠前),候选与面板同源。
 * 决策纯逻辑在 goldenEdit.ts(planGoldenAdd / planGoldenEdit),此处只做 IO。
 */
import { db } from "./db";
import { queueEmbedding } from "./offscreen";
import { hashText, normalizeText } from "../utils/text";
import { planGoldenAdd, planGoldenEdit } from "./goldenEdit";
import {
  MAX_GOLDENS_PER_QUESTION,
  UNCATEGORIZED_FOLDER_ID,
} from "../types/memory";
import type {
  AddGoldenRequest,
  UpdateGoldenRequest,
} from "../types/messages";

/** 同一问题可保留的标准回答条数上限(定义在 types/memory,与 UI 提示同源) */
export { MAX_GOLDENS_PER_QUESTION };

export interface AddGoldenOutcome {
  id?: string;
  /** 同问题 + 同答案已存在 */
  exists?: boolean;
  /** 该问题已达上限 */
  limitReached?: boolean;
  /** 该问题当前条数(新建成功时含本条) */
  count?: number;
  error?: string;
}

/** 该问题现有标准回答(createdAt 倒序:最近设置靠前) */
async function siblingsOf(questionHash: string) {
  return db.getGoldensByQuestionHash(questionHash);
}

export async function addGoldenFromSuggestion(
  payload: AddGoldenRequest["payload"],
): Promise<AddGoldenOutcome> {
  const question = normalizeText(payload.question ?? "");
  const siblings = question ? await siblingsOf(hashText(question)) : [];
  const plan = planGoldenAdd(siblings, { question: question, answer: payload.answer ?? "" }, MAX_GOLDENS_PER_QUESTION);

  if (plan.action === "invalid") return { error: plan.error };
  if (plan.action === "exists") {
    return { id: plan.id, exists: true, count: plan.count };
  }
  if (plan.action === "limit") return { limitReached: true, count: plan.count };

  const answer = normalizeText(payload.answer ?? "");
  const now = Date.now();
  const id = `gd-${now}-${Math.random().toString(36).slice(2, 8)}`;
  await db.addGolden({
    id,
    // 默认入预置"默认文件夹"夹(设计文档 §6.3);展示层另有 null→默认文件夹兜底
    folderId: UNCATEGORIZED_FOLDER_ID,
    question,
    answer,
    questionHash: hashText(question),
    hasEmbedding: 0,
    sourceRecordId: payload.sourceRecordId,
    sourceReplyId: payload.sourceReplyId,
    createdAt: now,
    updatedAt: now,
  });
  queueEmbedding("golden", id, question);
  return { id, count: siblings.length + 1 };
}

export interface UpdateGoldenOutcome {
  id?: string;
  reembed?: boolean;
  error?: string;
}

/** 编辑标准回答:双字段编辑/迁移文件夹;问题实质变更时作废旧向量并排队重嵌 */
export async function updateGoldenWithReembed(
  payload: UpdateGoldenRequest["payload"],
): Promise<UpdateGoldenOutcome> {
  const existing = await db.getGolden(payload.id);
  if (!existing) return { error: "标准回答不存在" };

  if (payload.folderId !== undefined && payload.folderId !== null) {
    const folder = await db.folders.get(payload.folderId);
    if (!folder) return { error: "目标文件夹不存在" };
  }

  // 校验基准 = 编辑后的问题之下、除自己以外的同题条目
  const nextQuestion =
    payload.question !== undefined ? normalizeText(payload.question) : existing.question;
  const siblings = nextQuestion
    ? (await siblingsOf(hashText(nextQuestion))).filter((g) => g.id !== payload.id)
    : [];

  const plan = planGoldenEdit(
    existing,
    { question: payload.question, answer: payload.answer, folderId: payload.folderId },
    {
      siblingAnswerHashes: new Set(siblings.map((g) => hashText(g.answer))),
      siblingCount: siblings.length,
      maxPerQuestion: MAX_GOLDENS_PER_QUESTION,
    },
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

/** 删除标准回答(不影响历史问答记录)—— 即"取消标准回答" */
export async function deleteGolden(id: string): Promise<void> {
  await db.deleteGolden(id);
}
