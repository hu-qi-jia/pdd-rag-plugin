/**
 * PDD 聊天工作台 —— AI 回复按钮 + 候选弹窗 + 直填(ISOLATED,P2-4)
 *
 * 交互(设计文档 §6.3):
 *  - 每条可见买家文本气泡右侧紧跟「AI回复」胶囊按钮(Figma 官网控件风格)
 *  - 点击 → 合并该行向上连续买家文本为 query → SW GET_SUGGESTIONS
 *  - 状态机:无候选提示 / 单候选或直填开关开 → 直填 / 多候选弹推荐回复面板
 *    (条数 = 检索侧类别配额:标准回答/历史/知识库各至多 3;
 *     快捷键唤起的面板与此完全同构,共用 openPopup)
 *  - 快捷键面板(自动回复关):Tab/Shift+Tab 移动选中项(键可在设置自定义,
 *    第二十二轮;↑↓ 与平台切换会话冲突已让位),Enter 填充**选中项**
 *    (鼠标悬浮同步选中,两套高亮共用一态)
 *  - 弹窗:金标准徽标+置顶、同内容×n、原始问题摘要、设为金标准、仅复制
 *  - 主题:覆盖层跟随 popup 的主题设置(storage pddcs:theme + onChanged 实时切换,
 *    2026-09-15 设计1;样式生成纯逻辑见 ui/overlay-css.ts)
 *
 * 边界(不逾越):
 *  - 只填充官方输入框 textarea#replyTextarea(原生 value setter + input 事件,
 *    2026-09-08 真机校准通过),发送永远由人工点击 —— 绝不自动发送;
 *  - UI 不进 Vue 管理的子树:统一挂在 body 下的 fixed 覆盖层,按行坐标渲染,
 *    防止平台重渲染把注入节点清掉(买家行 rect 可滚出容器,必须按可见性裁剪)。
 */
import type { PlasmoCSConfig } from 'plasmo'
import type { Suggestion, UiSettings } from '../types/messages'
import {
  aiButtonX,
  aiButtonY,
  decideUiAction,
  isRowVisible,
  mergeBuyerQuery,
  moveSelection,
  popupPosition,
  scrollForSelection,
  type UiAction,
} from '../pdd/ui-logic'
import { findBubbleElement } from '../pdd/bubble-anchor'
import { DEFAULT_HOTKEY, DEFAULT_SETTINGS, MAX_GOLDENS_PER_QUESTION, SETTINGS_STORAGE_KEY } from '../shared/constants'
import type { PddSettings } from '../types/memory'
import { formatHotkey, isModifierOnly, matchesHotkey } from '../shared/hotkey'

import {
  THEME_STORAGE_KEY,
  POPUP_W,
  buildOverlayCss,
  parseThemeMode,
} from '../ui/overlay-css'
import {
  COPY_ICON,
  LOADER_ICON,
  STAR_FILLED_ICON,
  STAR_ICON,
} from '../ui/overlay-icons'
import { controlH, spacing } from '../ui/design'
import { getThemeTokens, type ThemeMode } from '../ui/theme'

export const config: PlasmoCSConfig = {
  matches: ['https://mms.pinduoduo.com/chat-merchant/*'],
}

const DEBUG = false
const SCAN_MS = 800 // 按钮重排周期(轻量:几十行 getBoundingClientRect)
const ROW_SEL = '#msgListContainer li.onemsg'
const LIST_SEL = '#msgListContainer'
const INPUT_SEL = '#replyTextarea'
const OVERLAY_ID = 'pddcs-overlay'
const STYLE_ID = 'pddcs-style'
const MAX_QUERY_CHARS = 800

// ─── 覆盖层与样式(主题跟随 popup 设置,2026-09-15 设计1)───────────────────────

/** 当前主题;样式整体由 buildOverlayCss 按令牌生成,切换即重建 */
let currentTheme: ThemeMode = 'light'

