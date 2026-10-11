// 文件夹 handler 直接单测(第五十七轮 Task 6 修复轮 1/5)。
//
// 背景:第五十七轮把文件夹 CRUD 的 **UI** 整体移除,原先 folderOps.test.tsx 里点按钮
// 的那批用例随之删掉。但 handler 本身是**回滚资产,仍在注册表里**(见 src/background/index.ts),
// 且 UPDATE_GOLDEN 的 folderId 分支还有调用方(scripts/verify-p3.mjs)—— 删掉 UI 用例
// 等于让它们彻底失去覆盖。这里改为**不经 UI 直接调 handler**,把仍在的后台行为钉死。
import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Dexie from 'dexie'
import { hashText } from '../../../src/shared/text'
import { UNCATEGORIZED_FOLDER_ID } from '../../../src/shared/constants'
import type { GoldenRecord } from '../../../src/types/memory'

async function fresh() {
  vi.resetModules()
  const { createFolder, renameFolder, deleteFolder } = await import('../../../src/background/panel')
  const { updateGoldenWithReembed } = await import('../../../src/background/goldens')
  const { db } = await import('../../../src/background/db')
  return { createFolder, renameFolder, deleteFolder, updateGoldenWithReembed, db }
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

const addFolder = (
  db: Awaited<ReturnType<typeof fresh>>['db'],
  id: string,
  name: string,
  parentId: string | null = null,
) => db.addFolder({ id, parentId, name, position: 0, createdAt: Date.now() })

beforeEach(async () => {
  await Dexie.delete('PddCSDB')
})

describe('createFolder', () => {
  it('正常路径:落库并返回新 id', async () => {
    const { createFolder, db } = await fresh()
    const out = await createFolder({ type: 'CREATE_FOLDER', payload: { name: ' 售后 ', parentId: null } })
    expect(out.error).toBeUndefined()
    expect(out.id).toBeTruthy()
    const row = await db.folders.get(out.id!)
    expect(row?.name).toBe('售后') // trim 过
    expect(row?.parentId).toBeNull()
  })

  it('名称为空 → 报错且不落库', async () => {
    const { createFolder, db } = await fresh()
    const out = await createFolder({ type: 'CREATE_FOLDER', payload: { name: '   ', parentId: null } })
    expect(out.error).toBe('文件夹名不能为空')
    expect(out.id).toBeUndefined()
    expect(await db.folders.count()).toBe(0)
  })

  it('父文件夹不存在 → 报错且不落库', async () => {
    const { createFolder, db } = await fresh()
    const out = await createFolder({
      type: 'CREATE_FOLDER',
      payload: { name: '子夹', parentId: 'fd-gone' },
    })
    expect(out.error).toBe('父文件夹不存在')
    expect(await db.folders.count()).toBe(0)
  })
})

describe('renameFolder', () => {
  it('正常路径:改名落库', async () => {
    const { renameFolder, db } = await fresh()
    await addFolder(db, 'fd-1', '旧名')
    const out = await renameFolder({ type: 'RENAME_FOLDER', payload: { id: 'fd-1', name: ' 新名 ' } })
    expect(out).toEqual({ success: true })
    expect((await db.folders.get('fd-1'))?.name).toBe('新名')
  })

  it('空名 / 预置文件夹 → 报错且不改动', async () => {
    const { renameFolder, db } = await fresh()
    await addFolder(db, 'fd-1', '旧名')
    expect((await renameFolder({ type: 'RENAME_FOLDER', payload: { id: 'fd-1', name: '' } })).error).toBe(
      '文件夹名不能为空',
    )
    const preset = await renameFolder({
      type: 'RENAME_FOLDER',
      payload: { id: UNCATEGORIZED_FOLDER_ID, name: '想改名' },
    })
    expect(preset.success).toBe(false)
    expect(preset.error).toBe('预置文件夹不可重命名')
    expect((await db.folders.get('fd-1'))?.name).toBe('旧名')
  })
})

describe('deleteFolder', () => {
  it('正常路径:删除文件夹,其下标准回答 folderId 归 null(不删数据)', async () => {
    const { deleteFolder, db } = await fresh()
    await addFolder(db, 'fd-1', '待删')
    await db.goldens.add(makeGolden({ id: 'g1', folderId: 'fd-1' }))

    const out = await deleteFolder({ type: 'DELETE_FOLDER', payload: { id: 'fd-1' } })
    expect(out).toEqual({ success: true })
    expect(await db.folders.get('fd-1')).toBeUndefined()
    const g = await db.goldens.get('g1')
    expect(g).toBeTruthy() // 数据保留
    expect(g?.folderId).toBeNull()
  })

  it('预置文件夹 → 报错且不删', async () => {
    const { deleteFolder, db } = await fresh()
    await addFolder(db, UNCATEGORIZED_FOLDER_ID, '默认文件夹')
    const out = await deleteFolder({ type: 'DELETE_FOLDER', payload: { id: UNCATEGORIZED_FOLDER_ID } })
    expect(out.success).toBe(false)
    expect(out.error).toBe('预置文件夹不可删除')
    expect(await db.folders.count()).toBe(1)
  })
})

describe('UPDATE_GOLDEN 的 folderId 分支(迁移文件夹)', () => {
  it('正常路径:标答 folderId 落到目标文件夹', async () => {
    const { updateGoldenWithReembed, db } = await fresh()
    await addFolder(db, 'fd-1', '售后')
    await db.goldens.add(makeGolden({ id: 'g1', folderId: null }))

    const out = await updateGoldenWithReembed({ id: 'g1', folderId: 'fd-1' })
    expect(out.error).toBeUndefined()
    expect((await db.goldens.get('g1'))?.folderId).toBe('fd-1')
  })

  it('目标文件夹不存在 → 报错且不改动', async () => {
    const { updateGoldenWithReembed, db } = await fresh()
    await db.goldens.add(makeGolden({ id: 'g1', folderId: null }))

    const out = await updateGoldenWithReembed({ id: 'g1', folderId: 'fd-gone' })
    expect(out.error).toBe('目标文件夹不存在')
    expect((await db.goldens.get('g1'))?.folderId).toBeNull()
  })
})
