/**
 * 细滚动条统一规格(v3.0:悬浮显现、**方角**滑块、6px 细轨)。
 *
 * v2.6 的滑块是胶囊端(9999px);v3.0 全直角,滑块一并改方 —— 滚动条是 popup 与
 * 聊天页面板**共有的**一件 chrome,它的形状跟着设计语言走,不单独豁免。
 *
 * 历史(2026-09-16 第二十三轮):由两处各写一份改为共用生成器。
 * 两处调用共享同一份生成逻辑,改宽度/最小滑块高只动这里:
 *  - popup「设置」等页签滚动容器:RESET_CSS 以 `.pddcs-scroll` 落地,
 *    滑块色走 CSS 变量(--pddcs-scroll-thumb,主题切换免重建);
 *  - 聊天页推荐回复面板:buildOverlayCss 以 `.pddcs-popup` 落地,
 *    滑块色直接内插 scrollThumb 令牌(主题切换整体重建样式,无变量桥)。
 * 本模块保持纯逻辑(不触碰 chrome/DOM)。
 */

/** 轨道宽度(px):用户口径"比浏览器默认细很多",6px = 细而不失可抓握 */
export const SCROLLBAR_WIDTH = 6

/** 滑块最小高度(px):长列表下滑块不至于缩成一点 */
export const SCROLLBAR_MIN_THUMB = 36

/**
 * 生成一段 hover 显现式细滚动条 CSS。
 * @param selector 滚动容器选择器(可复数,如 `.a, .b`)
 * @param thumbColor 滑块色:CSS 变量或直接颜色值,由调用方按场景决定
 */
export function thinScrollbarCss(selector: string, thumbColor: string): string {
  return `
${selector} { scrollbar-width: thin; scrollbar-color: transparent transparent; }
${selector}:hover { scrollbar-color: ${thumbColor} transparent; }
${selector}::-webkit-scrollbar { width: ${SCROLLBAR_WIDTH}px; height: ${SCROLLBAR_WIDTH}px; }
${selector}::-webkit-scrollbar-thumb {
  background: transparent; border-radius: 0; border: 2px solid transparent;
  background-clip: content-box; min-height: ${SCROLLBAR_MIN_THUMB}px;
}
${selector}:hover::-webkit-scrollbar-thumb {
  background: ${thumbColor}; background-clip: content-box;
}`
}
