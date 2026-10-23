/** 设置页的文字档位与保留期取值。纯逻辑，便于单测且不依赖 DOM。 */
import {
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  RETENTION_PRESETS,
} from '../shared/constants'

export type ThresholdKind = 'history' | 'golden' | 'knowledge'
export type ThresholdTier = 'low' | 'medium' | 'high'
export type RetentionChoice = '7' | '30' | '90' | 'custom'

export { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, RETENTION_PRESETS }

/**
 * 基于真实导出问答与仓库内 bge-small-zh-v1.5 的配对评估：
 * 历史问题使用 0.70 作为平衡点；标准回答与知识库按来源可信度依次放宽。
 */
export const THRESHOLD_TIERS: Record<ThresholdKind, Record<ThresholdTier, number>> = {
  history: { low: 0.6, medium: 0.7, high: 0.8 },
  golden: { low: 0.55, medium: 0.65, high: 0.75 },
  knowledge: { low: 0.5, medium: 0.6, high: 0.7 },
}

export const THRESHOLD_TIER_LABELS: ReadonlyArray<{ value: ThresholdTier; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

export function retentionChoice(days: number): RetentionChoice {
  if (days === 7) return '7'
  if (days === 30) return '30'
  if (days === 90) return '90'
  return 'custom'
}

/** 自定义输入只接受 7~365 的整数；返回 null 表示当前输入不可保存。 */
export function parseRetentionInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const days = Number(trimmed)
  return Number.isInteger(days) && days >= RETENTION_MIN_DAYS && days <= RETENTION_MAX_DAYS
    ? days
    : null
}

export function thresholdForTier(kind: ThresholdKind, tier: ThresholdTier): number {
  return THRESHOLD_TIERS[kind][tier]
}

/** 旧备份里可能是任意数值；界面显示最接近的档位，不改写原值。 */
export function nearestThresholdTier(kind: ThresholdKind, value: number): ThresholdTier {
  const tiers = THRESHOLD_TIERS[kind]
  return (Object.keys(tiers) as ThresholdTier[]).reduce((nearest, tier) =>
    Math.abs(tiers[tier] - value) < Math.abs(tiers[nearest] - value) ? tier : nearest,
  )
}
