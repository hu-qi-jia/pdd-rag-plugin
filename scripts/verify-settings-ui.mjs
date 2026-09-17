/**
 * 设置页口径验收(2026-09-16 第四十一轮,用户三条要求)——
 *  ① 文字字号规范:分组标题 13.5 / 配置项字段 12.5 / 说明文字 11.5
 *  ② 配置项之间间距增大并统一:全页 16px 栅格(标签→说明 4px,标签→滑杆轨道 8px)
 *  ③ 开关与滑杆改灰白:激活色浅色深灰 / 深色白,柄色与轨道反相
 *
 * 全部按真实渲染的 rect / computedStyle 量,不 grep 源码字面值。
 * 用法:node scripts/verify-settings-ui.mjs
 */
import { rmSync } from 'node:fs'
import path from 'node:path'
import {
  launchExtContext,
  findExtensionId,
  openPopup,
  freshProfile,
  ROOT,
  sleep,
} from './lib.mjs'

const PROFILE = freshProfile()
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
/** 颜色归一:#ffffff / rgb(255,255,255) / rgba(255,255,255,1) 视为同色 */
const normColor = (c) => {
  const s = String(c).replace(/\s+/g, '').toLowerCase()
  const hex = s.match(/^#([0-9a-f]{6})$/)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`
  }
  const rgb = s.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/)
  if (!rgb) return s
  const a = rgb[4] === undefined ? 1 : Number(rgb[4])
  return a >= 1 ? `rgb(${rgb[1]},${rgb[2]},${rgb[3]})` : s
}

/** 每主题的期望值(令牌真源在 src/ui/theme.ts) */
const EXPECT = {
  light: {
    // controlActive: #45484d(与主按钮同值),controlKnobBg: #ffffff,switchTrack: #c6c8cc
    active: 'rgb(69,72,77)',
    knob: 'rgb(255,255,255)',
    offTrack: 'rgb(198,200,204)',
  },
  dark: {
    // controlActive: #ffffff,controlKnobBg: #2c2c2c,switchTrack: rgba(255,255,255,0.16)
    active: 'rgb(255,255,255)',
    knob: 'rgb(44,44,44)',
    offTrack: 'rgba(255,255,255,0.16)',
  },
}

const ctx = await launchExtContext(PROFILE, { headless: true })
await sleep(5000)
const extId = await findExtensionId(ctx)
if (!extId) {
  console.log('FAIL: 扩展未加载')
  await ctx.close()
  process.exit(1)
}
const pop = await openPopup(ctx, extId)
if (!pop) {
  console.log('FAIL: popup 打不开')
  await ctx.close()
  process.exit(1)
}
const pageErrors = []
pop.on('pageerror', (e) => pageErrors.push('[PAGE_ERROR] ' + e.message))
await sleep(2500)

// 预置:开启「自动回复」,让开关处于选中态(否则量不到激活色)
await pop.evaluate(async () => {
  const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' })
  await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    payload: { ...stats.payload.settings, directFillEnabled: true },
  })
})

