/**
 * 面板纯逻辑单测:关键词筛选 / 剩余保留天数 / 两层文件夹树构建。
 * 设计依据:设计文档 §7(记忆列表 / 回复文件夹)。
 */
import { describe, it, expect } from 'vitest'
import {
  filterQaRecords,
  remainingDays,
  buildFolderTree,
  countGoldensByQuestion,
  orderGoldensByRecency,
  legacyDocNotice,
  type PanelFolder,
  type PanelGolden,
  type FolderNode,
} from '../../../src/popup/logic'
import { UNCATEGORIZED_FOLDER_ID } from '../../../src/shared/constants'
const DAY = 86_400_000

describe('filterQaRecords 关键词筛选', () => {
  const items = [
    { id: 'a', question: '这个手机壳支持 iPhone 14 吗' },
    { id: 'b', question: '什么时候发货?' },
    { id: 'c', question: '能  开发票吗' }, // 内部双空格 → 归一化后单空格
  ]

  it('空/纯空白关键词返回全量', () => {
    expect(filterQaRecords(items, '')).toHaveLength(3)
    expect(filterQaRecords(items, '   ')).toHaveLength(3)
  })

  it('按归一化包含匹配(容忍空白差异)', () => {
    expect(filterQaRecords(items, '发票').map((x) => x.id)).toEqual(['c'])
    expect(filterQaRecords(items, '能 开发票').map((x) => x.id)).toEqual(['c'])
    expect(filterQaRecords(items, '发货').map((x) => x.id)).toEqual(['b'])
  })

  it('无命中返回空数组', () => {
    expect(filterQaRecords(items, '退款')).toEqual([])
  })
})

describe('remainingDays 剩余保留天数', () => {
  const ts = 1_000_000_000_000

  it('刚记录 → 满额天数', () => {
    expect(remainingDays(ts, ts, 90)).toBe(90)
  })

  it('不足一天向上取整', () => {
    expect(remainingDays(ts, ts + 88.5 * DAY, 90)).toBe(2)
  })

  it('恰好到期 → 0', () => {
    expect(remainingDays(ts, ts + 90 * DAY, 90)).toBe(0)
  })

  it('已过期 → 夹为 0(不为负)', () => {
    expect(remainingDays(ts, ts + 91 * DAY, 90)).toBe(0)
  })
})

