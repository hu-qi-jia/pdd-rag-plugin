import { MODEL_NAME, EMBEDDING_VERSION } from "../shared/embedding-model";
import { db } from "./db";

// ─── Offscreen Document Management ───────────────────────────────────────────
// Transformers.js (ONNX/WASM) 需要 SW 中不存在的 DOM API,因此创建隐藏
// offscreen document(tabs/offscreen.html)承载推理,SW 经 chrome.runtime
// 消息转发嵌入请求。

export const OFFSCREEN_URL = chrome.runtime.getURL("tabs/offscreen.html");
let _creatingOffscreen = false;

// bge-small-zh-v1.5 的上下文窗口为 512 token;中文大体 1 字 ≈ 1 token,
// 留安全余量按 1024 字截断(问答文本在此上限内不会损失语义)。
export const MAX_EMBED_CHARS = 1024;

export async function ensureOffscreenDocument(): Promise<void> {
  // chrome.runtime.getContexts 自 Chrome 116 起可用
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
      documentUrls: [OFFSCREEN_URL],
    });
    if (contexts.length > 0) return;
  }

  if (_creatingOffscreen) {
    // 等待进行中的创建完成
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (!_creatingOffscreen) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
    });
    return;
  }

  _creatingOffscreen = true;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [
        "BLOBS" as chrome.offscreen.Reason,
        "WORKERS" as chrome.offscreen.Reason,
      ],
      justification: "Run ONNX/WASM text embedding inference for quick replies",
    });
  } finally {
    _creatingOffscreen = false;
  }
}

export async function embedViaOffscreen(text: string): Promise<Float32Array> {
  await ensureOffscreenDocument();
  const truncated =
    text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;

  return new Promise<Float32Array>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "EMBED_TEXT", payload: { text: truncated } },
      (
        response:
          | { success: boolean; embedding?: number[]; error?: string }
          | undefined,
      ) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.success && response.embedding) {
          resolve(new Float32Array(response.embedding));
        } else {
          reject(
            new Error(
              response?.error ?? "Embedding failed in offscreen document",
            ),
          );
        }
      },
    );
  });
}

export async function embedBatchViaOffscreen(
  texts: string[],
): Promise<Array<Float32Array | null>> {
  await ensureOffscreenDocument();
  const truncated = texts.map((t) =>
    t.length > MAX_EMBED_CHARS ? t.slice(0, MAX_EMBED_CHARS) : t,
  );
  return new Promise<Array<Float32Array | null>>((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "EMBED_BATCH", payload: { texts: truncated } },
      (
        response:
          | {
              success: boolean;
              results?: Array<{
                success: boolean;
                embedding?: number[];
                error?: string;
              }>;
              error?: string;
            }
          | undefined,
      ) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.success || !response.results) {
          reject(new Error(response?.error ?? "EMBED_BATCH failed"));
          return;
        }
        resolve(
          response.results.map((r) =>
            r.success && r.embedding ? new Float32Array(r.embedding) : null,
          ),
        );
      },
    );
  });
}

// ─── 单条嵌入入队(捕获/导入落库后触发) ─────────────────────────────────────────
// v1 只向量化"问题锚"(qaRecords.question / goldens.question / knowledge.title),
// 回复与知识正文不单独向量化(参与 BM25 与同内容折叠)。

const EMBED_RETRY_DELAYS_MS = [2000, 5000, 15000];

export function queueEmbedding(
  kind: "qa" | "golden" | "knowledge",
  id: string,
  text: string,
  attempt = 0,
): void {
  embedViaOffscreen(text)
    .then((embedding) => {
      if (kind === "qa") {
        return db.updateQaEmbedding(id, embedding, MODEL_NAME, EMBEDDING_VERSION);
      }
      if (kind === "golden") {
        return db.updateGoldenEmbedding(id, embedding, MODEL_NAME, EMBEDDING_VERSION);
      }
      return db.updateKnowledgeEmbedding(id, embedding, MODEL_NAME, EMBEDDING_VERSION);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const isConnectionError =
        msg.includes("Receiving end does not exist") ||
        msg.includes("Could not establish connection");

      // 瞬时连接错误重试(offscreen 尚未就绪等)
      if (isConnectionError && attempt < EMBED_RETRY_DELAYS_MS.length) {
        const delay = EMBED_RETRY_DELAYS_MS[attempt];
        setTimeout(() => queueEmbedding(kind, id, text, attempt + 1), delay);
        return;
      }

      // 永久失败:hasEmbedding 置 -1 并由启动扫描兜底重试
      console.warn("[PDD CS] Embedding failed:", kind, id, err);
      void db.markEmbeddingFailed(kind, id);
      void db.logError("EMBEDDING_FAILED", {
        kind,
        recordId: id,
        error: msg,
      });
    });
}
