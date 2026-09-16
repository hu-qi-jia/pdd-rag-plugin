/**
 * 会话内分段状态机(设计文档 §5.3)—— 纯逻辑,不触碰 chrome/Dexie。
 *
 * 规则:
 *  - 买家文本连续累加为"未结问题段"(空白/换行连接);
 *  - 客服文本到达 → 关闭未结段(落盘问答)并把回复挂到该问答;
 *  - 客服文本到达且无未结段 → 挂到本会话最近一条问答(补发/迟复情形);
 *  - idle(3 分钟无动静)/ leave → 关闭未结段为"无回复问题";
 *  - 顺序性由内部 promise 链保证(事件串行落盘,防 DB 竞态)。
 *
 * (2026-09-16 工程审查③:自 background/pddSegmenter.ts 迁入 pdd/ —— 平台领域
 *  纯逻辑与 DOM 解析/锚点同域;SW 侧调用方为 background/pddCapture.ts)
 */
import type { PddRole } from '../types/memory'
export interface SegMsg {
  sessionKey: string
  role: PddRole
  text: string
  msgId?: string
  ts: number
  /** 买家 uid 尾号(仅首条买家消息携带,落盘冗余用) */
  buyerIdTail?: string
}

export interface CloseQuestionCtx {
  sessionKey: string
  buyerIdTail?: string
  question: string
  /** 问题段首条买家消息的 msgId —— 落库为幂等锚(后续并入的买家消息不覆盖) */
  firstMsgId?: string
  firstTs: number
}

export interface AttachReplyCtx {
  sessionKey: string
  qaId: string
  text: string
  ts: number
  msgId?: string
}

export interface SegmenterHooks {
  /** 问题段关闭时落盘;命中近期同内容问答时返回既有 qaId(回填幂等),否则新建 */
  closeQuestion(ctx: CloseQuestionCtx): Promise<string | undefined>
  /** 回复挂载到 qaId(内部按归一化哈希幂等) */
  attachReply(ctx: AttachReplyCtx): Promise<void>
  /** 无未结问题段时,找本会话最近一条问答 */
  recentQaId(sessionKey: string): Promise<string | undefined>
}

interface OpenQuestion {
  buyerTexts: string[]
  /** 首条买家消息的 msgId(开段时定,不随后续消息变化) */
  firstMsgId?: string
  firstTs: number
  buyerIdTail?: string
}

/** 未结段快照(纯 JSON 可入 chrome.storage.session;SW 休眠前导出、重启后恢复) */
export type SegmenterSnapshot = Record<
  string,
  { buyerTexts: string[]; firstMsgId?: string; firstTs: number; buyerIdTail?: string }
>

export class PddSegmenter {
  private readonly sessions = new Map<string, OpenQuestion>()
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly hooks: SegmenterHooks) {}

  /** 全部事件经此串行化,保证与 DB 写操作的相对顺序 */
  private enqueue(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task).catch((err) => {
      console.warn('[PDD CS] segmenter task failed:', err)
    })
    return this.chain
  }

  /** 新消息(已过消息级去重的调用方仅把新消息送进来) */
  onMessage(msg: SegMsg): Promise<void> {
    return this.enqueue(() => this.handleMessage(msg))
  }

  /** 会话无动静收尾(3 分钟无新消息 → 无回复问题落盘) */
  onIdle(sessionKey: string): Promise<void> {
    return this.enqueue(async () => {
      await this.closeOpen(sessionKey)
    })
  }

  /** 会话失活/页面卸载 → 关闭未结段 */
  onLeave(sessionKey: string): Promise<void> {
    return this.enqueue(async () => {
      await this.closeOpen(sessionKey)
    })
  }

  /** 兜底:全量收尾(SW 收到批量 leave 等场景) */
  flushAll(): Promise<void> {
    // 在任务真正执行时读会话表:链上可能还有未落盘的 onMessage
    return this.enqueue(async () => {
      const keys = [...this.sessions.keys()]
      for (const key of keys) await this.closeOpen(key)
    })
  }

  /** 等待已入队事件全部落盘(返回当前链尾) */
  settled(): Promise<void> {
    return this.chain
  }

  /** 导出全部未结段快照(链上串行,深拷贝——调用方可持有没有被后续事件改写的顾虑) */
  exportState(): Promise<SegmenterSnapshot> {
    const p = this.chain.then(() => {
      const snap: SegmenterSnapshot = {}
      for (const [key, open] of this.sessions) {
        snap[key] = {
          buyerTexts: [...open.buyerTexts],
          firstMsgId: open.firstMsgId,
          firstTs: open.firstTs,
          buyerIdTail: open.buyerIdTail,
        }
      }
      return snap
    })
    // 值任务也走链:导出本身抛错不冻结后续事件
    this.chain = p.then(
      () => undefined,
      (err) => {
        console.warn('[PDD CS] segmenter exportState failed:', err)
      },
    )
    return p
  }

  /** 从快照恢复未结段(SW 重启后调用;覆盖现有表,恢复的段为拷贝) */
  restoreState(state: SegmenterSnapshot): Promise<void> {
    return this.enqueue(async () => {
      this.sessions.clear()
      for (const [key, open] of Object.entries(state ?? {})) {
        if (!Array.isArray(open?.buyerTexts)) continue
        this.sessions.set(key, {
          buyerTexts: [...open.buyerTexts],
          firstMsgId: open.firstMsgId,
          firstTs: open.firstTs,
          buyerIdTail: open.buyerIdTail,
        })
      }
    })
  }

  private async handleMessage(msg: SegMsg): Promise<void> {
    const { sessionKey, role } = msg

    if (role === 'buyer') {
      const open = this.sessions.get(sessionKey)
      if (open) {
        // 客服未回复前,连续买家文本并入同一问题段
        if (!open.buyerTexts.includes(msg.text)) open.buyerTexts.push(msg.text)
      } else {
        this.sessions.set(sessionKey, {
          buyerTexts: [msg.text],
          firstMsgId: msg.msgId,
          firstTs: msg.ts,
          buyerIdTail: msg.buyerIdTail,
        })
      }
      return
    }

    // agent:先关闭未结问题段,回复挂到该问答;无未结段则挂最近问答
    const closedQaId = await this.closeOpen(sessionKey)
    const qaId = closedQaId ?? (await this.hooks.recentQaId(sessionKey))
    if (!qaId) return // 会话尚无任何问答(如开场欢迎语)且无可挂载目标 → 丢弃
    await this.hooks.attachReply({
      sessionKey,
      qaId,
      text: msg.text,
      ts: msg.ts,
      msgId: msg.msgId,
    })
  }

  /** 关闭未结问题段并落盘为问答;返回该问答 id(无未结段返回 undefined) */
  private async closeOpen(sessionKey: string): Promise<string | undefined> {
    const open = this.sessions.get(sessionKey)
    if (!open) return undefined
    this.sessions.delete(sessionKey)

    const question = open.buyerTexts.join('\n').trim()
    if (!question) return undefined

    return this.hooks.closeQuestion({
      sessionKey,
      buyerIdTail: open.buyerIdTail,
      question,
      firstMsgId: open.firstMsgId,
      firstTs: open.firstTs,
    })
  }
}
