/**
 * Background Service Worker — 入口(P0 工程底座)
 *
 * P0 职责:
 *   - 最小消息路由:PING_EMBED(嵌入链路自检)/ GET_STATS(库统计)/
 *     SELF_TEST_WRITE(示例问答入库验证)
 *   - 每日 TTL 清理(chrome.alarms)与 SW 启动时补嵌
 *   - 预置"默认文件夹"文件夹;清理旧项目遗留的 AIMemoryDB 空库
 *   - P1 起扩展:PDD 捕获链路由、分段状态机等
 */

import { MODEL_NAME } from "../shared/embedding-model";
import { db } from "./db";
import {
  embedViaOffscreen,
  queueEmbedding,
} from "./offscreen";
import { processPendingEmbeddings } from "./syncEmbeddings";
import { resplitStaleKbDocs } from "./kbResplit";
import { registerAiPort } from "./aiIntegrate";
import { isLlmConfigured, testLlmConnection } from "./llm";
import { isJevConfigured, testJevConnection } from "./jev";
import {
  getBackfillStatus,
  refreshBackfillPending,
  requestBackfillStop,
  startBackfill,
} from "./backfillState";
import { handlePddIngest, restoreSegmenterState } from "./pddCapture";
import { loadSettings } from "./settings";
import { clearMetrics, metricsSnapshot, trackEvent } from "./metrics";
import { hashText } from "../shared/text";
import { fillEventOf } from "../shared/metrics";
import { DEFAULT_SETTINGS, SELF_TEST_SESSION_KEY } from '../shared/constants';
import type { QaRecord, ReplyRecord } from '../types/memory';
import type {
  ExtensionMessage,
  ExtensionMessageResponse,
  FillInputRequest,
  PingEmbedResponse,
  SelfTestWriteRequest,
  SelfTestWriteResponse,
  FillInputResponse,
} from "../types/messages";
import type { ContentFillResponse } from "../types/messages/fill";
import { searchSuggestions } from "./search";
import {
  addGoldenFromSuggestion,
  deleteGolden,
  updateGoldenWithReembed,
} from "./goldens";
import {
  clearMemoryData,
  createFolder,
  deleteFolder,
  deleteQa,
  flattenFolders,
  getMemoryList,
  getPanelData,
  renameFolder,
  updateGoldenCategory,
} from "./panel";
import { createCategory, deleteCategory, renameCategory } from "./categories";
import { exportData, importData } from "./transfer";
import {
  createKnowledge,
  deleteKnowledge,
  importKbDocument,
  setKbDocSizeTable,
  updateKnowledgeWithReembed,
} from "./knowledge";
import { saveSettings } from "./settings";
import { TTL_ALARM_NAME, purgeIfRetentionChanged, runTtlPurge, scheduleDailyAlarm } from "./ttl";

const LEGACY_DB_NAME = "AIMemoryDB";

/**
 * 补分类的待办计数缓存。`countBackfillCandidates()` 要把 qaRecords / goldens / categories
 * 三张表 `.toArray()` 后在 JS 里过滤(**整条记录、含向量**),所以运行期(running 的 500ms 轮询)
 * **不刷新**它,免得每秒白扫两次。
 *
 * 刷新时机:`idle`(初次/下一次运行前)与 `done`(跑完的转换点)。done 必须刷新 —— 面板在
 * done 态要**同时**显示完成报告与"下一次会外发多少"的预览行(ADR-0007 / spec §11.1,
 * 按钮文案先算条数);若只在 idle 刷新,同一 SW 会话里第二次点「开始分类全部历史」时
 * pending 还是启动那一刻的旧值,预览行就没了依据。轮询到 done 即停,故这是一次廉价刷新。
 */
let backfillPending = { history: 0, golden: 0 };

// ─── 处理器(只返回 payload;响应包装与错误兜底统一交给 route)──────────────────

