/**
 * 打标编排(第五十六轮 · 问题自动分类)。
 *
 * 与 jev.ts 的分工:jev.ts 只管"怎么问",这里管"该不该问、问到之后怎么落"。
 * 门禁先于一切 IO:总开关关、未配 key、无类型可问 —— 任一条不成立就**一次 fetch 都不发**。
 * 这是 ADR-0007 里"未配置时扩展保持完全本地"的落点。
 *
 * **作用域**:同一份门禁服务两条路径,但选项集不同 —— 记录级(捕获/金标打标、批量补分类)
 * 取 `route='retrieve'`;查询级(意图识别)才含 `route='size'`。见 `classifiableCategories`。
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
import type { CategoryRecord, PddSettings } from '../types/memory'

/** 打标作用域:`'record'` = 记录级(打标/补分类),`'query'` = 查询级(意图识别) */
export type ClassifyScope = 'record' | 'query'

/**
 * 可作为 jev 选项的类型。
 *
 * `'query'`(意图识别):`filterable=true` 即可 —— 与加作用域之前逐字节相同。
 * `'record'`(捕获/金标打标、批量补分类):还要 `route === 'retrieve'`。
 * 尺码(`route='size'`)的答案取决于买家个体参数、历史回复不可复用,
 * 天生**不可能有有用的存档记录** —— 记录级少一个选项,好过事后清理错标。
 *
 * 用现成的 `route` 字段而不是新增"是否记录级"字段:`route='size'` 的语义本就是
 * "答案不可复用",两者是同一件事;加字段只会多一处要同步的真相(spec M4)。
 */
export function classifiableCategories(
  cats: CategoryRecord[],
  scope: ClassifyScope,
): JevCategoryOption[] {
  return cats
    .filter((c) => c.filterable && (scope === 'query' || c.route === 'retrieve'))
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
 * 门禁 + 一次分类调用,返回**整份概率分布**。失败一律吞成 null。
 *
 * 门禁顺序(与 classifyRecord 一致,三处共用同一份实现 —— 免得两条路径漂移):
 *   ① 总开关 classifyEnabled;② 配置齐全 isJevConfigured;③ 有可问类型。
 * 任一条不成立就**一次 fetch 都不发**(ADR-0007 的"未配置保持完全本地")。
 *
 * `scope` **不给默认值**:记录级与查询级的选项集不同,默认值会让"忘传"的调用点
 * 静默退回旧的一集合行为 —— 那正是本任务要消灭的缺陷(spec 6.1)。
 */
async function classifyGated(
  question: string,
  settings: PddSettings,
  scope: ClassifyScope,
): Promise<Record<string, number> | null> {
  try {
    // 门禁①:总开关
    if (!settings.classifyEnabled) return null
    // 门禁②:配置齐全
    const config = jevConfigFromSettings(settings)
    if (!isJevConfigured(config)) return null

    const cats = await db.listCategories()
    const options = classifiableCategories(cats, scope)
    // 门禁③:有选项可问
    if (options.length === 0) return null

    const r = await classifyQuestion({ question, categories: options, config })
    return r.ok ? r.probabilities : null
  } catch {
    return null
  }
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
    const probabilities = await classifyGated(question, settings, 'record')
    if (probabilities === null) return null
    return pickRecordCategory(probabilities, settings.classifyProbThreshold)
  } catch {
    return null
  }
}

/**
 * 查询时的分类(第五十八轮 · 检索路由)—— 与 classifyRecord **同一套门禁**,
 * 区别有二:① 返回**整份概率分布**(路由要的是"哪些类型过了线"、多意图取并集,
 * 不是"哪一个赢了");② 选项集走**查询级** —— 含 `route='size'`,这正是把尺码
 * 问题导向"尺码表 + LLM"之路的那个选项。`null` = 没判出来(未配置 / 无可问类型 /
 * 超时 / 报错),调用方据此走"不筛"路线 —— 分类失败绝不能阻塞检索。
 *
 * settings 由调用方传入:检索链路已经读过一次,没必要为门禁再读一遍存储。
 */
export async function classifyForQuery(
  question: string,
  settings: PddSettings,
): Promise<Record<string, number> | null> {
  return classifyGated(question, settings, 'query')
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
  // 记录级作用域:与 backfillState 的启动门禁同口径 —— 否则门禁说"有类型可问",
  // 跑起来却一个选项都没有(尺码不该被打标,这里必须排除它)。
  const options = opts.deps?.categories ?? classifiableCategories(await db.listCategories(), 'record')
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
        // 写回条数为 0 有两种成因,都算 skipped:① 行已不在(Dexie update 对缺失行不抛错,只返回 0);
        // ② 标准回答已被用户手工摆放(manual 守卫拒绝机器覆盖,见 db.updateGoldenCategory)。
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
