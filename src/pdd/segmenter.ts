/**
 * 会话内分段状态机(设计文档 §5.3)—— 纯逻辑,不触碰 chrome/Dexie。
 *
 * 规则:
 *  - 买家文本连续累加为"未结问题段"(空白/换行连接);
 *  - 客服消息到达(文本或图片)→ 关闭未结段(落盘问答)并把回复挂到该问答;
 *  - 客服文本到达且无未结段 → 挂到本会话最近一条问答(补发/迟复情形);
 *  - idle(3 分钟无动静)/ leave → 关闭未结段为"无回复问题";
 *  - 顺序性由内部 promise 链保证(事件串行落盘,防 DB 竞态)。
 *
 * (2026-09-16 工程审查③:自 background/pddSegmenter.ts 迁入 pdd/ —— 平台领域
 *  纯逻辑与 DOM 解析/锚点同域;SW 侧调用方为 background/pddCapture.ts)
 */
import type { PddRole, ImageAttachment } from '../types/memory'
export interface SegMsg {
  sessionKey: string
  role: PddRole
  /** 正文;纯图片消息是占位符「[图片]」 */
  text: string
  /** 图片附件(客服/买家发图) */
  attachments?: ImageAttachment[]
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
  /** 段内第一条消息的平台幂等键(段开始时就定下,后续不覆盖) */
  firstMsgId?: string
  /**
   * 已有回复记录 id:段内后续消息带着它来,落盘端**更新**这一条而不是新建。
   * 这样"一句话 + 一张图"既能合并成一条,又能做到**即时入库**(不必等 flush)。
   */
  replyId?: string
  /** 图片附件;纯图片回复的 text 为「[图片]」 */
  attachments?: ImageAttachment[]
}

export interface SegmenterHooks {
  /** 问题段关闭时落盘;命中近期同内容问答时返回既有 qaId(回填幂等),否则新建 */
  closeQuestion(ctx: CloseQuestionCtx): Promise<string | undefined>
  /** 回复落盘(新建或按 replyId 更新);返回记录 id,段内后续消息据此继续更新 */
  attachReply(ctx: AttachReplyCtx): Promise<string | undefined>
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

/**
 * 未结的客服回复段(2026-10-24)。
 *
 * 客服真实的一次回复经常是多条消息:一句话 + 一张图、或连着补两句。
 * 这些**属于同一条回复**,不该在记忆里碎成三条。规则与买家侧对称:
 * 买家连续文本合并成问题,客服连续消息(文本/图片)合并成回复,
 * 直到买家再次开口、会话空闲或离开。
 */
interface OpenReply {
  /** 这段回复归属的问答(段开始时就定下来) */
  qaId: string
  texts: string[]
  attachments: ImageAttachment[]
  firstMsgId?: string
  lastTs: number
  /** 已经落盘的记录 id(首条消息落盘后拿到,后续消息据此更新) */
  replyId?: string
}

/** 未结段快照(纯 JSON 可入 chrome.storage.session;SW 休眠前导出、重启后恢复) */
export interface SegmenterSnapshot {
  /** 未结问题段;旧快照没有这一层(见 restoreState 的兼容分支) */
  questions?: Record<
    string,
    { buyerTexts: string[]; firstMsgId?: string; firstTs: number; buyerIdTail?: string }
  >
  /** 未结回复段;2026-10-24 新增(旧快照没有这一层,读取端兼容) */
  replies?: Record<string, OpenReply>
}

export class PddSegmenter {
  private readonly sessions = new Map<string, OpenQuestion>()
  /** 会话 → 未结的客服回复段 */
  private readonly replies = new Map<string, OpenReply>()
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

  /** 会话无动静收尾(3 分钟无新消息 → 落回复 + 无回复问题落盘) */
  onIdle(sessionKey: string): Promise<void> {
    return this.enqueue(async () => {
      this.replies.delete(sessionKey)
      await this.closeOpen(sessionKey)
    })
  }

  /** 会话失活/页面卸载 → 关闭未结段 */
  onLeave(sessionKey: string): Promise<void> {
    return this.enqueue(async () => {
      this.replies.delete(sessionKey)
      await this.closeOpen(sessionKey)
    })
  }

