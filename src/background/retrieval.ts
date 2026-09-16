/**
 * 混合检索纯逻辑(设计文档 §6.2)—— 不触碰 chrome/Dexie/offscreen。
 *
 * 管线:候选池(按来源类型阈值过滤原始余弦)→ 双路排名(向量×时间衰减 /
 * BM25)→ RRF 融合 → 展开回复/知识正文候选 → 同内容折叠 → 类别配额装配
 * (标准回答全部 / 历史最近 2 / 知识库 1,金标准层级置顶可关)。
 *
 * 设计要点:
 *  - 检索锚 = 问题文本(买家问题 vs 历史/金标准问题);回复正文不向量化;
 *  - 时间衰减只作用于排序(向量路排名),不污染阈值判定,避免老记录被卡死;
 *  - BM25 为辅助信号:只参与排名融合,不做语义门槛;
 *  - 折叠现实来源 = 不同问答下相同回复文本 / 金标准与历史同文本
 *    (同一条问答内部已在捕获时按 contentHash 幂等)。
 */
import { hashText } from '../utils/text'
import type { Suggestion } from '../types/messages'

export type { Suggestion }

export type SourceKind = 'golden' | 'knowledge' | 'history'

/** 参与检索的源(金标准 / 知识库 / 问答记录)—— 只带纯数据,向量由调用方并行给出 */
export interface RetSource {
  id: string
  kind: SourceKind
  /** 原始问题全文(候选展示"原始问题摘要"用);知识库 = 标题 */
  question: string
  /** 问题时间(历史=questionTs,金标准/知识库=updatedAt) */
  questionTs: number
}

/** 展开候选用的回复条目 */
export interface RetReply {
  qaId: string
  id: string
  text: string
  ts: number
}

/** 过阈源 + 融合得分 */
export interface RankedSource {
  source: RetSource
  /** 原始余弦(0~1 语义,阈值判定与展示用) */
  cosine: number
  /** RRF 融合分(排序用,无界) */
  rrfScore: number
}

/** 时间衰减半衰期(天):30 天前的历史问答权重减半。可调参数,暂不进设置 */
export const HALF_LIFE_DAYS = 30

const MS_PER_DAY = 86_400_000
const RRF_K = 60
const BM25_K1 = 1.5
const BM25_B = 0.75

// ─── 基础函数 ─────────────────────────────────────────────────────────────────

/** 余弦相似度(向量已 L2 归一化 → 点积) */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += a[i] * b[i]
  return dot
}

/**
 * 检索分词:中文按相邻二字(bigram),ASCII 词/数字整体保留并小写,
 * 其余(标点/空白)剔除;单字中文串退化为 unigram。
 * BM25 建索引与查询共用;查询多为 5~30 字短句,bigram 已够判别。
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  for (const run of lower.match(/[一-鿿]+/g) ?? []) {
    if (run.length === 1) {
      tokens.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  for (const w of lower.match(/[a-z0-9]+/g) ?? []) tokens.push(w)
  return tokens
}

/** 标准 BM25 打分(返回与 docsTokens 对齐的分数数组) */
export function bm25Scores(docsTokens: string[][], queryTokens: string[]): number[] {
  const n = docsTokens.length
  if (n === 0) return []
  const avgdl = docsTokens.reduce((s, d) => s + d.length, 0) / n || 1

  // df 表
  const df = new Map<string, number>()
  for (const doc of docsTokens) {
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const idf = (t: string): number => {
    const d = df.get(t) ?? 0
    return Math.log(1 + (n - d + 0.5) / (d + 0.5))
  }

  // tf 表(按 doc 缓存)
  const tfs = docsTokens.map((doc) => {
    const m = new Map<string, number>()
    for (const t of doc) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  })

  const scores = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    const tf = tfs[i]
    const dl = docsTokens[i].length
    let s = 0
    for (const t of queryTokens) {
      const f = tf.get(t)
      if (!f) continue
      s += idf(t) * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / avgdl)))
    }
    scores[i] = s
  }
  return scores
}

/**
 * RRF 融合:rankLists 每路为文档下标按名次排列;未上榜文档该路计 0 分。
 * 返回与文档下标对齐的融合分数。
 */
export function rrfFuse(rankLists: number[][]): number[] {
  // 最大下标用循环求(spread 有 V8 实参上限,几万条候选过阈时 Math.max(...flat) 直接栈溢出)
  let maxIdx = -1
  for (const list of rankLists) {
    for (const idx of list) if (idx > maxIdx) maxIdx = idx
  }
  const fused = new Array<number>(maxIdx + 1).fill(0)
  for (const list of rankLists) {
    for (let rank = 0; rank < list.length; rank++) {
      fused[list[rank]] += 1 / (RRF_K + rank + 1)
    }
  }
  return fused
}