function applyOverlayTheme(theme: ThemeMode): void {
  currentTheme = theme
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = buildOverlayCss(getThemeTokens(theme))
  // 面板开着时切主题:同步内联背景(见 openPopup 的不透明双保险)
  if (popupEl) popupEl.style.backgroundColor = getThemeTokens(theme).bg
}

/** Lucide "sparkles" 图标已按用户要求移除(2026-09-15):按钮为纯文字胶囊 */
const AI_BTN_W = 72 // "AI回复" 纯文字胶囊预估宽度(首帧尚未排版时定位用)
const BTN_GAP = spacing.xl // 气泡与按钮的间距(实测按真实气泡右缘计,不再按 <p> 内缘)

function ensureOverlay(): HTMLDivElement {
  let overlay = document.getElementById(OVERLAY_ID) as HTMLDivElement | null
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = OVERLAY_ID
    document.body.appendChild(overlay)
  }
  if (!document.getElementById(STYLE_ID)) applyOverlayTheme(currentTheme)
  return overlay
}

// ─── toast ────────────────────────────────────────────────────────────────────

let toastTimer = 0
function toast(text: string): void {
  const overlay = ensureOverlay()
  let el = overlay.querySelector('.pddcs-toast') as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.className = 'pddcs-toast'
    overlay.appendChild(el)
  }
  el.textContent = text
  el.classList.add('show')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), 2400)
}

// ─── 填充(只写输入框,绝不发送)────────────────────────────────────────────────

/** 校准过的填充方式:原生 value setter + input 事件(Vue/受控组件可感知) */
function fillInput(text: string): boolean {
  const el = document.querySelector(INPUT_SEL) as HTMLTextAreaElement | null
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set
  if (!el || !setter) return false
  setter.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
  return true
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

// ─── 买家行识别与 query 合并 ───────────────────────────────────────────────────

/** 是买家文本行则返回正文,否则 null(客服行/图片行/系统行) */
function buyerRowText(li: Element): string | null {
  if (li.querySelector('.cs-item')) return null
  const text = (li.querySelector('.buyer-item .msg-content-box')?.textContent ?? '').trim()
  return text || null
}

// ─── 气泡可视矩形 ─────────────────────────────────────────────────────────────
//
// 真实结构:li.onemsg > .buyer-item > div[currentuid] > .msg-content > p.msg-content-box
// 气泡底色与内边距挂在上层容器上,<p> 的 rect 右缘落在气泡 padding 之内。
// 2026-09-15 用户反馈「按钮压住气泡」实测根因:按 <p> 右缘 +12px 定位,扣掉约 10px 的
// 气泡内边距后视觉间距只剩 ~1px。故改为向上吸收有背景色的祖先,取最外层带背景者
// 作锚(算法见 pdd/bubble-anchor.ts,含单测)。

/** 行 → 真实气泡元素(WeakMap 缓存:DOM 结构跨轮稳定,免每轮 getComputedStyle) */
const bubbleCache = new WeakMap<Element, HTMLElement>()

function resolveBubble(li: Element): HTMLElement | null {
  const cached = bubbleCache.get(li)
  if (cached?.isConnected) return cached
  const box = li.querySelector('.buyer-item .msg-content-box')
  if (!(box instanceof HTMLElement)) return null
  const bubble = findBubbleElement(box, li.querySelector('.buyer-item'))
  bubbleCache.set(li, bubble)
  return bubble
}

/** 点击行 + 向上连续买家行(时间序)合并为检索 query */
function buildQuery(clicked: Element): string {
  const texts: string[] = []
  let cur: Element | null = clicked
  while (cur) {
    const t = buyerRowText(cur)
    if (t === null) break
    texts.push(t)
    cur = cur.previousElementSibling
  }
  return mergeBuyerQuery(texts.reverse(), MAX_QUERY_CHARS)
}

// ─── AI 按钮:按可见买家行渲染(fixed 覆盖层,不进 Vue 子树)───────────────────

const rowBtns = new Map<Element, HTMLButtonElement>()

function scanButtons(): void {
  const overlay = ensureOverlay()
  const list = document.querySelector(LIST_SEL)
  const cont = list?.getBoundingClientRect()
  if (!cont || cont.width <= 0) {
    // 会话面板未挂载/隐藏:清空按钮
    for (const [, btn] of rowBtns) btn.remove()
    rowBtns.clear()
    return
  }

  const wanted = new Set<Element>()
  for (const li of document.querySelectorAll(ROW_SEL)) {
    if (buyerRowText(li) === null) continue
    const rect = li.getBoundingClientRect()
    // 行滚出消息容器可视区(校准实测 y 可为负)→ 不挂按钮
    if (!isRowVisible(rect, cont)) continue
    wanted.add(li)

    let btn = rowBtns.get(li)
    if (!btn) {
      btn = document.createElement('button')
      btn.className = 'pddcs-ai-btn'
      btn.title = 'AI 检索历史回复'
      btn.innerHTML = `<span class="pddcs-ai-btn-label">AI回复</span>`
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation()
        void onButtonClick(li, btn!)
      })
      overlay.appendChild(btn)
      rowBtns.set(li, btn)
    }
    // 锚定到买家气泡本身(真实气泡容器)右侧 —— 气泡在哪按钮就跟在哪,不再贴整行右缘
    // (行右缘距气泡太远),也不再按 <p>.msg-content-box 定位(其右缘短掉气泡内边距,
    //  会让按钮视觉上压住气泡)。气泡解析不到时退回整行矩形。
    const bubble = resolveBubble(li)
    const anchor = bubble?.getBoundingClientRect() ?? rect
    const bw = btn.offsetWidth || AI_BTN_W
    // x:气泡右缘外 BTN_GAP(真间隙);放不下则移到气泡左侧
    // y:气泡垂直居中,夹在消息容器可视区内(几何算术见 pdd/ui-logic,含单测)
    const x = aiButtonX(anchor, bw, window.innerWidth, BTN_GAP)
    const y = aiButtonY(anchor, cont, controlH.form)
    btn.style.left = `${Math.round(x)}px`
    btn.style.top = `${Math.round(y)}px`
  }

  for (const [li, btn] of rowBtns) {
    if (!wanted.has(li) || !li.isConnected) {
      btn.remove()
      rowBtns.delete(li)
    }
  }
}

