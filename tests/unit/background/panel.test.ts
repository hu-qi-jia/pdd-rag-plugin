// 面板数据编排单测(fake-indexeddb 内存实现):getMemoryList 的金标徽标回带。
// 背景(2026-09-15 评审 PM1):「已设为标准回答」原是会话级 state,重开 popup 即丢;
// 现改为 GET_MEMORY_LIST 按 goldens.sourceReplyId 回带 goldenId,前端从数据派生徽标。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import type { QaRecord, ReplyRecord, GoldenRecord } from '../../../src/types/memory'
import { hashText } from '../../../src/shared/text'

/** 重置模块注册表 → panel.ts(及其单例 db)在已删库的 fake-indexeddb 上重建 */
async function freshPanel() {
  vi.resetModules()
  const { getMemoryList } = await import('../../../src/background/panel')
  const { db } = await import('../../../src/background/db')
  return { getMemoryList, db }
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

function makeGolden(over: Partial<GoldenRecord> & { id: string }): GoldenRecord {
  const now = Date.now()
  return {
    folderId: null,
    question: '能开发票吗?',
    answer: '可以,支持电子发票。',
    questionHash: hashText('能开发票吗?'),
    hasEmbedding: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('getMemoryList:金标徽标持久化(goldenId 回带)', () => {
  it('回复若被提升为标准回答(sourceReplyId 命中)→ 回带 goldenId', async () => {
    const { getMemoryList, db } = await freshPanel()
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addReply(makeReply({ id: 'r-1' }))
    await db.addReply(makeReply({ id: 'r-2', text: '换个说法:支持开票。' }))
    await db.goldens.add(
      makeGolden({ id: 'g-1', sourceRecordId: 'qa-1', sourceReplyId: 'r-1' }),
    )

    const { items } = await getMemoryList({ type: 'GET_MEMORY_LIST' })
    const replies = items.find((i) => i.id === 'qa-1')!.replies
    expect(replies.find((r) => r.id === 'r-1')?.goldenId).toBe('g-1')
    // 未提升的回复不带 goldenId
    expect(replies.find((r) => r.id === 'r-2')?.goldenId).toBeUndefined()
  })

  it('手工新建的金标准(无来源溯源)不影响任何回复的徽标', async () => {
    const { getMemoryList, db } = await freshPanel()
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addReply(makeReply({ id: 'r-1' }))
    await db.goldens.add(makeGolden({ id: 'g-manual' }))

    const { items } = await getMemoryList({ type: 'GET_MEMORY_LIST' })
    const replies = items.find((i) => i.id === 'qa-1')!.replies
    expect(replies.find((r) => r.id === 'r-1')?.goldenId).toBeUndefined()
  })
})

describe('getMemoryList:分页(2026-09-15 PM2,更早记录显式入口)', () => {
  /** 5 条问答,questionTs = 1..5(id=qa-1 最新) */
  async function seedFive() {
    const { getMemoryList, db } = await freshPanel()
    for (let i = 1; i <= 5; i++) {
      await db.addQaRecord(makeQa({ id: `qa-${i}`, questionTs: i }))
    }
    return { getMemoryList, db }
  }

  it('第一页(limit 2)= 最近 2 条;total=5;hasMore=true', async () => {
    const { getMemoryList } = await seedFive()
    const out = await getMemoryList({ type: 'GET_MEMORY_LIST', payload: { limit: 2 } })
    expect(out.items.map((i) => i.id)).toEqual(['qa-5', 'qa-4'])
    expect(out.total).toBe(5)
    expect(out.hasMore).toBe(true)
  })

  it('翻到末页:只剩更早的 1 条;hasMore=false', async () => {
    const { getMemoryList } = await seedFive()
    const out = await getMemoryList({
      type: 'GET_MEMORY_LIST',
      payload: { offset: 4, limit: 2 },
    })
    expect(out.items.map((i) => i.id)).toEqual(['qa-1'])
    expect(out.total).toBe(5)
    expect(out.hasMore).toBe(false)
  })

  it('total 排除自检示例数据(与头部统计同口径)', async () => {
    const { getMemoryList, db } = await seedFive()
    const { SELF_TEST_SESSION_KEY } = await import('../../../src/shared/constants')
    await db.addQaRecord(
      makeQa({ id: 'qa-st', sessionKey: SELF_TEST_SESSION_KEY, questionTs: 99 }),
    )
    const out = await getMemoryList({ type: 'GET_MEMORY_LIST', payload: { limit: 2 } })
    expect(out.total).toBe(5)
    expect(out.hasMore).toBe(true)
  })

  it('缺省分页:一次取全(≤100 时 hasMore=false),兼容无 payload 调用', async () => {
    const { getMemoryList } = await seedFive()
    const out = await getMemoryList({ type: 'GET_MEMORY_LIST' })
    expect(out.items).toHaveLength(5)
    expect(out.total).toBe(5)
    expect(out.hasMore).toBe(false)
  })
})

describe('clearMemoryData:清空问答记忆(2026-09-15 PM6a)', () => {
  it('删除全部问答与回复;金标准/知识库/文件夹保留;返回删除条数', async () => {
    vi.resetModules()
    const { clearMemoryData } = await import('../../../src/background/panel')
    const { db } = await import('../../../src/background/db')

    await db.ensurePresetFolders()
    await db.addQaRecord(makeQa({ id: 'qa-1' }))
    await db.addQaRecord(makeQa({ id: 'qa-2', questionTs: 2 }))
    await db.addReply(makeReply({ id: 'r-1', qaId: 'qa-1' }))
    await db.goldens.add(makeGolden({ id: 'g-1' }))
    await db.knowledge.add({
      id: 'kb-1',
      title: '运费说明',
      content: '满 49 包邮',
      questionHash: hashText('运费说明'),
      hasEmbedding: 0,
      enabled: 1,
      createdAt: 1,
      updatedAt: 1,
    })

    const out = await clearMemoryData({ type: 'CLEAR_MEMORY_DATA' })
    expect(out.success).toBe(true)
    expect(out.deletedQa).toBe(2)

    expect(await db.qaRecords.count()).toBe(0)
    expect(await db.replies.count()).toBe(0)
    // 长期资产不受影响
    expect(await db.goldens.count()).toBe(1)
    expect(await db.knowledge.count()).toBe(1)
    expect(await db.folders.count()).toBe(1)
  })

  it('清空后检索缓存同步失效(已嵌问答不再出现在缓存)', async () => {
    vi.resetModules()
    const { clearMemoryData } = await import('../../../src/background/panel')
    const { db } = await import('../../../src/background/db')
    const { getRetrievalEntries } = await import('../../../src/background/retrievalCache')

    await db.addQaRecord(
      makeQa({ id: 'qa-1', hasEmbedding: 1, embedding: new Float32Array([1]) }),
    )
    expect(await getRetrievalEntries()).toHaveLength(1)

    await clearMemoryData({ type: 'CLEAR_MEMORY_DATA' })
    expect(await getRetrievalEntries()).toHaveLength(0)
  })

  it('空库清空:success=true,deletedQa=0', async () => {
    vi.resetModules()
    const { clearMemoryData } = await import('../../../src/background/panel')
    const out = await clearMemoryData({ type: 'CLEAR_MEMORY_DATA' })
    expect(out).toEqual({ success: true, deletedQa: 0 })
  })
})

describe('flattenFolders:遗留子文件夹一键拍平(2026-09-15 PM7)', () => {
  async function freshFlatten() {
    vi.resetModules()
    const { flattenFolders } = await import('../../../src/background/panel')
    const { db } = await import('../../../src/background/db')
    return { flattenFolders, db }
  }

  async function addFolder(db: Awaited<ReturnType<typeof freshFlatten>>['db'], over: { id: string; parentId: string | null }) {
    await db.folders.add({
      id: over.id,
      parentId: over.parentId,
      name: over.id,
      position: 0,
      createdAt: Date.now(),
    })
  }

  it('子夹金标准上移父根夹,子夹删除;根夹与其金标准不动', async () => {
    const { flattenFolders, db } = await freshFlatten()
    await addFolder(db, { id: 'fd-root1', parentId: null })
    await addFolder(db, { id: 'fd-root2', parentId: null })
    await addFolder(db, { id: 'fd-sub', parentId: 'fd-root1' })
    await db.goldens.add(makeGolden({ id: 'g-sub', folderId: 'fd-sub' }))
    await db.goldens.add(makeGolden({ id: 'g-root1', folderId: 'fd-root1' }))
    await db.goldens.add(makeGolden({ id: 'g-root2', folderId: 'fd-root2' }))

    const out = await flattenFolders({ type: 'FLATTEN_FOLDERS' })
    expect(out.success).toBe(true)
    expect(out.flattened).toBe(1)

    const folderIds = (await db.folders.toArray()).map((f) => f.id).sort()
    expect(folderIds).toEqual(['fd-root1', 'fd-root2'])
    expect((await db.goldens.get('g-sub'))?.folderId).toBe('fd-root1')
    expect((await db.goldens.get('g-root1'))?.folderId).toBe('fd-root1')
    expect((await db.goldens.get('g-root2'))?.folderId).toBe('fd-root2')
  })

  it('父夹已失联的遗留子夹:金标准归「默认文件夹」(folderId=null),子夹删除', async () => {
    const { flattenFolders, db } = await freshFlatten()
    await addFolder(db, { id: 'fd-orphan', parentId: 'fd-gone' })
    await db.goldens.add(makeGolden({ id: 'g-1', folderId: 'fd-orphan' }))

    const out = await flattenFolders({ type: 'FLATTEN_FOLDERS' })
    expect(out.success).toBe(true)
    expect(out.flattened).toBe(1)
    expect(await db.folders.count()).toBe(0)
    expect((await db.goldens.get('g-1'))?.folderId).toBeNull()
  })

  it('无遗留子夹时:flattened=0,不动任何数据', async () => {
    const { flattenFolders, db } = await freshFlatten()
    await addFolder(db, { id: 'fd-root', parentId: null })
    await db.goldens.add(makeGolden({ id: 'g-1', folderId: 'fd-root' }))

    const out = await flattenFolders({ type: 'FLATTEN_FOLDERS' })
    expect(out).toEqual({ success: true, flattened: 0 })
    expect(await db.folders.count()).toBe(1)
    expect((await db.goldens.get('g-1'))?.folderId).toBe('fd-root')
  })
})