/** 半衰期时间衰减:age = 一个半衰期 → 0.5 */
export function timeDecay(ts: number, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, (now - ts) / MS_PER_DAY)
  return Math.pow(0.5, ageDays / halfLifeDays)
}

// ─── 管线 ─────────────────────────────────────────────────────────────────────

/**
 * 阈值过滤 + 双路排名 + RRF 融合。
 * 阈值按源独立(2026-09-16):历史 simThreshold(默认 0.5)、
 * 金标准 goldenThreshold(默认 0.4,放宽)、知识库 kbThreshold(默认 0.4,
 * 同档放宽但独立可调)——后两者均为人工精选源,宁多勿漏。
 * 返回按 rrfScore 降序排列。
 */
export function rankCandidates(
  entries: Array<{ source: RetSource; vec: Float32Array }>,
  query: string,
  qvec: Float32Array,
  thresholds: { golden: number; history: number; knowledge: number },
  now: number,
): RankedSource[] {
  // 1. 阈值过滤(原始余弦;金标准/知识库放宽,各自独立)
  const survivors: Array<{ source: RetSource; cosine: number }> = []
  for (const { source, vec } of entries) {
    const cosine = Math.max(0, Math.min(1, cosineSim(qvec, vec)))
    const gate =
      source.kind === 'history'
        ? thresholds.history
        : source.kind === 'knowledge'
          ? thresholds.knowledge
          : thresholds.golden
    if (cosine >= gate) survivors.push({ source, cosine })
  }
  if (survivors.length === 0) return []

  // 2a. 向量路:cosine × 时间衰减 排名
  const byVector = [...survivors.keys()].sort((i, j) => {
    const di =
      survivors[j].cosine * timeDecay(survivors[j].source.questionTs, now, HALF_LIFE_DAYS) -
      survivors[i].cosine * timeDecay(survivors[i].source.questionTs, now, HALF_LIFE_DAYS)
    return di || survivors[j].cosine - survivors[i].cosine
  })

  // 2b. BM25 路:问题文本词袋排名
  const docsTokens = survivors.map((s) => tokenize(s.source.question))
  const bm = bm25Scores(docsTokens, tokenize(query))
  const byBm25 = [...survivors.keys()].sort((i, j) => bm[j] - bm[i])

  // 3. RRF 融合
  const fused = rrfFuse([byVector, byBm25])

  return survivors
    .map((s, i) => ({ ...s, rrfScore: fused[i] }))
    .sort((a, b) => b.rrfScore - a.rrfScore || b.cosine - a.cosine)
}

/**
 * 推荐回复面板类别配额(2026-09-16 用户指定,推荐回复与快捷键面板共用):
 *  - 标准回答:有则展示,至多 3 条(按设置时间倒序);
 *  - 历史:top-k=3,取**最近** 3 条(按回复时间倒序,而非按相关度);
 *  - 知识库:top-k=3,按相关度最高取 3 条。
 */
export const PANEL_QUOTA = { golden: 3, history: 3, knowledge: 3 } as const

/**
 * 候选组装:过阈源展开为回复候选 → 同内容折叠(hashText)→ 按类别配额装配。
 * getReplies / getGoldenAnswer / getKbContent 由调用方注入(DAO 或测试桩;
 * getKbContent 缺省视为知识库为空)。
 * 组内胜者:金标准 > 知识库 > 历史;同 kind 取父问题余弦最高,平分取最新回复时间。
 */
