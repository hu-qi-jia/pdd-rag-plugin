/**
 * PDD 聊天工作台 —— 消息捕获(ISOLATED,chat-merchant 顶层页面)
 *
 * 读取渲染结果而非网络层:观察 #msgListContainer 消息列表,
 * 新出现的文本行(买家/客服)去重后批量上报 SW(PDD_INGEST)。
 * 不上报非文本行(图片/商品卡),不改写页面,不自动发送(见 docs/adr/0002 边界)。
 *
 * 会话级语义:
 *  - 切换会话(检测到会话键变化) → 先发 leave 关闭上一会话未结问题段
 *  - 3 分钟无新消息 → 发 idle 关闭当前会话未结问题段(无回复问题落盘)
 *  - 页面卸载(pagehide) → flush 并按活动会话发 leave
 *
 * 页面为 Vue2 单页应用,容器在 app 挂载后才出现 → 先轮询等容器,
 * 挂上后 MutationObserver(增行/滚屏回填新节点)+ 低频兜底扫描。
 */
import type { PlasmoCSConfig } from 'plasmo'
import type { PddCapturedEvent } from '../types/messages'
import { extractMessages, type DomMessage } from '../pdd/dom-parser'

// 校准期:整站 chat-merchant 顶层页;稳定后可再按需收紧
export const config: PlasmoCSConfig = {
  matches: ['https://mms.pinduoduo.com/chat-merchant/*'],
}

const LIST_SEL = '#msgListContainer .msg-list'
const SCAN_MS = 2500 // 兜底轮询(容器挂载期间也用它)
const IDLE_MS = 3 * 60_000 // 无新消息阈值(与 SW 端 idle 语义一致)
const MAX_SEEN = 6000 // 行 id 去重集上限(超出剪半)
const DEBUG = false // true 时打印逐行捕获与 ingest 结果(链路排查用)

let listEl: Element | null = null
let lastSessionKey: string | undefined
let pendingScan = 0
let idleTimer = 0
let seen = new Set<string>()

function markSeen(key: string): void {
  if (seen.size >= MAX_SEEN) {
    const half = Math.floor(seen.size / 2)
    seen = new Set([...seen].slice(half))
  }
  seen.add(key)
}

function sendEvents(events: PddCapturedEvent[]): void {
  if (events.length === 0) return
  try {
    chrome.runtime.sendMessage(
      { type: 'PDD_INGEST', payload: { events } },
      (resp) => {
        const err = chrome.runtime.lastError
        if (err) console.warn('[PDD CS] ingest 上报失败:', err.message)
        else if (resp?.payload?.error) {
          console.warn('[PDD CS] ingest 处理失败:', resp.payload.error)
        } else if (DEBUG) {
          console.log(
            `[PDD CS] ingest 结果: queued=${resp?.payload?.queued ?? '?'} skipped=${resp?.payload?.skipped ?? '?'} ${resp?.payload?.detail ?? ''}`,
          )
        }
      },
    )
  } catch (err) {
    console.warn('[PDD CS] sendMessage 同步异常:', err)
  }
}

/** 会话有新消息后重置 idle 计时;到期发 idle 让 SW 关闭未结问题段 */
function resetIdleTimer(sessionKey: string | undefined): void {
  if (idleTimer) window.clearTimeout(idleTimer)
  idleTimer = 0
  if (!sessionKey) return
  idleTimer = window.setTimeout(() => {
    idleTimer = 0
    // 到期时已切走会话 → 关段交给 leave,不发过期 idle
    if (lastSessionKey === sessionKey) {
      sendEvents([{ kind: 'idle', sessionKey }])
    }
  }, IDLE_MS)
}

function scanOnce(): void {
  if (!listEl) return
  let rows: DomMessage[]
  try {
    rows = extractMessages(listEl)
  } catch (err) {
    console.warn('[PDD CS] DOM 提取失败:', err)
    return
  }
  const events: PddCapturedEvent[] = []

  // 会话切换:上一会话先关段(消息总带会话键,单会话面板一次只有一个)
  const curSession = rows.length > 0 ? rows[rows.length - 1].sessionKey : undefined
  if (curSession && lastSessionKey && curSession !== lastSessionKey) {
    events.push({ kind: 'leave', sessionKey: lastSessionKey })
  }

  let added = 0
  for (const r of rows) {
    const key = r.msgId ?? `${r.sessionKey ?? ''}|${r.role}|${r.text}`
    if (seen.has(key)) continue
    markSeen(key)
    added++
    const buyerIdTail = r.sessionKey && /^\d+$/.test(r.sessionKey)
      ? r.sessionKey.slice(-4)
      : undefined
    events.push({
      kind: 'msg',
      sessionKey: r.sessionKey,
      buyerIdTail,
      msg: {
        source: 'dom',
        role: r.role,
        text: r.text,
        msgId: r.msgId,
        ts: r.ts,
      },
    })
    const who = r.role === 'agent' ? '客服' : '买家'
    if (DEBUG) {
      console.log(
        `[PDD CS] DOM 捕获 → ${who}: ${r.text.slice(0, 40)} (${r.sessionKey ?? '无会话'})`,
      )
    }
  }
  if (added > 0 || events.length > 0) {
    if (curSession) lastSessionKey = curSession
    sendEvents(events)
  }
  if (added > 0) resetIdleTimer(curSession)
}

function scheduleScan(delay = 200): void {
  if (pendingScan) return
  pendingScan = window.setTimeout(() => {
    pendingScan = 0
    scanOnce()
  }, delay)
}

function attachList(root: Element): void {
  listEl = root
  scanOnce()
  // 新行追加 / 加载更多 / Vue patch 重挂 → 防抖扫描
  const mo = new MutationObserver(() => scheduleScan())
  mo.observe(root, { childList: true, subtree: true })
}

// ─── 启动:等容器出现(单页应用懒挂载)──────────────────────────────────────────
let tries = 0
function waitContainer(): void {
  const root = document.querySelector(LIST_SEL)
  if (root) {
    attachList(root)
    console.log('[PDD CS] capture ready')
    return
  }
  tries++
  if (tries > 60) return // 60s 仍无 → 页面结构变化,静默放弃
  window.setTimeout(waitContainer, 1000)
}

// 兜底轮询(容器挂载后每 2.5s 全量 diff,防观察遗漏);
// Vue 重挂载会整体替换列表节点 → 检测到脱离文档即重新等容器自愈
window.setInterval(() => {
  if (!listEl) return
  if (listEl.isConnected) {
    scanOnce()
    return
  }
  listEl = null
  seen = new Set() // 新节点会重放已有行,去重交给 SW(内存 + 库级 msgId)
  tries = 0
  waitContainer()
}, SCAN_MS)

// 卸载前 flush:关闭当前会话未结段
window.addEventListener('pagehide', () => {
  if (idleTimer) window.clearTimeout(idleTimer)
  if (listEl && lastSessionKey) {
    sendEvents([{ kind: 'leave', sessionKey: lastSessionKey }])
  }
})

waitContainer()
export {}
