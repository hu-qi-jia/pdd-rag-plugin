// P2-4 content UI 纯逻辑(chrome/DOM 无关,可单测)。
// UI 行为状态机见设计文档 §6.3:直填开关开 → 永远直填最高分;
// 关 → 永远弹推荐回复面板由人工选(2026-09-15 用户反馈:开关关就不该静默直填,
// 原实现"单候选免面板直填"与开关语义冲突,已移除),无候选仅提示。
// 面板条数由检索侧类别配额决定(标准回答/历史/知识库各至多 3,见 retrieval.ts#PANEL_QUOTA),
// 此处不再截断。

import type { Suggestion } from "../types/messages";

export type UiAction =
  | { action: "none" }
  | { action: "fill"; fillIndex: number }
  | { action: "popup"; items: Suggestion[] };

/**
 * 连续买家行文本合并为检索 query:按时间序换行拼接,剔除空行,
 * 超长保留尾部(点击行是最新消息,是检索锚,不能被截掉)。
 */
export function mergeBuyerQuery(texts: string[], maxChars = 800): string {
  const joined = texts
    .map((t) => (t ?? "").trim())
    .filter((t) => t.length > 0)
    .join("\n");
  if (joined.length <= maxChars) return joined;
  return joined.slice(-maxChars);
}

/** 候选列表 + 直填开关 → UI 动作 */
export function decideUiAction(
  suggestions: Suggestion[],
  directFillEnabled: boolean,
): UiAction {
  if (suggestions.length === 0) return { action: "none" };
  if (directFillEnabled) return { action: "fill", fillIndex: 0 };
  return { action: "popup", items: suggestions };
}

/**
 * 面板 ↑↓ 键盘导航(2026-09-16 第二十一轮):当前选中项 ± delta,
 * 夹取在 [0, count-1],到端点停住不回绕(候选 ≤ 9 条,回绕反而跳来跳去)。
 */
export function moveSelection(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + delta));
}
