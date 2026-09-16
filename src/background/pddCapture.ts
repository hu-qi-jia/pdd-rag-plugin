/**
 * PDD 捕获落盘胶水(content 桥 → 此处):
 *
 *  消息级过滤(会话绑定 / 保留期 / msgId 幂等)
 *    → PddSegmenter 分段状态机(纯逻辑)
 *    → Dexie 落盘 + 问题向量入队
 *
 * 事件全部经 segmenter 内部 promise 链串行,避免 DB 写竞态。
 */
import { db } from "./db";
import { queueEmbedding } from "./offscreen";
import { PddSegmenter, type SegmenterHooks, type SegmenterSnapshot } from "../pdd/segmenter";
import { loadSettings } from "./settings";
import { hashText, normalizeText } from "../shared/text";
import type { QaRecord, ReplyRecord } from '../types/memory';
import type { PddIngestRequest, PddIngestResponse } from "../types/messages";

const MS_PER_DAY = 86_400_000;

/** 同会话内相同问题文本在此窗口内视为回填重复(合并到既有问答),超出视为真实重复询问 */
const RECENT_MERGE_MS = 5 * 60_000;

/** 每会话 msgId 幂等缓存上限(超出清前半,防内存无界) */
const MAX_MSGID_PER_SESSION = 2000;

// ─── 落盘 hooks ────────────────────────────────────────────────────────────────

/** 段内异常落错误表(SW 控制台在生产不可达,DB 错误表是唯一可观测通道,故常驻) */
async function hookLog(fn: string, ctx: Record<string, unknown>, err: unknown): Promise<void> {
  try {
    await db.logError(`pddCapture.${fn}`, { ...ctx, err: String(err) });
  } catch {
    /* 错误表也写不进去则放弃 */
  }
}

