/**
 * DOM 校准 3:历史区原始 HTML、滚动触发加载、遍历会话找双向消息
 * 输出 logs/dom-calib3.log
 * 用法:node scripts/probe-dom3.mjs
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
  console.log(s.slice(0, 400))
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

const histHTML = await page.evaluate(() => {
  const h = document.querySelector('.history-box')
  if (!h) return 'no .history-box'
  return h.outerHTML.slice(0, 8000)
})
log('=== history-box 原始 HTML ===')
log(histHTML)

// 滚动历史区触发消息加载(只读)
await page.evaluate(() => {
  const h = document.querySelector('.history-box')
  if (h) {
    h.scrollTop = h.scrollHeight
    h.dispatchEvent(new Event('scroll'))
  }
})
await sleep(5000)
const after = await page.evaluate(() => {
  const h = document.querySelector('.history-box')
  return h ? h.outerHTML.length + ' chars; text: ' + h.textContent.trim().slice(0, 200) : 'no'
})
log('=== 滚动后 ===', after)

// 遍历会话列表:找有双向消息的会话并 dump 消息行
const convInfo = await page.evaluate(() => {
  const items = [...document.querySelectorAll('li.chat-item')].map((li) => {
    const box = li.querySelector('.chat-item-box')
    const rand = (box && box.getAttribute('data-random')) || ''
    const nick = li.querySelector('.nickname-span')?.textContent || ''
    const prev = li.querySelector('.chat-message-content')?.textContent?.trim() || ''
    const active = box ? box.className.includes('active') : false
    return { uid: rand.split('-')[0], nick, prev: prev.slice(0, 40), active }
  })
  return items
})
log('=== 会话列表 ===', JSON.stringify(convInfo, null, 1))

// 逐个点非活跃会话,等渲染,统计消息行
for (const it of convInfo) {
  if (it.active) continue
  log(`点击会话 ${it.nick} ${it.uid}`)
  try {
    await page.locator('li.chat-item').filter({ hasText: it.nick }).first().click({ timeout: 5000 })
  } catch (e) {
    log('点击失败:', String(e).slice(0, 80))
    continue
  }
  await sleep(8000)
  // 滚动到底触发加载
  await page.evaluate(() => {
    const h = document.querySelector('.history-box')
    if (h) {
      h.scrollTop = h.scrollHeight
      h.dispatchEvent(new Event('scroll'))
    }
  })
  await sleep(4000)
  const rows = await page.evaluate(() => {
    const h = document.querySelector('.history-box')
    if (!h) return null
    const leaves = []
    const walk = (el, depth) => {
      if (leaves.length > 60) return
      for (const c of el.children) {
        const own = [...c.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim()).map((x) => x.textContent.trim()).join(' ')
        if (own) {
          // 记录该叶子的行容器线索:向上到含 img 或文本较长的祖先
          let row = c
          for (let i = 0; i < 4 && row.parentElement; i++) {
            if (row.parentElement.querySelector('img') || (row.parentElement.textContent.length > 30 && row.parentElement.children.length >= 2)) {
              row = row.parentElement
              break
            }
            row = row.parentElement
          }
          leaves.push({
            depth,
            leafCls: (c.className && c.className.toString().slice(0, 100)) || '',
            text: own.slice(0, 80),
            rowTag: row.tagName,
            rowCls: (row.className && row.className.toString().slice(0, 160)) || '',
            rowText: (row.textContent || '').trim().slice(0, 60).replace(/\s+/g, ' '),
          })
        } else if (c.children.length) walk(c, depth + 1)
      }
    }
    walk(h, 0)
    return leaves
  })
  log('消息行:', JSON.stringify(rows, null, 1))
  const twoSide = rows && rows.some((r) => r.text)
  if (twoSide) break
}

writeFileSync(ROOT + '\\logs\\dom-calib3.log', out.join('\n'), 'utf8')
log('已写入 logs/dom-calib3.log')
await ctx.close()
process.exit(0)
