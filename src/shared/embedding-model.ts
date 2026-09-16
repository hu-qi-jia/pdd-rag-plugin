// ─── 嵌入模型契约常量(上下文无关)─────────────────────────────────────────────
// SW 落库/统计与 offscreen 推理两侧共用;2026-09-16 工程审查③-V4 自
// offscreen/embedding.ts 拆出 —— SW 只引本模块,transformers 引擎不再进后台包。

/** 本地嵌入模型(bge-small-zh-v1.5 中文检索专用,量化后 ~25MB) */
export const MODEL_NAME = 'Xenova/bge-small-zh-v1.5'

/** 模型族换代计数:bge 中文系 = 2.x;记录自带 embeddingVersion,
 *  将来再换模型时按旧版本号懒重嵌,无需人工干预。 */
export const EMBEDDING_VERSION = '2.0.0'
