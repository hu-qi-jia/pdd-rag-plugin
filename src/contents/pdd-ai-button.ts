/**
 * PDD 聊天工作台 —— AI 回复按钮 + 候选弹窗 + 直填(ISOLATED,P2-4)
 *
 * 交互(设计文档 §6.3):
 *  - 每条可见买家文本气泡右侧紧跟「AI回复」胶囊按钮(Figma 官网控件风格)
 *  - 点击 → 合并该行向上连续买家文本为 query → SW GET_SUGGESTIONS
 *  - 状态机:无候选提示 / 单候选或直填开关开 → 直填 / 多候选弹窗 top-3
 *  - 弹窗:金标准徽标+置顶、得分、同内容×n、原始问题摘要、设为金标准、仅复制
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
  decideUiAction,
  mergeBuyerQuery,
  type UiAction,
} from '../utils/pddUiLogic'
import { findBubbleElement } from '../utils/pddBubbleAnchor'
import {
  DEFAULT_HOTKEY,
  DEFAULT_SETTINGS,
  MAX_GOLDENS_PER_QUESTION,
  SETTINGS_STORAGE_KEY,
  type PddSettings,
} from '../types/memory'
import { formatHotkey, isModifierOnly, matchesHotkey } from '../utils/hotkey'
import { controlH, fontFamily, fontSize, radius, semantic, spacing } from '../ui/design'
import { lightTheme as tk } from '../ui/theme'

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
const POPUP_W = 340

// ─── 覆盖层与样式 ─────────────────────────────────────────────────────────────

const CSS = `
#${OVERLAY_ID} { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
  font-family: ${fontFamily}; }

/* AI回复按钮 — 与 popup 的 .pddcs-btn 同档工具风控件
   (26px 高 / 6px 圆角 / 12.5px 字号:2026-09-15 用户反馈原 20px 偏小,与整体设计脱节)
   box-sizing 显式声明:本样式注入平台页面,不享受 popup 的全局 border-box 重置 */
.pddcs-ai-btn { position: fixed; box-sizing: border-box; height: ${controlH.form}px;
  border-radius: ${radius.md}px; border: 1px solid ${tk.btnBorder};
  cursor: pointer; pointer-events: auto; padding: 0 ${spacing.xl}px; display: inline-flex; align-items: center;
  background: ${tk.btnBg}; color: ${tk.text}; font-size: ${fontSize.body}px; font-weight: 500; line-height: 1;
  letter-spacing: -0.01em; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: background-color .12s ease, color .12s ease, border-color .12s ease; }
.pddcs-ai-btn:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; border-color: ${tk.textTertiary}; }
.pddcs-ai-btn:active { background: ${tk.border}; }
.pddcs-ai-btn .pddcs-ai-btn-label { white-space: nowrap; }
.pddcs-ai-btn:disabled { opacity: .55; cursor: wait; }

/* 候选弹窗 — 工具风浮层卡片 */
.pddcs-popup { position: fixed; width: ${POPUP_W}px; max-height: min(62vh, calc(100vh - 16px)); overflow: auto;
  pointer-events: auto; background: ${tk.bg}; border: 1px solid ${tk.border}; border-radius: ${radius.xl}px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08);
  font-size: ${fontSize.body}px; color: ${tk.text}; }
.pddcs-popup-head { display: flex; align-items: center; padding: 11px 14px;
  border-bottom: 1px solid ${tk.borderLight}; font-weight: 600; font-size: ${fontSize.title}px; position: sticky; top: 0;
  background: ${tk.bg}; letter-spacing: -0.01em; }
.pddcs-popup-close { margin-left: auto; border: none; background: none; cursor: pointer;
  width: 24px; height: 24px; border-radius: ${radius.sm}px; display: flex; align-items: center;
  justify-content: center; color: ${tk.textTertiary}; font-size: 15px; transition: background-color .12s ease; }
.pddcs-popup-close:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; }
.pddcs-cand { padding: 10px 14px; border-bottom: 1px solid ${tk.borderLight}; cursor: pointer;
  transition: background-color .1s ease; }
