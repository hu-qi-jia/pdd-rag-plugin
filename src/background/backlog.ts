/**
 * 待沉淀清单 · IO 编排(v0.16)。
 *
 * 一次读全量再在内存里聚合:问答记录受 90 天保留期约束,单客服账号的量级在
 * 数千条,一次 toArray 是毫秒级;换成逐组查询反而要几千次 IO。
 * 聚合口径与排序全在 backlogPlan.ts(纯函数,可单测)。
 */
import { db } from "./db";
import { buildBacklog } from "./backlogPlan";
import { BACKLOG_LIMIT, BACKLOG_REPLIES_PER_ITEM, SELF_TEST_SESSION_KEY } from "../shared/constants";
import type {
  GetBacklogRequest,
  GetBacklogResponse,
  IgnoreBacklogRequest,
  IgnoreBacklogResponse,
} from "../types/messages";

export async function getBacklog(
  _message: GetBacklogRequest,
): Promise<GetBacklogResponse["payload"]> {
  const [qa, replies, goldens, ignores] = await Promise.all([
    db.qaRecords.toArray(),
    db.replies.toArray(),
    // 只需要问题哈希:标准回答的正文与向量在这个页签里毫无用处,不读
    db.goldens.orderBy("questionHash").uniqueKeys(),
    db.listBacklogIgnores(),
  ]);

  const { items, total } = buildBacklog({
    qa,
    replies,
    goldenHashes: new Set(goldens.map(String)),
    ignoreHashes: new Set(ignores.map((i) => i.questionHash)),
    selfTestSessionKey: SELF_TEST_SESSION_KEY,
    limit: BACKLOG_LIMIT,
    repliesPerItem: BACKLOG_REPLIES_PER_ITEM,
  });
  return { items, total };
}

export async function ignoreBacklog(
  message: IgnoreBacklogRequest,
): Promise<IgnoreBacklogResponse["payload"]> {
  const { questionHash, question } = message.payload ?? { questionHash: "", question: "" };
  if (!questionHash) return { success: false, error: "缺少问题标识" };
  await db.ignoreBacklog(questionHash, String(question ?? ""));
  return { success: true };
}
