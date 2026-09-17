/**
 * 设置页「AI 整合」表单的纯逻辑:主机权限推导 / 测试连接文案 / 表单完备性。
 *
 * 为什么单独一份 isLlmConfigured:UI 层不 import background(全仓无此先例,
 * 也是 popup 打包体积与分层的既有约定),于是判据在两个进程边界各有一份实现。
 * 一致性不靠自觉,靠 llm-form.test.ts 里那张对照表 —— 两边对同一组输入必须同判。
 */
import type { PddSettings } from '../types/memory'

/** 表单里与"配没配好"有关的三个字段 */
export interface LlmFormFields {
  baseUrl: string
  apiKey: string
  model: string
}

/**
 * 表单字段 ↔ 设置字段的**唯一**映射处。
 *
 * 设置里这三个字段带 `llm` 前缀(llmBaseUrl/llmApiKey/llmModel),表单里不带 ——
 * 两个名字都"看起来对",所以写错不会有任何提示:`{...draft, ...llm}` 展开后
 * 多出来的键既不过 TS 的多余属性检查,PddSettings 那一侧读到的又只是旧值。
 * 第四十八轮的"保存后内容全消失"就是这么来的:提交没写进去、回填把表单清空。
 * 于是映射收敛成下面两个函数,任何一处需要转换都必须走它们。
 */
export type LlmSettingsFields = Pick<PddSettings, 'llmBaseUrl' | 'llmApiKey' | 'llmModel'>

export function llmSettingsPatch(f: LlmFormFields): LlmSettingsFields {
  return { llmBaseUrl: f.baseUrl, llmApiKey: f.apiKey, llmModel: f.model }
}

export function llmFormFromSettings(s: LlmSettingsFields): LlmFormFields {
  return { baseUrl: s.llmBaseUrl, apiKey: s.llmApiKey, model: s.llmModel }
}

/** 表单值是否与设置一致(逐字段比,不依赖对象身份;调用方负责先把设置转成表单形) */
export function sameLlmFields(a: LlmFormFields, b: LlmFormFields): boolean {
  return a.baseUrl === b.baseUrl && a.apiKey === b.apiKey && a.model === b.model
}

/** 三项都填了才算配好(与 background/llm.ts 的 isLlmConfigured 同判据) */
export function llmFormReady(f: LlmFormFields): boolean {
  return !!f.baseUrl.trim() && !!f.apiKey.trim() && !!f.model.trim()
}

/**
 * baseUrl → MV3 可选主机权限表达式。
 * 取 **origin**(协议 + 主机 + 端口),路径部分不参与匹配 ——
 * 用户可能填 `https://api.deepseek.com/v1`,也可能填 `https://api.deepseek.com`,
 * 两者要的是同一条权限。非法地址/非 http(s) 返回 [](调用方据此跳过申请)。
 */
export function originsForBaseUrl(baseUrl: string): string[] {
  let u: URL
  try {
    u = new URL(baseUrl.trim())
  } catch {
    return []
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return []
  return [`${u.protocol}//${u.host}/*`]
}

/** 「测试连接」这一枚按钮的状态机 */
export type LlmTestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok' }
  | { phase: 'fail'; error: string }

/**
 * 测试结果 → 用户看得懂的话。HTTP 状态码原样带上:那是用户唯一能自己动手改的线索
 * (401/403 换密钥、404 换地址或模型名),糊成一句"失败"等于把线索扔了。
 */
export function llmTestErrorText(raw: string): string {
  const m = /^http (\d+)$/.exec(raw)
  if (m) {
    const code = m[1]
    if (code === '401' || code === '403') return `API 拒绝了该密钥(${code})`
    if (code === '404') return '接口地址或模型名不对(404)'
    if (code === '429') return '请求过于频繁或额度不足(429)'
    return `接口返回 ${code}`
  }
  if (raw === 'badurl') return '请先把接口地址填完整(要以 http:// 或 https:// 开头)'
  if (raw === 'unconfigured') return '接口地址 / API Key / 模型名还没填全'
  if (raw === 'timeout') return '连接超时,请检查地址与网络'
  if (raw === 'network') return '连不上:检查地址、网络或代理,以及是否已授权该域名'
  return '连接失败'
}

export function llmTestLabel(s: LlmTestState): string {
  switch (s.phase) {
    case 'idle':
      return '测试连接'
    case 'testing':
      return '测试中…'
    case 'ok':
      return '连接正常'
    case 'fail':
      return llmTestErrorText(s.error)
  }
}

/** 结果是否为"坏消息"(决定按钮/文字走语义色还是中性色) */
export function llmTestFailed(s: LlmTestState): boolean {
  return s.phase === 'fail'
}