describe('buildFolderTree 两层文件夹树', () => {
  const folder = (id: string, parentId: string | null, position: number, name = id): PanelFolder => ({
    id,
    parentId,
    name,
    position,
  })
  const golden = (id: string, folderId: string | null): PanelGolden => ({
    id,
    folderId,
    question: `q-${id}`,
    answer: `a-${id}`,
    hasEmbedding: 1,
    updatedAt: 1,
  })

  it('根夹/子夹按 position 排序,金标准按 folderId 归组', () => {
    const folders = [
      folder('f2', null, 2, '物流'),
      folder('f1', null, 1, '售前'),
      folder('f1-a', 'f1', 2, '发票'),
      folder('f1-b', 'f1', 1, '优惠'),
    ]
    const goldens = [golden('g1', 'f1'), golden('g2', 'f1-b'), golden('g3', 'f1-a')]

    const tree = buildFolderTree(folders, goldens)
    expect(tree.map((n) => n.folder.id)).toEqual(['f1', 'f2'])
    expect(tree[0].children.map((n) => n.folder.id)).toEqual(['f1-b', 'f1-a'])
    expect(tree[0].goldens.map((g) => g.id)).toEqual(['g1'])
    expect(tree[0].children[0].goldens.map((g) => g.id)).toEqual(['g2'])
    expect(tree[0].children[1].goldens.map((g) => g.id)).toEqual(['g3'])
  })

  it('folderId 为 null 或指向不存在夹的金标准 → 归入默认文件夹节点', () => {
    const folders = [folder(UNCATEGORIZED_FOLDER_ID, null, 0, '默认文件夹'), folder('f1', null, 1)]
    const goldens = [golden('g1', null), golden('g2', 'ghost-folder'), golden('g3', 'f1')]

    const tree = buildFolderTree(folders, goldens)
    const unc = tree.find((n) => n.folder.id === UNCATEGORIZED_FOLDER_ID) as FolderNode
    expect(unc.goldens.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(tree.find((n) => n.folder.id === 'f1')?.goldens.map((g) => g.id)).toEqual(['g3'])
  })

  it('子夹 parentId 悬空 → 兜底当根层展示', () => {
    const folders = [folder('f1', null, 1), folder('orphan', 'missing-parent', 2)]
    const tree = buildFolderTree(folders, [])
    expect(tree.map((n) => n.folder.id).sort()).toEqual(['f1', 'orphan'])
  })

  it('默认文件夹夹缺失时合成兜底节点收纳孤儿金标准', () => {
    const tree = buildFolderTree([folder('f1', null, 1)], [golden('g1', null)])
    const unc = tree.find((n) => n.folder.id === UNCATEGORIZED_FOLDER_ID) as FolderNode
    expect(unc.goldens.map((g) => g.id)).toEqual(['g1'])
  })
})

// ─── 多答案标准回答(2026-09-15:同一问题可挂多条,上限 3)──────────────────────

describe('orderGoldensByRecency / countGoldensByQuestion', () => {
  const g = (id: string, question: string, updatedAt: number, folderId: string | null = 'f1'): PanelGolden => ({
    id,
    folderId,
    question,
    answer: `a-${id}`,
    hasEmbedding: 1,
    updatedAt,
  })

  it('同问题的多条按设置时间倒序,组位置取首成员位置', () => {
    const list = [
      g('g1', '问题甲', 100),
      g('g2', '问题乙', 100),
      g('g3', '问题甲', 300),
      g('g4', '问题甲', 200),
    ]
    expect(orderGoldensByRecency(list).map((x) => x.id)).toEqual(['g3', 'g4', 'g1', 'g2'])
  })

  it('问题文本前后空白差异视为同一问题(归一化后同 hash)', () => {
    const list = [g('g1', '能开发票吗', 100), g('g2', '  能开发票吗 ', 200)]
    expect(orderGoldensByRecency(list).map((x) => x.id)).toEqual(['g2', 'g1'])
  })

  it('单条/空数组原样返回', () => {
    expect(orderGoldensByRecency([])).toEqual([])
    const one = [g('g1', '问题甲', 1)]
    expect(orderGoldensByRecency(one)).toBe(one)
  })

  it('分组计数:同问题累加,不同问题分开', () => {
    const counts = countGoldensByQuestion([
      g('g1', '问题甲', 1),
      g('g2', '问题甲', 2),
      g('g3', '问题乙', 3),
    ])
    expect(counts.size).toBe(2)
    expect([...counts.values()].sort()).toEqual([1, 2])
  })

  it('buildFolderTree 内已按设置时间倒序(面板与候选同一口径)', () => {
    const tree = buildFolderTree(
      [{ id: 'f1', parentId: null, name: 'f1', position: 0 }],
      [g('old', '问题甲', 100), g('new', '问题甲', 300)],
    )
    expect(tree[0].goldens.map((x) => x.id)).toEqual(['new', 'old'])
  })
})

// 第四十八轮:升级前上传的文档检索不到却毫无征兆,得说一声并给出可执行的动作。
describe('legacyDocNotice:旧文档重新上传提示', () => {
  it('无旧文档 / 字段缺省 → null(不提示)', () => {
    expect(legacyDocNotice([])).toBeNull()
    expect(legacyDocNotice(undefined)).toBeNull()
  })

  it('有旧文档 → 点名文档 + 给出动作(重新上传同名文件)', () => {
    const t = legacyDocNotice(['常见问答'])
    expect(t).toContain('《常见问答》')
    expect(t).toContain('上传 .md') // 按钮上的原话,用户照着找得到
    expect(t).toContain('同名') // 不产生重复条目的定心丸
  })

  it('多篇文档全部点名', () => {
    const t = legacyDocNotice(['常见问答', '售后政策']) as string
    expect(t).toContain('《常见问答》')
    expect(t).toContain('《售后政策》')
  })
})