// ─── 点击 → 检索 → 状态机 ─────────────────────────────────────────────────────

async function fetchSuggestions(query: string): Promise<{
  suggestions: Suggestion[]
  settings: UiSettings
  error?: string
}> {
  const fallback: UiSettings = { directFillEnabled: false, goldenPriorityEnabled: true }
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'GET_SUGGESTIONS',
      payload: { query },
    })
    const err =
      chrome.runtime.lastError?.message ?? resp?.payload?.error ?? undefined
    return {
      suggestions: resp?.payload?.suggestions ?? [],
      settings: resp?.payload?.settings ?? fallback,
      error: err,
    }
  } catch (err) {
    return { suggestions: [], settings: fallback, error: String(err) }
  }
}

async function onButtonClick(li: Element, btn: HTMLButtonElement): Promise<void> {
  closePopup()
  const query = buildQuery(li)
  if (!query) {
    toast('未取到买家消息文本')
    return
  }
  if (DEBUG) console.log('[PDD CS UI] query:', query.slice(0, 80))

  const label = btn.querySelector('.pddcs-ai-btn-label') as HTMLElement | null
  btn.disabled = true
  if (label) label.textContent = '检索中'
  const { suggestions, settings, error } = await fetchSuggestions(query)
  btn.disabled = false
  if (label) label.textContent = 'AI回复'

  if (error) {
    toast(`检索失败:${error}`)
    return
  }

  const act: UiAction = decideUiAction(suggestions, settings.directFillEnabled)
  if (DEBUG) console.log('[PDD CS UI] action:', act.action, suggestions.length)

  if (act.action === 'none') {
    toast('未找到匹配的历史回复')
    return
  }
  if (act.action === 'fill') {
    const s = suggestions[act.fillIndex]
    if (fillInput(s.text)) {
      const kindLabel = s.kind === 'golden' ? '标准回答' : s.kind === 'knowledge' ? '知识库' : '历史回忆'
      toast(
        `已填充:${kindLabel}` +
          `${(s.foldCount ?? 1) > 1 ? ` · 同内容×${s.foldCount}` : ''} · 请手动发送`,
      )
    } else {
      toast('未找到输入框,请手动粘贴')
    }
    return
  }
  openPopup(btn, act.items, query)
}

