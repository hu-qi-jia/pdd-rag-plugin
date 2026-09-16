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
import { normalizeText } from "../utils/text";
import type { GoldenRecord, KnowledgeRecord } from "../types/memory";
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

  let qvec: Float32Array;
  const settings = await loadSettings();
  try {
    qvec = await embedViaOffscreen(query);
  } catch (err) {
    return {
      suggestions: [],
      settings: uiSettings(settings),
      error: `查询向量失败: ${String(err)}`,
    };
  }

  const now = Date.now();

  // 三源条目走 SW 内存缓存(工程5b):命中时不触库,写路径已失效
  const entries = await getRetrievalEntries();

  const ranked = rankCandidates(
    entries,
    query,
    qvec,
    {
      golden: settings.goldenThreshold,
      history: settings.simThreshold,
      knowledge: settings.kbThreshold,
    },
    now,
  );

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
  return { suggestions, settings: uiSettings(settings) };
}

function uiSettings(s: Awaited<ReturnType<typeof loadSettings>>): UiSettings {
  return {
    directFillEnabled: s.directFillEnabled,
    goldenPriorityEnabled: s.goldenPriorityEnabled,
  };
}

async function uiSettingsSnapshot(): Promise<UiSettings> {
  return uiSettings(await loadSettings());
}
