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

// ─── 滑杆量程与单位(2026-09-17 第五十二轮真实 bug)──────────────────────────────
// 用户报:「整合超时的默认项数值太高了,滚动条有问题,拖动无变化」。
// 根因是调用点把毫秒喂给了以秒为界的滑杆(range 值越界时浏览器把滑块钉在最右端,
// 组件显示的却仍是 React 传进来的那个数)—— 所以这里量的是**渲染出来的读数**,
// 读数越界就是单位错配的现场证据;再用键盘拖一格,验"拖得动"。
{
  await pop.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1800)
  await pop.locator('button[title="设置"]').click()
  await sleep(800)

  /** 读全部滑杆的「标签 / 显示值 / 量程」;再按标签取某根(页面里执行,不引用 Node 闭包) */
  const sliders = await pop.evaluate(() =>
    [...document.querySelectorAll('input.pddcs-slider')].map((input) => {
      const row = input.parentElement.children[0]
      return {
        label: row.children[0].textContent,
        shown: parseFloat(row.children[1].textContent),
        min: Number(input.min),
        max: Number(input.max),
      }
    }),
  )
  const outOfRange = sliders.filter((s) => !(s.shown >= s.min && s.shown <= s.max))
  check(
    '滑杆读数落在自己的量程内(单位错配的现场证据)',
    sliders.length >= 5 && outOfRange.length === 0,
    outOfRange.length ? `越界=${JSON.stringify(outOfRange)}` : `共 ${sliders.length} 根`,
  )

  const idx = sliders.findIndex((s) => s.label === '整合超时')
  check(
    '整合超时:默认 8 秒、量程 2~30 秒(滑杆读秒、设置存毫秒)',
    idx >= 0 && sliders[idx].shown === 8 && sliders[idx].min === 2 && sliders[idx].max === 30,
    JSON.stringify(sliders[idx] ?? null),
  )

  // 键盘拖一格(焦点 + →):range 的原生步进。比鼠标去够 14px 圆拇指稳,
  // 走的是同一条「值变 → onChange → 防抖落库」的路。
  await pop.locator('input.pddcs-slider').nth(idx).press('ArrowRight')
  await sleep(1200) // 滑杆 500ms detent 防抖 + 落库余量
  const after = await pop.evaluate(async () => {
    const input = [...document.querySelectorAll('input.pddcs-slider')].find(
      (el) => el.parentElement.children[0].children[0].textContent === '整合超时',
    )
    const row = input.parentElement.children[0]
    const s = await chrome.storage.local.get(['pddcs:settings'])
    return { shown: parseFloat(row.children[1].textContent), stored: s['pddcs:settings']?.llmTimeoutMs }
  })
  check(
    '整合超时:键盘拖一格,读数与库里的毫秒一起变(不再"拖动无变化")',
    after.shown === 9 && after.stored === 9000,
    `读数=${after.shown} 秒 库=${after.stored} ms`,
  )
}

