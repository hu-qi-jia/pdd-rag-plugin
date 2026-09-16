// ─── 填充消息(popup → SW → content,P3)───────────────────────────────────────
// 金标准卡"填充"按钮:SW 找到聊天页 tab 经 tabs.sendMessage 转发到 content。

export interface FillInputRequest {
  type: 'FILL_INPUT'
  payload: { text: string }
}

export interface FillInputResponse {
  type: 'FILL_INPUT_RESPONSE'
  payload: { success: boolean; error?: string }
}

/** SW → content(不经 ExtensionMessage 并集,走 tabs.sendMessage) */
export interface ContentFillMessage {
  type: 'PDD_FILL_INPUT'
  payload: { text: string }
}

export interface ContentFillResponse {
  type: 'PDD_FILL_INPUT_RESPONSE'
  payload: { success: boolean; error?: string }
}
