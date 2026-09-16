/**
 * DOM 校准 4:消息行(li)逐条结构 —— 类名/方向标识/名字标签/时间/头像
 * 用法:node scripts/probe-dom4.mjs
 */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
const PROFILE = 'E:\\个人项目\\拼多多客服检索工具\\.chrome-debug-profile'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []
const log = (...a) => {
  const s = a.join(' ')
  out.push(s)
  console.log(s.slice(0, 300))
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(12000)
// 确保消息已加载:滚动到底 + 顶部各一次
await page.evaluate(() => {
  const h = document.querySelector('.history-box')
  if (h) {
    h.scrollTop = 0
    h.dispatchEvent(new Event('scroll'))
    h.scrollTop = h.scrollHeight
    h.dispatchEvent(new Event('scroll'))
  }
})
await sleep(6000)

const rows = await page.evaluate(() => {
  const ul = document.querySelector('#msgListContainer .msg-list') || document.querySelector('.msg-list')
  if (!ul) return 'no msg-list'
  const items = [...ul.children].filter((el) => el.tagName === 'LI' || el.children.length)
  const res = items.slice(0, 25).map((li) => {
    const ownText = [...li.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim()).map((x) => x.textContent.trim()).join(' ')
    const kids = [...li.children].map((c) => ({
      tag: c.tagName,
      cls: (c.className && c.className.toString().slice(0, 120)) || '',
      text: (c.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' '),
    }))
    const imgs = [...li.querySelectorAll('img')].map((i) => {
      const s = i.src || ''
      return s.includes('data:') ? '[data-img]' : s.slice(0, 60)
    })
    return {
      tag: li.tagName,
      cls: (li.className && li.className.toString().slice(0, 200)) || '',
      ownText: ownText.slice(0, 40),
      kids,
      imgs: imgs.slice(0, 3),
      htmlHead: li.outerHTML.slice(0, 400),
    }
  })
  return { total: items.length, res }
})
log(JSON.stringify(rows, null, 1))

// 也 dump 时间分隔符与 moremsg 按钮类名(结构复用要点)
const extra = await page.evaluate(() => {
  const h = document.querySelector('.history-box')
  const tags = new Set()
  if (h) {
    for (const el of h.querySelectorAll('[class]')) {
      const c = el.className.toString()
      if (c && c.length < 60 && /msg|time|date|item|content|bubble|avatar|name|nick|role/i.test(c)) {
        tags.add(c.split(' ')[0])
      }
    }
  }
  return [...tags].slice(0, 60)
})
log('=== 相关类名集合 ===')
log(JSON.stringify(extra))

writeFileSync(ROOT + '\\logs\\dom-calib4.log', out.join('\n'), 'utf8')
await ctx.close()
process.exit(0)
