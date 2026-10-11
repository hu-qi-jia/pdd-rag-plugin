/**
 * 打标编排(第五十六轮 · 问题自动分类)。
 *
 * 与 jev.ts 的分工:jev.ts 只管"怎么问",这里管"该不该问、问到之后怎么落"。
 * 门禁先于一切 IO:总开关关、未配 key、无类型可问 —— 任一条不成立就**一次 fetch 都不发**。
 * 这是 ADR-0007 里"未配置时扩展保持完全本地"的落点。
 *
 * 数据边界(ADR-0007,修订 ADR-0006):外发内容仅限问题文本、类型名/判定说明与请求参数;
 * 回复正文与标准回答正文永不出本机 —— 它们根本不在这条链路的入参里,是结构性保证。
 */
import { db } from './db'
import { loadSettings } from './settings'
import {
  argmaxId,
  classifyQuestion,
  isJevConfigured,
  jevConfigFromSettings,
  type JevCategoryOption,
  type JevConfig,
} from './jev'
import type { CategoryRecord } from '../types/memory'

/** 可作为 jev 选项的类型。与"参与类型过滤"是同一个集合(filterable=true) */
export function classifiableCategories(cats: CategoryRecord[]): JevCategoryOption[] {
  return cats
    .filter((c) => c.filterable)
    .map((c) => ({ id: c.id, name: c.name, criteria: c.criteria }))
}

/**
 * 一条问题 → 单一类型。最高概率低于阈值时返回 null,调用方落未分类。
 *
 * 记录级只取单一类型(归档要落在唯一一个组里);**多意图并集只用于查询时的路由**,
 * 那是另一条路径(见 spec §7.3)。
 */
export function pickRecordCategory(
  probabilities: Record<string, number>,
  threshold: number,
): { categoryId: string; confidence: number } | null {
  const top = argmaxId(probabilities)
  if (!top) return null
  const p = probabilities[top] ?? 0
  if (p < threshold) return null
  return { categoryId: top, confidence: p }
}

/**
 * 给一段问题文本打标。
 *
 * **从不抛错** —— 调用方在捕获链路与批量补分类里都是"失败就算了"的语义,
 * 一个网络错误不该把整条链路带崩。任何失败一律返回 null(落未分类)。
 */
export async function classifyRecord(
  question: string,
): Promise<{ categoryId: string; confidence: number } | null> {
  try {
    const settings = await loadSettings()
    // 门禁①:总开关
    if (!settings.classifyEnabled) return null
    // 门禁②:配置齐全
    const config = jevConfigFromSettings(settings)
    if (!isJevConfigured(config)) return null

    const cats = await db.listCategories()
    const options = classifiableCategories(cats)
    // 门禁③:有选项可问
    if (options.length === 0) return null

    const r = await classifyQuestion({ question, categories: options, config })
    if (!r.ok) return null
    return pickRecordCategory(r.probabilities, settings.classifyProbThreshold)
  } catch {
    return null
  }
}

/** 补分类进度。total 是**待办条数**(不含跳过的),设置页按钮上的文案与它同源 */
export interface BackfillProgress {
  total: number
  done: number
  ok: number
  failed: number
  skipped: number
}

/** 并发上限:官方限流约 1200 req/min,5 并发远在安全区 */
const BACKFILL_CONCURRENCY = 5
/** 单条失败重试次数(不含首发) */
const BACKFILL_RETRIES = 2

/**
 * 只有**瞬时**错误才值得重试:超时、网络失败、5xx。
 *
 * 4xx(401 配错 key、400 请求非法)重试多少次结果都一样 —— 一条配错的 key
 * 会把 1 万条补分类放大成 3 万次外发,既烧钱又拖垮限流。错误串是 jev.ts 的
 * 既定契约(`timeout`/`network`/`http <code>`),这里按前缀解析状态码,不改契约。
 */
function isTransientError(error: string): boolean {
  if (error === 'timeout' || error === 'network') return true
  const m = /^http (\d{3})$/.exec(error)
  return m !== null && Number(m[1]) >= 500
}

