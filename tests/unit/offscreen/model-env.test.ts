import { describe, expect, it } from 'vitest'
import { configureLocalModelEnv, toLocalModelErrorMessage } from '../../../src/offscreen/model-env'

function fakeEnv() {
  return {
    allowLocalModels: false,
    allowRemoteModels: true,
    localModelPath: '',
    useBrowserCache: true,
  }
}

describe('configureLocalModelEnv —— 模型内置后 offscreen 必须纯本地', () => {
  it('四项 env 全部落位:本地开、远程关、路径指向扩展内 model/、关浏览器缓存', () => {
    const env = fakeEnv()
    const seen: string[] = []
    configureLocalModelEnv(env, (p) => {
      seen.push(p)
      return `chrome-extension://abcd/${p}`
    })
    expect(env.allowLocalModels).toBe(true)
    expect(env.allowRemoteModels).toBe(false)
    expect(env.localModelPath).toBe('chrome-extension://abcd/model/')
    expect(env.useBrowserCache).toBe(false)
    expect(seen).toEqual(['model/'])
  })
})

describe('toLocalModelErrorMessage —— 本地加载失败必须给出可行动文案', () => {
  it('保留原始错误并附「重新安装扩展」指引', () => {
    const msg = toLocalModelErrorMessage('TypeError: Failed to fetch')
    expect(msg).toContain('重新安装扩展')
    expect(msg).toContain('Failed to fetch')
  })
})