// ─── AI 整合表单保存(2026-09-17 第四十八轮真实 bug)────────────────────────────
// 用户报:填完接口配置点「保存」,内容全部消失、整块不可用。
// 单测里后台是桩,这里跑的是**真浏览器 + 真后台 + 真 chrome.storage**:
// 填 → 存 → 后台夹取 → 回填 → 关掉重开,顺带核对库里落的到底是什么。
{
  await pop.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1800)
  await pop.locator('button[title="设置"]').click()
  await sleep(600)

  // 地址刻意用 mms.pinduoduo.com:它在 manifest 的 host_permissions 里已授予,
  // 于是 saveLlm 里那次 chrome.permissions.request 无需弹窗、立即返回 ——
  // 这是**唯一**能在 headless 里跑通保存路径的办法(无头浏览器没有权限弹窗,
  // 换成一个要新授权的域名,request() 的 Promise 会永远挂着,保存根本走不到落库)。
  // 换域名不影响这条检查要验的东西:表单 → 设置字段名 → 后台夹取 → 落库 → 回填。
  const AI = { url: 'https://mms.pinduoduo.com/v1/', key: 'sk-verify-1234', model: 'verify-model' }
  const URL_SAVED = 'https://mms.pinduoduo.com/v1' // 后台夹取去尾斜杠后的样子

  const PH = {
    url: 'input[placeholder="https://api.deepseek.com/v1"]',
    key: 'input[placeholder="sk-…"]',
    model: 'input[placeholder="deepseek-chat"]',
  }
  /**
   * 读当前表单与库里的状态。
   * 注意:evaluate 的函数体在浏览器里执行,不能引用 Node 侧的闭包变量。
   */
  const readState = async () => {
    const st = await pop.evaluate(async () => {
      const byPh = (p) =>
        [...document.querySelectorAll('input.pddcs-input')].find((el) => el.placeholder === p)
      const store = (k) => chrome.storage.local.get([k]).then((o) => o[k])
      const s = await store('pddcs:settings')
      return {
        form: {
          url: byPh('https://api.deepseek.com/v1')?.value,
          key: byPh('sk-…')?.value,
          model: byPh('deepseek-chat')?.value,
        },
        stored: { url: s.llmBaseUrl, key: s.llmApiKey, model: s.llmModel },
        draftAlive: !!(await store('pddcs:llmDraft')),
        dirtyNotice: document.body.textContent.includes('有未保存的修改'),
        btnDisabled: Object.fromEntries(
          ['保存', '测试连接'].map((label) => [
            label,
            [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
              ?.disabled,
          ]),
        ),
      }
    })
    return st
  }

  // 用 Playwright 真实输入与真实点击,不用 page 内 dispatch:
  // 「保存」要申请主机权限,chrome.permissions.request **只认受信任的用户手势**,
  // 脚本合成的 click 拿不到手势令牌,请求会一直挂着 —— 保存根本走不到落库那一步。
  await pop.locator(PH.url).fill(AI.url)
  await pop.locator(PH.key).fill(AI.key)
  await pop.locator(PH.model).fill(AI.model)
  // 先等过草稿防抖(300ms)再点保存 —— 真实用户也是这个节奏,
  // 这样"保存前确实有一次挂起的草稿落盘"才是被验到的那条路径
  await sleep(450)
  await pop.locator('button:text-is("保存")').click()
  await sleep(1500)

  const saved = await readState()
  check(
    'AI 表单保存:落库的是 llm* 字段(不再是一个字段都没存进去)',
    saved.stored.url === URL_SAVED && saved.stored.key === AI.key && saved.stored.model === AI.model,
    `stored=${JSON.stringify(saved.stored)}`,
  )
  check(
    'AI 表单保存:输入框里还是用户填的内容(用户报的"点保存就消失")',
    saved.form.url === URL_SAVED && saved.form.key === AI.key && saved.form.model === AI.model,
    `form=${JSON.stringify(saved.form)}`,
  )
  check(
    'AI 表单保存:不残留"有未保存的修改",「测试连接」仍可用("不可使用"就是它变灰)',
    !saved.dirtyNotice && saved.btnDisabled['测试连接'] === false,
    `dirtyNotice=${saved.dirtyNotice} 保存=${saved.btnDisabled['保存']} 测试连接=${saved.btnDisabled['测试连接']}`,
  )
  check(
    'AI 表单保存:草稿已清,且没被挂起的防抖定时器写回来',
    saved.draftAlive === false,
    `draftAlive=${saved.draftAlive}`,
  )

  // 关掉重开:这是用户真正会做的下一步
  await pop.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1800)
  await pop.locator('button[title="设置"]').click()
  await sleep(800)
  const reopened = await readState()
  check(
    'AI 表单重开:配置还在(不是一片空白)',
    reopened.form.url === URL_SAVED &&
      reopened.form.key === AI.key &&
      reopened.form.model === AI.model,
    `form=${JSON.stringify(reopened.form)}`,
  )
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
