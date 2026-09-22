// ─── 填充消息(popup → SW → content,P3)───────────────────────────────────────
// 金标准卡"填充"按钮:SW 找到聊天页 tab 经 tabs.sendMessage 转发到 content。

import type { MetricItemKind } from '../../shared/metrics'

export interface FillInputRequest {
  type: 'FILL_INPUT'
  payload: {
    text: string
    /**
     * 来源标注(可选,v0.16):弹窗里的填充也走 SW 转发,顺手在此记账 ——
     * 填充成功才计,失败不计(见 background/index.ts#fillToChatPage)。
     * 不填则只填充、不计数(如未来的临时文本填充)。
     */
    itemKind?: MetricItemKind
    itemId?: string
  }
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
