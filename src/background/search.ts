/**
 * 检索编排(P2,设计文档 §6.2;P4-KB 扩第三源):
 *   查询向量(offscreen)→ 三源读库(问答/金标准/知识库)→ rankCandidates(阈值+RRF)
 *   → 展开回复 → assembleSuggestions(折叠/置顶)。
 * 纯逻辑在 retrieval.ts;此处只做 IO 与装配。
 */
import { db } from "./db";
import { embedViaOffscreen } from "./offscreen";
import { getRetrievalEntries } from "./retrievalCache";
import {
  assembleSuggestions,
  rankCandidates,
  type RetReply,
  type Suggestion,
} from "./retrieval";
import { loadSettings } from "./settings";
import { aiRowAvailable } from "./aiIntegrate";
import { classifyForQuery } from "./classify";
import { decideRoute, pickByMargin } from "./route";
import { recordSearchOutcome } from "./metrics";
import { normalizeText } from "../shared/text";
import type { GoldenRecord, KnowledgeRecord } from '../types/memory';
import type { UiSettings } from "../types/messages";

export interface SearchOutcome {
  suggestions: Suggestion[];
  settings: UiSettings;
  error?: string;
}

/** 买家问题全文 → 折叠排序后的候选列表 */
export async function searchSuggestions(rawQuery: string): Promise<SearchOutcome> {
  const query = normalizeText(rawQuery);
  if (!query) {
    return {
      suggestions: [],
      settings: await uiSettingsSnapshot(),
    };
  }

  const settings = await loadSettings();

  // 分类与嵌入**并行**发起:分类是旁路,失败/超时一律吞成 null(classifyForQuery
  // 内部有超时,不会挂住检索)。embedViaOffscreen 是这里唯一可能抛错的。
  let qvec: Float32Array;
  let probabilities: Record<string, number> | null;
  try {
    [qvec, probabilities] = await Promise.all([
      embedViaOffscreen(query),
      classifyForQuery(query, settings),
    ]);
  } catch (err) {
    return {
      suggestions: [],
      settings: uiSettings(settings),
      error: `查询向量失败: ${String(err)}`,
    };
  }

  const now = Date.now();

  // 路线决策:jev 不可用 / 判不准 → no-filter(与今天逐字节一致)
  const categories = await db.listCategories();
  const route = decideRoute(categories, probabilities, settings.classifyProbThreshold);

  if (route.kind === "size-only") {
    // 纯尺码:答案取决于买家个体参数,历史回复不可复用 —— 不检索,池为空,
    // 面板据 settings.sizeRoute 渲染「按尺码表生成」行。
    // 埋点照样记(R29):漏掉它会让尺码类问题系统性地从"检索次数"里消失,
    // 把未命中率的口径拉偏。代价是它们也计一次 miss —— 这是裁决接受的偏差。
    recordSearchOutcome(0);
    return { suggestions: [], settings: uiSettings(settings, [], { sizeRoute: true }) };
  }

  // 三源条目走 SW 内存缓存(工程5b):命中时不触库,写路径已失效
  const entries = await getRetrievalEntries();

  const thresholds = {
    golden: settings.goldenThreshold,
    history: settings.simThreshold,
    knowledge: settings.kbThreshold,
  };

  // B 全池:no-filter 只跑这一遍,与改动前完全一致;filter 时它是放宽的兜底。
  const full = rankCandidates(entries, query, qvec, thresholds, now, null);
  // A 切片:只有 filter 路线才多跑一遍,且仅在"全池没有显著更优"时采用(见 pickByMargin)。
  // no-filter 下 allowed 为 null,narrowed 与 full 是**同一个引用** —— 不花第二次排名。
  const allowed = route.kind === "filter" ? route.allowed : null;
  const narrowed = allowed
    ? rankCandidates(entries, query, qvec, thresholds, now, allowed)
    : full;
  const ranked = pickByMargin(narrowed, full);

  // 候选正文按需取(缓存只存锚+向量):只取过阈源,IO 与候选数成正比
  const qaIds = ranked
    .filter((r) => r.source.kind === "history")
    .map((r) => r.source.id);
  const repliesByQa = new Map<string, RetReply[]>();
  if (qaIds.length > 0) {
    const replies = await db.getRepliesByQaIds(qaIds);
    for (const r of replies) {
      const list = repliesByQa.get(r.qaId) ?? [];
      list.push({ qaId: r.qaId, id: r.id, text: r.text, ts: r.ts });
      repliesByQa.set(r.qaId, list);
    }
  }
  const goldenIds = ranked
    .filter((r) => r.source.kind === "golden")
    .map((r) => r.source.id);
  const kbIds = ranked
    .filter((r) => r.source.kind === "knowledge")
    .map((r) => r.source.id);
  const [goldenRows, kbRows] = await Promise.all([
    goldenIds.length > 0 ? db.goldens.bulkGet(goldenIds) : [],
    kbIds.length > 0 ? db.knowledge.bulkGet(kbIds) : [],
  ]);
  const goldensById = new Map<string, GoldenRecord>();
  goldenIds.forEach((id, i) => {
    const g = goldenRows[i];
    if (g) goldensById.set(id, g);
  });
  const kbById = new Map<string, KnowledgeRecord>();
  kbIds.forEach((id, i) => {
    const k = kbRows[i];
    if (k) kbById.set(id, k);
  });

  const suggestions = assembleSuggestions(ranked, {
    getReplies: (id) => repliesByQa.get(id) ?? [],
    getGoldenAnswer: (id) => goldensById.get(id)?.answer ?? "",
    getKbContent: (id) => kbById.get(id)?.content ?? "",
    goldenPriority: settings.goldenPriorityEnabled,
    now,
  });
  // 命中率口径:v0.16 起记"发起多少次、其中多少次一条候选都捞不着"。
  // 即发即忘 —— 埋点不在这条链路上加一次 DB 写入的等待(见 metrics.ts)。
  recordSearchOutcome(suggestions.length);
  return { suggestions, settings: uiSettings(settings, suggestions) };
}

function uiSettings(
  s: Awaited<ReturnType<typeof loadSettings>>,
  suggestions: Suggestion[] = [],
  opts: { sizeRoute?: boolean } = {},
): UiSettings {
  return {
    directFillEnabled: s.directFillEnabled,
    goldenPriorityEnabled: s.goldenPriorityEnabled,
    // 门禁在 SW 单方判定(aiIntegrate.ts),content 只照渲染 —— 免得两边口径漂移
    aiAvailable: aiRowAvailable(s, suggestions.some((x) => x.kind === "knowledge")),
    // 只在真的时候写这个键:缺省即旧语义,响应体里多一个 undefined 也属噪音
    ...(opts.sizeRoute ? { sizeRoute: true } : {}),
  };
}

async function uiSettingsSnapshot(): Promise<UiSettings> {
  return uiSettings(await loadSettings());
}
