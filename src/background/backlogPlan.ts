/**
 * 待沉淀清单 · 纯聚合(v0.16)—— 不触碰 chrome/Dexie,便于单测。
 *
 * 口径(为什么这么切):
 *  - **按 questionHash 分组**,与全库其它地方同一把尺子:归一化后精确相等才合并。
 *    语义相近的不同问法暂不合并 —— 那需要向量聚类,代价与收益不成比例;
 *    页面上如实写明口径,好过悄悄把两条不相干的问题并成一条。
 *  - **已有标准回答的问题不进清单**:这本就是"还没沉淀"的清单,不是"问答大全"。
 *  - **一条回复都没有的问题不进清单**:本页签唯一动作是"提升为标准回答",
 *    没有回复就没有可提升的东西,列出来只是一行按不动的按钮。
 *  - **被忽略的问题不进清单**:用户说过"这条不用沉淀"。
 *  - 排序:出现次数倒序 → 最近出现时间倒序。次数才是"高频"的定义,
 *    只按时间排会让一次性的新问题盖住问了二十遍的老问题。
 */
import type { BacklogItem, BacklogReply } from '../types/messages'

/** 聚合入参:只取用得上的字段,好让调用方与测试都少造数据 */
export interface BacklogQaInput {
  id: string
  question: string
  questionHash: string
  questionTs: number
  sessionKey: string
}

export interface BacklogReplyInput {
  id: string
  qaId: string
  text: string
  contentHash: string
  ts: number
}

export interface BacklogPlanInput {
  qa: readonly BacklogQaInput[]
  replies: readonly BacklogReplyInput[]
  /** 已有标准回答的问题哈希(不进清单) */
  goldenHashes: ReadonlySet<string>
  /** 用户已忽略的问题哈希(不进清单) */
  ignoreHashes: ReadonlySet<string>
  /** 自检示例数据专用会话(统计口径一致:排除) */
  selfTestSessionKey: string
  /** 清单最多列出多少条 */
  limit: number
  /** 每条最多带出几条回复候选 */
  repliesPerItem: number
}

export interface BacklogPlanResult {
  items: BacklogItem[]
  /** 截断前的总数 */
  total: number
}

/** 按问题哈希分组 → 过滤 → 排序 → 截断 */
export function buildBacklog(input: BacklogPlanInput): BacklogPlanResult {
  const repliesByQa = new Map<string, BacklogReplyInput[]>()
  for (const r of input.replies) {
    const list = repliesByQa.get(r.qaId)
    if (list) list.push(r)
    else repliesByQa.set(r.qaId, [r])
  }

  interface Group {
    questionHash: string
    rows: BacklogQaInput[]
  }
  const groups = new Map<string, Group>()
  for (const q of input.qa) {
    if (q.sessionKey === input.selfTestSessionKey) continue
    if (input.goldenHashes.has(q.questionHash)) continue
    if (input.ignoreHashes.has(q.questionHash)) continue
    const g = groups.get(q.questionHash)
    if (g) g.rows.push(q)
    else groups.set(q.questionHash, { questionHash: q.questionHash, rows: [q] })
  }

  const items: BacklogItem[] = []
  for (const g of groups.values()) {
    // 代表 = 最近一次出现的那条:问题原文用最新问法,回复也取最新的
    let latest = g.rows[0]
    for (const q of g.rows) if (q.questionTs > latest.questionTs) latest = q

    // 回复按内容去重(跨同组的多条问答记录),最近优先
    const seen = new Set<string>()
    const replies: BacklogReply[] = []
    for (const row of g.rows) {
      for (const r of repliesByQa.get(row.id) ?? []) {
        if (!r.text || seen.has(r.contentHash)) continue
        seen.add(r.contentHash)
        replies.push({ id: r.id, qaId: r.qaId, text: r.text, ts: r.ts })
      }
    }
    // 一条回复都没有 → 没有可提升的内容,不进清单(见文件头口径)
    if (replies.length === 0) continue
    replies.sort((a, b) => b.ts - a.ts)

    items.push({
      questionHash: g.questionHash,
      question: latest.question,
      count: g.rows.length,
      lastTs: latest.questionTs,
      replies: replies.slice(0, input.repliesPerItem),
    })
  }

  items.sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
  return { items: items.slice(0, input.limit), total: items.length }
}
