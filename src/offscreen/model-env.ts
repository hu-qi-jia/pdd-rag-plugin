/**
 * 模型加载环境(2026-09-17 第四十七轮):模型内置后 offscreen 必须**纯本地**。
 * 抽成纯函数以便单测(不 import @xenova/transformers);embedding.ts 模块初始化时调用。
 * 约束来源:spec §二.3 / ADR 0005 —— allowRemoteModels=false 永久,杜绝"一半在线一半本地"。
 */

type TransformersEnv = {
  allowLocalModels: boolean
  allowRemoteModels: boolean
  localModelPath?: string
  useBrowserCache: boolean
}

/** 扩展内模型根目录(与 scripts/model.mjs 的 copy 目标一致) */
export const MODEL_DIR_PREFIX = 'model/'

/** 把 transformers env 切到「仅扩展内 model/」;getURL 注入便于测试 */
export function configureLocalModelEnv(
  env: TransformersEnv,
  getURL: (path: string) => string,
): void {
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.localModelPath = getURL(MODEL_DIR_PREFIX)
  // 扩展自带文件走 HTTP 缓存即可,不占 Cache API 存储
  env.useBrowserCache = false
}

/** 本地模型加载失败 → 可行动文案(文件缺失/损坏;原始错误保留供诊断) */
export function toLocalModelErrorMessage(raw: string): string {
  return `本地模型加载失败(文件缺失或损坏),请重新安装扩展;原始错误: ${raw}`
}
