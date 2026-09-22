// ─── 使用统计口径(v0.16)───────────────────────────────────────────────────────
// 「工具到底帮没帮上忙」要能回答,就得先有数。这里定义**唯一一份**计数口径:
// 事件键的字面量 + 逐条用量键的构造/解析。SW 写库、content 上报、设置页读展示
// 三处共用 —— 键名散着写迟早对不上(展示端查一个永远为 0 的键,页面上不报错,
// 只是数字悄悄是错的)。
//
// 全部本地:只进本机 IndexedDB,不出网、不随导出外发(见 ADR-0006 的合规边界)。

/**
 * 可上报的统计事件 —— **受限联合**。content 经 TRACK_EVENT 上报时只认这几个字面量,
 * 后台按白名单收,脏键进不了表。
 *
 * 命名 = `<动作>.<对象>`;`fill.<类别>` 与 Suggestion.kind 同名,便于按类别汇总。
 */
export type MetricEventKey =
  /** 发起一次检索(每次点「AI回复」/按快捷键) */
  | 'search.total'
  /** 检索返回 0 条候选 —— 未命中率 = miss / total */
  | 'search.miss'
  /** 点「AI回复」按钮打开候选面板 */
  | 'panel.open.click'
  /** 快捷键直接呼出候选面板 */
  | 'panel.open.hotkey'
  /** 填入输入框:标准回答 */
  | 'fill.golden'
  /** 填入输入框:历史回答 */
  | 'fill.history'
  /** 填入输入框:知识库 */
  | 'fill.knowledge'
  /** 填入输入框:AI 整合行(唯一会出网的功能,单独一栏才看得出它到底用没用上) */
  | 'fill.ai'

/** 全部事件键(设置页遍历展示、后台白名单共用;顺序即展示顺序) */
export const METRIC_EVENT_KEYS: readonly MetricEventKey[] = [
  'search.total',
  'search.miss',
  'panel.open.click',
  'panel.open.hotkey',
  'fill.golden',
  'fill.history',
  'fill.knowledge',
  'fill.ai',
]

/** 事件键 → 中文名(设置页「使用统计」卡片的行标签) */
export const METRIC_LABELS: Record<MetricEventKey, string> = {
  'search.total': '检索次数',
  'search.miss': '其中未命中',
  'panel.open.click': '面板打开(点击)',
  'panel.open.hotkey': '面板打开(快捷键)',
  'fill.golden': '填充 · 标准回答',
  'fill.history': '填充 · 历史回答',
  'fill.knowledge': '填充 · 知识库',
  'fill.ai': '填充 · AI 整合',
}

/**
 * 可记逐条用量的来源 —— 只有长期资产配得上一条常驻计数器:
 * 历史问答有 90 天保留期,记录会被 TTL 清掉,给它计数就是在库里攒孤儿键。
 */
export type MetricItemKind = 'golden' | 'knowledge'

const ITEM_PREFIX: Record<MetricItemKind, string> = {
  golden: 'item.golden',
  knowledge: 'item.knowledge',
}

/** 逐条用量键:`item.<类别>:<条目id>`(条目删除时一并清掉,见 db.deleteGolden 等) */
export function itemMetricKey(kind: MetricItemKind, id: string): string {
  return `${ITEM_PREFIX[kind]}:${id}`
}

/** 逐条用量键 → 条目 id;非逐条键(全局事件/别的类别)返回 null */
export function parseItemMetricKey(
  key: string,
  kind: MetricItemKind,
): string | null {
  const prefix = `${ITEM_PREFIX[kind]}:`
  return key.startsWith(prefix) ? key.slice(prefix.length) : null
}

/** Suggestion.kind → 填充事件键(三处填充路径共用,免得各写各的) */
export function fillEventOf(kind: MetricItemKind | 'history'): MetricEventKey {
  return kind === 'golden'
    ? 'fill.golden'
    : kind === 'knowledge'
      ? 'fill.knowledge'
      : 'fill.history'
}