.pddcs-cand:hover { background: ${tk.btnHoverBg}; }
.pddcs-cand-top { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
.pddcs-badge { display: inline-flex; align-items: center; border-radius: ${radius.sm}px;
  font-size: 10px; font-weight: 600; padding: 2px 7px; }
.pddcs-badge.golden { background: ${semantic.goldenBg}; color: ${semantic.golden}; }
.pddcs-badge.knowledge { background: ${semantic.knowledgeBg}; color: ${semantic.knowledge}; }
.pddcs-badge.history { background: ${tk.bgCard}; color: ${tk.textMuted}; border: 1px solid ${tk.border}; }
.pddcs-score { color: ${tk.textTertiary}; font-size: 10px; font-variant-numeric: tabular-nums; }
.pddcs-fold { color: ${tk.textTertiary}; font-size: 10px; }
.pddcs-cand-actions { margin-left: auto; display: flex; gap: 4px; }
.pddcs-mini { border: 1px solid transparent; background: transparent; border-radius: ${radius.sm}px;
  cursor: pointer; font-size: 10.5px; padding: 2px 8px; color: ${tk.textMuted}; font-weight: 500;
  transition: background-color .1s ease, color .1s ease; }
.pddcs-mini:hover { background: ${tk.borderLight}; color: ${tk.text}; }
/* 危险型迷你钮(取消标准回答):悬浮转红,与图标钮的危险态同语言 */
.pddcs-mini-danger { color: ${tk.errorText}; }
.pddcs-mini-danger:hover { background: ${tk.errorBg}; color: ${tk.errorText}; }
.pddcs-cand-text { white-space: pre-wrap; word-break: break-word; line-height: 1.55;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.pddcs-cand-src { margin-top: 5px; color: ${tk.textTertiary}; font-size: 11px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pddcs-popup-foot { padding: 8px 14px; color: ${tk.textTertiary}; font-size: 11px; }

/* 轻提示 — 近黑 toast */
.pddcs-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; background: rgba(22,22,22,.92); color: #fff; font-size: ${fontSize.body}px;
  padding: 8px 16px; border-radius: ${radius.md}px; opacity: 0; transition: opacity .2s;
  max-width: 60vw; z-index: 2147483001; box-shadow: 0 4px 16px rgba(0,0,0,0.20); }
.pddcs-toast.show { opacity: 1; }
`

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
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.appendChild(style)
  }
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
// 作锚(算法见 utils/pddBubbleAnchor.ts,含单测)。

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
    if (rect.height <= 0) continue
    // 行滚出消息容器可视区(校准实测 y 可为负)→ 不挂按钮
    if (rect.bottom <= cont.top + 1 || rect.top >= cont.bottom - 1) continue
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
    // x:气泡右缘外 12px(真间隙);放不下则移到气泡左侧
    const x =
      anchor.right + BTN_GAP + bw <= window.innerWidth - 8
        ? anchor.right + BTN_GAP
        : Math.max(4, anchor.left - bw - BTN_GAP)
    // y:气泡垂直居中(按钮高 26 → 偏移 13),夹在消息容器可视区内
    const y = Math.min(
      Math.max(anchor.top + anchor.height / 2 - controlH.form / 2, cont.top + 2),
      cont.bottom - controlH.form - 2,
    )
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
/** 由快捷键唤起的推荐回复面板:再按 Enter 填充第一条(点外部/Esc 关闭即解除) */
let armedPanel: { items: Suggestion[] } | null = null

function closePopup(): void {
  popupEl?.remove()
  popupEl = null
  armedPanel = null
}

function badge(kind: Suggestion['kind']): HTMLSpanElement {
  const b = document.createElement('span')
  b.className = `pddcs-badge ${kind}`
  b.textContent = kind === 'golden' ? '标准回答' : kind === 'knowledge' ? '知识库' : '历史'
  return b
}

function miniBtn(label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'pddcs-mini'
  b.textContent = label
  return b
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
  if ((s.foldCount ?? 1) > 1) {
    const fold = document.createElement('span')
    fold.className = 'pddcs-fold'
    fold.textContent = `同内容×${s.foldCount}`
    top.appendChild(fold)
  }
  const actions = document.createElement('div')
  actions.className = 'pddcs-cand-actions'
  top.appendChild(actions)
  row.appendChild(top)

  /** 设为标准回答(每问上限见 MAX_GOLDENS_PER_QUESTION,刷新后同问题多条按时间倒序) */
  const addGolden = async (btn: HTMLButtonElement): Promise<void> => {
    btn.disabled = true
    btn.textContent = '设置中…'
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
    btn.disabled = true
    btn.textContent = '取消中…'
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

  /** 操作钮:按 goldenId 在「设置标准回答 / 取消标准回答」之间翻转 */
  function renderActions(): void {
    actions.textContent = ''
    const isGolden = goldenId !== null
    const goldBtn = miniBtn(isGolden ? '取消标准回答' : '设置标准回答')
    goldBtn.title = isGolden
      ? '取消后该回复不再作为标准回答(历史问答记录不受影响)'
      : `将当前问题 + 该回复设为标准回答(每个问题最多 ${MAX_GOLDENS_PER_QUESTION} 条)`
    if (isGolden) goldBtn.classList.add('pddcs-mini-danger')
    goldBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      void (isGolden ? cancelGolden(goldBtn) : addGolden(goldBtn))
    })
    const copyBtn = miniBtn('复制')
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      void copyText(s.text).then((ok) =>
        toast(ok ? '已复制到剪贴板' : '复制失败,请手动选择文本'),
      )
    })
    actions.append(goldBtn, copyBtn)
  }

  renderActions()

  const text = document.createElement('div')
  text.className = 'pddcs-cand-text'
  text.textContent = s.text
  row.appendChild(text)

  const src = document.createElement('div')
  src.className = 'pddcs-cand-src'
  // 金标准/历史:来源是原始问题;知识库:手工条目来源是标题,文档块来源即命中片段
  src.textContent = `${s.kind === 'knowledge' ? '来源' : '原问题'}:${s.sourceQuestion}`
  src.title = s.sourceQuestion
  row.appendChild(src)

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

function openPopup(anchor: HTMLElement, items: Suggestion[], query: string): void {
  closePopup()
  const overlay = ensureOverlay()
  const el = document.createElement('div')
  el.className = 'pddcs-popup'

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

  for (const s of items) el.appendChild(candidateRow(s, query))

  const foot = document.createElement('div')
  foot.className = 'pddcs-popup-foot'
  foot.textContent = '点击候选填入输入框;发送请手动点击'
  el.appendChild(foot)

  overlay.appendChild(el)

  // 定位:水平方向按钮右侧优先,放不下换左侧,越界回缩;
  // 垂直方向必须按弹窗**实高**夹在视口内(旧逻辑写死 window.innerHeight - 120,
  // 靠近屏幕下方的气泡会让面板溢出屏幕,只能看到一部分)
  const a = anchor.getBoundingClientRect()
  let x = a.right + 8
  if (x + POPUP_W > window.innerWidth - 8) x = a.left - POPUP_W - 8
  if (x < 8) x = Math.max(8, Math.min(window.innerWidth - POPUP_W - 8, a.left))
  el.style.left = `${Math.round(x)}px`
  el.style.visibility = 'hidden'
  overlay.appendChild(el)
  // 实高向上取整:offsetHeight 是取整后的整数,会丢掉亚像素(如 336.125 → 336),
  // 差的 0.1px 恰好让面板底边压线溢出;getBoundingClientRect 保留小数
  const h = Math.ceil(el.getBoundingClientRect().height)
  const maxTop = Math.max(8, window.innerHeight - h - 8)
  const y = Math.max(8, Math.min(a.top - 4, maxTop))
  el.style.top = `${Math.round(y)}px`
  el.style.visibility = ''
  popupEl = el
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
// 「自动回复」关:检索**用户最新消息** → 弹推荐回复面板 → 再按 Enter 填充第一条;
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

/** 最近一条可见买家消息行:快捷键按"用户最新消息"检索 */
function latestBuyerRow(): Element | null {
  const list = document.querySelector(LIST_SEL)
  const cont = list?.getBoundingClientRect()
  if (!cont || cont.width <= 0) return null
  let latest: Element | null = null
  for (const li of document.querySelectorAll(ROW_SEL)) {
    if (buyerRowText(li) === null) continue
    const r = li.getBoundingClientRect()
    if (r.height <= 0) continue
    if (r.bottom <= cont.top + 1 || r.top >= cont.bottom - 1) continue
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

  // 关 → 弹推荐回复面板,再按 Enter 填充第一条
  const anchor =
    (rowBtns.get(latest) as HTMLElement | undefined) ??
    (document.querySelector(INPUT_SEL) as HTMLElement | null) ??
    (latest as HTMLElement)
  openPopup(anchor, suggestions, query)
  armedPanel = { items: suggestions }
  const foot = popupEl?.querySelector('.pddcs-popup-foot')
  if (foot) foot.textContent = '点击候选填入输入框;发送请手动点击 · 按 Enter 填充第一条'
}

document.addEventListener(
  'keydown',
  (ev) => {
    if (ev.key === 'Escape') {
      closePopup()
      return
    }
    // 面板已由快捷键唤起:单独按 Enter = 填充第一条推荐回复
    if (
      armedPanel &&
      matchesHotkey(ev, { ctrl: false, alt: false, shift: false, key: 'Enter' })
    ) {
      ev.preventDefault()
      ev.stopPropagation()
      const first = armedPanel.items[0]
      if (fillInput(first.text)) {
        toast('已填充:第一条推荐回复 · 请手动发送')
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
