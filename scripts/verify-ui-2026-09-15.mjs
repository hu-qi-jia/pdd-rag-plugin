/**
 * 诊断 + 验收:2026-09-15 用户反馈三项
 *   ① 记忆页「设置标准回答」点击无可见反馈(真因:写入成功但反馈在视口外 + 统计不刷新);
 *   ② 文件夹页内联表单输入框与按钮不等高(实测 35px vs 28px);
 *   ③ 导航栏顶部 logo 已删。
 * 同时落截图到 logs/ 便于人工核对。
 * 用法:node scripts/verify-ui-2026-09-15.mjs
 */
import { chromium } from '@playwright/test'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
const PROFILE = ROOT + '\\.diag-golden-profile'
const SESS = 'diag-golden-click'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  timeout: 60000,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--hide-crash-restore-bubble',
    '--no-default-browser-check',
  ],
})
await sleep(5000)
let extId = null
for (let i = 0; i < 10 && !extId; i++) {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
  if (sw) extId = new URL(sw.url()).host
  if (!extId) await sleep(1000)
}
if (!extId) {
  console.log('FAIL: 扩展未加载')
  await ctx.close()
  process.exit(1)
}

const pop = await ctx.newPage()
const pageErrors = []
pop.on('pageerror', (e) => pageErrors.push(String(e)))
await pop.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' })
await sleep(1500)

const send = (type, payload) =>
  pop.evaluate(
    async ({ type, payload }) => {
      const resp = await chrome.runtime.sendMessage({ type, payload })
      return resp?.payload ?? {}
    },
    { type, payload },
  )

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 造一条合成问答(问题文本带时间戳,避免与历史数据撞幂等 → 统计必然 +1)──
await send('PDD_INGEST', {
  events: [
    {
      kind: 'msg',
      sessionKey: SESS,
      msg: { source: 'dom', role: 'buyer', text: `验收:点击设置标准回答是否可见反馈?${Date.now()}`, msgId: 'v915-b1', ts: Date.now() - 60_000 },
    },
    {
      kind: 'msg',
      sessionKey: SESS,
      msg: { source: 'dom', role: 'agent', text: '验收回复:按钮应原位变为已设为标准回答,且头部统计立即 +1。', msgId: 'v915-a1', ts: Date.now() },
    },
    { kind: 'leave', sessionKey: SESS },
  ],
})
await sleep(1500)
await pop.reload({ waitUntil: 'domcontentloaded' })
await sleep(1800)

const header = () => pop.evaluate(() => document.body.innerText.split('\n')[1] ?? '')
const before = await header()
const statsBefore = (await send('GET_STATS')).goldenCount

// ── ① 记忆页:点击设置标准回答 ──
const btn = pop.locator('button', { hasText: '设置标准回答' }).first()
await btn.click()
await sleep(2200)
const after = await header()
const statsAfter = (await send('GET_STATS')).goldenCount
const doneMarker = await pop.locator('text=已设为标准回答').count()

check('点击后按钮原位变为「已设为标准回答」', doneMarker > 0, `命中 ${doneMarker} 处`)
check(`头部统计刷新(标准回答 ${statsBefore} → ${statsAfter})`, statsAfter > statsBefore)
check('头部统计文案已更新', after.includes(`标准回答 ${statsAfter}`), after)
await pop.screenshot({ path: ROOT + '\\logs\\ui-0915-memory.png' })

// ── ② 文件夹页:内联表单等高 ──
await pop.locator('button[title="文件夹"]').click()
await sleep(600)
const railLogos = await pop.evaluate(
  () => document.querySelectorAll('nav [title="拼多多客服快捷回复"]').length,
)
check('导航栏顶部品牌 logo 已移除', railLogos === 0, `品牌标命中=${railLogos}`)

await pop.locator('button', { hasText: '新建根文件夹' }).click()
await sleep(500)
const geo = await pop.evaluate(() => {
  const input = document.querySelector('input[placeholder="根文件夹名称"]')
  const btns = [...document.querySelectorAll('button')].filter((b) =>
    ['创建', '取消'].includes(b.textContent.trim()),
  )
  const r = (el) => {
    const b = el.getBoundingClientRect()
    return { h: Math.round(b.height * 10) / 10, top: Math.round(b.top * 10) / 10 }
  }
  return { input: r(input), buttons: btns.map(r) }
})
console.log('几何 =', JSON.stringify(geo))
const hs = [geo.input.h, ...geo.buttons.map((b) => b.h)]
check(
  `输入框与按钮等高(${hs.join(' / ')}px)`,
  new Set(hs).size === 1,
)
check(
  '三者顶边对齐',
  new Set([geo.input.top, ...geo.buttons.map((b) => b.top)]).size === 1,
)
await pop.screenshot({ path: ROOT + '\\logs\\ui-0915-folders.png' })

// ── ③ 标准回答行的小控件也应等高 ──
await pop.locator('button', { hasText: '取消' }).first().click()
await sleep(400)
const inlineGeo = await pop.evaluate(() => {
  const boxes = [...document.querySelectorAll('button')]
    .filter((b) => ['填充', '确认', '取消'].includes(b.textContent.trim()))
    .map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) }))
  return boxes
})
console.log('行内小控件高度 =', JSON.stringify(inlineGeo))

console.log('页面错误 =', JSON.stringify(pageErrors))
console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await ctx.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