/** 嵌入链路自检:经 offscreen 嵌入样本文本,返回模型名与向量维度 */
async function pingEmbedPayload(): Promise<PingEmbedResponse["payload"]> {
  const started = Date.now();
  const embedding = await embedViaOffscreen(
    "亲,请问这款商品支持7天无理由退换吗?可以开发票吗?",
  );
  return {
    success: true,
    model: MODEL_NAME,
    dimensions: embedding.length,
    elapsedMs: Date.now() - started,
  };
}

/**
 * 自检示例数据:write = 落一条完整问答(问题+回复,触发真实嵌入回填);
 * clean = 按 SELF_TEST_SESSION_KEY 一键清除。
 */
async function selfTestWritePayload(
  message: SelfTestWriteRequest,
): Promise<SelfTestWriteResponse["payload"]> {
  if (message.payload.action === "clean") {
    const deletedCount = await db.clearSelfTestRecords();
    return { success: true, deletedCount };
  }

  const now = Date.now();
  const qaId = `st-${now}`;
  const question =
    "亲,这个手机壳支持 iPhone 14 吗?有没有黑色的?";
  const answer =
    "支持的,兼容 iPhone 14 / 14 Plus / 14 Pro / 14 Pro Max 全系;黑色款现货,今天下单最快明天发货。";

  const qa: QaRecord = {
    id: qaId,
    sessionKey: SELF_TEST_SESSION_KEY,
    buyerIdTail: "9999",
    question,
    questionHash: hashText(question),
    questionTs: now,
    hasEmbedding: 0,
    replyCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  const reply: ReplyRecord = {
    id: `st-r-${now}`,
    qaId,
    text: answer,
    contentHash: hashText(answer),
    msgId: `selftest-${now}`,
    ts: now + 1000,
    hasEmbedding: 0,
  };
  await db.addQaRecord(qa);
  await db.addReply(reply);
  queueEmbedding("qa", qaId, question);
  return { success: true, qaId };
}

/** 金标准卡"填充":转发文本到聊天页 content(只填官方输入框,绝不发送) */
async function fillToChatPage(
  payload: FillInputRequest["payload"],
): Promise<FillInputResponse["payload"]> {
  const text = String(payload?.text ?? "");
  if (!text) return { success: false, error: "填充内容为空" };
  const tabs = await chrome.tabs.query({
    url: "https://mms.pinduoduo.com/chat-merchant/*",
  });
  if (tabs.length === 0) return { success: false, error: "未找到打开的聊天页" };
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (tab.id === undefined) return { success: false, error: "聊天页不可达" };
  // 第五十一轮:取协议里的 ContentFillResponse,不再手抄响应形状
  const resp = (await chrome.tabs.sendMessage(tab.id, {
    type: "PDD_FILL_INPUT",
    payload: { text },
  })) as ContentFillResponse | undefined;
  if (!resp?.payload?.success) {
    return {
      success: false,
      error: resp?.payload?.error ?? "页面未就绪,请刷新聊天页后重试",
    };
  }
  // 填进去了才记账(v0.16):未就绪/空文本的失败不算"用过这条话术"。
  // 即发即忘 —— 填充已经从页面往返一次,不该再等一次写库。
  if (payload.itemKind) {
    void trackEvent({
      event: fillEventOf(payload.itemKind),
      itemKind: payload.itemKind,
      itemId: typeof payload.itemId === "string" ? payload.itemId : undefined,
    });
  }
  return { success: true };
}

// ─── 消息路由(类型化映射表,第二十七轮重构)────────────────────────────────────
//
// 契约:响应消息 type = `${请求 type}_RESPONSE`,payload 形状见 types/messages.ts。
// route() 统一"异步执行 → 包装响应 → 错误兜底":处理器只声明 happy path 的
// payload,错误 payload 就地写在第二个参数 —— 取代原 24 分支 switch 的
// .then/.catch 样板与逐 case 的 as 强转(类型由映射表按键自动收窄)。

type RequestOf<K extends ExtensionMessage["type"]> = Extract<
  ExtensionMessage,
  { type: K }
>;
type ResponseOf<K extends ExtensionMessage["type"]> = Extract<
  ExtensionMessageResponse,
  { type: `${K}_RESPONSE` }
>;
type PayloadOf<K extends ExtensionMessage["type"]> = ResponseOf<K>["payload"];

type Handler<K extends ExtensionMessage["type"]> = (
  message: RequestOf<K>,
  senderTabId: number | undefined,
) => Promise<ResponseOf<K>>;

/** 组装单个处理器:happy path + 错误兜底统一包装成完整响应消息。
 *  requestType 显式传参:K 在值位置拿不到,顺带让响应类型与请求键在运行时可见。 */
function route<K extends ExtensionMessage["type"]>(
  requestType: K,
  run: (
    message: RequestOf<K>,
    senderTabId: number | undefined,
  ) => Promise<PayloadOf<K>>,
  onError: (err: unknown) => PayloadOf<K>,
): Handler<K> {
  return async (message, senderTabId) => {
    const responseType = `${requestType}_RESPONSE` as ResponseOf<K>["type"];
    try {
      return {
        type: responseType,
        payload: await run(message, senderTabId),
      } as unknown as ResponseOf<K>;
    } catch (err) {
      return {
        type: responseType,
        payload: onError(err),
      } as unknown as ResponseOf<K>;
    }
  };
}

const handlers: { [K in ExtensionMessage["type"]]: Handler<K> } = {
  PING_EMBED: route("PING_EMBED", pingEmbedPayload, (err) => ({
    success: false,
    error: String(err),
  })),

  GET_STATS: route(
    "GET_STATS",
    async () => {
      const [stats, settings, metrics, categories] = await Promise.all([
        db.getStats(),
        loadSettings(),
        metricsSnapshot(),
        // 问题类型表搭统计顺路回(第五十七轮 Task 5):记忆列表分区要用,
        // 各页签不再各自拉一遍(几份重复请求、刷新时机还各不相同)
        db.listCategories(),
      ]);
      return {
        ...stats,
        settings,
        embeddingModel: MODEL_NAME,
        metrics,
        // 面板 DTO 不带 criteria(那是喂给 jev 的选项描述)
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          filterable: c.filterable,
          route: c.route,
          position: c.position,
        })),
      };
    },
    (err) => ({
      qaCount: 0,
      replyCount: 0,
      goldenCount: 0,
      folderCount: 0,
      knowledgeCount: 0,
      settings: { ...DEFAULT_SETTINGS },
      embeddingModel: MODEL_NAME,
      metrics: {},
      // 失败兜底给空数组(不是 undefined):面板的 filter/map 不因此崩
      categories: [],
      error: String(err),
    }),
  ),

  SELF_TEST_WRITE: route("SELF_TEST_WRITE", selfTestWritePayload, (err) => ({
    success: false,
    error: String(err),
  })),

  // 注意:handlePddIngest 返回完整响应消息(历史约定),此处解包 payload
  PDD_INGEST: route(
    "PDD_INGEST",
    async (message, senderTabId) => (await handlePddIngest(message, senderTabId)).payload,
    (err) => ({ queued: 0, skipped: 0, error: String(err) }),
  ),

  GET_SUGGESTIONS: route(
    "GET_SUGGESTIONS",
    (message) => searchSuggestions(message.payload.query),
    (err) => ({ suggestions: [], error: String(err) }),
  ),

  ADD_GOLDEN: route(
    "ADD_GOLDEN",
    (message) => addGoldenFromSuggestion(message.payload),
    (err) => ({ error: String(err) }),
  ),

  GET_MEMORY_LIST: route(
    "GET_MEMORY_LIST",
    (message) => getMemoryList(message),
    (err) => ({ items: [], total: 0, hasMore: false, error: String(err) }),
  ),

  DELETE_QA: route(
    "DELETE_QA",
    (message) => deleteQa(message),
    (err) => ({ success: false, error: String(err) }),
  ),

  CLEAR_MEMORY_DATA: route(
    "CLEAR_MEMORY_DATA",
    (message) => clearMemoryData(message),
    (err) => ({ success: false, deletedQa: 0, error: String(err) }),
  ),

  GET_PANEL_DATA: route(
    "GET_PANEL_DATA",
    (message) => getPanelData(message),
    (err) => ({
      folders: [],
      goldens: [],
      knowledge: [],
      categories: [],
      error: String(err),
    }),
  ),

  FLATTEN_FOLDERS: route(
    "FLATTEN_FOLDERS",
    (message) => flattenFolders(message),
    (err) => ({ success: false, flattened: 0, error: String(err) }),
  ),

  CREATE_KB: route(
    "CREATE_KB",
    (message) => createKnowledge(message.payload),
    (err) => ({ error: String(err) }),
  ),

  UPDATE_KB: route(
    "UPDATE_KB",
    (message) => updateKnowledgeWithReembed(message.payload),
    (err) => ({ error: String(err) }),
  ),

  DELETE_KB: route(
    "DELETE_KB",
    async (message) => {
      await deleteKnowledge(message.payload.id);
      return { success: true };
    },
    (err) => ({ success: false, error: String(err) }),
  ),

  UPLOAD_KB_DOC: route(
    "UPLOAD_KB_DOC",
    (message) => importKbDocument(message.payload),
    (err) => ({ error: String(err) }),
  ),

  SET_KB_SIZE_TABLE: route(
    "SET_KB_SIZE_TABLE",
    (message) => setKbDocSizeTable(message.payload.docId, message.payload.on),
    (err) => ({ success: false, error: String(err) }),
  ),

  UPDATE_GOLDEN: route(
    "UPDATE_GOLDEN",
    (message) => updateGoldenWithReembed(message.payload),
    (err) => ({ error: String(err) }),
  ),

  UPDATE_GOLDEN_CATEGORY: route(
    "UPDATE_GOLDEN_CATEGORY",
    (message) => updateGoldenCategory(message),
    (err) => ({ success: false, error: String(err) }),
  ),

  DELETE_GOLDEN: route(
    "DELETE_GOLDEN",
    async (message) => {
      await deleteGolden(message.payload.id);
      return { success: true };
    },
    (err) => ({ success: false, error: String(err) }),
  ),

  CREATE_FOLDER: route(
    "CREATE_FOLDER",
    (message) => createFolder(message),
    (err) => ({ error: String(err) }),
  ),

  RENAME_FOLDER: route(
    "RENAME_FOLDER",
    (message) => renameFolder(message),
    (err) => ({ success: false, error: String(err) }),
  ),

  DELETE_FOLDER: route(
    "DELETE_FOLDER",
    (message) => deleteFolder(message),
    (err) => ({ success: false, error: String(err) }),
  ),

  // 问题类型 CRUD(第五十七轮 Task 7):预置/未分类的改名与删除在 handler 内拦截
  CREATE_CATEGORY: route(
    "CREATE_CATEGORY",
    (message) => createCategory(message),
    (err) => ({ error: String(err) }),
  ),

  RENAME_CATEGORY: route(
    "RENAME_CATEGORY",
    (message) => renameCategory(message),
    (err) => ({ success: false, error: String(err) }),
  ),

  DELETE_CATEGORY: route(
    "DELETE_CATEGORY",
    (message) => deleteCategory(message),
    (err) => ({ success: false, error: String(err) }),
  ),

  UPDATE_SETTINGS: route(
    "UPDATE_SETTINGS",
    async (message) => {
      // 保留期要"改完立刻生效"(第五十四轮):改完即清,不然旧记录得等下次 SW 启动
      // 才落库。清理自带兜底(runTtlPurge 失败只 warn),不会把设置保存一起带崩。
      const before = await loadSettings();
      await saveSettings(message.payload ?? {});
      const settings = await loadSettings();
      await purgeIfRetentionChanged(before, settings);
      return { settings };
    },
    (err) => ({ error: String(err) }),
  ),

  // 测试连接:走的是真正会用的端点与模型(见 llm.ts 注释)。配置体来自设置页草稿,
  // 库里的旧值不参与 —— 用户改完地址点测试,测的必须是刚改的那份。
  TEST_LLM: route(
    "TEST_LLM",
    async (message) => {
      const p = message.payload;
      const config = {
        baseUrl: String(p?.baseUrl ?? ""),
        apiKey: String(p?.apiKey ?? ""),
        model: String(p?.model ?? ""),
        timeoutMs: Number(p?.timeoutMs) || DEFAULT_SETTINGS.llmTimeoutMs,
      };
      if (!isLlmConfigured(config)) return { ok: false, error: "unconfigured" };
      const r = await testLlmConnection(config);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    (err) => ({ ok: false, error: String(err) }),
  ),

  // 测试连接(分类):与 TEST_LLM 同一条做法 —— 打真正会用的 System One 端点,
  // 配置体来自设置页草稿。未配置直接回 unconfigured,**绝不发请求**(ADR-0007 零远程)。
  TEST_JEV: route(
    "TEST_JEV",
    async (message) => {
      const p = message.payload;
      const config = {
        baseUrl: String(p?.baseUrl ?? ""),
        apiKey: String(p?.apiKey ?? ""),
        model: String(p?.model ?? ""),
        timeoutMs: Number(p?.timeoutMs) || DEFAULT_SETTINGS.jevTimeoutMs,
      };
      if (!isJevConfigured(config)) return { ok: false, error: "unconfigured" };
      const r = await testJevConnection(config);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    (err) => ({ ok: false, error: String(err) }),
  ),

  EXPORT_DATA: route(
    "EXPORT_DATA",
    (message) => exportData(message),
    (err) => ({ error: String(err) }),
  ),

  IMPORT_DATA: route(
    "IMPORT_DATA",
    (message) => importData(message),
    (err) => ({ error: String(err) }),
  ),

  FILL_INPUT: route(
    "FILL_INPUT",
    (message) => fillToChatPage(message.payload),
    (err) => ({ success: false, error: String(err) }),
  ),

  // 页面内发生的事(content 侧填充/打开面板)只能由当事方回报 —— 见 types/messages/metrics.ts
  TRACK_EVENT: route(
    "TRACK_EVENT",
    (message) => trackEvent(message.payload),
    (err) => ({ success: false, error: String(err) }),
  ),

  CLEAR_METRICS: route("CLEAR_METRICS", () => clearMetrics(), (err) => ({
    success: false,
    cleared: 0,
    error: String(err),
  })),

  // 补分类(第五十七轮 Task 4):面板用轮询读状态,不用长连接。
  // 状态留在 backfillState 的单例里,关/开弹窗都能如实反映。
  GET_BACKFILL_STATE: route(
    "GET_BACKFILL_STATE",
    async () => {
      const status = getBackfillStatus();
      // 待办计数 = 两张全表各物化一遍(含向量);只在**非 running** 时刷新 —— 运行期每秒轮询
      // 不再白扫,而 idle / done 的转换点各刷新一次(done 态会让预览行给出下一次的条数)。
      // 判断逻辑在 refreshBackfillPending 里(本文件不可单测,那里可)。
      const next = await refreshBackfillPending(status.phase);
      if (next) backfillPending = next;
      return { status, pending: backfillPending };
    },
    (err) => ({ status: { ...getBackfillStatus(), error: String(err) }, pending: { history: 0, golden: 0 } }),
  ),

  // 门禁由 startBackfill 唯一判定:不过就返回 started:false,一次 fetch 都不发
  START_BACKFILL: route("START_BACKFILL", () => startBackfill(), (err) => ({
    started: false,
    error: String(err),
  })),

  // 中断:已跑完的条目结果保留,worker 在下一轮循环顶部退出
  STOP_BACKFILL: route(
    "STOP_BACKFILL",
    async () => {
      requestBackfillStop();
      return { stopping: true };
    },
    () => ({ stopping: false }),
  ),
};

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  // 信任边界的 cast:chrome 类型层把消息当 any,形状契约由 types/messages.ts 保证。
  // 查表值宽化为统一签名(运行时按键分发,TS 传不过去"键 ↔ 消息类型"的对应关系)。
  // | undefined 保留未知消息的 default 分支语义。
  // (本文件另有几处 cast,各有其因,不是"仅此一处":route() 内按键拼响应类型 3 处、
  //  调试挂载 globalThis 2 处、上面 fillToChatPage 的跨上下文响应 1 处。)
  const message = rawMessage as ExtensionMessage | undefined;
  if (!message?.type) return false;
  const handler = handlers[message.type] as
    | ((
        message: ExtensionMessage,
        senderTabId: number | undefined,
      ) => Promise<ExtensionMessageResponse>)
    | undefined;
  if (!handler) return false; // 未知消息:不占用响应通道(与原 default 一致)
  handler(message, sender.tab?.id)
    .then(sendResponse)
    .catch((err) => console.error("[PDD CS] message handler failed:", err));
  return true; // 保持通道等待异步响应
});

