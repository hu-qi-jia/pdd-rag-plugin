import { describe, expect, it } from 'vitest'
import {
  RETENTION_PRESETS,
  nearestThresholdTier,
  parseRetentionInput,
  retentionChoice,
  thresholdForTier,
} from '../../../src/popup/preferences'
import {
  knowledgeTemplateFile,
  sizeTableTemplateFile,
} from '../../../src/popup/knowledgeTemplates'

describe('保留期档位', () => {
  it('固定档位原样识别,其它合法天数归入自定义', () => {
    expect(RETENTION_PRESETS).toEqual([7, 30, 90])
    expect(retentionChoice(7)).toBe('7')
    expect(retentionChoice(30)).toBe('30')
    expect(retentionChoice(90)).toBe('90')
    expect(retentionChoice(45)).toBe('custom')
  })

  it('自定义天数只接受 7~365 的整数', () => {
    expect(parseRetentionInput('7')).toBe(7)
    expect(parseRetentionInput('365')).toBe(365)
    expect(parseRetentionInput(' 45 ')).toBe(45)
    expect(parseRetentionInput('6')).toBeNull()
    expect(parseRetentionInput('366')).toBeNull()
    expect(parseRetentionInput('7.5')).toBeNull()
    expect(parseRetentionInput('')).toBeNull()
  })
})

describe('相似度阈值档位', () => {
  it('历史、标准回答、知识库分别使用已评估的三档值', () => {
    expect(thresholdForTier('history', 'low')).toBe(0.6)
    expect(thresholdForTier('history', 'medium')).toBe(0.7)
    expect(thresholdForTier('history', 'high')).toBe(0.8)
    expect(thresholdForTier('golden', 'low')).toBe(0.55)
    expect(thresholdForTier('golden', 'medium')).toBe(0.65)
    expect(thresholdForTier('golden', 'high')).toBe(0.75)
    expect(thresholdForTier('knowledge', 'low')).toBe(0.5)
    expect(thresholdForTier('knowledge', 'medium')).toBe(0.6)
    expect(thresholdForTier('knowledge', 'high')).toBe(0.7)
  })

  it('旧备份里的任意数值会显示为最接近的档位', () => {
    expect(nearestThresholdTier('history', 0.68)).toBe('medium')
    expect(nearestThresholdTier('golden', 0.52)).toBe('low')
    expect(nearestThresholdTier('knowledge', 0.74)).toBe('high')
  })
})

describe('知识库下载模板', () => {
  it('知识库模板给出可直接上传的 Markdown 结构', () => {
    const file = knowledgeTemplateFile()
    expect(file.filename).toBe('客服知识库模板.md')
    expect(file.content).toContain('# 客服知识库模板')
    expect(file.content).toContain('## 发货与物流')
    expect(file.content).toContain('### 怎么开发票？')
    expect(file.content).toContain('请替换示例内容')
  })

  it('尺码表模板包含选码表、参数说明与冲突规则', () => {
    const file = sizeTableTemplateFile()
    expect(file.filename).toBe('尺码表模板.md')
    expect(file.content).toContain('# 尺码表模板')
    expect(file.content).toContain('| 尺码 | 建议身高')
    expect(file.content).toContain('## 选码规则')
    expect(file.content).toContain('以体重为主')
  })
})
