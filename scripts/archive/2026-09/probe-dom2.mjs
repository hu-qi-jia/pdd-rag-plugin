/**
 * DOM 校准 2:消息行结构(方向/时间/会话标识)、li 全 HTML、Vue vm 探针
 * 输出 logs/dom-calib2.log
 * 用法:node scripts/probe-dom2.mjs
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
  console.log(s.slice(0, 500))
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

// 已打开的会话(上一轮出现 .active conv):直接 dump 消息区
const dump = await page.evaluate(() => {
  const res = {}
  // 1) 消息区结构:history-box-container 子树
  const hist = document.querySelector('.history-box-container')
  res.histFound = !!hist
  if (hist) {
    const rows = []
    const walk = (el, depth) => {
      if (rows.length > 30) return
      for (const c of el.children) {
        const own = [...c.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent.trim()).join('')
        if (c.children.length && own.length === 0) walk(c, depth + 1)
        else {
          const imgs = [...c.querySelectorAll('img')].map((i) => (i.src || '').slice(0, 80))
          rows.push({
            depth,
            tag: c.tagName,
            cls: (c.className && c.className.toString().slice(0, 150)) || '',
            text: (c.textContent || '').trim().slice(0, 120),
            imgs: imgs.slice(0, 2),
          })
        }
      }
    }
    // 逐层看结构而不是全递归:先看历史容器直系
    const top = [...hist.children].map((c) => ({
      tag: c.tagName,
      cls: (c.className && c.className.toString().slice(0, 150)) || '',
      text: (c.textContent || '').trim().slice(0, 60),
      ownKids: c.children.length,
    }))
    res.histTop = top
  }
  // 2) 会话头部
  const hdr = document.querySelector('.chatWindowHeader')
  res.header = hdr ? hdr.textContent.trim().slice(0, 200) : null
  // 3) 活跃会话条目全 HTML(找 uid/数据属性)
  const activeItem = document.querySelector('li.chat-item .chat-item-box.active')
  res.activeItemHTML = activeItem ? activeItem.parentElement.outerHTML.slice(0, 2000) : null
  // 4) Vue vm 探针:根元素 __vue__ → 找 uid 字符串
  const appRoot = document.querySelector('.merchantApp')
  res.hasVue = !!(appRoot && appRoot.__vue__)
  let uid = null
  let uids = []
  try {
    const vm = appRoot.__vue__
    // 找所有含数字 uid 形态(如 1875210170836 13 位)的组件状态,广度限 500 节点
    const stack = [vm]
    const seen = new Set()
    let n = 0
    while (stack.length && n < 2000) {
      const cur = stack.pop()
      n++
      if (!cur || seen.has(cur)) continue
      seen.add(cur)
      const cand = cur.$data || cur
      if (cand && typeof cand === 'object') {
        for (const k of Object.keys(cand)) {
          const v = cand[k]
          if (typeof v === 'string' && /^\d{10,15}$/.test(v)) {
            uids.push({ k, v: v.slice(0, 20), at: cur.$options?.name || cur.$options?._componentTag || '?' })
          }
        }
      }
      const kids = cur.$children
      if (kids) for (const k of kids) stack.push(k)
    }
  } catch (e) {
    res.vueErr = String(e).slice(0, 120)
  }
  res.uids = uids.slice(0, 10)
  res.vmCount = uids.length
  return res
})
log('=== 校准2 ===')
log(JSON.stringify(dump, null, 1))

writeFileSync(ROOT + '\\logs\\dom-calib2.log', out.join('\n'), 'utf8')
await ctx.close()
process.exit(0)
