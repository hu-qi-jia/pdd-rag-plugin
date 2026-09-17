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

/**
 * 候选类别 → 用户可见的中文名(第五十一轮单点化)。
 *
 * 此前这段三元表达式在内容脚本里抄了 **5 份**(徽标 1 处 + 「已填充:…」提示 4 处),
 * 其中徽标那份写的是「历史」、提示那 4 份写的是「历史回忆」—— 同一条候选,
 * 看到的标签和提示语说的是两个词。设计文档 §八 的类别 chip 名是「历史」,
 * 故单点在这里,两处取同一个词。
 */
export function kindLabel(kind: Suggestion["kind"]): string {
  return kind === "golden" ? "标准回答" : kind === "knowledge" ? "知识库" : "历史";
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
 * 面板导航键移动选中项(2026-09-16 第二十一轮引入,第二十四轮改循环):
 * 当前选中项 ± delta,循环切换 —— 末条再按回绕到首条(用户指定;
 * Shift+Tab 反向已删,只保留单键"下一个")。
 */
export function moveSelection(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

// ─── 覆盖层几何(第三十一轮自 pdd-ai-button.ts 内联算术提取,逐式等价)────────
// 输入一律是 getBoundingClientRect 语义的矩形(视口坐标),DOM/设计系统无关。

export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
}

/** 视口内边距(popupPosition / aiButtonX 的贴边最小距离) */
const VIEWPORT_PAD = 8;
/** aiButtonX 左侧极限夹位 */
const EDGE_MIN = 4;
/** 容器上下留白(aiButtonY 夹位) */
const CONTAINER_PAD = 2;
/** 行可视判定的 1px 容差(压线不算滚出) */
const EDGE_TOLERANCE = 1;
/** 弹窗与锚的间距 */
const POPUP_GAP = 8;
/** 弹窗顶与锚顶的偏移 */
const POPUP_ANCHOR_OFFSET = 4;

/** 行矩形在消息容器可视区内?滚出上/下沿(含 1px 容差)或高度为 0 → false */
export function isRowVisible(row: RectLike, cont: RectLike): boolean {
  if (row.height <= 0) return false;
  return row.bottom > cont.top + EDGE_TOLERANCE && row.top < cont.bottom - EDGE_TOLERANCE;
}

/** AI 按钮 x:气泡右缘外 gap;右侧放不下移到气泡左侧;左右都放不下夹 4px */
export function aiButtonX(anchor: RectLike, btnW: number, viewportW: number, gap: number): number {
  if (anchor.right + gap + btnW <= viewportW - VIEWPORT_PAD) return anchor.right + gap;
  return Math.max(EDGE_MIN, anchor.left - btnW - gap);
}

/** AI 按钮 y:气泡垂直居中,夹在消息容器可视区内(上下各留 2px) */
export function aiButtonY(anchor: RectLike, cont: RectLike, btnH: number): number {
  return Math.min(
    Math.max(anchor.top + anchor.height / 2 - btnH / 2, cont.top + CONTAINER_PAD),
    cont.bottom - btnH - CONTAINER_PAD,
  );
}

/**
 * 候选弹窗位置:水平锚右侧优先 → 放不下换左侧 → 左缘越界回缩进视口;
 * 垂直按弹窗实高夹在视口内(旧实现写死内边距导致低屏气泡面板溢出,已修)。
 */
export function popupPosition(
  anchor: RectLike,
  popupW: number,
  popupH: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  let x = anchor.right + POPUP_GAP;
  if (x + popupW > viewportW - VIEWPORT_PAD) x = anchor.left - popupW - POPUP_GAP;
  if (x < VIEWPORT_PAD)
    x = Math.max(VIEWPORT_PAD, Math.min(viewportW - popupW - VIEWPORT_PAD, anchor.left));
  const maxTop = Math.max(VIEWPORT_PAD, viewportH - popupH - VIEWPORT_PAD);
  const y = Math.max(VIEWPORT_PAD, Math.min(anchor.top - POPUP_ANCHOR_OFFSET, maxTop));
  return { x, y };
}

/**
 * 选中行滚进可视区的 scrollTop 校正:首条直接归零(回绕回顶,避开浮点残差);
 * 行被 sticky 头部遮住上滚差值;行超出容器底下滚差值;其余不动。
 */
export function scrollForSelection(
  scrollTop: number,
  cont: RectLike,
  row: RectLike,
  headH: number,
  selected: number,
): number {
  if (selected === 0) return 0;
  const topLimit = cont.top + headH;
  if (row.top < topLimit) return scrollTop - (topLimit - row.top);
  if (row.bottom > cont.bottom) return scrollTop + (row.bottom - cont.bottom);
  return scrollTop;
}
