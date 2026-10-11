/**
 * 设置页「问题自动分类」表单的纯逻辑:测试连接文案 / 表单完备性 / 字段映射。
 *
 * 与 `llm-form.ts` 是**同构**的两个文件:同形不同字段,谁改了结构另一份就该跟着改。
 * 分开写而不是抽成泛型,是因为字段名(带 jev 前缀)与文案(jev 拒绝密钥 / 401 的说法)
 * 都要各说各的 —— 共用一份抽象会让"改了一处忘了另一处"有处可藏。
 *
 * 主机权限推导 `originsForBaseUrl` **不在这里复制第二份**:它本就是通用的
 * origin 推导(协议 + 主机 + 端口),与 llm/jev 无关,只住在 `llm-form.ts`,
 * 需要的一方直接 import。复制一份出来才是"改了一个忘了另一个"的藏身处。
 *
 * 为什么单独一份 jevFormReady:UI 层不 import background(全仓无此先例,也是
 * popup 打包体积与分层的既有约定),于是判据在两个进程边界各有一份实现。
 * 一致性不靠自觉,靠 jev-form.test.ts 里那张对照表 —— 两边对同一组输入必须同判。
 */
import type { PddSettings } from '../types/memory'

/** 表单里与"配没配好"有关的三个字段 */
export interface JevFormFields {
  baseUrl: string
  apiKey: string
  model: string
}

/**
 * 表单字段 ↔ 设置字段的**唯一**映射处。
 *
 * 设置里这三个字段带 `jev` 前缀(jevBaseUrl/jevApiKey/jevModel),表单里不带 ——
 * 这与 llm 那对是同样的坑:两个名字都"看起来对",写错不会报错只会静默丢值。
 * 映射收敛成下面两个函数,任何一处需要转换都必须走它们。
 */
export type JevSettingsFields = Pick<PddSettings, 'jevBaseUrl' | 'jevApiKey' | 'jevModel'>

export function jevSettingsPatch(f: JevFormFields): JevSettingsFields {
  return { jevBaseUrl: f.baseUrl, jevApiKey: f.apiKey, jevModel: f.model }
}

export function jevFormFromSettings(s: JevSettingsFields): JevFormFields {
  return { baseUrl: s.jevBaseUrl, apiKey: s.jevApiKey, model: s.jevModel }
}

/** 表单值是否与设置一致(逐字段比,不依赖对象身份;调用方负责先把设置转成表单形) */
export function sameJevFields(a: JevFormFields, b: JevFormFields): boolean {
  return a.baseUrl === b.baseUrl && a.apiKey === b.apiKey && a.model === b.model
}

/** 三项都填了才算配好(与 background/jev.ts 的 isJevConfigured 同判据 —— 这是两份实现) */
export function jevFormReady(f: JevFormFields): boolean {
  return !!f.baseUrl.trim() && !!f.apiKey.trim() && !!f.model.trim()
}

/** 「测试连接」这一枚按钮的状态机 */
export type JevTestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok' }
  | { phase: 'fail'; error: string }

/**
 * 测试结果 → 用户看得懂的话。HTTP 状态码原样带上:那是用户唯一能自己动手改的线索
 * (401/403 换密钥、404 换地址或模型名),糊成一句"失败"等于把线索扔了。
 */
export function jevTestErrorText(raw: string): string {
  const m = /^http (\d+)$/.exec(raw)
  if (m) {
    const code = m[1]
    if (code === '401' || code === '403') return `jev 服务拒绝了该密钥(${code})`
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

export function jevTestLabel(s: JevTestState): string {
  switch (s.phase) {
    case 'idle':
      return '测试连接'
    case 'testing':
      return '测试中…'
    case 'ok':
      return '连接正常'
    case 'fail':
      return jevTestErrorText(s.error)
  }
}

/** 结果是否为"坏消息"(决定按钮/文字走语义色还是中性色) */
export function jevTestFailed(s: JevTestState): boolean {
  return s.phase === 'fail'
}
