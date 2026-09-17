// 保留期清理(TTL)单测:闹钟幂等 + "保留期一改就清" + 清理本身的调用口径。
//
// 为什么补这一组(2026-09-17 第五十四轮):这三条都是"什么时候跑、跑几次"的契约,
// 此前全在 SW 入口(index.ts)顶层裸奔,没法单测 —— 于是"每次 SW 唤醒都无条件重建
// 同名闹钟、把 24h 计时一次次推后"这种错一直没人看见(真机实测:每次启动读到的都是
// 距现在 1440 分钟,闹钟从没到过点)。入库先戴笼头。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { QaRecord, ReplyRecord } from '../../../src/types/memory'
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../../../src/shared/constants'
import { hashText } from '../../../src/shared/text'

const DAY = 86_400_000

const store: Record<string, unknown> = {}

/** chrome.storage.local 内存桩(callback 风格,与 chrome-storage.ts 的调用方式一致) */
function stubLocalStorage(): void {
  const local = chrome.storage.local as unknown as Record<string, unknown>
  local.get = (
    keys: string | string[] | null,
    cb?: (r: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> => {
    const wanted = keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]
    const out: Record<string, unknown> = {}
    for (const k of wanted) if (k in store) out[k] = store[k]
    cb?.(out)
    return Promise.resolve(out)
  }
  local.set = (items: Record<string, unknown>, cb?: () => void): Promise<void> => {
    Object.assign(store, items)
    cb?.()
    return Promise.resolve()
  }
}

/** chrome.alarms 桩:在册/不在册由 alarms.get 决定,create 记账 */
const alarms = chrome.alarms as unknown as Record<string, unknown>
const createCalls: Array<[string, unknown]> = []
function stubAlarms(inBook: boolean, getThrows = false): void {
  alarms.get = vi.fn(() => {
    if (getThrows) throw new Error('alarms 不可用')
    return Promise.resolve(inBook ? { name: 'pddcs-daily-ttl', scheduledTime: Date.now() + DAY } : undefined)
  })
  alarms.create = vi.fn((name: string, info: unknown) => {
    createCalls.push([name, info])
  })
}

/** 重置模块注册表 → ttl.ts 与它的单例 db 在干净的 fake-indexeddb 上重建 */
async function fresh() {
  vi.resetModules()
  stubLocalStorage()
  const ttl = await import('../../../src/background/ttl')
  const { db } = await import('../../../src/background/db')
  return { ...ttl, db }
}

function makeQa(over: Partial<QaRecord> & { id: string }): QaRecord {
  const now = Date.now()
  return {
    sessionKey: 'sess-1',
    question: '能开发票吗?',
    questionHash: hashText('能开发票吗?'),
    questionTs: now,
    hasEmbedding: 0,
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function makeReply(over: Partial<ReplyRecord> & { id: string }): ReplyRecord {
  const text = over.text ?? '可以,支持电子发票。'
  return {
    qaId: 'qa-1',
    text,
    contentHash: hashText(text),
    ts: Date.now(),
    hasEmbedding: 0,
    ...over,
  }
}

/** 种一条 N 天前的问答 + 它的回复 */
async function seedOld(db: Awaited<ReturnType<typeof fresh>>['db'], id: string, days: number) {
  await db.addQaRecord(makeQa({ id, questionTs: Date.now() - days * DAY }))
  await db.addReply(makeReply({ id: 'r-' + id, qaId: id }))
}

const setRetention = (days: number) =>
  Promise.resolve(Object.assign(store, { [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, retentionDays: days } }))

beforeEach(async () => {
  // fake-indexeddb 的后端在同一文件内是共享的:不删库,上一条用例的记录会活到下一条
  await Dexie.delete('PddCSDB')
  for (const k of Object.keys(store)) delete store[k]
  createCalls.length = 0
  stubAlarms(false)
})

describe('scheduleDailyAlarm:幂等', () => {
  it('已在册 → 不重建(重建会把 24h 计时推后,闹钟永远到不了点)', async () => {
    const { scheduleDailyAlarm } = await fresh()
    stubAlarms(true)
    await scheduleDailyAlarm()
    expect(createCalls).toHaveLength(0)
  })

  it('不在册 → 补一个 24h 周期的(扩展更新/重载会清掉闹钟)', async () => {
    const { scheduleDailyAlarm } = await fresh()
    await scheduleDailyAlarm()
    expect(createCalls).toEqual([['pddcs-daily-ttl', { periodInMinutes: 1440 }]])
  })

  it('alarms 不可用 → 静默吞掉,不拖垮 SW 启动', async () => {
    const { scheduleDailyAlarm } = await fresh()
    stubAlarms(false, true)
    await expect(scheduleDailyAlarm()).resolves.toBeUndefined()
  })
})

describe('runTtlPurge:按设置里的天数清', () => {
  it('过期问答连回复一起删,返回条数;未过期的原样留着', async () => {
    const { runTtlPurge, db } = await fresh()
    await setRetention(30)
    await seedOld(db, 'qa-old', 60)
    await seedOld(db, 'qa-new', 1)

    expect(await runTtlPurge()).toBe(1)
    expect(await db.qaRecords.get('qa-old')).toBeUndefined()
    expect(await db.replies.get('r-qa-old')).toBeUndefined()
    expect(await db.qaRecords.get('qa-new')).toBeDefined()
    expect(await db.replies.get('r-qa-new')).toBeDefined()
  })

  it('读设置失败 → 返回 0 且不抛(闹钟到点那次崩了不能把 SW 带下水)', async () => {
    const { runTtlPurge } = await fresh()
    const local = chrome.storage.local as unknown as Record<string, unknown>
    local.get = () => {
      throw new Error('storage 炸了')
    }
    await expect(runTtlPurge()).resolves.toBe(0)
  })
})

describe('purgeIfRetentionChanged:保留期一改就清', () => {
  it('天数没变 → 不清(其余设置项不该每次都触发一次扫描)', async () => {
    const { purgeIfRetentionChanged, db } = await fresh()
    await setRetention(30)
    await seedOld(db, 'qa-old', 60)

    const removed = await purgeIfRetentionChanged(
      { ...DEFAULT_SETTINGS, retentionDays: 30 },
      { ...DEFAULT_SETTINGS, retentionDays: 30 },
    )
    expect(removed).toBe(0)
    expect(await db.qaRecords.get('qa-old')).toBeDefined()
  })

  it('天数变了 → 立刻清(不必等下次 SW 启动)', async () => {
    const { purgeIfRetentionChanged, db } = await fresh()
    await setRetention(30) // UPDATE_SETTINGS 先落库、再清
    await seedOld(db, 'qa-old', 60)

    const removed = await purgeIfRetentionChanged(
      { ...DEFAULT_SETTINGS, retentionDays: 90 },
      { ...DEFAULT_SETTINGS, retentionDays: 30 },
    )
    expect(removed).toBe(1)
    expect(await db.qaRecords.get('qa-old')).toBeUndefined()
    expect(await db.replies.get('r-qa-old')).toBeUndefined()
  })
})
