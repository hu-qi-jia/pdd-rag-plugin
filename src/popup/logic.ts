/**
 * 面板纯逻辑(popup 的 Model 层):记忆列表关键词筛选 / 剩余保留天数 / 两层文件夹树构建。
 * 设计依据:设计文档 §7(面板结构)。纯函数,无 chrome/DB 依赖,便于单测。
 * (2026-09-16 工程审查③-V6:自 utils/panelLogic.ts 迁入 popup/,与 background/panel.ts
 *  的命名撞车解除 —— 后者是 SW 侧 DB 读取,本文件是 UI 侧纯逻辑)
 */
import { hashText, normalizeText } from '../shared/text'
import {
  METRIC_EVENT_KEYS,
  METRIC_LABELS,
  type MetricEventKey,
} from '../shared/metrics'
import {
  PRESET_CATEGORIES,
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_NAME,
  UNCATEGORIZED_CATEGORY_POSITION,
  UNCATEGORIZED_FOLDER_ID,
  UNCATEGORIZED_FOLDER_NAME,
} from '../shared/constants'
import type { PanelCategory, PanelFolder, PanelGolden, PanelKnowledge } from '../types/messages'

/*
 * 这里原有 `chunkOrdinal` 与 `firstChunkIds` 两个纯函数,随 v3.0 第二版**整体删除**。
 *
 * 它们唯一的用途是回答"该在哪一块上渲染那个尺码表开关" —— 尺码表是**文档级**标记
 * (落在 `kbDocs.isSizeTable`,不随块存),而一篇文档会被切成很多块、每块一条记录,
 * 开关只能在第一块上渲染一次,否则一篇 20 块的文档会冒出 20 个开关。
 *
 * 用户把那个开关本身要求掉了(「不用将每条都增加尺码表的开关,在顶部上传按钮右侧
 * 增加一个上传尺码表就好」),列表里不再有任何逐条开关,于是"第一块是哪一块"这个问题
 * 在界面上不再存在,两个函数一并退场。
 *
 * 块序号的语义**仍有出处**,别在这里重新发明:`src/background/aiMaterials.ts#chunkOrdinal`
 * (尺码材料按块序号收集续块时在用)。要点照录:`importKbDocument` 造的 id 形如
 * `${rootId}-c${i}`(rootId 是随机 id),只有一块时 id 就是 rootId、**不带** `-c<n>` 后缀,
 * 视为第 0 块 —— 不能写成 `id === docId + '-c0'`,那是把文档名误当作了 id 前缀。
 *
 * 若将来要把逐条开关加回来,需要同时补回这两个函数与它们的用例,别只挂界面。
 */

export type { PanelCategory, PanelFolder, PanelGolden }

/** 记忆列表关键词筛选:归一化包含匹配;空关键词返回全量 */
export function filterQaRecords<T extends { question: string }>(items: T[], keyword: string): T[] {
  const kw = normalizeText(keyword)
  if (!kw) return items
  return items.filter((it) => normalizeText(it.question).includes(kw))
}

/**
 * 使用统计展示行(v0.16 设置页)——
 * 「检索次数 / 其中未命中」合并成一行:未命中单独一行会让人误以为它是另一类动作,
 * 它其实是分母的一部分。未命中率随行给出,这才是"工具有没有帮上忙"的那一眼。
 * 其余事件各占一行,顺序取 METRIC_EVENT_KEYS(口径单处定义,展示端不另排一遍)。
 */
export function usageRows(
  metrics: Record<string, number> | undefined,
): Array<{ key: string; label: string; value: string }> {
  const m = metrics ?? {}
  const n = (k: MetricEventKey): number => m[k] ?? 0
  const total = n('search.total')
  const miss = n('search.miss')
  const rows = [
    {
      key: 'search',
      label: METRIC_LABELS['search.total'],
      // 总数为 0 时不显示"0%":分母都没有,那个百分比不是结论而是错觉
      value: total === 0 ? '0 次' : `${total} 次 · 未命中 ${miss} 次(${missRate(m)}%)`,
    },
  ]
  for (const key of METRIC_EVENT_KEYS) {
    if (key === 'search.total' || key === 'search.miss') continue
    rows.push({ key, label: METRIC_LABELS[key], value: `${n(key)} 次` })
  }
  return rows
}