// ─── 候选弹窗 ─────────────────────────────────────────────────────────────────

let popupEl: HTMLDivElement | null = null
/**
 * 由快捷键唤起的推荐回复面板:导航键(默认 Tab,循环)移动选中项,Enter 填充**选中项**
 * (2026-09-16 第二十一轮引入,第二十四轮:Shift+Tab 反向删除,末条回绕首条;
 * 点外部/Esc 关闭即解除)。仅快捷键路径持有选中态 —— 点击「AI回复」打开的面板保持纯点击交互,不抢键盘。
 */
let armedPanel: { items: Suggestion[]; selected: number } | null = null

function closePopup(): void {
  popupEl?.remove()
  popupEl = null
  armedPanel = null
}

/** 把选中态渲染到行上:唯一高亮源,导航键与鼠标悬浮都写这里 */
function applySelection(): void {
  if (!popupEl || !armedPanel) return
  const rows = popupEl.querySelectorAll('.pddcs-cand')
  rows.forEach((r, i) => r.classList.toggle('pddcs-cand-selected', i === armedPanel!.selected))
  // 长面板(候选至多 9 条)可能出滚动条:选中项始终滚进可视区。
  // v2.6.18 三段式后滚动容器是 .pddcs-popup-body,头/脚已移出滚动视口,不再需要
  // 头部实高补偿(v2.6.17 的 sticky 遮挡问题随结构消失),headH 传 0;
  // scrollForSelection 算术不变(含单测):选中首条 → 直接归零(回绕即回顶)。
  const body = popupEl.querySelector('.pddcs-popup-body')
  const row = rows[armedPanel.selected]
  if (body instanceof HTMLElement && row instanceof HTMLElement) {
    body.scrollTop = scrollForSelection(
      body.scrollTop,
      body.getBoundingClientRect(),
      row.getBoundingClientRect(),
      0,
      armedPanel.selected,
    )
  }
}

/** 导航键移动选中项;无快捷键面板时返回 false(按键放行) */
function movePanelSelection(delta: number): boolean {
  if (!popupEl || !armedPanel) return false
  armedPanel.selected = moveSelection(armedPanel.selected, delta, armedPanel.items.length)
  applySelection()
  return true
}

function badge(kind: Suggestion['kind']): HTMLSpanElement {
  const b = document.createElement('span')
  b.className = `pddcs-badge ${kind}`
  b.textContent = kind === 'golden' ? '标准回答' : kind === 'knowledge' ? '知识库' : '历史'
  return b
}

/**
 * 图标操作钮(第三十七轮 v2.6.24,用户指定"设置标准回答用星图标、复制用图标替代")——
 * 24px 方钮 + 13px lucide 图标(与 popup 行悬浮图标钮同档同语言);
 * 无文字,语义落在 `title` 与 `aria-label` 上;`data-action` 供验收脚本稳定定位
 * (原先靠按钮文字选元素,文案一改脚本就断)。
 */
function iconBtn(icon: string, label: string, action: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'pddcs-icon-btn'
  b.dataset.action = action
  b.innerHTML = icon
  b.title = label
  b.setAttribute('aria-label', label)
  return b
}

/** 请求在途:图标原地换转圈(替代原「设置中… / 取消中…」文字反馈);收尾由 renderActions 重建 */
function setBusy(btn: HTMLButtonElement, on: boolean): void {
  btn.disabled = on
  btn.classList.toggle('pddcs-icon-btn-busy', on)
  if (on) btn.innerHTML = LOADER_ICON
}

