/**
 * EmbeddingEngine —— 运行于 offscreen 页(tabs/offscreen.html),不在 SW 内。
 *
 * 懒加载 Xenova/bge-small-zh-v1.5(中文检索专用,量化后 ~25MB)作为单例。
 * 所有嵌入请求经串行任务队列执行,避免 SW/WASM 并发内存溢出。
 *
 * 输出 512 维 Float32Array(mean pooling + L2 归一化)。
 * 决策背景见 docs/adr/0001-embedding-model-bge-small-zh.md。
 *
 * (2026-09-16 工程审查③-V4:自 background/ 迁入 offscreen/ —— 本模块实际运行
 *  上下文是 offscreen 页;MODEL_NAME/EMBEDDING_VERSION 契约常量拆到
 *  shared/embedding-model.ts,SW 侧只引常量,transformers 不再进后台包。)
 *
 * (2026-09-17 第四十七轮:模型**内置**扩展包(扩展内 model/,ADR 0005)——
 *  运行时纯本地加载,零远程请求;hf-mirror 仅存在于构建期脚本 scripts/model.mjs。
 *  加载失败只可能源于本地文件缺失/损坏,文案指向「重新安装扩展」。)
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers'
import { MODEL_NAME } from '../shared/embedding-model'
import { configureLocalModelEnv, toLocalModelErrorMessage } from './model-env'

// 模型文件随包内置(扩展内 model/),运行时零远程请求。
configureLocalModelEnv(env, (p) => chrome.runtime.getURL(p))

// 强制单线程 WASM 推理:多线程 ONNX 以 blob: URL 起 worker,
// 被扩展 CSP 拦截(script-src 'self' 'wasm-unsafe-eval' 不含 blob:)。
// numThreads=1 使 ONNX 使用无 worker 的非线程版 wasm。
env.backends.onnx.wasm.numThreads = 1

// ─── Singleton Model ──────────────────────────────────────────────────────────

let _pipe: FeatureExtractionPipeline | null = null
let _loadPromise: Promise<FeatureExtractionPipeline> | null = null

// 失败闩锁:加载失败后进入冷却期(避免每次请求都重复拉取),冷却结束允许重试;
// 重抛时携带真实底层错误(供 UI/控制台定位 CORS/网络/路径问题)。
let _modelFailed = false
let _lastModelError: string | null = null
let _retryAt = 0
const FAIL_COOLDOWN_MS = 20_000

async function getOrLoadPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipe) return _pipe

  if (_modelFailed) {
    if (Date.now() < _retryAt) {
      throw new Error(
        `Model load failed previously: ${_lastModelError ?? 'unknown error'} ` +
          '(cooldown in progress, retry automatically)',
      )
    }
    // 冷却结束:清闩锁,允许再次尝试加载
    _modelFailed = false
    _loadPromise = null
  }

  if (!_loadPromise) {
    _loadPromise = pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    }) as Promise<FeatureExtractionPipeline>
  }

  try {
    _pipe = await _loadPromise
    return _pipe
  } catch (err) {
    _modelFailed = true
    _lastModelError = toLocalModelErrorMessage(err instanceof Error ? err.message : String(err))
    _retryAt = Date.now() + FAIL_COOLDOWN_MS
    _loadPromise = null
    throw err
  }
}

// ─── Task Queue ───────────────────────────────────────────────────────────────

type EmbedTask = {
  text: string
  resolve: (embedding: Float32Array) => void
  reject: (err: unknown) => void
}

const _queue: EmbedTask[] = []
let _processing = false

async function processQueue(): Promise<void> {
  if (_processing || _queue.length === 0) return
  _processing = true

  while (_queue.length > 0) {
    const task = _queue.shift()!
    try {
      const pipe = await getOrLoadPipeline()
      const output = await pipe(task.text, { pooling: 'mean', normalize: true })
      const embedding = new Float32Array(output.data as ArrayBuffer | number[])
      task.resolve(embedding)
    } catch (err) {
      task.reject(err)
    }
  }

  _processing = false
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 入队一个文本嵌入请求。返回 Promise<Float32Array>(512 维);
 * 模型不可用时 reject。
 */
export function embed(text: string): Promise<Float32Array> {
  return new Promise<Float32Array>((resolve, reject) => {
    _queue.push({ text, resolve, reject })
    processQueue().catch(console.error)
  })
}

/**
 * 顺序嵌入多条文本(同一任务队列,一次一条推理)。
 * 逐条返回以便调用方容忍部分失败。
 */
export async function embedBatch(
  texts: string[]
): Promise<Array<{ success: true; embedding: Float32Array } | { success: false; error: string }>> {
  const results: Array<{ success: true; embedding: Float32Array } | { success: false; error: string }> = []
  for (const text of texts) {
    try {
      const embedding = await embed(text)
      results.push({ success: true, embedding })
    } catch (err) {
      results.push({ success: false, error: String(err) })
    }
  }
  return results
}

export { MODEL_NAME }