// AI 整合走 Port 长连接(流式增量回推),不占 onMessage 的一问一答通道
registerAiPort();

// ─── 保留期清理(TTL) ───────────────────────────────────────────────────────────
// 闹钟与清理本体在 background/ttl.ts(可单测);本文件只做接线:闹钟到点、SW 启动补一次。

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TTL_ALARM_NAME) {
      void runTtlPurge();
    }
  });
}

// ─── 生命周期 ───────────────────────────────────────────────────────────────────

// 每次 SW 唤醒:预置文件夹、清理旧库、确保每日闹钟、恢复未结段快照、补嵌待嵌记录
void db.ensurePresetFolders();
// 第五十六轮:预置问题类型(幂等,已存在的不会被覆盖)
void db.ensurePresetCategories();
void db.dropLegacyDbIfExists(LEGACY_DB_NAME).then((dropped) => {
  if (dropped) console.log("[PDD CS] Dropped legacy database:", LEGACY_DB_NAME);
});
void scheduleDailyAlarm();
// SW 休眠会丢分段器内存:从 storage.session 恢复未结问题段(浏览器会话内有效)
void restoreSegmenterState();

// 旧版 MAIN-world 网络 hook(已在 P1 重构中删除)可能残留在 profile 的
// 动态脚本注册表里(文件已不存在 → 注入报错)。每次唤醒幂等注销一次。
if (typeof chrome.scripting?.unregisterContentScripts === "function") {
  void chrome.scripting
    .unregisterContentScripts({ ids: ["srcContentsPddNetHook"] })
    .catch(() => {
      /* 未注册过/无权限:忽略 */
    });
}

