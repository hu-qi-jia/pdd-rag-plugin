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
import { fontFamily, fontSize, radius, semantic } from '../ui/design'
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

/* AI回复按钮 — 工具风小控件(紧跟买家气泡右侧;纯文字、20px 高、4px 圆角) */
.pddcs-ai-btn { position: fixed; height: 20px; border-radius: ${radius.sm}px; border: 1px solid ${tk.btnBorder};
  cursor: pointer; pointer-events: auto; padding: 0 10px; display: inline-flex; align-items: center;
  background: ${tk.btnBg}; color: ${tk.textMuted}; font-size: ${fontSize.secondary}px; font-weight: 500; line-height: 1;
  letter-spacing: -0.01em; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: background-color .12s ease, color .12s ease, border-color .12s ease; }
.pddcs-ai-btn:hover { background: ${tk.btnHoverBg}; color: ${tk.text}; border-color: ${tk.textTertiary}; }
.pddcs-ai-btn:active { background: ${tk.border}; }
.pddcs-ai-btn .pddcs-ai-btn-label { white-space: nowrap; }
.pddcs-ai-btn:disabled { opacity: .55; cursor: wait; }

/* 候选弹窗 — 工具风浮层卡片 */
.pddcs-popup { position: fixed; width: ${POPUP_W}px; max-height: 62vh; overflow: auto;
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
const AI_BTN_W = 70 // "AI回复" 纯文字胶囊预估宽度(定位用)

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
    // 锚定到买家气泡本身(.msg-content-box)右侧 —— 气泡在哪按钮就跟在哪,
    // 不再贴整行右缘(行右缘距气泡太远)。气泡取不到时退回整行矩形。
    const bubble = li.querySelector('.buyer-item .msg-content-box')
    const anchor = (bubble as HTMLElement | null)?.getBoundingClientRect() ?? rect
    const bw = btn.offsetWidth || AI_BTN_W
    // x:气泡右侧 12px(用户反馈贴太近会压到气泡);放不下则贴气泡左侧
    const x = anchor.right + 12 + bw <= window.innerWidth - 8
      ? anchor.right + 12
      : Math.max(4, anchor.left - bw - 12)
    // y:气泡垂直居中(按钮高 20 → 偏移 10),夹在消息容器可视区内
    const y = Math.min(
      Math.max(anchor.top + anchor.height / 2 - 10, cont.top + 2),
      cont.bottom - 22,
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

function closePopup(): void {
  popupEl?.remove()
  popupEl = null
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

  const top = document.createElement('div')
  top.className = 'pddcs-cand-top'
  top.appendChild(badge(s.kind))
  const score = document.createElement('span')
  score.className = 'pddcs-score'
  score.textContent = s.score.toFixed(2)
  top.appendChild(score)
  if ((s.foldCount ?? 1) > 1) {
    const fold = document.createElement('span')
    fold.className = 'pddcs-fold'
    fold.textContent = `同内容×${s.foldCount}`
    top.appendChild(fold)
  }
  const actions = document.createElement('div')
  actions.className = 'pddcs-cand-actions'
  const goldBtn = miniBtn('设置标准回答')
  goldBtn.title = '将当前问题 + 该回复设为标准回答'
  goldBtn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    void setGolden(s, query, goldBtn)
  })
  const copyBtn = miniBtn('复制')
  copyBtn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    void copyText(s.text).then((ok) =>
      toast(ok ? '已复制到剪贴板' : '复制失败,请手动选择文本'),
    )
  })
  actions.append(goldBtn, copyBtn)
  top.appendChild(actions)
  row.appendChild(top)

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
  head.textContent = `AI 候选(${items.length})`
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

  // 定位:按钮右侧优先,放不下换左侧,越界回缩
  const a = anchor.getBoundingClientRect()
  let x = a.right + 8
  if (x + POPUP_W > window.innerWidth - 8) x = a.left - POPUP_W - 8
  if (x < 8) x = Math.max(8, Math.min(window.innerWidth - POPUP_W - 8, a.left))
  const y = Math.max(8, Math.min(a.top - 4, window.innerHeight - 120))
  el.style.left = `${Math.round(x)}px`
  el.style.top = `${Math.round(y)}px`
  popupEl = el
}

async function setGolden(
  s: Suggestion,
  query: string,
  btn: HTMLButtonElement,
): Promise<void> {
  btn.disabled = true
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
    const err = chrome.runtime.lastError?.message ?? resp?.payload?.error
    if (err) toast(`设置标准回答失败:${err}`)
    else if (resp?.payload?.exists) toast('相同问题的标准回答已存在')
    else toast('已设为标准回答(后台自动向量化)')
  } catch (err) {
    toast(`设置标准回答失败:${String(err)}`)
  }
  btn.disabled = false
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