const segmenterHooks: SegmenterHooks = {
  /** 问题段关闭落盘:msgId/近期同内容命中既有问答(回填幂等),否则新建并触发嵌入 */
  async closeQuestion(ctx) {
    try {
      if (!ctx.question) return undefined;
      const now = Date.now();
      const questionHash = hashText(ctx.question);

      // 库级幂等锚:同首条消息的问题已入库(SW 重启后重放)→ 直接复用
      if (ctx.firstMsgId) {
        const byMsgId = await db.findQaByMsgId(ctx.firstMsgId);
        if (byMsgId) return byMsgId.id;
      }

      const existing = await db.findLatestQaByHash(ctx.sessionKey, questionHash);
      if (existing && now - existing.questionTs <= RECENT_MERGE_MS) {
        return existing.id;
      }

      const id = crypto.randomUUID();
      const record: QaRecord = {
        id,
        sessionKey: ctx.sessionKey,
        buyerIdTail: ctx.buyerIdTail,
        question: ctx.question,
        questionHash,
        msgId: ctx.firstMsgId,
        questionTs: ctx.firstTs,
        hasEmbedding: 0,
        replyCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.addQaRecord(record);
      queueEmbedding("qa", id, ctx.question);
      return id;
    } catch (err) {
      await hookLog("closeQuestion", { q: ctx.question.slice(0, 60), sk: ctx.sessionKey }, err);
      throw err;
    }
  },

  /** 回复挂到 qaId;同内容(contentHash)幂等,附言计数刷新 */
  async attachReply(ctx) {
    try {
      const qa = await db.getQaRecord(ctx.qaId);
      if (!qa) return; // 问答已被 TTL/删除 → 丢弃孤回复

      // 库级 msgId 幂等(SW 重启后重放防御,优先于内容折叠判定)
      if (ctx.msgId && (await db.findReplyByMsgId(ctx.msgId))) return;

      const contentHash = hashText(ctx.text);
      if (await db.hasReplyContent(ctx.qaId, contentHash)) return;

      const id = crypto.randomUUID();
      const reply: ReplyRecord = {
        id,
        qaId: ctx.qaId,
        text: ctx.text,
        contentHash,
        msgId: ctx.msgId,
        ts: ctx.ts,
        hasEmbedding: 0,
      };
      await db.addReply(reply);
      await db.recountReplyCount(ctx.qaId);
    } catch (err) {
      await hookLog("attachReply", { qaId: ctx.qaId, t: ctx.text.slice(0, 60) }, err);
      throw err;
    }
  },

  async recentQaId(sessionKey) {
    try {
      const qa = await db.latestQaOfSession(sessionKey);
      return qa?.id;
    } catch (err) {
      await hookLog("recentQaId", { sk: sessionKey }, err);
      throw err;
    }
  },
};

const segmenter = new PddSegmenter(segmenterHooks);

// ─── 未结段快照持久化(SW 休眠 ~30s 即丢内存;storage.session 跨 SW 重启存活)────

const SEGMENTER_STATE_KEY = "pddSegmenterState";

async function persistSegmenterState(): Promise<void> {
  try {
    const snapshot = await segmenter.exportState();
    await chrome.storage.session.set({ [SEGMENTER_STATE_KEY]: snapshot });
  } catch (err) {
    console.warn("[PDD CS] persist segmenter state failed:", err);
  }
}

/** SW 启动时调用:恢复休眠前的未结问题段(idle/客服回复到达时仍能正确配对落盘) */
export async function restoreSegmenterState(): Promise<void> {
  try {
    const got = await chrome.storage.session.get(SEGMENTER_STATE_KEY);
    const state = got?.[SEGMENTER_STATE_KEY];
    if (state) await segmenter.restoreState(state as SegmenterSnapshot);
  } catch (err) {
    console.warn("[PDD CS] restore segmenter state failed:", err);
  }
}

// ─── msgId 幂等(历史重放/列表重渲染/跨页面重会话去重)───────────────────────────

const seenMsgIds = new Map<string, Set<string>>();

function markMsgIdSeen(sessionKey: string, msgId: string): void {
  let set = seenMsgIds.get(sessionKey);
  if (!set) {
    set = new Set();
    seenMsgIds.set(sessionKey, set);
  }
  if (set.size >= MAX_MSGID_PER_SESSION) {
    // 超出上限:清掉最早一半,保最新
    const entries = [...set];
    for (const e of entries.slice(0, Math.floor(entries.length / 2))) {
      set.delete(e);
    }
  }
  set.add(msgId);
}

function isMsgIdSeen(sessionKey: string, msgId: string): boolean {
  return seenMsgIds.get(sessionKey)?.has(msgId) ?? false;
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────────

/** 来源 tab → 最近出现的会话(供 DOM 兜底消息与 leave 事件绑定会话) */
const tabSessions = new Map<number, string>();

export async function handlePddIngest(
  message: PddIngestRequest,
  senderTabId?: number,
): Promise<PddIngestResponse> {
  let queued = 0;
  let skipped = 0;
  // 跳过原因计数:随响应 detail 字段返回,供诊断脚本/排查使用(开销可忽略)
  const why: Record<string, number> = {};
  const markSkip = (k: string): void => {
    skipped++;
    why[k] = (why[k] ?? 0) + 1;
  };
  const settings = await loadSettings();
  const retentionMs = settings.retentionDays * MS_PER_DAY;
  const now = Date.now();

  for (const ev of message.payload.events) {
    if (ev.kind === "msg" && ev.msg) {
      const m = ev.msg;

      // 会话解析:DOM 路线由 content 放在事件级(消息容器 currentuid),网络层
      // 形态可能在消息级;两者都缺时按来源 tab 兜底
      let sessionKey = ev.sessionKey ?? m.sessionKey;
      if (!sessionKey) {
        sessionKey =
          senderTabId !== undefined ? tabSessions.get(senderTabId) : undefined;
        if (!sessionKey) {
          markSkip("nosession"); // 无会话可绑定,丢弃无主消息
          continue;
        }
      } else if (senderTabId !== undefined) {
        tabSessions.set(senderTabId, sessionKey);
      }

      const text = normalizeText(m.text);
      if (!text) {
        markSkip("notext");
        continue;
      }
      const ts = m.ts ?? now;

      // 回填的历史消息若早于保留期 → 直接跳过(不浪费入库后即被清理)
      if (now - ts > retentionMs) {
        markSkip("retention");
        continue;
      }

      // 消息级幂等:DOM 行 id 为平台毫秒号(重放/重渲染/重开会话均靠它去重)。
      // 内存 seen 随 SW 休眠丢失 → 未命中时再查库(SW 重启后 content 重放防御)
      if (m.msgId) {
        if (isMsgIdSeen(sessionKey, m.msgId)) {
          markSkip("dupmsgid");
          continue;
        }
        const known =
          m.role === "buyer"
            ? await db.findQaByMsgId(m.msgId)
            : await db.findReplyByMsgId(m.msgId);
        if (known) {
          markMsgIdSeen(sessionKey, m.msgId);
          markSkip("dupmsgid");
          continue;
        }
        markMsgIdSeen(sessionKey, m.msgId);
      }

      queued++;
      segmenter.onMessage({
        sessionKey,
        role: m.role,
        text,
        msgId: m.msgId,
        ts,
        buyerIdTail: ev.buyerIdTail ?? m.buyerIdTail,
      });
      continue;
    }

    // 会话级事件
    let sessionKey = ev.sessionKey;
    if (!sessionKey && (ev.kind === "leave" || ev.kind === "idle")) {
      sessionKey =
        senderTabId !== undefined ? tabSessions.get(senderTabId) : undefined;
    }
    if (!sessionKey) {
      markSkip("nosession");
      continue;
    }

    if (ev.kind === "active") {
      if (senderTabId !== undefined) tabSessions.set(senderTabId, sessionKey);
      continue; // 激活本身不入库
    }
    if (ev.kind === "leave" || ev.kind === "idle") {
      queued++;
      if (ev.kind === "leave") segmenter.onLeave(sessionKey);
      else segmenter.onIdle(sessionKey);
    }
  }

  // 等待已入队事件全部落盘(维持串行写),然后把未结段快照写入 session 存储
  await segmenter.settled();
  await persistSegmenterState();
  return {
    type: "PDD_INGEST_RESPONSE",
    payload: {
      queued,
      skipped,
      detail: Object.entries(why)
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
    },
  };
}