export function assembleSuggestions(
  ranked: RankedSource[],
  opts: {
    getReplies: (qaId: string) => RetReply[]
    getGoldenAnswer: (goldenId: string) => string
    getKbContent?: (id: string) => string
    goldenPriority: boolean
    now: number
  },
): Suggestion[] {
  interface Cand extends Suggestion {
    ts: number
    rrfScore: number
  }
  const getKb = opts.getKbContent ?? (() => '')

  const candidates: Cand[] = []
  for (const r of ranked) {
    if (r.source.kind === 'golden') {
      const answer = opts.getGoldenAnswer(r.source.id)
      if (!answer) continue
      candidates.push({
        kind: 'golden',
        text: answer,
        sourceQuestion: r.source.question,
        score: r.cosine,
        sourceId: r.source.id,
        replyId: undefined,
        ts: r.source.questionTs,
        rrfScore: r.rrfScore,
        foldCount: 1,
      })
      continue
    }
    if (r.source.kind === 'knowledge') {
      const content = getKb(r.source.id)
      if (!content) continue
      candidates.push({
        kind: 'knowledge',
        text: content,
        sourceQuestion: r.source.question,
        score: r.cosine,
        sourceId: r.source.id,
        replyId: undefined,
        ts: r.source.questionTs,
        rrfScore: r.rrfScore,
        foldCount: 1,
      })
      continue
    }
    for (const reply of opts.getReplies(r.source.id)) {
      if (!reply.text) continue
      candidates.push({
        kind: 'history',
        text: reply.text,
        sourceQuestion: r.source.question,
        score: r.cosine,
        sourceId: r.source.id,
        replyId: reply.id,
        ts: reply.ts,
        rrfScore: r.rrfScore,
        foldCount: 1,
      })
    }
  }

  // 同内容折叠:hashText 相同即同内容;金标准优先,其次历史,再次高分,平分取最新
  const groups = new Map<string, Cand[]>()
  for (const c of candidates) {
    const key = hashText(c.text)
    const g = groups.get(key)
    if (g) g.push(c)
    else groups.set(key, [c])
  }

  // 层级:金标准(人工沉淀,最准)> 历史(真实话术,打招呼等高频场景覆盖最好)>
  // 知识库(文档片段,预设少;阈值独立放宽,置顶优先级最低)
  const foldWinnerRank = (k: Suggestion['kind']): number =>
    k === 'golden' ? 0 : k === 'history' ? 1 : 2

  const winners = [...groups.values()].map((g): Cand => {
    if (g.length === 1) return g[0]
    const top = [...g].sort(
      (a, b) =>
        foldWinnerRank(a.kind) - foldWinnerRank(b.kind) ||
        b.score - a.score ||
        b.ts - a.ts,
    )[0]
    return { ...top, foldCount: g.length }
  })

  // 排序:金标准 > 历史 > 知识库(可选置顶)→ 融合分 → 原始余弦 → 新
  const tier = (c: Cand): number =>
    opts.goldenPriority ? foldWinnerRank(c.kind) : 1
  const basic = [...winners].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      b.rrfScore - a.rrfScore ||
      b.score - a.score ||
      b.ts - a.ts,
  )

  // ── 类别配额装配(2026-09-16 用户指定,替代 2026-09-15 的"标准全量+历史2+知识1"):
  // 标准回答至多 3 条(设置时间倒序);历史取最近 3 条(回复时间倒序,与相关度无关);
  // 知识库取相关度最高 3 条。配额在折叠后的胜者池上选取,
  // 某类别候选存在就必然占位,无需再做事后补位。
  const ordered = groupGoldenAnswersByRecency(basic)
  const goldenPicked = ordered.filter((c) => c.kind === 'golden').slice(0, PANEL_QUOTA.golden)
  const historyPicked = ordered
    .filter((c) => c.kind === 'history')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, PANEL_QUOTA.history)
  const knowledgePicked = ordered
    .filter((c) => c.kind === 'knowledge')
    .sort((a, b) => b.score - a.score || b.ts - a.ts)
    .slice(0, PANEL_QUOTA.knowledge)
  const byQuota = [...goldenPicked, ...historyPicked, ...knowledgePicked]

  // goldenPriority 关闭时不按层级置顶,在配额选出的候选上按融合分混排
  const picked = opts.goldenPriority
    ? byQuota
    : [...byQuota].sort(
        (a, b) => b.rrfScore - a.rrfScore || b.score - a.score || b.ts - a.ts,
      )

  return picked
    .map((c) => ({
      kind: c.kind,
      text: c.text,
      sourceQuestion: c.sourceQuestion,
      score: c.score,
      sourceId: c.sourceId,
      replyId: c.replyId,
      foldCount: c.foldCount,
    }))
}

/**
 * 同一问题的多条标准回答归为一组:组内按设置时间倒序(**最近设置的靠前**),
 * 组的位置取该组名次最高成员的位置;其余候选保持原序。
 * 依据 2026-09-15 用户口径:一个问题的多条标准回答共同参与检索(均为独立检索源,
 * 问题向量相同 → 原始余弦天然一致),展示顺序只按设置时间倒序最有意义。
 */
function groupGoldenAnswersByRecency<
  T extends { kind: Suggestion['kind']; sourceQuestion: string; ts: number },
>(list: T[]): T[] {
  if (!list.some((c) => c.kind === 'golden')) return list
  const keyCache = new Map<T, string>()
  const keyOf = (c: T): string => {
    let k = keyCache.get(c)
    if (k === undefined) {
      k = hashText(c.sourceQuestion)
      keyCache.set(c, k)
    }
    return k
  }

  const out: T[] = []
  const used = new Set<T>()
  for (const c of list) {
    if (used.has(c)) continue
    if (c.kind !== 'golden') {
      used.add(c)
      out.push(c)
      continue
    }
    const group = list.filter((x) => !used.has(x) && x.kind === 'golden' && keyOf(x) === keyOf(c))
    for (const g of group) used.add(g)
    out.push(...group.sort((a, b) => b.ts - a.ts))
  }
  return out
}
