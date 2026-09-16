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