/** 打一条,失败重试。成功返回打标结果(可能是 null = 判不准) */
async function classifyWithRetry(
  question: string,
  config: JevConfig,
  options: JevCategoryOption[],
  threshold: number,
): Promise<{ categoryId: string; confidence: number } | null> {
  for (let attempt = 0; attempt <= BACKFILL_RETRIES; attempt++) {
    const r = await classifyQuestion({ question, categories: options, config })
    if (r.ok) return pickRecordCategory(r.probabilities, threshold)
    // 非瞬时错误:再试也是一样的结果,直接放弃,不放大外发
    if (!isTransientError(r.error)) return null
  }
  return null
}

/**
 * 批量补存量。
 *
 * 前置门禁由调用方负责(通过才会调到这里),本函数不重复判。
 * 每条跑完立即落库 —— 中断不丢进度。
 *
 * skipped 的语义是「跑的过程中记录被 TTL 清掉了」:快照拿到的候选与真正写回之间
 * 隔了几秒到几分钟,期间的清理会让 update 匹配到 0 行(Dexie 不抛错,只返回 0)。
 * 这种条目既不算 ok 也不算 failed —— 它没有被分类,只是不存在了。**不中断整批**:
 * 一次清理不该让几千条的补分类停在中途。
 */
export async function runBackfill(opts: {
  onProgress: (p: BackfillProgress) => void
  shouldStop: () => boolean
  /** 测试注入用;不传则走真实设置、真库 */
  deps?: {
    config?: JevConfig
    categories?: JevCategoryOption[]
    threshold?: number
    snapshot?: () => Promise<{
      history: Array<{ id: string; question: string }>
      golden: Array<{ id: string; question: string }>
    }>
    writeHistory?: (
      id: string,
      hit: { categoryId: string; confidence: number } | null,
    ) => Promise<number | void>
    writeGolden?: (
      id: string,
      hit: { categoryId: string; confidence: number } | null,
    ) => Promise<number | void>
  }
}): Promise<BackfillProgress> {
  const settings = await loadSettings()
  const config = opts.deps?.config ?? jevConfigFromSettings(settings)
  const options = opts.deps?.categories ?? classifiableCategories(await db.listCategories())
  const threshold = opts.deps?.threshold ?? settings.classifyProbThreshold
  const snapshot = opts.deps?.snapshot ?? (() => db.snapshotBackfillCandidates())
  const writeHistory = opts.deps?.writeHistory ?? ((id, hit) => db.updateQaCategory(id, hit))
  const writeGolden = opts.deps?.writeGolden ?? ((id, hit) => db.updateGoldenCategory(id, hit))

  const snap = await snapshot()
  const items = [
    ...snap.history.map((r) => ({ ...r, kind: "history" as const })),
    ...snap.golden.map((r) => ({ ...r, kind: "golden" as const })),
  ]
  const progress: BackfillProgress = {
    total: items.length,
    done: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
  }
  opts.onProgress({ ...progress })
  if (items.length === 0) return progress

  // 固定的 worker 池 + 共享游标:并发数恒等于池大小,不需要信号量
  let cursor = 0
  let stopped = false
  const workers = Array.from({ length: BACKFILL_CONCURRENCY }, async () => {
    for (;;) {
      if (stopped || opts.shouldStop()) {
        stopped = true
        return
      }
      const idx = cursor++
      if (idx >= items.length) return
      const item = items[idx]

      const hit = await classifyWithRetry(item.question, config, options, threshold)
      try {
        const write = item.kind === "history" ? writeHistory : writeGolden
        const written = await write(item.id, hit)
        // 0 = 行已不在(Dexie update 对缺失行不抛错,只返回 0)→ 计 skipped
        if (written === 0) progress.skipped++
        else if (hit) progress.ok++
        else progress.failed++
      } catch {
        progress.skipped++
      }
      progress.done++
      opts.onProgress({ ...progress })
    }
  })
  await Promise.all(workers)

  return progress
}