for (const theme of ['light', 'dark']) {
  await pop.evaluate(async (t) => {
    await chrome.storage.local.set({ 'pddcs:theme': t })
    localStorage.setItem('pddcs:theme', t)
  }, theme)
  await pop.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1800)
  await pop.locator('button[title="设置"]').click()
  await sleep(800)

  const m = await pop.evaluate(() => {
    const scroll = document.querySelector('.pddcs-scroll')
    const tabRoot = scroll?.firstElementChild
    const cards = tabRoot ? [...tabRoot.children] : []
    const card = cards.find((el) => el.textContent.includes('检索与填充'))
    // 卡片没渲染出来时直接返回诊断,别让后续 getComputedStyle 抛"不是 Element"
    if (!card) {
      return { error: '设置卡片未渲染', text: (tabRoot?.textContent ?? '(无 .pddcs-scroll)').slice(0, 300) }
    }
    const px = (v) => Math.round(parseFloat(v) * 100) / 100
    const sw0 = card.querySelector('[role="switch"]')

    // ── 字号:卡片标题 / 配置项字段 / 说明文字 ──
    const titleEl = [...card.querySelectorAll('div')].find(
      (el) => el.children.length === 0 && el.textContent === '检索与填充',
    )
    const ts = getComputedStyle(titleEl)

    // 第四十八轮:整行容器由 <label> 改为 <div>(用户"只有在点击开关时才开/关,
    // 点配置文字不该触发"),文字块不再由 label 包着 —— 从开关本体反查同一行
    const toggleRow = sw0.parentElement
    const textWrap = toggleRow.querySelector(':scope > span')
    const labelEl = textWrap.children[0]
    const descEl = textWrap.children[1]
    const ls = getComputedStyle(labelEl)
    const ds = getComputedStyle(descEl)

    // ── 间距:卡片内相邻配置项、标签→说明、标签→轨道、卡片之间 ──
    const rows = [...card.children].slice(1) // 首个子元素是分组标题
    const rowGaps = rows
      .slice(1)
      .map((el, i) => px(el.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom))
    const cardGaps = cards
      .slice(1)
      .map((el, i) => px(el.getBoundingClientRect().top - cards[i].getBoundingClientRect().bottom))
    const labelDescGap = px(descEl.getBoundingClientRect().top - labelEl.getBoundingClientRect().bottom)

    const sliderBlock = card.querySelector('input.pddcs-slider').parentElement
    const sliderLabelRow = sliderBlock.children[0]
    const sliderTrack = card.querySelector('input.pddcs-slider')
    const labelControlGap = px(
      sliderTrack.getBoundingClientRect().top - sliderLabelRow.getBoundingClientRect().bottom,
    )

    // ── 开关 / 滑杆配色 ──
    const sw = sw0
    const knob = sw.querySelector('.pddcs-switch-knob')
    const knobBg = getComputedStyle(knob).backgroundColor
    // 令牌 → CSS 变量的桥挂在 popup 最外层 div 上,自定义属性会向下继承,
    // 故从滚动容器读到的就是根上注入的值(不必知道根元素具体是什么 id)
    const resetCss = document.getElementById('pddcs-popup-reset-style')?.textContent ?? ''

    // 拇指规则体单独取出再断(拿整份 CSS 跑正则会跨规则误匹配到焦点环的 accent)
    const thumbRule = resetCss.match(/::-webkit-slider-thumb\s*\{([^}]*)\}/)?.[1] ?? ''
    const focusRingBlue =
      /\.pddcs-slider:focus-visible\s*\{[^}]*var\(--pddcs-accent\)/.test(resetCss) &&
      /\.pddcs-switch:focus-visible\s*\{[^}]*var\(--pddcs-accent\)/.test(resetCss)

    return {
      titleFont: ts.fontSize,
      titleWeight: ts.fontWeight,
      labelFont: ls.fontSize,
      labelWeight: ls.fontWeight,
      descFont: ds.fontSize,
      descWeight: ds.fontWeight,
      labelDescGap,
      labelControlGap,
      sliderDisplay: getComputedStyle(sliderTrack).display,
      sliderMarginTop: getComputedStyle(sliderTrack).marginTop,
      rowGaps,
      cardGaps,
      onTrack: getComputedStyle(sw).backgroundColor,
      knobBg,
      onEqualsKnob: getComputedStyle(sw).backgroundColor === knobBg,
      sliderFill: sliderTrack.style.backgroundImage,
      varActive: getComputedStyle(scroll).getPropertyValue('--pddcs-control-active').trim(),
      varKnob: getComputedStyle(scroll).getPropertyValue('--pddcs-control-knob').trim(),
      thumbRule,
      thumbHasBlue: thumbRule.includes('--pddcs-accent'),
      thumbUsesVars:
        thumbRule.includes('var(--pddcs-control-active)') &&
        thumbRule.includes('var(--pddcs-control-knob)'),
      focusRingBlue,
    }
  })

  const exp = EXPECT[theme]
  const name = (s) => `[${theme}] ${s}`
  console.log(`\n── ${theme} ──`, JSON.stringify(m))

  if (m.error) {
    check(name(`设置页渲染(${m.error})`), false, m.text)
    continue
  }

  // ① 字号规范
  check(name('分组标题 13.5px / 600'), m.titleFont === '13.5px' && m.titleWeight === '600', `${m.titleFont} ${m.titleWeight}`)
  check(name('配置项字段 12.5px / 600'), m.labelFont === '12.5px' && m.labelWeight === '600', `${m.labelFont} ${m.labelWeight}`)
  check(name('说明文字 11.5px / 400'), m.descFont === '11.5px' && m.descWeight === '400', `${m.descFont} ${m.descWeight}`)

  // ② 间距统一
  check(
    name('配置项之间 16px 且全部一致'),
    m.rowGaps.length >= 7 && m.rowGaps.every((g) => Math.abs(g - 16) <= 0.5),
    `gaps=${JSON.stringify(m.rowGaps)}`,
  )
  check(
    name('卡片之间同为 16px'),
    m.cardGaps.length >= 3 && m.cardGaps.every((g) => Math.abs(g - 16) <= 0.5),
    `gaps=${JSON.stringify(m.cardGaps)}`,
  )
  check(name('标签 → 说明 4px'), Math.abs(m.labelDescGap - 4) <= 0.5, `${m.labelDescGap}`)
  check(
    name('标签 → 滑杆轨道 8px'),
    Math.abs(m.labelControlGap - 8) <= 0.5,
    `gap=${m.labelControlGap} display=${m.sliderDisplay} marginTop=${m.sliderMarginTop}`,
  )

  // ③ 开关 / 滑杆灰白
  check(
    name(`开关选中轨道取激活色(${exp.active})`),
    normColor(m.onTrack) === exp.active,
    `on=${m.onTrack} 期望=${exp.active}`,
  )
  check(name(`开关柄取反相柄色(${exp.knob})`), normColor(m.knobBg) === exp.knob, `knob=${m.knobBg}`)
  check(
    name('柄与轨道不同色(反相硬约束)'),
    normColor(m.knobBg) !== normColor(m.onTrack),
    `knob=${m.knobBg} track=${m.onTrack}`,
  )
  // 浏览器会把渐变里的 hex 归一成 rgb(),断言前统一归一再比
  const fill = String(m.sliderFill).replace(/\s+/g, '')
  check(
    name('滑杆填充用激活色、不再是 accent 蓝'),
    fill.includes('linear-gradient') &&
      fill.includes(exp.active) &&
      !fill.includes(normColor('#0d99ff')) &&
      !fill.includes(normColor('#4cb3ff')),
    m.sliderFill,
  )
  check(
    name('开关/滑杆的 K/V 桥已注入并等于令牌'),
    normColor(m.varActive) === normColor(exp.active) && normColor(m.varKnob) === normColor(exp.knob),
    `--active=${m.varActive} --knob=${m.varKnob}`,
  )
  check(
    name('滑杆拇指 CSS 走变量(不再是写死的白底 + accent 描边)'),
    m.thumbUsesVars && !m.thumbHasBlue,
    `vars=${m.thumbUsesVars} blueThumb=${m.thumbHasBlue} | ${m.thumbRule.trim()}`,
  )
  check(
    name('焦点环保留品牌蓝(刻意:控件本体改灰白,焦点是状态色)'),
    m.focusRingBlue,
    `focusRingBlue=${m.focusRingBlue}`,
  )

  await pop.screenshot({
    path: path.join(ROOT, 'logs', `ui-0916-settings-${theme}.png`),
    clip: { x: 0, y: 0, width: 420, height: 560 },
  })
  await pop.evaluate(() => {
    const el = document.querySelector('.pddcs-scroll')
    if (el) el.scrollTop = el.scrollHeight
  })
  await sleep(400)
  await pop.screenshot({
    path: path.join(ROOT, 'logs', `ui-0916-settings-${theme}-bottom.png`),
    clip: { x: 0, y: 0, width: 420, height: 560 },
  })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length - failed.length}/${results.length} 通过`)
if (pageErrors.length) console.log('页面错误:\n' + pageErrors.join('\n'))
await ctx.close()
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* 忽略 */
}
process.exit(failed.length ? 1 : 0)
