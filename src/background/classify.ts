/**
 * 打标编排(第五十六轮 · 问题自动分类)。
 *
 * 与 jev.ts 的分工:jev.ts 只管"怎么问",这里管"该不该问、问到之后怎么落"。
 * 门禁先于一切 IO:总开关关、未配 key、无类型可问 —— 任一条不成立就**一次 fetch 都不发**。
 * 这是 ADR-0007 里"未配置时扩展保持完全本地"的落点。
 *
 * 本模块只处理**问题文本**;回复正文与标准回答正文从不进入这里的入参。
 */
import { db } from './db'
import { loadSettings } from './settings'
import {
  argmaxId,
  classifyQuestion,
  isJevConfigured,
  jevConfigFromSettings,
  type JevCategoryOption,
} from './jev'
import type { CategoryRecord } from '../types/memory'

/** 可作为 jev 选项的类型。与"参与类型过滤"是同一个集合(filterable=true) */
export function classifiableCategories(cats: CategoryRecord[]): JevCategoryOption[] {
  return cats
    .filter((c) => c.filterable)
    .map((c) => ({ id: c.id, name: c.name, criteria: c.criteria }))
}

/**
 * 一条问题 → 单一类型。最高概率低于阈值时返回 null,调用方落未分类。
 *
 * 记录级只取单一类型(归档要落在唯一一个组里);**多意图并集只用于查询时的路由**,
 * 那是另一条路径(见 spec §7.3)。
 */
export function pickRecordCategory(
  probabilities: Record<string, number>,
  threshold: number,
): { categoryId: string; confidence: number } | null {
  const top = argmaxId(probabilities)
  if (!top) return null
  const p = probabilities[top] ?? 0
  if (p < threshold) return null
  return { categoryId: top, confidence: p }
}

/**
 * 给一段问题文本打标。
 *
 * **从不抛错** —— 调用方在捕获链路与批量补分类里都是"失败就算了"的语义,
 * 一个网络错误不该把整条链路带崩。任何失败一律返回 null(落未分类)。
 */
export async function classifyRecord(
  question: string,
): Promise<{ categoryId: string; confidence: number } | null> {
  try {
    const settings = await loadSettings()
    // 门禁①:总开关
    if (!settings.classifyEnabled) return null
    // 门禁②:配置齐全
    const config = jevConfigFromSettings(settings)
    if (!isJevConfigured(config)) return null

    const cats = await db.listCategories()
    const options = classifiableCategories(cats)
    // 门禁③:有选项可问
    if (options.length === 0) return null

    const r = await classifyQuestion({ question, categories: options, config })
    if (!r.ok) return null
    return pickRecordCategory(r.probabilities, settings.classifyProbThreshold)
  } catch {
    return null
  }
}