/** 检索未命中率(整数百分比 0~100);未检索过时返回 0 */
export function missRate(metrics: Record<string, number> | undefined): number {
  const total = metrics?.['search.total'] ?? 0
  if (total <= 0) return 0
  return Math.round(((metrics?.['search.miss'] ?? 0) / total) * 100)
}

/** 是否一条统计都还没有(全是 0)—— 新装/刚重置,展示端据此给一句说明而不是一排 0 */
export function usageIsEmpty(metrics: Record<string, number> | undefined): boolean {
  if (!metrics) return true
  return METRIC_EVENT_KEYS.every((k) => !metrics[k])
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

// ─── 记忆列表按问题类型分区(第五十七轮 Task 5,只读)───────────────────────────

/** 分区结果的一节 */
export interface CategoryBucket<T> {
  category: PanelCategory
  items: T[]
}

/**
 * 类型展示顺序:按 position 升序,**未分类恒最后** —— 不看它的 position。
 * 库里给未分类的 position 是 9999,但自定义类型可能被摆到更大的位置;
 * 「未分类」是兜底容器,视觉上必须收在末尾。
 */
export function categoryOrder(categories: PanelCategory[]): PanelCategory[] {
  const isUnc = (c: PanelCategory): number => (c.id === UNCATEGORIZED_CATEGORY_ID ? 1 : 0)
  return [...categories].sort((a, b) => isUnc(a) - isUnc(b) || a.position - b.position)
}

/**
 * 一条记录在**分类导航**上归到哪一档。
 *
 * 口径与 `groupByCategory` 逐字一致:**类型表里没有的 categoryId 并进未分类**。
 * 这条必须两边同源 —— 导航上的数字相加要等于总数,点进去也不能是空的;
 * 各自实现一份"归到哪一类"的规则,迟早出现"导航写着 3 条、点进去 0 条"。
 */
export function navBucketOf(categoryId: string, categories: PanelCategory[]): string {
  return categories.some((c) => c.id === categoryId) ? categoryId : UNCATEGORIZED_CATEGORY_ID
}

/**
 * 分类导航的条目(**不含「全部」那一档**,它由页面自己拼在最前 —— `all` 是个 UI 字面量,
 * 不该混进这一层纯逻辑)。
 *
 * 顺序 = `categoryOrder`(未分类恒最后);并且:
 *  - **保证「未分类」在列**。类型表本身不保证含它(测试夹具、迁移中途都可能没有),
 *    而它恰恰是"最容易被忽略的那一类",导航漏掉它 = 那批记录没有入口;
 *  - **展示全部分类,含 0 条的**。用户要的是"一眼看到有哪些分类";藏掉空分类
 *    反而会让人以为类型丢了(标准回答页还要在导航上改名 / 删除自定义类型)。
 */
export function categoryNavItems(
  items: { categoryId: string }[],
  categories: PanelCategory[],
): { id: string; name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const it of items) {
    const bucket = navBucketOf(it.categoryId, categories)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  const ordered = categoryOrder(categories)
  const out = ordered.map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id) ?? 0 }))
  if (!ordered.some((c) => c.id === UNCATEGORIZED_CATEGORY_ID)) {
    out.push({
      id: UNCATEGORIZED_CATEGORY_ID,
      name: UNCATEGORIZED_CATEGORY_NAME,
      count: counts.get(UNCATEGORIZED_CATEGORY_ID) ?? 0,
    })
  }
  return out
}

/**
 * 按问题类型分桶(记忆列表面板)。
 *
 * 三条不变量:
 *  ① **一条都不能丢** —— 类型表里没有的 categoryId 一律并进「未分类」组。
 *     类型表可能不含某条 id(旧库的自定义类型被删掉了),而条目还在。
 *  ② 未分类恒排最后,不管它的 position 是多少(见 categoryOrder)。
 *  ③ 组内保持传入顺序 —— 调用方已按时间排好,这里不再排一次。
 *
 * 空组不产出(面板上不显示空的分区容器)。
 */
