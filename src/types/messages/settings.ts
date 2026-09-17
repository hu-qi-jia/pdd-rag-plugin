// ─── 设置消息(popup → SW,P3)──────────────────────────────────────────────────

import type { PddSettings } from '../memory'

export interface UpdateSettingsRequest {
  type: 'UPDATE_SETTINGS'
  payload: Partial<PddSettings>
}

export interface UpdateSettingsResponse {
  type: 'UPDATE_SETTINGS_RESPONSE'
  payload: { settings?: PddSettings; error?: string }
}

/**
 * 测试 LLM 连接(P4)。**带配置体**:设置页要能"先测再存",
 * 拿表单里的草稿去测,而不是拿库里那份旧配置 —— 否则用户改完地址点测试,
 * 测的还是改之前的那份,结论毫无意义。
 */
export interface TestLlmRequest {
  type: 'TEST_LLM'
  payload: { baseUrl: string; apiKey: string; model: string; timeoutMs: number }
}

export interface TestLlmResponse {
  type: 'TEST_LLM_RESPONSE'
  payload: { ok: boolean; error?: string }
}
