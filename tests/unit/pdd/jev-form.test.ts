// jev 表单的纯逻辑。与 llm-form 同构,所以这里也照它的写法钉两件事:
//  ① 字段映射是**唯一**的转换点,写错不会报错只会静默丢值 → 往返必须对得上;
//  ② 判据与 background 侧必须同判(这是两份实现,一致性靠测试不靠自觉)。
import { describe, it, expect } from 'vitest'
import {
  jevFormFromSettings,
  jevFormReady,
  jevSettingsPatch,
  jevTestErrorText,
  jevTestLabel,
  sameJevFields,
} from '../../../src/pdd/jev-form'

const S = { jevBaseUrl: 'https://api.typesafe.ai', jevApiKey: 'sk-1', jevModel: 'jev-latest' }

describe('jev 表单字段映射', () => {
  it('设置 → 表单 → 设置 往返不丢值', () => {
    expect(jevSettingsPatch(jevFormFromSettings(S))).toEqual(S)
  })

  it('表单形不带 jev 前缀', () => {
    expect(jevFormFromSettings(S)).toEqual({
      baseUrl: 'https://api.typesafe.ai',
      apiKey: 'sk-1',
      model: 'jev-latest',
    })
  })

  it('sameJevFields 逐字段比,不比对象身份', () => {
    expect(sameJevFields(jevFormFromSettings(S), { ...jevFormFromSettings(S) })).toBe(true)
    expect(sameJevFields(jevFormFromSettings(S), { ...jevFormFromSettings(S), apiKey: 'x' })).toBe(
      false,
    )
  })
})

describe('jevFormReady', () => {
  it('三项都非空才算配好', () => {
    expect(jevFormReady({ baseUrl: 'https://a', apiKey: 'k', model: 'm' })).toBe(true)
    expect(jevFormReady({ baseUrl: 'https://a', apiKey: '', model: 'm' })).toBe(false)
    expect(jevFormReady({ baseUrl: '', apiKey: 'k', model: 'm' })).toBe(false)
    expect(jevFormReady({ baseUrl: 'https://a', apiKey: 'k', model: '' })).toBe(false)
  })

  it('纯空白不算填了', () => {
    expect(jevFormReady({ baseUrl: '   ', apiKey: 'k', model: 'm' })).toBe(false)
  })
})

describe('测试连接文案', () => {
  it('状态机四态', () => {
    expect(jevTestLabel({ phase: 'idle' })).toBe('测试连接')
    expect(jevTestLabel({ phase: 'testing' })).toBe('测试中…')
    expect(jevTestLabel({ phase: 'ok' })).toBe('连接正常')
  })

  it('HTTP 码原样带出(那是用户唯一能自己动手改的线索)', () => {
    expect(jevTestErrorText('http 401')).toContain('401')
    expect(jevTestErrorText('http 500')).toContain('500')
  })

  it('超时与网络分开说,且网络那档要提"是否已授权该域名"', () => {
    expect(jevTestErrorText('timeout')).toContain('超时')
    expect(jevTestErrorText('network')).toContain('授权')
  })

  it('没填全时说清是没填全', () => {
    expect(jevTestErrorText('unconfigured')).toMatch(/没填全|尚未填全/)
  })
})
