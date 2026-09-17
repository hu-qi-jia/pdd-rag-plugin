/**
 * 面板纯逻辑(popup 的 Model 层):记忆列表关键词筛选 / 剩余保留天数 / 两层文件夹树构建。
 * 设计依据:设计文档 §7(面板结构)。纯函数,无 chrome/DB 依赖,便于单测。
 * (2026-09-16 工程审查③-V6:自 utils/panelLogic.ts 迁入 popup/,与 background/panel.ts
 *  的命名撞车解除 —— 后者是 SW 侧 DB 读取,本文件是 UI 侧纯逻辑)
 */
import { hashText, normalizeText } from '../shared/text'
import { UNCATEGORIZED_FOLDER_ID, UNCATEGORIZED_FOLDER_NAME } from '../shared/constants'
import type { PanelFolder, PanelGolden } from '../types/messages'

export type { PanelFolder, PanelGolden }

/** 记忆列表关键词筛选:归一化包含匹配;空关键词返回全量 */
export function filterQaRecords<T extends { question: string }>(items: T[], keyword: string): T[] {
  const kw = normalizeText(keyword)
  if (!kw) return items
  return items.filter((it) => normalizeText(it.question).includes(kw))
}

/** 剩余保留天数:向上取整,过期夹为 0 */
export function remainingDays(questionTs: number, now: number, retentionDays: number): number {
  const remainMs = questionTs + retentionDays * 86_400_000 - now
  return Math.max(0, Math.ceil(remainMs / 86_400_000))
}

/** 文件夹树节点:金标准挂在自己归属的夹上 */
export interface FolderNode {
  folder: PanelFolder
  children: FolderNode[]
  goldens: PanelGolden[]
}

const byPosition = (a: FolderNode, b: FolderNode): number =>
  a.folder.position - b.folder.position ||
  a.folder.name.localeCompare(b.folder.name, 'zh-Hans-CN')

/**
 * 构建两层文件夹树(根层 + 一层子夹)。
 * 兜底规则:
 *  - 金标准 folderId 为 null 或指向不存在的夹 → 归入"默认文件夹"节点;
 *  - "默认文件夹"夹缺失(理论上 ensurePresetFolders 保证存在)→ 合成兜底节点;
 *  - 子夹 parentId 悬空 → 当根层展示。
 */
export function buildFolderTree(folders: PanelFolder[], goldens: PanelGolden[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>()
  for (const f of folders) {
    nodes.set(f.id, { folder: f, children: [], goldens: [] })
  }
  let uncIsSynthetic = false
  if (!nodes.has(UNCATEGORIZED_FOLDER_ID)) {
    uncIsSynthetic = true
    nodes.set(UNCATEGORIZED_FOLDER_ID, {
      folder: {
        id: UNCATEGORIZED_FOLDER_ID,
        parentId: null,
        name: UNCATEGORIZED_FOLDER_NAME,
        position: 0,
      },
      children: [],
      goldens: [],
    })
  }

  const roots: FolderNode[] = []
  for (const f of folders) {
    const node = nodes.get(f.id)!
    const parent = f.parentId !== null ? nodes.get(f.parentId) : undefined
    if (parent && f.parentId !== f.id) parent.children.push(node)
    else roots.push(node)
  }

  for (const g of goldens) {
    const target =
      g.folderId !== null ? nodes.get(g.folderId) : undefined
    ;(target ?? nodes.get(UNCATEGORIZED_FOLDER_ID)!).goldens.push(g)
  }

  // 合成兜底节点(库中实际无"默认文件夹"夹)仅在确有孤儿金标准要收纳时才入根层
  const uncNode = nodes.get(UNCATEGORIZED_FOLDER_ID)!
  if (uncIsSynthetic && uncNode.goldens.length > 0) roots.push(uncNode)

  roots.sort(byPosition)
  for (const node of nodes.values()) node.children.sort(byPosition)
  // 同一问题的多条标准回答(每问上限见 MAX_GOLDENS_PER_QUESTION)按设置时间倒序:
  // 最近设置的靠前,与聊天页候选顺序同一口径
  for (const node of nodes.values()) {
    node.goldens = orderGoldensByRecency(node.goldens)
  }
  return roots
}

/**
 * 同问题的多条标准回答按 updatedAt 倒序(最近设置靠前);
 * 组的位置取该组在入参中最早出现的位置,其余条目保持原序 —— 不打乱既有阅读顺序。
 */
export function orderGoldensByRecency(goldens: PanelGolden[]): PanelGolden[] {
  if (goldens.length < 2) return goldens
  const keyOf = new Map<PanelGolden, string>()
  for (const g of goldens) keyOf.set(g, hashText(g.question))
  const out: PanelGolden[] = []
  const used = new Set<PanelGolden>()
  for (const g of goldens) {
    if (used.has(g)) continue
    const group = goldens.filter((x) => !used.has(x) && keyOf.get(x) === keyOf.get(g))
    for (const m of group) used.add(m)
    out.push(...group.sort((a, b) => b.updatedAt - a.updatedAt))
  }
  return out
}

/** 标准回答按问题分组计数(questionHash → 条数):面板标"同问题 N 条 / 已满"用 */
export function countGoldensByQuestion(
  goldens: Array<Pick<PanelGolden, 'question'>>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const g of goldens) {
    const k = hashText(g.question)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

/**
 * 旧版文档的重新上传提示(2026-09-17 第四十八轮)。
 *
 * 升级前上传的文档只有切好的块、没有原文,自动重切够不着 —— 而它们的块正是
 * 旧规则切的(整篇一块),向量被多主题平均稀释,检索会**静默**命中不到:
 * 用户以为知识库里有这条,问起来却永远匹配不上,还找不到原因。
 * 唯一出路是拿原文重切,而原文只有用户手里有 → 提示他重新上传同名文件。
 *
 * 返回 null 表示无需提示(无旧文档 / 后台读不到该字段)。
 */
export function legacyDocNotice(docIds: string[] | undefined): string | null {
  if (!docIds || docIds.length === 0) return null
  return `《${docIds.join('》《')}》是按旧版规则切分的,检索可能命中不到。点上方「上传 .md」重新上传同名文件即可修复 —— 同名整篇替换,不会产生重复条目。`
}