  /** 兜底:全量收尾(SW 收到批量 leave 等场景) */
  flushAll(): Promise<void> {
    // 在任务真正执行时读会话表:链上可能还有未落盘的 onMessage
    return this.enqueue(async () => {
      const keys = new Set([...this.sessions.keys(), ...this.replies.keys()])
      for (const key of keys) {
        this.replies.delete(key)
        await this.closeOpen(key)
      }
    })
  }

  /** 等待已入队事件全部落盘(返回当前链尾) */
  settled(): Promise<void> {
    return this.chain
  }

  /** 导出全部未结段快照(链上串行,深拷贝——调用方可持有没有被后续事件改写的顾虑) */
  exportState(): Promise<SegmenterSnapshot> {
    const p = this.chain.then(() => {
      const snap: SegmenterSnapshot = { questions: {}, replies: {} }
      for (const [key, open] of this.sessions) {
        snap.questions![key] = {
          buyerTexts: [...open.buyerTexts],
          firstMsgId: open.firstMsgId,
          firstTs: open.firstTs,
          buyerIdTail: open.buyerIdTail,
        }
      }
      for (const [key, rep] of this.replies) {
        snap.replies![key] = {
          ...rep,
          texts: [...rep.texts],
          attachments: [...rep.attachments],
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
      this.replies.clear()
      // 兼容旧快照:2026-10-24 之前,快照本身就是"会话 → 问题段"的裸映射
      const raw = (state ?? {}) as Partial<SegmenterSnapshot> & Record<string, unknown>
      const questions = (raw.questions ?? raw) as Record<
        string,
        { buyerTexts: string[]; firstMsgId?: string; firstTs: number; buyerIdTail?: string }
      >
      for (const [key, open] of Object.entries(questions)) {
        if (!Array.isArray(open?.buyerTexts)) continue
        this.sessions.set(key, {
          buyerTexts: [...open.buyerTexts],
          firstMsgId: open.firstMsgId,
          firstTs: open.firstTs,
          buyerIdTail: open.buyerIdTail,
        })
      }
      // ⚠️ **未结回复段不恢复**(2026-10-24):回复是逐条即时写库的,段只用于"后续消息继续合并"。
      // 若把休眠前的段搬回来,页面重放/跨标签页的旧消息可能被并入一条早已落盘的记录,
      // 实机症状是"新回复记到了旧问题下"。宁可让重启后的下一条消息另起一条回复 —— 那只是
      // 一次拆分,不会写错归属。
    })
  }

  private async handleMessage(msg: SegMsg): Promise<void> {
    const { sessionKey, role } = msg

    if (role === 'buyer') {
      // 买家再次开口 = 上一段客服回复到此为止(段内消息都已即时落盘,这里只需丢弃)
      this.replies.delete(sessionKey)
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

    // agent:一段连续回复合并成一条(文本与图片同属一条)。
    // 段开始时才关闭未结问题段 —— 归属的问答在那一刻定下来,后续补发的话和图都挂它
    let seg = this.replies.get(sessionKey)
    if (!seg) {
      const qaId = (await this.closeOpen(sessionKey)) ?? (await this.hooks.recentQaId(sessionKey))
      if (!qaId) return // 会话尚无任何问答(如开场欢迎语)且无可挂载目标 → 丢弃
      seg = { qaId, texts: [], attachments: [], firstMsgId: msg.msgId, lastTs: msg.ts }
      this.replies.set(sessionKey, seg)
    }
    if (msg.text) seg.texts.push(msg.text)
    if (msg.attachments?.length) seg.attachments.push(...msg.attachments)
    seg.lastTs = msg.ts
    if (msg.msgId && !seg.firstMsgId) seg.firstMsgId = msg.msgId

    // **即时落盘**:每条客服消息都把这"当前合并结果"写一次(首条新建、后续更新),
    // 这样面板里立刻能看到,不必等买家开口或 3 分钟空闲
    const id = await this.hooks.attachReply({
      sessionKey,
      qaId: seg.qaId,
      text: seg.texts.join('\n').trim(),
      ts: seg.lastTs,
      msgId: seg.firstMsgId,
      firstMsgId: seg.firstMsgId,
      ...(seg.replyId ? { replyId: seg.replyId } : {}),
      ...(seg.attachments.length ? { attachments: seg.attachments } : {}),
    })
    if (id) seg.replyId = id
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
