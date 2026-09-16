/**
 * handlePddIngest 会话解析与落盘胶水测试。
 * db/offscreen/settings 全 mock:只验证路由逻辑(会话解析 → 分段器 → hooks 调用)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { chromeMock } from '../../__mocks__/chrome'
import type { QaRecord, ReplyRecord } from '../../../src/types/memory'
vi.mock('../../../src/background/db', () => {
  // 有状态最小 mock:addQaRecord 存入内存,getQaRecord 可读回(孤回复守卫需要)
  const qaStore = new Map<string, unknown>()
  return {
    db: {
      findLatestQaByHash: vi.fn(async () => undefined),
      findQaByMsgId: vi.fn(async (_msgId: string): Promise<QaRecord | undefined> => undefined),
      findReplyByMsgId: vi.fn(
        async (_msgId: string): Promise<ReplyRecord | undefined> => undefined,
      ),
      addQaRecord: vi.fn(async (r: { id: string }) => {
        qaStore.set(r.id, r)
      }),
      getQaRecord: vi.fn(async (id: string) => qaStore.get(id)),
      hasReplyContent: vi.fn(async () => false),
      addReply: vi.fn(async () => undefined),
      recountReplyCount: vi.fn(async () => undefined),
      latestQaOfSession: vi.fn(async () => undefined),
      logError: vi.fn(async () => undefined),
    },
  }
})

vi.mock('../../../src/background/offscreen', () => ({
  queueEmbedding: vi.fn(),
}))

vi.mock('../../../src/background/settings', () => ({
  loadSettings: vi.fn(async () => ({
    directFillEnabled: false,
    simThreshold: 0.5,
    goldenThreshold: 0.4,
    retentionDays: 90,
    goldenPriorityEnabled: true,
  })),
}))

import { db } from '../../../src/background/db'
import type { PddCapturedEvent, PddIngestRequest } from '../../../src/types/messages'

type Ingest = (m: PddIngestRequest, tabId?: number) => Promise<{
  queued: number
  skipped: number
  detail?: string
}>

async function freshIngest(): Promise<Ingest> {
  vi.resetModules()
  const mod = await import('../../../src/background/pddCapture')
  const raw = mod.handlePddIngest
  return async (m, tabId) => {
    const resp = await raw(m, tabId)
    return resp.payload
  }
}

function msgEvents(sessionKey: string | undefined, level: 'event' | 'msg') {
  // 同一 sessionKey 分别按事件级 / 消息级两种形态构造
  const base = {
    source: 'dom' as const,
    role: 'buyer' as const,
    text: '这个能开发票吗?',
    msgId: `m-${Math.random().toString(36).slice(2)}`,
    ts: Date.now(),
  }
  const ev: PddCapturedEvent =
    level === 'event'
      ? { kind: 'msg', sessionKey, buyerIdTail: sessionKey?.slice(-4), msg: base }
      : { kind: 'msg', msg: { ...base, sessionKey, buyerIdTail: sessionKey?.slice(-4) } }
  return [ev]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handlePddIngest: 会话解析', () => {
  it('★ 回归:事件级 sessionKey 的消息应进入分段器并落盘(DOM 路线真实形态)', async () => {
    const ingest = await freshIngest()
    const resp = await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          ...msgEvents('u1875210170836', 'event'),
          {
            kind: 'msg',
            sessionKey: 'u1875210170836',
            buyerIdTail: '0836',
            msg: {
              source: 'dom',
              role: 'agent',
              text: '可以的,支持电子发票。',
              msgId: 'a-1',
              ts: Date.now(),
            },
          },
        ],
      },
    })

    expect(resp.queued).toBe(2)
    expect(resp.skipped).toBe(0)
    expect(db.addQaRecord).toHaveBeenCalledTimes(1)
    expect(vi.mocked(db.addQaRecord).mock.calls[0][0]).toMatchObject({
      sessionKey: 'u1875210170836',
      buyerIdTail: '0836',
      question: '这个能开发票吗?',
    })
    expect(db.addReply).toHaveBeenCalledTimes(1)
  })

  it('消息级 sessionKey(net 形态)同样入段落盘', async () => {
    const ingest = await freshIngest()
    const mkMsg = (role: 'buyer' | 'agent', text: string, id: string) => ({
      source: 'dom' as const,
      role,
      text,
      msgId: id,
      ts: Date.now(),
    })
    const resp = await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          {
            kind: 'msg',
            msg: { ...mkMsg('buyer', '能便宜点吗?', 'nm-1'), sessionKey: 'u9999' },
          },
          {
            kind: 'msg',
            msg: { ...mkMsg('agent', '亲,已经是活动价了哦。', 'nm-2'), sessionKey: 'u9999' },
          },
        ],
      },
    })

    expect(resp.queued).toBe(2)
    expect(db.addQaRecord).toHaveBeenCalledTimes(1)
    expect(vi.mocked(db.addQaRecord).mock.calls[0][0]).toMatchObject({ sessionKey: 'u9999' })
  })

  it('无 sessionKey 且无来源 tab → nosession 跳过(守卫保留)', async () => {
    const ingest = await freshIngest()
    const resp = await ingest({
      type: 'PDD_INGEST',
      payload: { events: msgEvents(undefined, 'event') },
    })

    expect(resp.queued).toBe(0)
    expect(resp.skipped).toBe(1)
    expect(resp.detail).toContain('nosession=1')
    expect(db.addQaRecord).not.toHaveBeenCalled()
  })
})

describe('handlePddIngest: msgId 库级幂等(SW 重启后重放防御)', () => {
  it('★ 回归:SW 重启后 content 重放已入库消息 → 库级查重拦截,不重复落盘', async () => {
    const ingest = await freshIngest()
    // 内存 seenMsgIds 随 SW 休眠已丢失(mock 里 find* 命中既有记录 = 库里已有)
    vi.mocked(db.findQaByMsgId).mockResolvedValue({ id: 'qa-exist' } as QaRecord)
    vi.mocked(db.findReplyByMsgId).mockResolvedValue({ id: 'r-exist' } as ReplyRecord)
    const ts = Date.now()
    const resp = await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          {
            kind: 'msg',
            sessionKey: 'u8888',
            buyerIdTail: '8888',
            msg: { source: 'dom', role: 'buyer', text: '能开发票吗?', msgId: 'b-replay', ts },
          },
          {
            kind: 'msg',
            sessionKey: 'u8888',
            buyerIdTail: '8888',
            msg: {
              source: 'dom',
              role: 'agent',
              text: '可以的,支持电子发票。',
              msgId: 'a-replay',
              ts,
            },
          },
        ],
      },
    })

    expect(resp.queued).toBe(0)
    expect(resp.detail).toContain('dupmsgid=2')
    expect(db.addQaRecord).not.toHaveBeenCalled()
    expect(db.addReply).not.toHaveBeenCalled()
  })

  it('新建问答/回复记录携带平台 msgId(供下次库级查重)', async () => {
    const ingest = await freshIngest()
    // 上一测试用 mockResolvedValue 覆盖过实现(clearAllMocks 不还原),显式恢复"未入库"
    vi.mocked(db.findQaByMsgId).mockResolvedValue(undefined)
    vi.mocked(db.findReplyByMsgId).mockResolvedValue(undefined)
    const ts = Date.now()
    await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          {
            kind: 'msg',
            sessionKey: 'u7777',
            buyerIdTail: '7777',
            msg: { source: 'dom', role: 'buyer', text: '多久发货?', msgId: 'b-new', ts },
          },
          {
            kind: 'msg',
            sessionKey: 'u7777',
            buyerIdTail: '7777',
            msg: { source: 'dom', role: 'agent', text: '48 小时内发货。', msgId: 'a-new', ts },
          },
        ],
      },
    })

    expect(vi.mocked(db.addQaRecord).mock.calls[0][0]).toMatchObject({ msgId: 'b-new' })
    expect(vi.mocked(db.addReply).mock.calls[0][0]).toMatchObject({ msgId: 'a-new' })
  })
})

describe('未结段持久化(chrome.storage.session,SW 休眠防御)', () => {
  async function freshCapture() {
    vi.resetModules()
    const mod = await import('../../../src/background/pddCapture')
    return {
      ingest: async (m: PddIngestRequest, tabId?: number) => {
        const resp = await mod.handlePddIngest(m, tabId)
        return resp.payload
      },
      restoreSegmenterState: mod.restoreSegmenterState as () => Promise<void>,
    }
  }

  it('★ 回归:ingest 落盘后把未结段快照写入 storage.session(SW 休眠可恢复)', async () => {
    const { ingest } = await freshCapture()
    await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          {
            kind: 'msg',
            sessionKey: 'u6666',
            buyerIdTail: '6666',
            msg: { source: 'dom', role: 'buyer', text: '还在吗?', msgId: 'b-snap', ts: Date.now() },
          },
        ],
      },
    })

    expect(chromeMock.storage.session.set).toHaveBeenCalled()
    const arg = vi.mocked(chromeMock.storage.session.set).mock.calls[0][0] as {
      pddSegmenterState: Record<string, { buyerTexts: string[] }>
    }
    expect(arg.pddSegmenterState.u6666).toMatchObject({ buyerTexts: ['还在吗?'] })
  })

  it('SW 重启后 restoreSegmenterState 恢复未结段:agent 回复到达仍能配对落盘', async () => {
    // 模拟 SW 休眠前写入的快照
    await chromeMock.storage.session.set({
      pddSegmenterState: {
        u5555: { buyerTexts: ['尺码偏大吗?'], firstMsgId: 'b-old', firstTs: Date.now() - 60_000 },
      },
    })

    const { ingest, restoreSegmenterState } = await freshCapture()
    await restoreSegmenterState()

    await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          {
            kind: 'msg',
            sessionKey: 'u5555',
            buyerIdTail: '5555',
            msg: {
              source: 'dom',
              role: 'agent',
              text: '亲,建议拍大一码哦。',
              msgId: 'a-new',
              ts: Date.now(),
            },
          },
        ],
      },
    })

    expect(db.addQaRecord).toHaveBeenCalledTimes(1)
    expect(vi.mocked(db.addQaRecord).mock.calls[0][0]).toMatchObject({
      sessionKey: 'u5555',
      question: '尺码偏大吗?',
      msgId: 'b-old',
    })
    expect(db.addReply).toHaveBeenCalledTimes(1)
  })

  it('idle 事件到达 → 关闭该会话未结段为无回复问题', async () => {
    const { ingest } = await freshCapture()
    const ts = Date.now()
    const resp = await ingest({
      type: 'PDD_INGEST',
      payload: {
        events: [
          {
            kind: 'msg',
            sessionKey: 'u4444',
            buyerIdTail: '4444',
            msg: { source: 'dom', role: 'buyer', text: '有优惠吗?', msgId: 'b-idle', ts },
          },
          { kind: 'idle', sessionKey: 'u4444' },
        ],
      },
    })

    expect(resp.queued).toBe(2)
    expect(db.addQaRecord).toHaveBeenCalledTimes(1)
    expect(vi.mocked(db.addQaRecord).mock.calls[0][0]).toMatchObject({
      sessionKey: 'u4444',
      question: '有优惠吗?',
    })
    expect(db.addReply).not.toHaveBeenCalled()
  })
})
