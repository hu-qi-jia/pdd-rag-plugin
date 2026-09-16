/**
 * DOM 校准:打开真实会话后 dump 消息面板结构
 * 输出:logs/dom-calib.log(气泡区结构、方向标识、会话标识线索)
 * 用法:node scripts/probe-dom.mjs
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

// 切到"全部会话"标签(列表可能有更多历史会话)
for (const tab of ['全部会话', '待回复', '已回复']) {
  try {
    const loc = page.getByText(tab, { exact: true }).first()
    if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
      await loc.click()
      log('已切换标签:', tab)
      break
    }
  } catch {}
}
await sleep(4000)

// ── 1) 会话列表项:找含掩码昵称的条目, dump 结构与属性 ──
const convDump = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('*')].find(
    (el) => el.children.length === 0 && /E\*{1,4}E|店铺/.test(el.textContent || '') && el.textContent.trim().length < 30,
  )
  if (!hit) return null
  const chain = []
  let n = hit
  for (let i = 0; i < 8 && n; i++) {
    chain.push({ tag: n.tagName, cls: (n.className && n.className.toString().slice(0, 120)) || '' })
    n = n.parentElement
  }
  // 找候选条目容器:兄弟数量 ≥3 的祖先
  let itemRoot = hit
  let cursor = hit.parentElement
  while (cursor) {
    const siblings = cursor.parentElement?.children.length ?? 0
    if (siblings >= 3 && cursor.textContent.length < 200) {
      itemRoot = cursor
      break
    }
    cursor = cursor.parentElement
  }
  const imgs = [...itemRoot.querySelectorAll('img')].map((i) => i.src.slice(0, 160))
  return {
    chain,
    itemRootTag: itemRoot.tagName,
    itemRootCls: (itemRoot.className && itemRoot.className.toString().slice(0, 200)) || '',
    itemText: itemRoot.textContent.trim().slice(0, 120),
    itemHTML: itemRoot.outerHTML.slice(0, 800),
    itemImgs: imgs.slice(0, 4),
  }
})
log('=== 会话列表条目 ===')
log(JSON.stringify(convDump, null, 1))

// ── 2) 点开会话:点击列表项条目区域 ──
let clicked = false
for (const c of ['E***E', '眼睛的店铺']) {
  try {
    const leaf = page
      .locator('*')
      .filter({ hasText: new RegExp(`^${c.replace(/\*/g, '\\*')}$`) })
      .first()
    if (await leaf.count().catch(() => 0)) {
      // 点该叶子所在的最外层条目
      const box = await leaf.boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      clicked = true
      log('已点击会话:', c)
      break
    }
  } catch {}
}
if (!clicked) log('未找到可点会话,仍 dump 当前 DOM')
await sleep(12000)

// ── 3) 聊天输入框 → 上溯找面板根 → 找消息容器 → dump 气泡 ──
const paneDump = await page.evaluate(() => {
  const ta = document.querySelector('textarea')
  if (!ta) return { err: 'no textarea' }
  // 输入框祖先链
  const chain = []
  let n = ta
  for (let i = 0; i < 14 && n; i++) {
    const kids = [...n.children].slice(0, 30).map((k) => {
      const txt = (k.textContent || '').trim()
      return `${k.tagName.toLowerCase()}.${(k.className && k.className.toString().split(' ')[0]) || ''}(len${txt.length})`
    })
    chain.push({
      tag: n.tagName,
      cls: (n.className && n.className.toString().slice(0, 150)) || '',
      kids: kids.slice(0, 8),
    })
    n = n.parentElement
  }
  return { chain }
})
log('=== 输入框祖先链 ===')
log(JSON.stringify(paneDump, null, 1))

// 找消息气泡候选:文本 leaf 与其祖先中的"行"结构
const bubbleDump = await page.evaluate(() => {
  const ta = document.querySelector('textarea')
  if (!ta) return { err: 'no textarea' }
  // 从输入框一路向上,选含 leaf 文本最多、不含输入框的容器作为消息区
  let best = null
  let n = ta.parentElement
  for (let i = 0; i < 8 && n; i++) {
    const leafCount = n.querySelectorAll('*').length
    const textLen = (n.textContent || '').length
    if (!best || leafCount > best.leafCount) best = { node: n, leafCount, textLen }
    n = n.parentElement
  }
  if (!best) return { err: 'no container' }
  const root = best.node
  // 收集"行":直接子元素中,包含 img 或文本量小的块
  const rows = []
  const walk = (el, depth) => {
    if (depth > 4 || rows.length > 40) return
    for (const child of el.children) {
      const hasImg = !!child.querySelector('img')
      const txt = (child.textContent || '').trim().slice(0, 100)
      const ownText = [...child.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent.trim()).join('')
      if (hasImg && ownText.length < 4 && txt.length < 200) {
        rows.push({
          tag: child.tagName,
          cls: (child.className && child.className.toString().slice(0, 180)) || '',
          hasImg,
          text: txt,
          childCount: child.children.length,
        })
      } else walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return { rootCls: (root.className && root.className.toString().slice(0, 200)) || '', rows }
})
log('=== 消息行候选 ===')
log(JSON.stringify(bubbleDump, null, 1))

writeFileSync(ROOT + '\\logs\\dom-calib.log', out.join('\n'), 'utf8')
log('已写入 logs/dom-calib.log')
await ctx.close()
process.exit(0)