function candidateRow(s: Suggestion, query: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'pddcs-cand'
  row.title = '点击填入输入框(不自动发送)'

  // 行内状态:该候选当前对应的标准回答 id
  //  - 候选本身就是标准回答(kind=golden)→ 进面板即可"取消";
  //  - 历史/知识库候选被设为标准回答后 → 原位翻转为"取消",无需重开面板。
  let goldenId: string | null = s.kind === 'golden' ? s.sourceId : null

  const top = document.createElement('div')
  top.className = 'pddcs-cand-top'
  top.appendChild(badge(s.kind))
  // 得分数字对客服没有决策价值,不再展示(2026-09-15 用户要求);同内容折叠数保留
  // (v2.6.25:自"行右下角悬浮才显"回到行首行、紧贴徽标右侧并常驻 —— 见 overlay-css 注释)
  const foldCount = s.foldCount ?? 1
  if (foldCount > 1) {
    const fold = document.createElement('span')
    fold.className = 'pddcs-fold'
    fold.textContent = `同内容×${foldCount}`
    fold.title = `该问题下有 ${foldCount} 条相同内容的答复(已合并为一条候选)`
    top.appendChild(fold)
  }
  const actions = document.createElement('div')
  actions.className = 'pddcs-cand-actions'
  top.appendChild(actions)
  row.appendChild(top)

  /** 设为标准回答(每问上限见 MAX_GOLDENS_PER_QUESTION,刷新后同问题多条按时间倒序) */
  const addGolden = async (btn: HTMLButtonElement): Promise<void> => {
    setBusy(btn, true)
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'ADD_GOLDEN',
        payload: {
          question: query,
          answer: s.text,
          sourceRecordId: s.sourceId,
          sourceReplyId: s.replyId,
        },
      })
      const p = resp?.payload ?? {}
      const err = chrome.runtime.lastError?.message ?? p.error
      if (err) toast(`设置标准回答失败:${err}`)
      else if (p.limitReached) toast(`该问题已有 ${p.count} 条标准回答,请先取消一条`)
      else if (p.exists) {
        goldenId = p.id ?? goldenId
        toast('该回复已是该问题的标准回答')
      } else {
        goldenId = p.id ?? goldenId
        toast(`已设为标准回答${p.count ? `(${p.count}/${MAX_GOLDENS_PER_QUESTION})` : ''}(后台自动向量化)`)
      }
    } catch (err) {
      toast(`设置标准回答失败:${String(err)}`)
    }
    renderActions()
  }

  /** 取消标准回答(仅解除该回复的"标准回答"身份,历史记录不受影响) */
  const cancelGolden = async (btn: HTMLButtonElement): Promise<void> => {
    const id = goldenId
    if (!id) return
    setBusy(btn, true)
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'DELETE_GOLDEN',
        payload: { id },
      })
      const err = chrome.runtime.lastError?.message ?? resp?.payload?.error
      if (err) toast(`取消失败:${err}`)
      else if (resp?.payload?.success === false) toast('取消失败,请稍后重试')
      else {
        goldenId = null
        toast('已取消标准回答(历史记录不受影响)')
      }
    } catch (err) {
      toast(`取消失败:${String(err)}`)
    }
    renderActions()
  }

  /**
   * 操作钮(第三十七轮 v2.6.24,用户"设置标准回答用星图标替代、复制用图标替代"):
   *  - 星标 = 设为标准回答:未设 → 描边灰星,已设 → **实心金星**(与原琥珀徽标同源语义),点击翻转;
   *  - 复制 = 复制图标(无状态)。
   * 无文字后语义全靠 title/aria-label 承载(悬浮可见,无障碍可读)。
   */
  function renderActions(): void {
    actions.textContent = ''
    const isGolden = goldenId !== null
    const goldBtn = iconBtn(
      isGolden ? STAR_FILLED_ICON : STAR_ICON,
      isGolden
        ? '取消标准回答(取消后该回复不再作为标准回答,历史问答记录不受影响)'
        : `设为标准回答(当前问题 + 该回复,每个问题最多 ${MAX_GOLDENS_PER_QUESTION} 条)`,
      'golden',
    )
    goldBtn.classList.add('pddcs-icon-btn-star')
    if (isGolden) goldBtn.classList.add('pddcs-icon-btn-golden')
    goldBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      void (isGolden ? cancelGolden(goldBtn) : addGolden(goldBtn))
    })
    const copyBtn = iconBtn(COPY_ICON, '复制该条答复文本', 'copy')
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      void copyText(s.text).then((ok) =>
        toast(ok ? '已复制到剪贴板' : '复制失败,请手动选择文本'),
      )
    })
    actions.append(goldBtn, copyBtn)
  }

  renderActions()

  // 问题回显上置为引子(v2.6.17 第二十六轮,原底部来源行移此):
  // 金标准/历史:来源是原始问题;知识库:手工条目来源是标题,文档块来源即命中片段
  const q = document.createElement('div')
  q.className = 'pddcs-cand-q'
  q.textContent = `${s.kind === 'knowledge' ? '来源' : '原问题'}:${s.sourceQuestion}`
  q.title = s.sourceQuestion
  row.appendChild(q)

  const text = document.createElement('div')
  text.className = 'pddcs-cand-text'
  text.textContent = s.text
  row.appendChild(text)

  row.addEventListener('click', () => {
    if (fillInput(s.text)) {
      const kindLabel = s.kind === 'golden' ? '标准回答' : s.kind === 'knowledge' ? '知识库' : '历史回忆'
      toast(`已填充:${kindLabel} · 请手动发送`)
      closePopup()
    } else {
      toast('未找到输入框,请手动粘贴')
    }
  })
  return row
}

