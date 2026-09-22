/**
 * 使用统计编排(v0.16)—— 白名单校验 + 落库 + 快照。
 *
 * 键的口径在 shared/metrics.ts(类型与字面量一处定义),存储与读写在 db.ts;
 * 此处只做"上报进来的东西该不该收、收成哪几个键"。
 *
 * 全部本地,不出网、不随导出外发。
 */
import { db } from "./db";
import {
  METRIC_EVENT_KEYS,
  itemMetricKey,
  type MetricEventKey,
} from "../shared/metrics";
import type {
  ClearMetricsResponse,
  TrackEventRequest,
  TrackEventResponse,
} from "../types/messages";

const EVENT_SET: ReadonlySet<string> = new Set<string>(METRIC_EVENT_KEYS);

/**
 * 受限联合的**运行时**那一半:类型只在编译期拦得住本仓库的代码,
 * content 上报的消息是跨上下文来的裸数据,必须当场校验。
 */
export function isTrackableEvent(value: unknown): value is MetricEventKey {
  return typeof value === "string" && EVENT_SET.has(value);
}

function isItemKind(value: unknown): value is "golden" | "knowledge" {
  return value === "golden" || value === "knowledge";
}

/**
 * 上报一次使用事件。返回是否受理 —— content 拿到 false 只记日志不弹错:
 * 统计是旁路,不该在客服面前报错。
 */
export async function trackEvent(
  payload: TrackEventRequest["payload"],
): Promise<TrackEventResponse["payload"]> {
  const event = payload?.event;
  if (!isTrackableEvent(event)) {
    return { success: false, error: `未知统计事件: ${String(event)}` };
  }
  const keys: string[] = [event];
  // 逐条用量只在来源可锚定时记;历史候选不带 id(问答记录会过期,计数会变孤儿)
  if (isItemKind(payload.itemKind) && typeof payload.itemId === "string" && payload.itemId) {
    keys.push(itemMetricKey(payload.itemKind, payload.itemId));
  }
  await db.bumpMetrics(keys);
  return { success: true };
}

/**
 * 检索结果记账:**即发即忘**(调用方不 await)。
 * 统计写在检索主链路上,但它属于旁路 —— 让一次检索多等一次 IndexedDB 写入,
 * 是拿用户体验换自己的数据好看,不划算。
 */
export function recordSearchOutcome(suggestionCount: number): void {
  const keys: string[] = ["search.total"];
  if (suggestionCount === 0) keys.push("search.miss");
  void db.bumpMetrics(keys);
}

/** 计数器快照(键 → 次数;随 GET_STATS 回给弹窗) */
export async function metricsSnapshot(): Promise<Record<string, number>> {
  const rows = await db.listMetrics();
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = r.count;
  return out;
}

export async function clearMetrics(): Promise<ClearMetricsResponse["payload"]> {
  const cleared = await db.clearMetrics();
  return { success: true, cleared };
}
