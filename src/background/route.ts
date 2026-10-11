/**
 * 检索路线决策(第五十八轮)—— **纯逻辑,无 IO、无 chrome、无网络**。
 *
 * 判据是"答案从哪来",不是话题:
 *  - `size-only`:买家在问自己的尺码 → 历史回复不可复用(答案取决于他的身高体重),
 *    不检索,改走"尺码表整篇原文 + LLM 生成";
 *  - `filter`:收窄到类型集合对应的池子;
 *  - `no-filter`:jev 不可用 / 判不准 → 与今天完全一致。
 */
import { UNCATEGORIZED_CATEGORY_ID } from '../shared/constants'
import type { CategoryRecord } from '../types/memory'
import type { RankedSource } from './retrieval'

export type RouteDecision =
  /** 不过滤:jev 不可用、或概率全低于阈值。检索行为与今天逐字节相同 */
  | { kind: 'no-filter' }
  /** 纯尺码:池为空,不检索,走尺码生成 */
  | { kind: 'size-only' }
  /** 收窄到 allowed;`picked` 里可能同时含尺码类型(那要额外挂生成行) */
  | { kind: 'filter'; allowed: Set<string>; picked: string[] }

/**
 * 池子 = picked 中的 retrieve 型  ∪  所有 `filterable === false` 的类型。
 *
 * 为什么后半边不可省:未分类与迁移来的旧文件夹**不参与 jev 分类**,它们无法
 * 通过"类型匹配"被选中。若把它们排除,里面的条目将**在任何查询下都搜不到** ——
 * 纯召回倒退。
 */
export function filterAllowed(categories: CategoryRecord[], picked: string[]): Set<string> {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const allowed = new Set<string>()
  for (const id of picked) {
    if (byId.get(id)?.route === 'retrieve') allowed.add(id)
  }
  for (const c of categories) {
    if (!c.filterable) allowed.add(c.id)
  }
  // 显式兜一层:不依赖"未分类恰好 filterable=false"这个巧合
  allowed.add(UNCATEGORIZED_CATEGORY_ID)
  return allowed
}

/**
 * 类型集合里是否含「尺码」型。
 *
 * 混合意图(spec §7.1【D】)的判据:"什么时候发货,165 穿多大" 这类问题类型集合
 * 同时含订单物流与尺码推荐 —— 池照常算(订单物流的候选要出来),**额外**挂一条
 * 尺码生成行。纯尺码【C】由 decideRoute 单独判,不走这里。
 */
export function pickedHasSize(categories: CategoryRecord[], picked: string[]): boolean {
  const byId = new Map(categories.map((c) => [c.id, c]))
  return picked.some((id) => byId.get(id)?.route === 'size')
}

/**
 * 概率 → 路线。
 *
 * `probabilities` 为 `null` 表示 jev 不可用(未配置 / 超时 / 报错)—— 调用方
 * 已经吞掉了错误,这里只负责"没判出来就不筛"。
 *
 * 多意图:取**概率 ≥ 阈值的所有类型**,不取胜者。概率分散既可能是"判不准"、
 * 也可能是"买家一次问了两件事",而两种情况下"把池子放宽"都是对的 ——
 * 所以不需要两套逻辑,也不需要额外问问题。
 */
export function decideRoute(
  categories: CategoryRecord[],
  probabilities: Record<string, number> | null,
  threshold: number,
): RouteDecision {
  if (probabilities === null) return { kind: 'no-filter' }

  const picked = Object.entries(probabilities)
    .filter(([, p]) => p >= threshold)
    .map(([id]) => id)
  // 全低于阈值 → 判不准,别乱筛
  if (picked.length === 0) return { kind: 'no-filter' }

  const byId = new Map(categories.map((c) => [c.id, c]))
  // 纯尺码:集合里一个 retrieve 型都没有 → 池为空
  const hasRetrieve = picked.some((id) => byId.get(id)?.route === 'retrieve')
  if (!hasRetrieve) return { kind: 'size-only' }

  return { kind: 'filter', allowed: filterAllowed(categories, picked), picked }
}

/**
 * 切片(A,带 `allowed`)与全池(B,不带)之间放宽与否的**余弦余量**。
 * 单位是原始余弦(0~1),不是 RRF 分 —— 见 `pickByMargin`。
 */
export const FILTER_MARGIN = 0.05

/** 一份排名结果的最高原始余弦(空结果记 0;余弦本身已夹在 0~1) */
function topCosine(ranked: RankedSource[]): number {
  let max = 0
  for (const r of ranked) if (r.cosine > max) max = r.cosine
  return max
}

/**
 * 两遍 pass 的取舍(裁决 R11)。
 *
 * 判据要回答的是"**切片是否真的更优**",而不是"切片是否为空"。
 *
 * 切片是全池的**子集**,所以它的最高余弦**不可能超过**全池 —— 真正可判的只有
 * 一个方向:**全池的最高余弦比切片高出不到 `FILTER_MARGIN` 时,切片不逊于全池,
 * 就用切片;一旦全池里有明显更强的候选(高出 ≥ 余量),说明正确答案大概率落在
 * 切片之外,放宽到全池。**
 *
 * 为什么不是"池子空了才放宽"(R11 的原话):把价格类问题误判成订单物流时,
 * 池子**不是空的** —— 它装着几条貌似合理的订单物流候选,所以空池判据**永远不会
 * 触发**,而正确答案被静默过滤掉。
 *
 * `no-filter` 路线传进来的 `narrowed === full`(同一引用),差值为 0 → 原样返回,
 * 与今天逐字节一致,且不多花第二遍排名。
 */
export function pickByMargin(narrowed: RankedSource[], full: RankedSource[]): RankedSource[] {
  return topCosine(full) - topCosine(narrowed) < FILTER_MARGIN ? narrowed : full
}
