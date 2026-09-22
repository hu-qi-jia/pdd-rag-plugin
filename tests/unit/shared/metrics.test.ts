/**
 * 统计口径单测(v0.16):事件键集合、逐条用量键的构造/解析、类别 → 填充事件映射。
 * 这些键是三处(SW 写、content 上报、设置页展示)共用的字符串契约,对不上不会报错,
 * 只会让页面上的数字永远是 0 —— 所以用测试钉住。
 */
import { describe, it, expect } from 'vitest'
import {
  METRIC_EVENT_KEYS,
  METRIC_LABELS,
  fillEventOf,
  itemMetricKey,
  parseItemMetricKey,
} from '../../../src/shared/metrics'

describe('事件键集合', () => {
  it('每个键都有中文标签(设置页直接拿来当行标题,缺了会显示 undefined)', () => {
    for (const k of METRIC_EVENT_KEYS) {
      expect(METRIC_LABELS[k]).toBeTruthy()
    }
  })

  it('键不重复', () => {
    expect(new Set(METRIC_EVENT_KEYS).size).toBe(METRIC_EVENT_KEYS.length)
  })

  it('填充类事件与候选类别同名,便于按类别汇总', () => {
    expect(METRIC_EVENT_KEYS).toContain('fill.golden')
    expect(METRIC_EVENT_KEYS).toContain('fill.history')
    expect(METRIC_EVENT_KEYS).toContain('fill.knowledge')
  })
})

describe('逐条用量键', () => {
  it('构造后能解回条目 id', () => {
    expect(parseItemMetricKey(itemMetricKey('golden', 'g-1'), 'golden')).toBe('g-1')
    expect(parseItemMetricKey(itemMetricKey('knowledge', 'k-1'), 'knowledge')).toBe('k-1')
  })

  it('类别不匹配时不解(金标准的键不会被当成知识库用量)', () => {
    expect(parseItemMetricKey(itemMetricKey('golden', 'x'), 'knowledge')).toBeNull()
  })

  it('全局事件键不解成条目 id', () => {
    expect(parseItemMetricKey('search.total', 'golden')).toBeNull()
    expect(parseItemMetricKey('fill.golden', 'golden')).toBeNull()
  })
})

describe('fillEventOf', () => {
  it('三类候选各自映射到对应的填充事件', () => {
    expect(fillEventOf('golden')).toBe('fill.golden')
    expect(fillEventOf('knowledge')).toBe('fill.knowledge')
    expect(fillEventOf('history')).toBe('fill.history')
  })
})
