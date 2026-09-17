// 设置页 AI 表单纯逻辑单测:主机权限推导 / 测试连接文案 / 与后台判据的一致性。
import { describe, it, expect } from 'vitest'
import {
  llmFormReady,
  llmTestErrorText,
  llmTestFailed,
  llmTestLabel,
  originsForBaseUrl,
  type LlmTestState,
} from '../../../src/pdd/llm-form'
import { isLlmConfigured, testLlmConnection } from '../../../src/background/llm'

describe('originsForBaseUrl:baseUrl → MV3 可选主机权限', () => {
  it('取 origin,丢掉路径 —— 填 /v1 与不填要的是同一条权限', () => {
    expect(originsForBaseUrl('https://api.deepseek.com/v1')).toEqual(['https://api.deepseek.com/*'])
    expect(originsForBaseUrl('https://api.deepseek.com')).toEqual(['https://api.deepseek.com/*'])
  })

  it('保留端口(本地模型常在非标端口上)', () => {
    expect(originsForBaseUrl('http://localhost:11434/v1')).toEqual(['http://localhost:11434/*'])
  })

  it('http 与 https 各按各的来,不互相放宽', () => {
    expect(originsForBaseUrl('http://api.example.com/v1')).toEqual(['http://api.example.com/*'])
  })

  it('非法/非 http(s) 一律空数组(调用方据此跳过权限申请,不发无意义的弹窗)', () => {
    expect(originsForBaseUrl('')).toEqual([])
    expect(originsForBaseUrl('   ')).toEqual([])
    expect(originsForBaseUrl('api.deepseek.com/v1')).toEqual([]) // 缺协议
    expect(originsForBaseUrl('ftp://x.com')).toEqual([])
    expect(originsForBaseUrl('javascript:alert(1)')).toEqual([])
  })

  it('前后空白不影响推导(用户复制粘贴常带空格)', () => {
    expect(originsForBaseUrl('  https://api.deepseek.com/v1  ')).toEqual([
      'https://api.deepseek.com/*',
    ])
  })
})

describe('llmFormReady:与后台 isLlmConfigured 必须同判', () => {
  it('三项齐全才算配好;任一为空/纯空白都不算', () => {
    const full = { baseUrl: 'https://a.com/v1', apiKey: 'sk-x', model: 'm' }
    expect(llmFormReady(full)).toBe(true)
    expect(llmFormReady({ ...full, baseUrl: '' })).toBe(false)
    expect(llmFormReady({ ...full, apiKey: '   ' })).toBe(false)
    expect(llmFormReady({ ...full, model: '' })).toBe(false)
  })

  // UI 层不 import background,判据不得不在两侧各存一份 —— 一致性靠这张对照表守,
  // 而不是靠"记得同步改"。
  it('对照表:同一组输入,前台与后台同判(防两份实现漂移)', () => {
    const cases = [
      { baseUrl: 'https://a.com/v1', apiKey: 'sk-x', model: 'm' },
      { baseUrl: '', apiKey: 'sk-x', model: 'm' },
      { baseUrl: 'https://a.com/v1', apiKey: '  ', model: 'm' },
      { baseUrl: 'https://a.com/v1', apiKey: 'sk-x', model: '' },
      { baseUrl: '', apiKey: '', model: '' },
    ]
    for (const c of cases) {
      expect(llmFormReady(c)).toBe(isLlmConfigured(c))
    }
  })
})

describe('llmTestErrorText:把机器话翻译成用户能动手改的线索', () => {
  it('401/403 指向密钥,404 指向地址或模型名,429 指向额度', () => {
    expect(llmTestErrorText('http 401')).toContain('密钥')
    expect(llmTestErrorText('http 403')).toContain('密钥')
    expect(llmTestErrorText('http 404')).toContain('模型名')
    expect(llmTestErrorText('http 429')).toContain('额度')
  })

  it('码原样带上 —— 那是用户唯一能自己动手改的线索', () => {
    expect(llmTestErrorText('http 401')).toContain('401')
    expect(llmTestErrorText('http 404')).toContain('404')
    expect(llmTestErrorText('http 500')).toContain('500')
  })

  it('未收录的 5xx 也不吞码', () => {
    expect(llmTestErrorText('http 502')).toBe('接口返回 502')
  })

  it('网络/超时/地址没填全各有说法', () => {
    expect(llmTestErrorText('timeout')).toContain('超时')
    expect(llmTestErrorText('network')).toContain('连不上')
    expect(llmTestErrorText('network')).toContain('授权')
    expect(llmTestErrorText('badurl')).toContain('http://')
    expect(llmTestErrorText('unconfigured')).toContain('填全')
  })

  it('未知标签兜底,不把英文原文糊到界面上', () => {
    expect(llmTestErrorText('ECONNREFUSED')).toBe('连接失败')
    expect(llmTestErrorText('')).toBe('连接失败')
  })
})

describe('llmTestLabel / llmTestFailed:按钮那行文字', () => {
  it('四个阶段各自的文案', () => {
    expect(llmTestLabel({ phase: 'idle' })).toBe('测试连接')
    expect(llmTestLabel({ phase: 'testing' })).toBe('测试中…')
    expect(llmTestLabel({ phase: 'ok' })).toBe('连接正常')
    expect(llmTestLabel({ phase: 'fail', error: 'http 401' })).toContain('401')
  })

  it('只有 fail 算坏消息(ok 不该被标红)', () => {
    const states: LlmTestState[] = [
      { phase: 'idle' },
      { phase: 'testing' },
      { phase: 'ok' },
      { phase: 'fail', error: 'x' },
    ]
    expect(states.map(llmTestFailed)).toEqual([false, false, false, true])
  })
})

describe('testLlmConnection:打完就收,不花用户的钱和时间', () => {
  const okBody = { ok: true, status: 200 }
  const cfg = { baseUrl: 'https://a.com/v1', apiKey: 'sk-x', model: 'm', timeoutMs: 8000 }

  it('打的是真正会用的那个端点(不是 /models 列表)', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return { ok: true, status: 200 } as Response
    }) as typeof fetch

    expect(await testLlmConnection(cfg)).toEqual({ ok: true })
    expect(calls[0].url).toBe('https://a.com/v1/chat/completions')
    expect(calls[0].body).toMatchObject({ model: 'm', max_tokens: 1, stream: false })
  })

  it('带 Bearer 头', async () => {
    let auth = ''
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      auth = String((init.headers as Record<string, string>).Authorization)
      return okBody as Response
    }) as typeof fetch
    await testLlmConnection(cfg)
    expect(auth).toBe('Bearer sk-x')
  })

  it('HTTP 错误码原样上报,由文案层翻译', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 401 }) as Response) as typeof fetch
    expect(await testLlmConnection(cfg)).toEqual({ ok: false, error: 'http 401' })
  })

  it('抛异常 → network(超时另有标记)', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    expect(await testLlmConnection(cfg)).toEqual({ ok: false, error: 'network' })
  })

  it('测试超时上限压到 10s —— 配置再长也不陪着等', async () => {
    // 断言行为而非时长:给 30s 配置,让 fetch 永不 resolve,看它在 10s 内被 abort。
    // (用假 timer 会连带 vitest 自己的超时一起假掉,索性直接验 AbortController 收到信号)
    let aborted = false
    globalThis.fetch = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true
          rej(new Error('aborted'))
        })
      })) as typeof fetch
    const r = await testLlmConnection({ ...cfg, timeoutMs: 200 })
    expect(r).toEqual({ ok: false, error: 'timeout' })
    expect(aborted).toBe(true)
  })
})
