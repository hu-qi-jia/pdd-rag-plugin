/**
 * 推荐回复面板可视评审截图(一次性,配合第十四轮重设计):
 * 复用 verify-ai-popup 的夹具与 chrome 桩,点亮面板并悬浮候选行,
 * 亮/暗两主题各截一张 → logs/ui-0915-ai-panel-{light,dark}.png
 */
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const DIR = ROOT + '\\build\\chrome-mv3-prod'
const CS = readdirSync(DIR).find((f) => /^pdd-ai-button\..*\.js$/.test(f))
if (!CS) {
  console.log('FAIL: 未找到 content script 产物,请先 build')
  process.exit(1)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#f5f5f5; font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
  #msgListContainer { width: 720px; height: 600px; overflow:auto; }
  ul.msg-list { margin:0; padding:0; list-style:none; }
  li.onemsg { padding: 8px 12px; }
  .buyer-item { display:flex; gap:8px; align-items:flex-start; }
  .avatar { width:32px; height:32px; border-radius:50%; background:#ccc; flex-shrink:0; }
  [currentuid] { display:inline-block; }
  .msg-content { background:#ffffff; padding:10px; border-radius:6px; max-width:420px; }
  .msg-content-box { margin:0; font-size:13px; line-height:1.5; }
</style></head><body>
<div id="msgListContainer"><ul class="msg-list">
  <li class="onemsg"><div class="buyer-item"><span class="avatar"></span>
    <div currentuid="u1"><div class="msg-content"><p class="msg-content-box">这个支持7天无理由退换吗</p></div></div>
  </div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u2"><div class="msg-content"><p class="msg-content-box">填充消息 2:让页面有一些上下文</p></div></div></div></li>
<li class="onemsg"><div class="buyer-item"><span class="avatar"></span><div currentuid="u3"><div class="msg-content"><p class="msg-content-box">填充消息 3:让页面有一些上下文</p></div></div></div></li>
</ul></div>
<textarea id="replyTextarea" style="position:fixed; left:20px; bottom:20px; width:600px; height:60px"></textarea>
</body></html>`

const browser = await chromium.launch({
  executablePath:
    'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
})

async function shot(theme, out) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript((t) => {
    const cand = (kind, text, id) => ({
      kind,
      text,
      sourceQuestion: '这个支持7天无理由退换吗',
      score: kind === 'golden' ? 0.93 : 0.87,
      sourceId: id,
      ...(kind === 'history' ? { replyId: `rp-${id}` } : {}),
    })
    const suggestions = [
      cand('golden', '标准回答:支持7天无理由退换,运费我们承担。', 'gd-1'),
      cand('history', '历史答复甲:支持7天无理由,请放心下单,外贸商品支持7天无理由退换,需保持商品完好,标签未拆。', 'h-1'),
      cand('history', '历史答复乙:7天内可退换,需要保持完好。', 'h-2'),
    ]
    window.chrome = {
      storage: {
        local: { get: async () => ({ 'pddcs:theme': t }) },
        onChanged: { addListener() {} },
      },
      runtime: {
        onMessage: { addListener() {} },
        lastError: undefined,
        sendMessage(msg) {
          if (msg?.type === 'GET_SUGGESTIONS') {
            return Promise.resolve({
              payload: {
                suggestions,
                settings: { directFillEnabled: false, goldenPriorityEnabled: true },
              },
            })
          }
          if (msg?.type === 'GET_STATS') {
            return Promise.resolve({
              payload: {
                settings: { directFillEnabled: false, goldenPriorityEnabled: true, autoReplyHotkey: { ctrl: true, alt: false, shift: false, key: 'Enter' } },
              },
            })
          }
          return Promise.resolve({ payload: {} })
        },
      },
    }
  }, theme)
  await page.route('**/fixture.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE }),
  )
  await page.goto('https://fixture.local/fixture.html')
  await page.addScriptTag({ path: `${DIR}\\${CS}` })
  await sleep(1000)
  await page.locator('.pddcs-ai-btn').first().click()
  await sleep(700)
  await page.hover('.pddcs-cand >> nth=1')
  await sleep(400)
  await page.screenshot({ path: out })
  console.log(`${theme} 面板截图完成 → ${out}`)
  await page.close()
}

await shot('light', ROOT + '\\logs\\ui-0915-ai-panel-light.png')
await shot('dark', ROOT + '\\logs\\ui-0915-ai-panel-dark.png')
await browser.close()
