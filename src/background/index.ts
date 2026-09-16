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
import { hashText } from "../utils/text";
import {
  SELF_TEST_SESSION_KEY,
  type QaRecord,
  type ReplyRecord,
} from "../types/memory";
import type {
  GetStatsRequest,
  GetStatsResponse,
  GetSuggestionsRequest,
  GetSuggestionsResponse,
  PingEmbedRequest,
  PingEmbedResponse,
  PddIngestRequest,
  SelfTestWriteRequest,
  SelfTestWriteResponse,
  AddGoldenRequest,
  AddGoldenResponse,
  GetMemoryListRequest,
  GetMemoryListResponse,
  DeleteQaRequest,
  DeleteQaResponse,
  ClearMemoryDataRequest,
  ClearMemoryDataResponse,
  GetPanelDataRequest,
  GetPanelDataResponse,
  UpdateGoldenRequest,
  UpdateGoldenResponse,
  DeleteGoldenRequest,
  DeleteGoldenResponse,
  CreateFolderRequest,
  CreateFolderResponse,
  RenameFolderRequest,
  RenameFolderResponse,
  DeleteFolderRequest,
  DeleteFolderResponse,
  FlattenFoldersRequest,
  FlattenFoldersResponse,
  CreateKbRequest,
  CreateKbResponse,
  UpdateKbRequest,
  UpdateKbResponse,
  DeleteKbRequest,
  DeleteKbResponse,
  UploadKbDocRequest,
  UploadKbDocResponse,
  UpdateSettingsRequest,
  UpdateSettingsResponse,
  ExportDataRequest,
  ExportDataResponse,
  ImportDataRequest,
  ImportDataResponse,
  FillInputRequest,
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

// ─── 处理器 ────────────────────────────────────────────────────────────────────

/** 嵌入链路自检:经 offscreen 嵌入样本文本,返回模型名与向量维度 */
async function handlePingEmbed(): Promise<PingEmbedResponse> {
  const started = Date.now();
  try {
    const embedding = await embedViaOffscreen(
      "亲,请问这款商品支持7天无理由退换吗?可以开发票吗?",
    );
    return {
      type: "PING_EMBED_RESPONSE",
      payload: {
        success: true,
        model: MODEL_NAME,
        dimensions: embedding.length,
        elapsedMs: Date.now() - started,
      },
    };
  } catch (err) {
    return {
      type: "PING_EMBED_RESPONSE",
      payload: { success: false, error: String(err) },
    };
  }
}

async function handleGetStats(): Promise<GetStatsResponse> {
  const [stats, settings] = await Promise.all([
    db.getStats(),
    loadSettings(),
  ]);
  return {
    type: "GET_STATS_RESPONSE",
    payload: { ...stats, settings, embeddingModel: MODEL_NAME },
  };
}

/**
 * 自检示例数据:write = 落一条完整问答(问题+回复,触发真实嵌入回填);
 * clean = 按 SELF_TEST_SESSION_KEY 一键清除。
 */
async function handleSelfTestWrite(
  message: SelfTestWriteRequest,
): Promise<SelfTestWriteResponse> {
  try {
    if (message.payload.action === "clean") {
      const deletedCount = await db.clearSelfTestRecords();
      return {
        type: "SELF_TEST_WRITE_RESPONSE",
        payload: { success: true, deletedCount },
      };
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
    return {
      type: "SELF_TEST_WRITE_RESPONSE",
      payload: { success: true, qaId },
    };
  } catch (err) {
    return {
      type: "SELF_TEST_WRITE_RESPONSE",
      payload: { success: false, error: String(err) },
    };
  }
}

/** 金标准卡"填充":转发文本到聊天页 content(只填官方输入框,绝不发送) */
async function handleFillInput(
  message: FillInputRequest,
): Promise<FillInputResponse> {
  const fail = (error: string): FillInputResponse => ({
    type: "FILL_INPUT_RESPONSE",
    payload: { success: false, error },
  });
  try {
    const text = String(message.payload?.text ?? "");
    if (!text) return fail("填充内容为空");
    const tabs = await chrome.tabs.query({
      url: "https://mms.pinduoduo.com/chat-merchant/*",
    });
    if (tabs.length === 0) return fail("未找到打开的聊天页");
    const tab = tabs.find((t) => t.active) ?? tabs[0];
    if (tab.id === undefined) return fail("聊天页不可达");
    const resp = (await chrome.tabs.sendMessage(tab.id, {
      type: "PDD_FILL_INPUT",
      payload: { text },
    })) as { payload?: { success?: boolean; error?: string } } | undefined;
    if (!resp?.payload?.success) {
      return fail(resp?.payload?.error ?? "页面未就绪,请刷新聊天页后重试");
    }
    return { type: "FILL_INPUT_RESPONSE", payload: { success: true } };
  } catch (err) {
    return fail(String(err));
  }
}

// ─── 消息路由 ───────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "PING_EMBED":
      handlePingEmbed()
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "PING_EMBED_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true; // 保持通道等待异步响应

    case "GET_STATS":
      handleGetStats()
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "GET_STATS_RESPONSE",
            payload: {
              qaCount: 0,
              replyCount: 0,
              goldenCount: 0,
              folderCount: 0,
              knowledgeCount: 0,
              settings: {
                directFillEnabled: false,
                simThreshold: 0.5,
                goldenThreshold: 0.4,
                kbThreshold: 0.4,
                retentionDays: 90,
                goldenPriorityEnabled: true,
              },
              embeddingModel: MODEL_NAME,
              error: String(err),
            } as GetStatsResponse["payload"] & { error?: string },
          }),
        );
      return true;

    case "SELF_TEST_WRITE":
      handleSelfTestWrite(message as SelfTestWriteRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "SELF_TEST_WRITE_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "PDD_INGEST":
      handlePddIngest(
        message as PddIngestRequest,
        (sender as { tab?: { id?: number } }).tab?.id,
      )
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "PDD_INGEST_RESPONSE",
            payload: { queued: 0, skipped: 0, error: String(err) },
          }),
        );
      return true;

    case "GET_SUGGESTIONS":
      searchSuggestions((message as GetSuggestionsRequest).payload.query)
        .then((out) =>
          sendResponse({
            type: "GET_SUGGESTIONS_RESPONSE",
            payload: out,
          } as GetSuggestionsResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "GET_SUGGESTIONS_RESPONSE",
            payload: { suggestions: [], error: String(err) },
          }),
        );
      return true;

    case "ADD_GOLDEN":
      addGoldenFromSuggestion((message as AddGoldenRequest).payload)
        .then((out) =>
          sendResponse({
            type: "ADD_GOLDEN_RESPONSE",
            payload: out,
          } as AddGoldenResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "ADD_GOLDEN_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "GET_MEMORY_LIST":
      getMemoryList(message as GetMemoryListRequest)
        .then((out) =>
          sendResponse({
            type: "GET_MEMORY_LIST_RESPONSE",
            payload: out,
          } as GetMemoryListResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "GET_MEMORY_LIST_RESPONSE",
            payload: { items: [], error: String(err) },
          }),
        );
      return true;

    case "DELETE_QA":
      deleteQa(message as DeleteQaRequest)
        .then((out) =>
          sendResponse({ type: "DELETE_QA_RESPONSE", payload: out } as DeleteQaResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "DELETE_QA_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "CLEAR_MEMORY_DATA":
      clearMemoryData(message as ClearMemoryDataRequest)
        .then((out) =>
          sendResponse({
            type: "CLEAR_MEMORY_DATA_RESPONSE",
            payload: out,
          } as ClearMemoryDataResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "CLEAR_MEMORY_DATA_RESPONSE",
            payload: { success: false, deletedQa: 0, error: String(err) },
          }),
        );
      return true;

    case "GET_PANEL_DATA":
      getPanelData(message as GetPanelDataRequest)
        .then((out) =>
          sendResponse({
            type: "GET_PANEL_DATA_RESPONSE",
            payload: out,
          } as GetPanelDataResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "GET_PANEL_DATA_RESPONSE",
            payload: { folders: [], goldens: [], knowledge: [], error: String(err) },
          }),
        );
      return true;

    case "FLATTEN_FOLDERS":
      flattenFolders(message as FlattenFoldersRequest)
        .then((out) =>
          sendResponse({
            type: "FLATTEN_FOLDERS_RESPONSE",
            payload: out,
          } as FlattenFoldersResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "FLATTEN_FOLDERS_RESPONSE",
            payload: { success: false, flattened: 0, error: String(err) },
          }),
        );
      return true;

    case "CREATE_KB":
      createKnowledge((message as CreateKbRequest).payload)
        .then((out) =>
          sendResponse({
            type: "CREATE_KB_RESPONSE",
            payload: out,
          } as CreateKbResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "CREATE_KB_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "UPDATE_KB":
      updateKnowledgeWithReembed((message as UpdateKbRequest).payload)
        .then((out) =>
          sendResponse({
            type: "UPDATE_KB_RESPONSE",
            payload: out,
          } as UpdateKbResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "UPDATE_KB_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "DELETE_KB":
      deleteKnowledge((message as DeleteKbRequest).payload.id)
        .then(() =>
          sendResponse({
            type: "DELETE_KB_RESPONSE",
            payload: { success: true },
          } as DeleteKbResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "DELETE_KB_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "UPLOAD_KB_DOC":
      importKbDocument((message as UploadKbDocRequest).payload)
        .then((out) =>
          sendResponse({
            type: "UPLOAD_KB_DOC_RESPONSE",
            payload: out,
          } as UploadKbDocResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "UPLOAD_KB_DOC_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "UPDATE_GOLDEN":
      updateGoldenWithReembed((message as UpdateGoldenRequest).payload)
        .then((out) =>
          sendResponse({
            type: "UPDATE_GOLDEN_RESPONSE",
            payload: out,
          } as UpdateGoldenResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "UPDATE_GOLDEN_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "DELETE_GOLDEN":
      deleteGolden((message as DeleteGoldenRequest).payload.id)
        .then(() =>
          sendResponse({
            type: "DELETE_GOLDEN_RESPONSE",
            payload: { success: true },
          } as DeleteGoldenResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "DELETE_GOLDEN_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "CREATE_FOLDER":
      createFolder(message as CreateFolderRequest)
        .then((out) =>
          sendResponse({
            type: "CREATE_FOLDER_RESPONSE",
            payload: out,
          } as CreateFolderResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "CREATE_FOLDER_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "RENAME_FOLDER":
      renameFolder(message as RenameFolderRequest)
        .then((out) =>
          sendResponse({
            type: "RENAME_FOLDER_RESPONSE",
            payload: out,
          } as RenameFolderResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "RENAME_FOLDER_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "DELETE_FOLDER":
      deleteFolder(message as DeleteFolderRequest)
        .then((out) =>
          sendResponse({
            type: "DELETE_FOLDER_RESPONSE",
            payload: out,
          } as DeleteFolderResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "DELETE_FOLDER_RESPONSE",
            payload: { success: false, error: String(err) },
          }),
        );
      return true;

    case "UPDATE_SETTINGS":
      (async () => {
        await saveSettings((message as UpdateSettingsRequest).payload ?? {});
        return await loadSettings();
      })()
        .then((settings) =>
          sendResponse({
            type: "UPDATE_SETTINGS_RESPONSE",
            payload: { settings },
          } as UpdateSettingsResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "UPDATE_SETTINGS_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "EXPORT_DATA":
      exportData(message as ExportDataRequest)
        .then((out) =>
          sendResponse({
            type: "EXPORT_DATA_RESPONSE",
            payload: out,
          } as ExportDataResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "EXPORT_DATA_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "IMPORT_DATA":
      importData(message as ImportDataRequest)
        .then((out) =>
          sendResponse({
            type: "IMPORT_DATA_RESPONSE",
            payload: out,
          } as ImportDataResponse),
        )
        .catch((err) =>
          sendResponse({
            type: "IMPORT_DATA_RESPONSE",
            payload: { error: String(err) },
          }),
        );
      return true;

    case "FILL_INPUT":
      handleFillInput(message as FillInputRequest)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            type: "FILL_INPUT_RESPONSE",
            payload: { success: false, error: String(err) },
          } satisfies FillInputResponse),
        );
      return true;

    default:
      return false;
  }
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
