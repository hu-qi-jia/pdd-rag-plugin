/**
 * 聊天页覆盖层图标(第三十七轮 2026-09-16):候选行操作钮由**文字**改**图标**——
 * 「设置标准回答」→ 星标、「复制」→ 复制图标(用户指定)。
 *
 * 为什么是字符串而不是 React 组件:
 *  - 覆盖层挂在平台页面 body 下(见 contents/pdd-ai-button.ts),是纯 DOM,
 *    不引 React 运行时;故这里只导出 **SVG 字面量**,由内容脚本 innerHTML 挂载。
 *
 * 口径(与 popup 的 lucide-react 图标钮**同源同档**,不产生第二套图标语言):
 *  - 路径数据取自 lucide-react@0.575.0 的 `star` / `copy` / `loader-circle`
 *    (`defaultAttributes`:24×24 画布 / fill none / stroke currentColor / 2px 描边 / 圆角线帽);
 *  - 渲染尺寸 13px,与 popup 行内图标钮(24px 钮 × 13px 图标)一致;
 *  - `currentColor` 继承,CSS 里由 `.pddcs-icon-btn` 决定颜色(含金色已设态)。
 */
import { controlH, size } from './design'

/** 图标渲染边长(与 popup 行内图标钮同档;钮本身取 controlH.inline)。
 *  第五十一轮起取自 `design.size.icon` —— 与 popup 的 FoldersTab.ICON_SIZE 同源。 */
export const ICON_SIZE = size.icon

/** 图标钮边长:与 popup 行悬浮图标钮严格同档(等高铁律:同行控件同档) */
export const ICON_BTN_SIZE = controlH.inline

/** lucide star —— 未设标准回答态(描边星) */
const STAR_PATH =
  'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'

/** lucide copy —— 复制答复 */
const COPY_BODY =
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>' +
  '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>'

/** lucide loader-circle —— 请求在途时的转圈(替代原「设置中…」文字反馈) */
const LOADER_PATH = 'M21 12a9 9 0 1 1-6.219-8.56'

/**
 * 拼一张图标 SVG。
 * @param body   内层元素(路径/矩形)
 * @param filled 是否实心(fill=currentColor):已设标准回答的金色实心星用它
 */
function svg(body: string, filled = false): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}"` +
    ` viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor"` +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' aria-hidden="true" focusable="false">' +
    body +
    '</svg>'
  )
}

/** 星标(未设标准回答):点击 = 设为标准回答 */
export const STAR_ICON = svg(`<path d="${STAR_PATH}"></path>`)

/** 星标(已设标准回答,实心金色):点击 = 取消标准回答 */
export const STAR_FILLED_ICON = svg(`<path d="${STAR_PATH}"></path>`, true)

/** 复制图标 */
export const COPY_ICON = svg(COPY_BODY)

/** 在途转圈(设置/取消标准回答请求期间替代图标) */
export const LOADER_ICON = svg(`<path d="${LOADER_PATH}"></path>`)