function openPopup(
  anchor: HTMLElement,
  items: Suggestion[],
  query: string,
  opts: { keyboard?: boolean } = {},
): void {
  closePopup()
  const overlay = ensureOverlay()
  const el = document.createElement('div')
  el.className = 'pddcs-popup'
  // 不透明双保险(第二十三轮,用户反馈面板似半透明):本样式注入平台页面,
  // 类样式可能被页面级 !important 规则盖掉;内联背景优先级最高,直观兜底
  el.style.backgroundColor = getThemeTokens(currentTheme).bg

  const head = document.createElement('div')
  head.className = 'pddcs-popup-head'
  head.textContent = `推荐回复(${items.length})`
  const close = document.createElement('button')
  close.className = 'pddcs-popup-close'
  close.textContent = '×'
  close.title = '关闭'
  close.addEventListener('click', closePopup)
  head.appendChild(close)
  el.appendChild(head)

  // v2.6.18 三段式:滚动只发生在 body 中段,头/脚常驻成面板外壳(页脚键位提示不再滚走)
  const body = document.createElement('div')
  body.className = 'pddcs-popup-body'
  for (const [i, s] of items.entries()) {
    const row = candidateRow(s, query)
    row.dataset.idx = String(i)
    if (opts.keyboard) {
      // 键盘模式:悬浮即选中(两套高亮共用一态,避免 hover 底色与选中描边打架)
      row.addEventListener('mouseenter', () => {
        if (!armedPanel || armedPanel.selected === i) return
        armedPanel.selected = i
        applySelection()
      })
    }
    body.appendChild(row)
  }
  el.appendChild(body)

  const foot = document.createElement('div')
  foot.className = 'pddcs-popup-foot'
  if (opts.keyboard) {
    // 键位键帽化(v2.6.16 第二十五轮):Tab/Enter 渲染成小键帽,文本节点保底正常朗读/复制
    const kbdEl = (text: string): HTMLElement => {
      const k = document.createElement('kbd')
      k.className = 'pddcs-kbd'
      k.textContent = text
      return k
    }
    foot.append(
      kbdEl(formatHotkey(hotkeySettings.panelNavHotkey)),
      document.createTextNode(' 切换候选(循环),'),
      kbdEl('Enter'),
      document.createTextNode(' 填充;发送请手动点击'),
    )
  } else {
    foot.textContent = '点击候选填入输入框;发送请手动点击'
  }
  el.appendChild(foot)

  // 定位:水平方向按钮右侧优先,放不下换左侧,越界回缩;
  // 垂直方向必须按弹窗**实高**夹在视口内(几何算术见 pdd/ui-logic#popupPosition,含单测)
  const a = anchor.getBoundingClientRect()
  el.style.visibility = 'hidden'
  overlay.appendChild(el)
  // 实高向上取整:offsetHeight 是取整后的整数,会丢掉亚像素(如 336.125 → 336),
  // 差的 0.1px 恰好让面板底边压线溢出;getBoundingClientRect 保留小数
  const h = Math.ceil(el.getBoundingClientRect().height)
  const { x, y } = popupPosition(a, POPUP_W, h, window.innerWidth, window.innerHeight)
  el.style.left = `${Math.round(x)}px`
  el.style.top = `${Math.round(y)}px`
  el.style.visibility = ''
  popupEl = el
  // 键盘模式:挂载完成后初始化选中态(popupEl 就位前 applySelection 是空操作)
  if (opts.keyboard) {
    armedPanel = { items, selected: 0 }
    applySelection()
  }
}

