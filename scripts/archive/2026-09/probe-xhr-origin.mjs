/**
 * 定位聊天 XHR 的真实发起点:frame 内 main-world 探针 + CDP initiator
 * 用法:node scripts/probe-xhr-origin.mjs
 */
import { chromium } from '@playwright/test'

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

// CDP:看聊天请求的 initiator(哪个脚本发起)+ 是否 worker
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
const seen = new Set()
cdp.on('Network.requestWillBeSent', (p) => {
  if (!/(plateau\/chat|sync\/message|plateau\/conv)/.test(p.request.url)) return
  const key = p.request.url.split('?')[0] + p.initiator?.type
  if (seen.has(key)) return
  seen.add(key)
  const st = p.initiator?.stackTrace?.callFrames?.[0]
  console.log('[NET]', p.initiator?.type, p.frameId, p.request.url.split('?')[0])
  if (st) console.log('   by:', st.url.split('/').pop(), 'ln', st.lineNumber)
})

// 每个 frame 的 main world 里装 XHR 探针 + postMessage 探针
page.on('framenavigated', (f) => installProbe(f).catch(() => {}))
const installProbe = async (f) => {
  try {
    await f.evaluate(() => {
      if (window.__xhrProbe) return
      window.__xhrProbe = true
      const origOpen = XMLHttpRequest.prototype.open
      const origSend = XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.open = function (...a) {
        this.__purl = String(a[1] ?? '')
        return origOpen.apply(this, a)
      }
      XMLHttpRequest.prototype.send = function (...a) {
        if (this.__purl && /plateau\/chat|sync\/message/.test(this.__purl)) {
          this.addEventListener('load', () => {
            const raw = this.responseType === '' || this.responseType === 'text'
              ? this.responseText : JSON.stringify(this.response)
            console.log(
              '[XHR-PROBE]', this.__purl.split('?')[0].split('/').pop(),
              'len', (raw || '').length, 'type', this.responseType,
              'hook', !!window.__pddcsNetHooked,
            )
          })
        }
        return origSend.apply(this, a)
      }
      window.addEventListener('message', (e) => {
        if (e.data && e.data.__pddcsNet) console.log('[MSG-PROBE] items', e.data.items?.length)
      })
    })
  } catch { /* 页面卸载等 */ }
}
for (const f of page.frames()) await installProbe(f)
page.on('console', (m) => {
  const t = m.text()
  if (/XHR-PROBE|MSG-PROBE|PDD CS/.test(t)) console.log('页console:', t.slice(0, 260))
})

await page.goto('https://mms.pinduoduo.com/chat-merchant/index.html#/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await sleep(12000)
for (const f of page.frames()) await installProbe(f)

for (const c of ['E***E', '眼睛的店铺']) {
  try {
    await page.getByText(c, { exact: false }).first().click({ timeout: 4000 })
    console.log('已点击:', c)
    break
  } catch { /* next */ }
}
await sleep(20000)
await ctx.close()
process.exit(0)
