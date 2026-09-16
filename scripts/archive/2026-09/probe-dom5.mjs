/**
 * DOM 校准 5:cs-item / buyer-item 内层结构(nickname、msg-content、图片卡识别)
 * 输出 logs/dom-calib5.log
 */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
const PROFILE = 'E:\\个人项目\\拼多多客服检索工具\\.chrome-debug-profile'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
await page.evaluate(() => {
  const h = document.querySelector('.history-box')
  if (h) {
    h.scrollTop = 0
    h.dispatchEvent(new Event('scroll'))
    h.scrollTop = h.scrollHeight
    h.dispatchEvent(new Event('scroll'))
  }
})
await sleep(5000)

const d = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    return el ? el.outerHTML.slice(0, 3500) : 'none'
  }
  // 收集不同形态样本:普通文本 cs、callback(机器人)、带商品卡的 buyer 行
  const cs = document.querySelector('#msgListContainer .cs-item')
  const cb = document.querySelector('#msgListContainer .cs-item.callback')
  const buyer = document.querySelector('#msgListContainer .buyer-item')
  // 找含图片较多/含 商品名 特征的行(商品卡)
  let card = null
  for (const el of document.querySelectorAll('#msgListContainer li.onemsg')) {
    const t = el.textContent || ''
    if (/[¥￥]/.test(t) && el.querySelectorAll('img').length > 1) {
      card = el
      break
    }
  }
  const hasCard = !!card
  return {
    csHTML: pick('#msgListContainer .cs-item'),
    robotHTML: cb ? cb.outerHTML.slice(0, 1800) : 'no .callback sample',
    buyerHTML: pick('#msgListContainer .buyer-item'),
    cardHTML: card ? card.outerHTML.slice(0, 2200) : 'no card sample',
    hasCard,
  }
})
writeFileSync(ROOT + '\\logs\\dom-calib5.log', JSON.stringify(d, null, 1))
console.log('cs-item 样本:', d.csHTML.length, '字符; callback:', d.robotHTML.length, '; buyer:', d.buyerHTML.length, '; 商品卡:', d.hasCard ? '有' : '无')
console.log(d.csHTML.slice(0, 2200))
await ctx.close()
process.exit(0)