// ─── 启动 ─────────────────────────────────────────────────────────────────────

ensureOverlay()
scanButtons()
window.setInterval(scanButtons, SCAN_MS)
// 滚动/缩放立即重排(scroll 不冒泡,用捕获阶段监听)
document.addEventListener('scroll', scanButtons, true)
window.addEventListener('resize', scanButtons)

// 点外部 / Esc 关弹窗
document.addEventListener(
  'mousedown',
  (ev) => {
    if (!popupEl) return
    const t = ev.target as Element
    if (popupEl.contains(t) || t.closest?.('.pddcs-ai-btn')) return
    closePopup()
  },
  true,
)
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closePopup()
})

// ─── 快捷键(默认 Ctrl+Enter,可在设置中自定义)─────────────────────────────────
// 「自动回复」关:检索**用户最新消息** → 弹推荐回复面板 → Tab/Shift+Tab 选候选,Enter 填充选中项;
// 「自动回复」开:检索 → 直接把第一条填入输入框。全程不自动发送。

let hotkeySettings: PddSettings = { ...DEFAULT_SETTINGS }

async function refreshHotkeySettings(): Promise<void> {
  try {
    const resp = (await chrome.runtime.sendMessage({ type: 'GET_STATS' })) as {
      payload?: { settings?: Partial<PddSettings> }
    }
    const s = resp?.payload?.settings
    if (s) hotkeySettings = { ...DEFAULT_SETTINGS, ...s } as PddSettings
  } catch {
    /* 拿不到就先用默认值 */
  }
}
// 设置在 popup 里改动 → 实时生效
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  const change = changes[SETTINGS_STORAGE_KEY]
  if (!change || typeof change.newValue !== 'object' || change.newValue === null) return
  hotkeySettings = { ...hotkeySettings, ...(change.newValue as Partial<PddSettings>) } as PddSettings
})

// 主题跟随(2026-09-15 设计1):启动读 popup 主题设置(pddcs:theme),运行期改动实时重建覆盖层样式
void (async () => {
  try {
    const stored = await chrome.storage.local.get([THEME_STORAGE_KEY])
    applyOverlayTheme(parseThemeMode(stored?.[THEME_STORAGE_KEY]))
  } catch {
    /* 读不到保持浅色默认 */
  }
})()
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  const change = changes[THEME_STORAGE_KEY]
  if (!change) return
  applyOverlayTheme(parseThemeMode(change.newValue))
})

/** 最近一条可见买家消息行:快捷键按"用户最新消息"检索 */
function latestBuyerRow(): Element | null {
  const list = document.querySelector(LIST_SEL)
  const cont = list?.getBoundingClientRect()
  if (!cont || cont.width <= 0) return null
  let latest: Element | null = null
  for (const li of document.querySelectorAll(ROW_SEL)) {
    if (buyerRowText(li) === null) continue
    if (!isRowVisible(li.getBoundingClientRect(), cont)) continue
    latest = li // 行按时间序排列,取最后一条可见的
  }
  return latest
}

