/**
 * PDD 聊天页气泡锚点解析(content UI 纯 DOM 逻辑,与平台无关,可单测)。
 *
 * 背景(2026-09-15 用户反馈「AI回复按钮压住气泡」):
 * 真实结构为 li.onemsg > .buyer-item > div[currentuid] > .msg-content > p.msg-content-box,
 * 气泡的底色/圆角/内边距挂在上层容器上,而 p.msg-content-box 只是文本块 ——
 * 它的 rect 右缘落在气泡内边距之内(实测短约 10px)。按 p 的右缘 +12px 放按钮,
 * 扣掉内边距后视觉间距只剩 ~1px,看上去就是「压住气泡」。
 *
 * 做法:自文本块向上,吸收「有不透明背景色 且 宽度贴近文本块」的祖先,取最外层者作气泡本体;
 * 宽度守卫用于排除整行容器上的底色(那不是气泡,会把按钮推到行外)。
 * 兜底:文本块的直属容器(.msg-content,真机上就是气泡包裹层),再退文本块自身。
 */

/** 宽度容差(px):气泡左右内边距 + 圆角的合理余量;超出即认定为整行背景 */
export const BUBBLE_WIDTH_TOLERANCE = 48

/** 背景色是否为「透明/无背景」:空串、transparent、none、alpha=0 都算 */
export function isTransparentColor(color: string | null | undefined): boolean {
  if (!color) return true
  const c = color.trim().toLowerCase()
  if (c === 'transparent' || c === 'none') return true
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (!m) return false
  const parts = m[1].split(',').map((s) => parseFloat(s))
  return parts.length >= 4 && !(parts[3] > 0)
}

/**
 * 求气泡本体元素。
 * @param box     买家文本块(.msg-content-box)
 * @param limit   上界(通常是 .buyer-item):该元素及更外层不参与判定 —— 那是整行,
 *                把按钮锚到行上会被推到行外
 * @param widthOf 宽度测量(默认 getBoundingClientRect().width;单测可注入,
 *                happy-dom 不做布局,rect 恒为 0)
 */
export function findBubbleElement(
  box: Element,
  limit?: Element | null,
  widthOf: (el: HTMLElement) => number = (el) => el.getBoundingClientRect().width,
): HTMLElement {
  const start = box as HTMLElement
  const boxW = widthOf(start)
  const parent =
    start.parentElement instanceof HTMLElement && start.parentElement !== limit
      ? start.parentElement
      : start
  let outmost: HTMLElement = parent
  for (let el: HTMLElement | null = start; el && el !== limit; el = el.parentElement) {
    const bg = typeof getComputedStyle === 'function' ? getComputedStyle(el).backgroundColor : ''
    if (isTransparentColor(bg)) continue
    // 整行背景(宽度远超文本块)不是气泡本体
    if (widthOf(el) - boxW > BUBBLE_WIDTH_TOLERANCE) continue
    outmost = el
  }
  return outmost
}