export function groupByCategory<T extends { categoryId: string }>(
  items: T[],
  categories: PanelCategory[],
): Array<CategoryBucket<T>> {
  const buckets = new Map<string, CategoryBucket<T>>()
  for (const c of categoryOrder(categories)) {
    if (c.id === UNCATEGORIZED_CATEGORY_ID) continue
    buckets.set(c.id, { category: c, items: [] })
  }

  // 未分类兜底桶:显式 'uncategorized' 与"类型表里没有的 id"都并进这里
  const uncCategory: PanelCategory = categories.find(
    (c) => c.id === UNCATEGORIZED_CATEGORY_ID,
  ) ?? {
    id: UNCATEGORIZED_CATEGORY_ID,
    name: UNCATEGORIZED_CATEGORY_NAME,
    kind: 'uncategorized',
    filterable: false,
    position: UNCATEGORIZED_CATEGORY_POSITION,
  }
  const uncategorized: T[] = []
  for (const it of items) {
    const bucket = buckets.get(it.categoryId)
    if (bucket) bucket.items.push(it)
    else uncategorized.push(it)
  }

  const out: Array<CategoryBucket<T>> = []
  for (const c of categoryOrder(categories)) {
    if (c.id === UNCATEGORIZED_CATEGORY_ID) continue
    const bucket = buckets.get(c.id)!
    if (bucket.items.length > 0) out.push(bucket)
  }
  if (uncategorized.length > 0) out.push({ category: uncCategory, items: uncategorized })
  return out
}

// ─── 判定说明与预置类型的"含义相近"提示(spec §5.3,纯提示不做拦截)──────────────

/**
 * 判定说明太短就不判定(去空白后的字符数)。比这更短的描述,一两个 bigram 偶然全中
 * 并不能说明"含义相近" —— 阈值取 8 字:7 字串只有 6 个 bigram,要求其中 ≥50% 命中
 * 太容易被"询问/商品"这类通用词凑出来;而预置描述最短的「价格优惠」约 40 字,
 * 8 字以上才谈得上有可判断的语义体量。
 */
const CRITERIA_OVERLAP_MIN_CHARS = 8

/** 包含度阈值:达到即把新建表单的说明行标成警示色(纯提示,不做计算式拦截) */
const CRITERIA_OVERLAP_THRESHOLD = 0.5

/** 相邻两字(bigram)集合 —— 中文无天然分词,bigram 是轻量的"含义相近"代理 */
function bigrams(s: string): Set<string> {
  const clean = s.replace(/\s+/g, '')
  const out = new Set<string>()
  for (let i = 0; i + 1 < clean.length; i++) out.add(clean.slice(i, i + 2))
  return out
}

/**
 * 判定说明是否与某个预置类型的描述高度重合(spec §5.3)。
 *
 * 用**包含度** `|a ∩ b| / min(|a|, |b|)`,而非 Sørensen–Dice(2·交/(|a|+|b|))。
 * 原因:预置描述有 60~70 字(约 63 个 bigram),Dice 的分母被压死 —— 用户写
 * 「尺码咨询」这类 4 字描述即使全部命中,Dice 也只有约 0.06,提示**永远不触发**,
 * 而这条提示正是用来防"新增类型与预置重叠 → 全部类型判断质量一起下降"的静默失效。
 * 包含度对短串归一,能识别"用户描述是预置描述的一个子集"这种真正危险的重叠形态。
 *
 * 太短的描述(< CRITERIA_OVERLAP_MIN_CHARS)直接放行:一两个 bigram 偶然全中不是
 * "含义相近"。名字唯一性才是硬拦截,这里只负责把说明行标红。
 */
export function criteriaOverlapsPresets(criteria: string): boolean {
  const clean = criteria.replace(/\s+/g, '')
  if (clean.length < CRITERIA_OVERLAP_MIN_CHARS) return false
  const a = bigrams(clean)
  if (a.size === 0) return false
  return PRESET_CATEGORIES.some((p) => {
    const b = bigrams(p.criteria)
    if (b.size === 0) return false
    let inter = 0
    for (const g of a) if (b.has(g)) inter++
    return inter / Math.min(a.size, b.size) >= CRITERIA_OVERLAP_THRESHOLD
  })
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
