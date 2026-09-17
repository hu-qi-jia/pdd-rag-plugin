/**
 * 保留期清理(TTL)—— 每日闹钟 + 一次清理(第五十四轮自 index.ts 抽出)。
 *
 * 抽出来的理由:这两件事都有"什么时候跑、跑几次"的行为契约,而 index.ts 是 SW 入口
 * (import 即拉起整个扩展),没法单测。此前"每次启动都无条件重建闹钟"正是这类错误 ——
 * 看不见的时序问题,必须由测试压着(见 ttl.test.ts)。
 */
import { db } from "./db";
import { loadSettings } from "./settings";
import type { PddSettings } from '../types/memory';

export const TTL_ALARM_NAME = "pddcs-daily-ttl";

/** 清理一次:删 questionTs 早于 now−retentionDays 的问答及其回复。返回删除条数(失败返回 0) */
export async function runTtlPurge(): Promise<number> {
  try {
    const settings = await loadSettings();
    const removed = await db.purgeExpired(Date.now(), settings.retentionDays);
    if (removed > 0) {
      console.log(
        `[PDD CS] TTL purge: removed ${removed} expired qa records (retention ${settings.retentionDays}d)`,
      );
    }
    return removed;
  } catch (err) {
    console.warn("[PDD CS] TTL purge failed:", err);
    return 0;
  }
}

/**
 * 确保每日闹钟在册 —— **幂等**:已在册就原样留着,不再重建。
 *
 * 不能无条件 create:同名 create 是**替换**,会把 24h 计时从此刻重头开始。而 SW 每次
 * 唤醒都会重跑一遍顶层代码,于是闹钟被一次次推后、永远到不了点(2026-09-17 实测:
 * 每次启动读到的都是"距现在 1440 分钟")。真正干活的是 SW 启动后那条 15s 定时与
 * onStartup;闹钟只是"浏览器一直开着、扩展又被晾着"时的兜底。
 * 反过来也不能只在安装时建一次:扩展更新/重载会把闹钟清掉,故每次启动补一次空位。
 */
export async function scheduleDailyAlarm(): Promise<void> {
  try {
    if (await chrome.alarms.get(TTL_ALARM_NAME)) return;
    chrome.alarms.create(TTL_ALARM_NAME, { periodInMinutes: 24 * 60 });
  } catch {
    /* alarms 不可用时退回 SW 启动时清理 */
  }
}

/**
 * 保留期一改就清一次(第五十四轮)。此前只有"SW 启动后 15s"那条路会清,用户把保留期
 * 从 365 天拉到 30 天后,旧记录要等下次浏览器启动才消失 —— 列表里那段时间只能看到
 * "剩 0 天"却不清。其余设置项改动不触发:清理是一次索引区间扫描,不值当每次滑杆都跑。
 */
export async function purgeIfRetentionChanged(
  before: PddSettings,
  after: PddSettings,
): Promise<number> {
  if (after.retentionDays === before.retentionDays) return 0;
  return runTtlPurge();
}
