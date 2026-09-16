/**
 * CDP 真机流量观察器(校准用,一次性脚本)
 *
 * 前提:Chrome 已带 --remote-debugging-port=9222 启动(同一浏览器配置,登录态保留)。
 * 作用:附加到商家聊天页,被动采集
 *   - 所有 frame 的 URL(判断聊天是否在 iframe)
 *   - 所有 WebSocket 帧(含中文的原文落盘)
 *   - 命中聊天/消息关键词的 XHR/fetch 响应体(含中文原文落盘)
 * 不注入任何代码到页面(纯 CDP Network 域观察)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const CDP = 'http://127.0.0.1:9222'
const LOG_DIR = path.resolve(import.meta.dirname, '../logs')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG = path.join(LOG_DIR, `cdp-capture-${Date.now()}.log`)

const HAS_CHINESE = /[一-鿿]/
const CHAT_RE = /\/(plateau|chat|message|send|sync|conversation|session|poll|msg|im)\//i

function line(tag, detail) {
  const s = `[${new Date().toISOString().slice(11, 23)}] ${tag} ${detail}`
  console.log(s)
  fs.appendFileSync(LOG, s + '\n')
}

const browser = await chromium.connectOverCDP(CDP)
const ctx = browser.contexts()[0]
if (!ctx) {
  console.error('CDP 连接成功但没有浏览器上下文(检查是否用了 --user-data-dir 启动)')
  process.exit(1)
}

let page = ctx.pages().find((p) => p.url().includes('chat-merchant'))
if (!page) {
  console.log('未找到聊天页,尝试打开 chat-merchant …')
  page = await ctx.newPage()
  await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
}

console.log('跟踪页面:', page.url())
line('PAGE', page.url())

// 1) frame 结构(聊天是否在 iframe)
const frames = page.frames().map((f) => f.url())
line('FRAMES', JSON.stringify(frames))

// 2) WebSocket 帧
page.on('websocket', (ws) => {
  line('WS_CONNECT', ws.url())
  ws.on('framereceived', ({ payload }) => {
    let text = payload
    if (typeof payload !== 'string') {
      try {
        text = Buffer.from(payload, 'base64').toString('utf8')
      } catch {
        return
      }
    }
    if (text.length > 2_000_000) return
    const hasCn = HAS_CHINESE.test(text)
    if (hasCn || text.includes('{')) {
      line('WS_FRAME', `${hasCn ? '[中文]' : '[无中文]'}(${text.length}字) ${text.slice(0, 1500)}`)
    }
  })
})

// 3) 聊天接口 XHR/fetch 响应体
page.on('response', async (res) => {
  try {
    const url = res.url()
    if (!CHAT_RE.test(url) && !HAS_CHINESE.test(url)) return
    const ct = res.headers()['content-type'] ?? ''
    if (!ct.includes('json')) return
    const len = Number(res.headers()['content-length'] ?? 0)
    if (len > 2_000_000) return
    const body = await res.text()
    if (body.length > 2_000_000) return
    const hasCn = HAS_CHINESE.test(body)
    if (!hasCn && body.length > 4000) return
    line(
      'HTTP_RESP',
      `${res.request().method()} ${url.split('?')[0]}(${body.length}字) ${hasCn ? '[中文]' : ''}`,
    )
    if (hasCn) line('HTTP_BODY', body.slice(0, 1500))
  } catch {
    /* 响应体读取失败等,忽略 */
  }
})

console.log(`观察中… 请正常聊天,日志写入 ${LOG}`)
console.log('提示:买家收消息与客服发消息各来一条;Ctrl+C 结束观察。')

process.on('SIGINT', async () => {
  console.log(`\n已保存:${LOG}`)
  await browser.close().catch(() => {})
  process.exit(0)
})