// 延迟执行,让 offscreen 有机会先行就绪(首次唤醒可能同时拉模型)
setTimeout(() => {
  void (async () => {
    // 分块器版本迁移必须先于补嵌:重切会把新块标为待嵌,由随后同一批补嵌一次拉齐
    try {
      await resplitStaleKbDocs();
    } catch (err) {
      console.error("[PDD CS] resplit stale kb docs failed:", err);
    }
    await processPendingEmbeddings();
  })();
}, 8000);
setTimeout(() => {
  void runTtlPurge();
}, 15000);

chrome.runtime.onInstalled.addListener((details) => {
  void db.ensurePresetFolders();
  void scheduleDailyAlarm();
  if (details.reason === "install" || details.reason === "update") {
    // 更新/重装后旧会话 ID 等状态无需迁移(P0 无状态),仅保底清理
    void db.dropLegacyDbIfExists(LEGACY_DB_NAME);
  }
});

if (typeof chrome.runtime.onStartup !== "undefined") {
  chrome.runtime.onStartup.addListener(() => {
    void scheduleDailyAlarm();
    void runTtlPurge();
  });
}

// ─── 开发/验收辅助(全部上下文可用;仅本机工具,不对外) ───────────────────────────

type PddDbHandle = typeof db;

(globalThis as unknown as { pddDb?: PddDbHandle }).pddDb = db;
(globalThis as unknown as { pddPing?: () => Promise<void> }).pddPing = async () => {
  try {
    const embedding = await embedViaOffscreen("验收:512 维嵌入自检");
    console.log(`[PDD CS] ping OK: ${embedding.length} dims (${MODEL_NAME})`);
  } catch (err) {
    console.error("[PDD CS] ping failed:", err);
  }
};