async function onHotkey(): Promise<void> {
  if (armedPanel) closePopup() // 再按一次快捷键 = 重新检索
  const latest = latestBuyerRow()
  if (!latest) {
    toast('未找到可见的买家消息')
    return
  }
  const query = buildQuery(latest)
  if (!query) {
    toast('未取到买家消息文本')
    return
  }
  const { suggestions, settings, error } = await fetchSuggestions(query)
  if (error) {
    toast(`检索失败:${error}`)
    return
  }
  if (suggestions.length === 0) {
    toast('未找到匹配的历史回复')
    return
  }

  // 「自动回复」开 → 直接填充第一条(不弹面板)
  if (settings.directFillEnabled) {
    const first = suggestions[0]
    if (fillInput(first.text)) {
      const kindLabel = first.kind === 'golden' ? '标准回答' : first.kind === 'knowledge' ? '知识库' : '历史回忆'
      toast(`已填充:${kindLabel} · 请手动发送`)
    } else {
      toast('未找到输入框,请手动粘贴')
    }
    return
  }

  // 关 → 弹推荐回复面板(键盘模式:导航键选择,Enter 填充选中项)
  const anchor =
    (rowBtns.get(latest) as HTMLElement | undefined) ??
    (document.querySelector(INPUT_SEL) as HTMLElement | null) ??
    (latest as HTMLElement)
  openPopup(anchor, suggestions, query, { keyboard: true })
}

document.addEventListener(
  'keydown',
  (ev) => {
    if (ev.key === 'Escape') {
      closePopup()
      return
    }
    // 面板已由快捷键唤起:导航键(默认 Tab,末条回绕首条)移动选中项,Enter = 填充**选中项**
    // (第二十四轮:Shift+Tab 反向删除;↑↓ 让位平台"切换会话",均不拦截)
    if (armedPanel && matchesHotkey(ev, hotkeySettings.panelNavHotkey)) {
      ev.preventDefault()
      ev.stopPropagation()
      movePanelSelection(1)
      return
    }
    if (
      armedPanel &&
      matchesHotkey(ev, { ctrl: false, alt: false, shift: false, key: 'Enter' })
    ) {
      ev.preventDefault()
      ev.stopPropagation()
      const picked = armedPanel.items[armedPanel.selected]
      if (fillInput(picked.text)) {
        const kindLabel = picked.kind === 'golden' ? '标准回答' : picked.kind === 'knowledge' ? '知识库' : '历史回忆'
        toast(`已填充:${kindLabel} · 请手动发送`)
        closePopup()
      } else {
        toast('未找到输入框,请手动粘贴')
      }
      return
    }
    // 快捷键唤起(默认 Ctrl+Enter)
    if (matchesHotkey(ev, hotkeySettings.autoReplyHotkey)) {
      ev.preventDefault()
      ev.stopPropagation()
      void onHotkey()
    }
  },
  true, // capture:抢在平台自身快捷键处理之前
)

void refreshHotkeySettings()

// popup 面板"填充"按钮 → SW 转发:同样只填官方输入框,绝不发送
chrome.runtime.onMessage.addListener(
  (
    message: { type?: string; payload?: { text?: string } },
    _sender: unknown,
    sendResponse: (resp: { payload: { success: boolean; error?: string } }) => void,
  ) => {
    if (message?.type !== 'PDD_FILL_INPUT') return false
    const text = String(message.payload?.text ?? '')
    if (!text) {
      sendResponse({ payload: { success: false, error: '填充内容为空' } })
      return false
    }
    if (fillInput(text)) {
      toast('已填充:标准回答 · 请手动发送')
      sendResponse({ payload: { success: true } })
    } else {
      sendResponse({ payload: { success: false, error: '未找到输入框' } })
    }
    return false
  },
)

export {}
