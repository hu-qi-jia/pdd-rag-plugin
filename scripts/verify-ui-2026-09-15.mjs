/**
 * 诊断 + 验收:2026-09-15 用户反馈三项
 *   ① 记忆页「设置标准回答」点击无可见反馈(真因:写入成功但反馈在视口外 + 统计不刷新);
 *   ② 文件夹页内联表单输入框与按钮不等高(实测 35px vs 28px);
 *   ③ 导航栏顶部 logo 已删。
 * 同时落截图到 logs/ 便于人工核对。
 * 用法:node scripts/verify-ui-2026-09-15.mjs
 */
import { chromium } from '@playwright/test'
import { rmSync } from 'node:fs'

const ROOT = 'E:\\个人项目\\拼多多客服检索工具\\personal-ai-memory'
const CHROME =
  'C:\\Users\\胡起嘉\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const EXT = ROOT + '\\build\\chrome-mv3-prod'
// 每次运行独立 profile:避免陈旧 SW 脚本缓存与 profile 锁(跑完即删)
const PROFILE = ROOT + '\\.diag-run-' + Date.now()
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
// SW reload 后扩展页可能短暂不可达 → 重试打开
let opened = false
for (let i = 0; i < 12 && !opened; i++) {
  try {
    await pop.goto(`chrome-extension://${extId}/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })
    opened = true
  } catch {
    await sleep(2000)
  }
}
if (!opened) {
  console.log('FAIL: popup 打不开')
  await ctx.close()
  process.exit(1)
}
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

/** 头部概览行:页签标题下的那行统计(设置页为空串) */
const projectHeader = () =>
  pop.evaluate(() => {
    const el = document.querySelector('header > div:nth-child(2)')
    return el?.textContent ?? ''
  })
const before = await projectHeader()
const statsBefore = (await send('GET_STATS')).goldenCount

// ── ① 记忆页:点击设为标准(第十九轮:mini 幽灵钮;已设变琥珀 ★ 徽标)──
const btn = pop.locator('button', { hasText: '设为标准' }).first()
await btn.click()
await sleep(2200)
const after = await projectHeader()
const statsAfter = (await send('GET_STATS')).goldenCount
const doneMarker = await pop.locator('[title="该回复已设为标准回答;可在文件夹页取消"]').count()

check('点击后按钮原位变为「标准回答」徽标', doneMarker > 0, `命中 ${doneMarker} 处`)

// ── 记忆页:每个问题的折叠按钮(2026-09-15 用户反馈"目前没有")──
const expandedBefore = await pop.locator('button[aria-expanded="true"]').count()
const collapsedBefore = await pop.locator('button[aria-expanded="false"]').count()
check('每条问题都有折叠按钮', expandedBefore + collapsedBefore > 0, `expanded=${expandedBefore} collapsed=${collapsedBefore}`)
await pop.locator('button[aria-expanded]').first().click()
await sleep(350)
const expandedAfter = await pop.locator('button[aria-expanded="true"]').count()
const collapsedAfter = await pop.locator('button[aria-expanded="false"]').count()
check(
  '点折叠按钮 → 该问题折叠(aria-expanded 翻转)',
  expandedAfter === expandedBefore - 1 && collapsedAfter === collapsedBefore + 1,
  `${expandedBefore}→${expandedAfter} / ${collapsedBefore}→${collapsedAfter}`,
)
await pop.locator('button[aria-expanded="false"]').first().click()
await sleep(350)
check(
  '再点一次 → 展开复原',
  (await pop.locator('button[aria-expanded="true"]').count()) === expandedBefore,
)

// ── 记忆页:删除入口(第十八轮:折叠钮左侧垃圾桶图标 + 行下确认条)──
const delGeo = await pop.evaluate(() => {
  const del = document.querySelector('button[title="删除该问答(需确认)"]')
  const chevron = document.querySelector('button[aria-expanded]')
  if (!del || !chevron) return null
  const d = del.getBoundingClientRect()
  const c = chevron.getBoundingClientRect()
  return {
    sameRow: del.parentElement === chevron.parentElement,
    delLeftOfChevron: d.left < c.left,
    delH: Math.round(d.height),
    chevH: Math.round(c.height),
  }
})
check(
  '删除为图标钮且在折叠钮左侧(同问题行、同高)',
  delGeo !== null && delGeo.sameRow && delGeo.delLeftOfChevron && delGeo.delH === delGeo.chevH,
  delGeo ? `${delGeo.delH}/${delGeo.chevH}px` : 'missing',
)
const textDeleteBtns = await pop.evaluate(
  () => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === '删除').length,
)
check('「删除」文字按钮已图标化(页面不再有纯文字删除钮)', textDeleteBtns === 0, `命中 ${textDeleteBtns}`)
await pop.locator('button[title="删除该问答(需确认)"]').first().click()
await sleep(300)
const confirmShown = await pop.evaluate(() => document.body.innerText.includes('删除该问答及其全部回复?'))
check('点删除图标 → 问题行下方出确认条', confirmShown)
await pop.locator('button', { hasText: '取消' }).first().click()
await sleep(300)
check(
  '取消可退出确认条',
  !(await pop.evaluate(() => document.body.innerText.includes('删除该问答及其全部回复?'))),
)

check(`头部统计刷新(标准回答 ${statsBefore} → ${statsAfter})`, statsAfter > statsBefore)
check('记忆页只展示本页统计(问答/回复),不再堆四个计数', /^问答 \d+ · 回复 \d+$/.test(after.trim()), after)
await pop.screenshot({ path: ROOT + '\\logs\\ui-0915-memory.png' })

// ── ② 文件夹页:内联表单等高 ──
await pop.locator('button[title="文件夹"]').click()
await sleep(600)
const foldersSummary = (await projectHeader())
check(
  '文件夹页统计 = 文件夹 n · 标准回答 m',
  /^文件夹 \d+ · 标准回答 \d+$/.test(foldersSummary.trim()),
  foldersSummary,
)
// ── 默认文件夹更名(第十八轮:未分类 → 默认文件夹,存量启动时迁移)──
const folderPageText = await pop.evaluate(() => document.body.innerText)
check(
  '预置夹显示「默认文件夹」(不再出现「未分类」)',
  folderPageText.includes('默认文件夹') && !folderPageText.includes('未分类'),
)
const railLogos = await pop.evaluate(
  () => document.querySelectorAll('nav [title="拼多多客服快捷回复"]').length,
)
check('导航栏顶部品牌 logo 已移除', railLogos === 0, `品牌标命中=${railLogos}`)

await pop.locator('button', { hasText: "新建文件夹" }).click()
await sleep(500)
const geo = await pop.evaluate(() => {
  const input = document.querySelector('input[placeholder="文件夹名称"]')
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

// ── 设置页:不展示任何统计 ──
await pop.locator('button[title="设置"]').click()
await sleep(600)
const settingsSummary = (await projectHeader())
check('设置页不展示统计', settingsSummary.trim() === '', JSON.stringify(settingsSummary))

// ── 设置页:快捷键展示与录入入口(第二十二轮起两行:唤起键 + 候选切换键)──
const hkText = await pop.evaluate(() => document.querySelector('kbd')?.textContent ?? '')
check('设置页展示快捷键(默认 Ctrl + Enter)', hkText === 'Ctrl + Enter', hkText)
const kbdTexts = await pop.evaluate(() => [...document.querySelectorAll('kbd')].map((k) => k.textContent))
check('候选切换键行存在且默认 Tab(第二十二轮)', kbdTexts.includes('Tab'), JSON.stringify(kbdTexts))
const modifyBtn = pop.locator('button', { hasText: '修改' })
check('两行快捷键都可进入录入(有 2 个「修改」按钮)', (await modifyBtn.count()) === 2)
// ── 快捷键行几何(第十七轮):kbd 与「修改」钮等高(等高铁律),修改推至行右 ──
// 按行取(第二十二轮起两行):第一个「修改」钮所在行的 kbd 与该钮
const hkGeo = await pop.evaluate(() => {
  const mod = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('修改'))
  const kbdEl = mod?.closest('div[style]')?.parentElement?.querySelector('kbd')
  if (!kbdEl || !mod) return null
  const k = kbdEl.getBoundingClientRect()
  const m = mod.getBoundingClientRect()
  return { kH: Math.round(k.height), mH: Math.round(m.height), kRight: Math.round(k.right), mLeft: Math.round(m.left) }
})
check('快捷键 kbd 与「修改」钮等高', hkGeo !== null && hkGeo.kH === hkGeo.mH, hkGeo ? `${hkGeo.kH}/${hkGeo.mH}px` : 'missing')
check('「修改」钮在快捷键展示右侧', hkGeo !== null && hkGeo.mLeft > hkGeo.kRight, hkGeo ? `kbd.right=${hkGeo.kRight} btn.left=${hkGeo.mLeft}` : '')
await modifyBtn.first().click()
await sleep(300)
const recHint = await pop.evaluate(() => document.body.innerText.includes('请按下新的快捷键'))
check('点修改 → 进入录入态(等待新组合键)', recHint)
await pop.keyboard.press('Escape')
await sleep(300)
check('Esc 可取消录入', !(await pop.evaluate(() => document.body.innerText.includes('请按下新的快捷键'))))

// ── ③ 标准回答行内小控件等高(填充钮与悬浮图标钮同取 controlH.inline 档;
//     旧步骤找第三轮时代的常驻「取消」钮,第十二轮文件夹页重构后已不存在)──
await pop.locator('button[title="文件夹"]').click()
await sleep(500)
const inlineGeo = await pop.evaluate(() => {
  const hs = [...document.querySelectorAll('button')]
    .filter((b) => b.textContent.trim() === '填充' || (b.title && b.title.includes('复制')))
    .map((b) => Math.round(b.getBoundingClientRect().height))
  return hs
})
console.log('行内小控件高度 =', JSON.stringify(inlineGeo))
check('标准回答行内小控件等高(填充/图标钮同高)', inlineGeo.length >= 2 && new Set(inlineGeo).size === 1, inlineGeo.join('/'))

console.log('页面错误 =', JSON.stringify(pageErrors))
console.log(`\n合计 ${results.filter((r) => r.ok).length}/${results.length} 通过`)
await ctx.close()
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* 有残留句柄时留给下次清理 */
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
