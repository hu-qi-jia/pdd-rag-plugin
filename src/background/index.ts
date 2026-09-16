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

import { MODEL_NAME } from "./embedding";
import { db } from "./db";
import {
  embedViaOffscreen,
  queueEmbedding,
} from "./offscreen";
import { processPendingEmbeddings } from "./syncEmbeddings";
import { handlePddIngest, restoreSegmenterState } from "./pddCapture";
import { loadSettings } from "./settings";
import { hashText } from "../shared/text";
import { DEFAULT_SETTINGS, SELF_TEST_SESSION_KEY } from '../shared/constants';
import type { QaRecord, ReplyRecord } from '../types/memory';
import type {
  ExtensionMessage,
  ExtensionMessageResponse,
  PingEmbedResponse,
  SelfTestWriteRequest,
  SelfTestWriteResponse,
  FillInputResponse,
} from "../types/messages";
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
} from "./panel";
import { exportData, importData } from "./transfer";
import {
  createKnowledge,
  deleteKnowledge,
  importKbDocument,
  updateKnowledgeWithReembed,
} from "./knowledge";
import { saveSettings } from "./settings";

const LEGACY_DB_NAME = "AIMemoryDB";
const TTL_ALARM_NAME = "pddcs-daily-ttl";

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
  text: string,
): Promise<FillInputResponse["payload"]> {
  if (!text) return { success: false, error: "填充内容为空" };
  const tabs = await chrome.tabs.query({
    url: "https://mms.pinduoduo.com/chat-merchant/*",
  });
  if (tabs.length === 0) return { success: false, error: "未找到打开的聊天页" };
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (tab.id === undefined) return { success: false, error: "聊天页不可达" };
  const resp = (await chrome.tabs.sendMessage(tab.id, {
    type: "PDD_FILL_INPUT",
    payload: { text },
  })) as { payload?: { success?: boolean; error?: string } } | undefined;
  if (!resp?.payload?.success) {
    return {
      success: false,
      error: resp?.payload?.error ?? "页面未就绪,请刷新聊天页后重试",
    };
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
      const [stats, settings] = await Promise.all([db.getStats(), loadSettings()]);
      return { ...stats, settings, embeddingModel: MODEL_NAME };
    },
    (err) => ({
      qaCount: 0,
      replyCount: 0,
      goldenCount: 0,
      folderCount: 0,
      knowledgeCount: 0,
      settings: { ...DEFAULT_SETTINGS },
      embeddingModel: MODEL_NAME,
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
    (err) => ({ folders: [], goldens: [], knowledge: [], error: String(err) }),
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

  UPDATE_GOLDEN: route(
    "UPDATE_GOLDEN",
    (message) => updateGoldenWithReembed(message.payload),
    (err) => ({ error: String(err) }),
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

  UPDATE_SETTINGS: route(
    "UPDATE_SETTINGS",
    async (message) => {
      await saveSettings(message.payload ?? {});
      return { settings: await loadSettings() };
    },
    (err) => ({ error: String(err) }),
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
    (message) => fillToChatPage(String(message.payload?.text ?? "")),
    (err) => ({ success: false, error: String(err) }),
  ),
};

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  // 信任边界唯一一次 cast:chrome 类型层把消息当 any,形状契约由 types/messages.ts 保证。
  // 查表值宽化为统一签名(运行时按键分发,TS 传不过去"键 ↔ 消息类型"的对应关系)——
  // 全文件仅此一处 cast,映射表内部零强转;| undefined 保留未知消息的 default 分支语义。
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

// ─── 保留期清理(TTL) ───────────────────────────────────────────────────────────

async function runTtlPurge(): Promise<void> {
  try {
    const settings = await loadSettings();
    const removed = await db.purgeExpired(Date.now(), settings.retentionDays);
    if (removed > 0) {
      console.log(
        `[PDD CS] TTL purge: removed ${removed} expired qa records (retention ${settings.retentionDays}d)`,
      );
    }
  } catch (err) {
    console.warn("[PDD CS] TTL purge failed:", err);
  }
}

function scheduleDailyAlarm(): void {
  try {
    chrome.alarms.create(TTL_ALARM_NAME, { periodInMinutes: 24 * 60 });
  } catch {
    /* alarms 不可用时退回 SW 启动时清理 */
  }
}

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
void db.dropLegacyDbIfExists(LEGACY_DB_NAME).then((dropped) => {
  if (dropped) console.log("[PDD CS] Dropped legacy database:", LEGACY_DB_NAME);
});
scheduleDailyAlarm();
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
  void processPendingEmbeddings();
}, 8000);
setTimeout(() => {
  void runTtlPurge();
}, 15000);

chrome.runtime.onInstalled.addListener((details) => {
  void db.ensurePresetFolders();
  scheduleDailyAlarm();
  if (details.reason === "install" || details.reason === "update") {
    // 更新/重装后旧会话 ID 等状态无需迁移(P0 无状态),仅保底清理
    void db.dropLegacyDbIfExists(LEGACY_DB_NAME);
  }
});

if (typeof chrome.runtime.onStartup !== "undefined") {
  chrome.runtime.onStartup.addListener(() => {
    scheduleDailyAlarm();
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
