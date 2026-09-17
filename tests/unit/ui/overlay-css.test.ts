// 覆盖层主题单测(2026-09-15 评审 设计1):聊天页覆盖层 CSS 原写死浅色令牌,
// 现抽取为纯函数 buildOverlayCss(按 ThemeTokens 生成)+ parseThemeMode(容错解析存储值)。
import { describe, it, expect } from 'vitest'
import {
  BADGE_PAD_X,
  buildOverlayCss,
  PANEL_PAD_X,
  panelSurface,
  parseThemeMode,
  POPUP_W,
  ROW_GAP_Y,
  ROW_INSET_X,
  ROW_PAD_X,
  ROW_PAD_Y,
  ROW_RADIUS,
  THEME_STORAGE_KEY,
} from '../../../src/ui/overlay-css'
import { lightTheme, darkTheme } from '../../../src/ui/theme'
import { controlH, fontSize, fontWeight, material, radius, semantic, spacing } from '../../../src/ui/design'

describe('buildOverlayCss:按主题令牌生成覆盖层样式', () => {
  it('浅色令牌 → 浅色面板底 + 主/次级文本色,且不混入深色文本', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain(`background: ${lightTheme.bg}`)
    // 覆盖层里出现的是面板与气泡按钮用到的令牌(text / textMuted / textTertiary);
    // **不含** btnPrimaryBg —— 主按钮只在 popup 侧,此处断它等于在断一个不存在的引用
    // (第四十一轮修正:旧断言 toContain(btnPrimaryBg) 曾因 tk.text 恰与主钮同值而"假绿")
    expect(css).toContain(`color: ${lightTheme.text}`)
    expect(css).toContain(`color: ${lightTheme.textMuted}`)
    expect(css).toContain(`color: ${lightTheme.textTertiary}`)
    expect(css).not.toContain(darkTheme.text)
  })
  it('深色令牌 → 深色面板底/中性灰控件,与浅色产物不同', () => {
    const css = buildOverlayCss(darkTheme)
    expect(css).toContain(`background: ${darkTheme.bg}`)
    expect(css).toContain(darkTheme.btnBg)
    expect(css).not.toContain(lightTheme.text)
    expect(css).not.toBe(buildOverlayCss(lightTheme))
  })
  it('轻提示 toast 两主题下都是深底白字(可读性不随主题切换)', () => {
    for (const tk of [lightTheme, darkTheme]) {
      expect(buildOverlayCss(tk)).toContain('rgba(22,22,22,.92)')
    }
  })
})

describe('buildOverlayCss:ChatGPT 化视觉(2026-09-16 第二十五轮,1+2+3+6,不割裂)', () => {
  it('候选行去分隔线靠留白分组(无 border-bottom)', () => {
    const css = buildOverlayCss(lightTheme)
    const candRule = css.match(/\.pddcs-cand \{[^}]*\}/)![0]
    expect(candRule).not.toContain('border-bottom')
  })
  it('徽标软底 chip 化(v2.6.19 用户"明显一点"):金=琥珀软底金字,知识库=绿软底绿字,圆点移除', () => {
    const css = buildOverlayCss(lightTheme)
    const badgeRule = css.match(/\.pddcs-badge \{[^}]*\}/)![0]
    expect(badgeRule).toContain('background:') // chip 软底回归
    expect(css).not.toContain('.pddcs-badge::before') // 6px 圆点移除
    expect(css).toContain('.pddcs-badge.golden')
    expect(css).toContain('rgba(184, 134, 11, 0.14)')
    expect(css).toContain('.pddcs-badge.knowledge')
    expect(css).toContain('rgba(20, 174, 92, 0.12)')
  })
  it('页脚键位提示键帽化:.pddcs-kbd 细边框圆角灰底', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain('.pddcs-kbd')
    expect(css).toContain(`border: 1px solid ${lightTheme.border}`)
  })
  it('浮层阴影为"亮环 → 近影 → 环境影"三段(v2.7.0:面板无描边,那圈 0.5px 环是唯一硬边)', () => {
    // 浅色的环是黑的、深色的环是白的 —— 深底上画黑环等于没画
    for (const [name, tk, ring] of [
      ['浅色', lightTheme, '0 0 0 0.5px rgba(0,0,0,0.06)'],
      ['深色', darkTheme, '0 0 0 0.5px rgba(255,255,255,0.10)'],
    ] as const) {
      expect(tk.shadow.startsWith(ring), `${name}环`).toBe(true)
      // 环只是轮廓,托起面板靠后两段阴影,且必须是"近→远"的小大序
      expect(tk.shadow.split('), ').length, `${name}三段`).toBe(3)
    }
  })
})

describe('buildOverlayCss:对话式排版与字号主次(2026-09-16 第二十六轮)', () => {
  it('回答正文为主层:13.5px(title 档)+ 1.6 行高', () => {
    const css = buildOverlayCss(lightTheme)
    const textRule = css.match(/\.pddcs-cand-text \{[^}]*\}/)![0]
    expect(textRule).toContain('font-size: 13.5px')
    expect(textRule).toContain('line-height: 1.6')
  })
  it('问题回显上置为引子:11.5px 灰字单行省略(.pddcs-cand-q);底部来源行规则移除', () => {
    const css = buildOverlayCss(lightTheme)
    const qRule = css.match(/\.pddcs-cand-q \{[^}]*\}/)![0]
    expect(qRule).toContain('font-size: 11.5px')
    expect(qRule).toContain('text-overflow: ellipsis')
    expect(css).not.toContain('.pddcs-cand-src')
  })
  it('面板名与候选数分属两档(v2.7.0):15px 半粗主文本 + 12.5px 三级灰,不再挤在一个灰字串里', () => {
    const css = buildOverlayCss(lightTheme)
    const rule = (sel: RegExp) => css.match(sel)![0]
    const head = rule(/\.pddcs-popup-head \{[^}]*\}/)
    // 头容器只做布局与配色,字号/字重下沉到两个文字档,否则 title/count 的字号会被容器盖住
    expect(head).not.toContain('font-size')
    expect(head).toContain(`color: ${lightTheme.text}`)
    const title = rule(/\.pddcs-popup-title \{[^}]*\}/)
    expect(title).toContain(`font-size: ${fontSize.heading}px`)
    expect(title).toContain(`font-weight: ${fontWeight.semibold}`)
    expect(title).toContain('letter-spacing: -0.02em')
    const count = rule(/\.pddcs-popup-count \{[^}]*\}/)
    expect(count).toContain(`font-size: ${fontSize.body}px`)
    expect(count).toContain(`font-weight: ${fontWeight.regular}`)
    expect(count).toContain(`color: ${lightTheme.textTertiary}`)
    // 计数比面板名小两档:它是补充信息,不是第二个标题
    expect(fontSize.heading).toBeGreaterThan(fontSize.body)
  })
  it('死规则清理:score 元素早已移除,规则不再生成', () => {
    expect(buildOverlayCss(lightTheme)).not.toContain('.pddcs-score')
  })
})

describe('buildOverlayCss:面板重设计(2026-09-16 第三十二轮 v2.6.18)', () => {
  it('面板加宽至 360(CSS 与 JS 定位共用常量,单处维护)', () => {
    expect(POPUP_W).toBe(360)
  })
  it('内缩圆角软行:左右内缩由滚动中段的内边距统一给(v2.7.0),行自身只留纵向行距', () => {
    const css = buildOverlayCss(lightTheme)
    const candRule = css.match(/\.pddcs-cand \{[^}]*\}/)![0]
    expect(candRule).toContain('border-radius')
    // 行的左右缘由 body 的 padding 单点决定,行不再自带左右外边距(改一处即整体对齐)
    expect(candRule).toContain(`margin: 0 0 ${ROW_GAP_Y}px`)
    expect(candRule).toContain(`padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px`)
    expect(css.match(/\.pddcs-popup-body \{ flex: 1[^}]*\}/)![0]).toContain(
      `padding: ${spacing.xs}px ${ROW_INSET_X}px`,
    )
    const fillRule = css.match(/\.pddcs-cand:hover,[^{]*\{[^}]*\}/)![0]
    expect(fillRule).toContain(lightTheme.selectedBg)
    expect(fillRule).not.toContain('inset 3px') // 左描边属旧表格语言,移除
  })
  it('操作钮悬浮/选中才显:静止 opacity 0 + pointer-events none,悬浮或选中显现', () => {
    const css = buildOverlayCss(lightTheme)
    const actRule = css.match(/\.pddcs-cand-actions \{[^}]*\}/)![0]
    expect(actRule).toContain('opacity: 0')
    expect(actRule).toContain('pointer-events: none')
    expect(css).toMatch(/\.pddcs-cand:hover \.pddcs-cand-actions[^{]*\{[^}]*opacity: 1/)
    expect(css).toMatch(/\.pddcs-cand-selected \.pddcs-cand-actions[^{]*\{[^}]*opacity: 1/)
  })
  it('三段式壳:popup 为 flex 列只负责裁圆角,滚动移交 body,页脚常驻;v2.7.0 三段之间不再有分隔线', () => {
    const css = buildOverlayCss(lightTheme)
    const popupRule = css.match(/\.pddcs-popup \{[^}]*\}/)![0]
    expect(popupRule).toContain('display: flex')
    expect(popupRule).not.toContain('overflow: auto') // 滚动不再在面板根上
    const bodyRule = css.match(/\.pddcs-popup-body \{ flex: 1[^}]*\}/)![0]
    expect(bodyRule).toContain('flex: 1')
    expect(bodyRule).toContain('overflow-y: auto')
    // 页脚仍是常驻壳(flex: 0 0 auto),但不再靠 hairline + 灰底自成一段 ——
    // 整块面板是一张连续材料,分层靠留白(见 v2.7.0 材料用例)
    const footRule = css.match(/\.pddcs-popup-foot \{[^}]*\}/)![0]
    expect(footRule).toContain('flex: 0 0 auto')
    expect(footRule).not.toContain('border-top')
    expect(footRule).not.toContain('background')
  })
  it('入场动效:200ms 级淡入落位, prefers-reduced-motion 关闭', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).toContain('@keyframes pddcs-pop-in')
    const popupRule = css.match(/\.pddcs-popup \{[^}]*\}/)![0]
    expect(popupRule).toContain('animation: pddcs-pop-in')
    expect(css).toContain('prefers-reduced-motion')
  })
})

describe('buildOverlayCss:面板细节四调(2026-09-16 第三十三轮 v2.6.19)', () => {
  it('面板圆角走 radius.xl,与行圆角构成同心圆角(行内缩多少,行圆角就减多少)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css.match(/\.pddcs-popup \{[^}]*\}/)![0]).toContain(`border-radius: ${radius.xl}px`)
    // 同心是减法关系而非两个独立数字:改任一端,另一端自动跟上
    expect(ROW_RADIUS).toBe(radius.xl - ROW_INSET_X)
    expect(css.match(/\.pddcs-cand \{[^}]*\}/)![0]).toContain(`border-radius: ${ROW_RADIUS}px`)
  })
  it('同内容×n 移到徽标右侧常驻(v2.6.25 用户"同内容移动至标签的右侧"):不再 absolute/不再悬浮才显,折叠条位预留规则删除', () => {
    const css = buildOverlayCss(lightTheme)
    const foldRule = css.match(/\.pddcs-fold \{[^}]*\}/)![0]
    expect(foldRule).not.toContain('position: absolute')
    expect(foldRule).not.toContain('opacity: 0')
    expect(foldRule).toContain('white-space: nowrap')
    expect(foldRule).toContain(`color: ${lightTheme.textTertiary}`)
    // 行首行不再是右浮动覆盖物:悬浮显隐钩子与折叠条位都撤掉
    expect(css).not.toContain('.pddcs-cand:hover .pddcs-fold')
    expect(css).not.toContain('.pddcs-cand-folded')
  })
})

describe('buildOverlayCss:标签放大 + 操作钮图标化 + 列表收紧(2026-09-16 第三十七轮 v2.6.24)', () => {
  it('类别徽标放大(用户"标签比例增大"):11.5px secondary 档 + 3px 9px 内边距 + 6px 圆角', () => {
    const css = buildOverlayCss(lightTheme)
    const badgeRule = css.match(/\.pddcs-badge \{[^}]*\}/)![0]
    expect(badgeRule).toContain('font-size: 11.5px')
    expect(badgeRule).toContain('padding: 3px 9px')
    expect(badgeRule).toContain('border-radius: 6px')
    // 三态配色不变(金/绿/中性灰软底)
    expect(css).toContain('.pddcs-badge.golden')
    expect(css).toContain('.pddcs-badge.knowledge')
  })
  it('三处文字左缘同基线:徽标内边距 BADGE_PAD_X 单点决定下方正文的左缩进', () => {
    const css = buildOverlayCss(lightTheme)
    const candRule = css.match(/\.pddcs-cand \{[^}]*\}/)![0]
    expect(candRule).toContain(`padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px`) // 行左右对称 → 徽标外框即整行左缘
    const topRule = css.match(/\.pddcs-cand-top \{[^}]*\}/)![0]
    expect(topRule).not.toContain('padding-left') // 徽标所在行不得再加缩进
    // v2.6.26 口径:正文对齐徽标**内文字**左缘 → 缩进量 = 徽标的水平内边距,同一个常量
    expect(BADGE_PAD_X).toBe(9)
    expect(css.match(/\.pddcs-badge \{[^}]*\}/)![0]).toContain(`padding: 3px ${BADGE_PAD_X}px`)
    expect(css.match(/\.pddcs-cand-q \{[^}]*\}/)![0]).toContain(`padding-left: ${BADGE_PAD_X}px`)
    expect(css.match(/\.pddcs-cand-text \{[^}]*\}/)![0]).toContain(`padding-left: ${BADGE_PAD_X}px`)
  })
  it('操作钮图标化:文字迷你钮规则移除,改 24px 图标钮(星标/复制)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css).not.toContain('.pddcs-mini')
    const btnRule = css.match(/\.pddcs-icon-btn \{[^}]*\}/)![0]
    expect(btnRule).toContain('width: 24px')
    expect(btnRule).toContain('height: 24px')
    expect(btnRule).toContain('color:') // currentColor 继承,图标 SVG 不写死颜色
    // 星标三态:未设悬浮金、已设实心金
    expect(css).toContain('.pddcs-icon-btn-star:hover')
    expect(css).toContain('.pddcs-icon-btn-golden')
    expect(css).toContain('rgba(184, 134, 11, 0.14)')
    // 在途转圈(替代「设置中…」文字)
    expect(css).toContain('.pddcs-icon-btn-busy svg')
    expect(css).toContain('@keyframes pddcs-spin')
  })
  it('图标钮颜色随主题走令牌(深色取深色 textTertiary),金色星态主题无关(semantic)', () => {
    const dark = buildOverlayCss(darkTheme)
    expect(dark.match(/\.pddcs-icon-btn \{[^}]*\}/)![0]).toContain(
      `color: ${darkTheme.textTertiary}`,
    )
    expect(dark).toContain('.pddcs-icon-btn-golden { color: #b8860b; }')
  })
  it('按钮右移:操作钮组负外边距 6px,从行内边距推向面板右缘', () => {
    const css = buildOverlayCss(lightTheme)
    const actRule = css.match(/\.pddcs-cand-actions \{[^}]*\}/)![0]
    expect(actRule).toContain('margin-right: -6px')
    expect(actRule).toContain('margin-left: auto')
  })
})

describe('buildOverlayCss:词条留白重配 + 折叠数归位(2026-09-16 第三十八轮 v2.6.25)', () => {
  it('留白重配:行内两处纵向节奏取同一个值(RowGapY),上下内边距取另一个(RowPadY)', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css.match(/\.pddcs-cand-top \{[^}]*\}/)![0]).toContain(`margin-bottom: ${ROW_GAP_Y}px`)
    expect(css.match(/\.pddcs-cand-q \{[^}]*\}/)![0]).toContain(`margin-bottom: ${ROW_GAP_Y}px`)
    expect(css.match(/\.pddcs-cand \{[^}]*\}/)![0]).toContain(`padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px`)
    expect(css.match(/\.pddcs-popup-body \{ flex: 1[^}]*\}/)![0]).toContain(
      `padding: ${spacing.xs}px ${ROW_INSET_X}px`,
    )
    // 行距与行内节奏是同一个值:"列表的疏"和"内文的疏"必须是一套,否则一眼看出两套排版
    expect(css.match(/\.pddcs-cand \{[^}]*\}/)![0]).toContain(`margin: 0 0 ${ROW_GAP_Y}px`)
  })
  it('文字左缘基线:行左右内边距即公共左缘;引子/正文缩进 = 徽标内边距', () => {
    const css = buildOverlayCss(lightTheme)
    expect(css.match(/\.pddcs-cand \{[^}]*\}/)![0]).toContain(`padding: ${ROW_PAD_Y}px ${ROW_PAD_X}px`)
    expect(css.match(/\.pddcs-cand-top \{[^}]*\}/)![0]).not.toContain('padding-left')
    expect(css.match(/\.pddcs-cand-q \{[^}]*\}/)![0]).toContain(`padding-left: ${BADGE_PAD_X}px`)
    expect(css.match(/\.pddcs-cand-text \{[^}]*\}/)![0]).toContain(`padding-left: ${BADGE_PAD_X}px`)
  })
  it('同内容×n 在徽标右侧常驻:不再 absolute/悬浮才显,折叠条位预留规则整体删除', () => {
    const css = buildOverlayCss(lightTheme)
    const foldRule = css.match(/\.pddcs-fold \{[^}]*\}/)![0]
    expect(foldRule).not.toContain('position: absolute')
    expect(foldRule).not.toContain('opacity: 0')
    expect(foldRule).toContain('white-space: nowrap')
    expect(foldRule).toContain(`color: ${lightTheme.textTertiary}`)
    expect(css).not.toContain('.pddcs-cand:hover .pddcs-fold')
    expect(css).not.toContain('.pddcs-cand-folded') // 折叠与否不再改变词条高度
  })
})

describe('buildOverlayCss:AI 整合行(v2.6.34 重设计,2026-09-17 第四十八轮)', () => {
  // 用户原话:「高度太小了,修改为和词条高度类似,视觉效果要和词条区分开」。
  // 这组用例把"类似"和"区分"各自拆成可断言的不变量:
  //   类似 = 与候选行同一套盒子(外边距/圆角/内容左缘)+ 同一套两层结构(小字行 + 大字行);
  //   区分 = 候选行是中性面色 + 类别徽标(素材),整合行是知识库绿软底 + 同色描边(动作)。
  const css = buildOverlayCss(lightTheme)
  const rule = (sel: RegExp) => css.match(sel)![0]
  const aiRow = rule(/\.pddcs-cand\.pddcs-ai-row \{[^}]*\}/)

  it('五块组件齐备(主行 / 说明行 / 正文 / 重试钮),纵向排布由 JS 决定显隐', () => {
    expect(css).toContain('.pddcs-cand.pddcs-ai-row {')
    expect(css).toContain('.pddcs-ai-main {')
    expect(css).toContain('.pddcs-ai-hint {')
    expect(css).toContain('.pddcs-ai-draft {')
    expect(css).toContain('.pddcs-ai-retry {')
    expect(aiRow).toContain('flex-direction: column')
  })

  it('高度同族:沿用候选行同一套盒子(外边距/圆角不另起一套)', () => {
    // 整合行靠 .pddcs-cand 类继承外边距与圆角 —— 自己再写一遍就会和候选行错位
    expect(aiRow).not.toContain('margin:')
    expect(aiRow).not.toContain('border-radius:')
  })

  it('内容左缘与候选行重合:横向内边距取候选行的同一个常量,且不自带描边去凑那 1px', () => {
    // v2.6.34 那版靠"11px 内边距 + 1px 描边 = 12px"凑出对齐;v2.7.0 撤掉描边后这条变恒等 ——
    // 断言也随之从"两个数相加相等"改成"两行横向内边距同源"
    const padX = (r: string) => r.match(/padding:\s*[\d.]+px\s+([\d.]+)px/)![1]
    expect(padX(rule(/\.pddcs-cand \{[^}]*\}/))).toBe(String(ROW_PAD_X))
    expect(aiRow).not.toContain('padding:') // 整条盒子的横向内边距都从 .pddcs-cand 继承
    expect(aiRow).not.toContain('border')
  })

  it('两层结构撑起高度:主行顶 24px 行内控件档 + 说明行 11.5px(不靠 padding 虚撑)', () => {
    expect(rule(/\.pddcs-ai-main \{[^}]*\}/)).toContain(`min-height: ${controlH.inline}px`)
    const hint = rule(/\.pddcs-ai-hint \{[^}]*\}/)
    expect(hint).toContain(`font-size: ${fontSize.secondary}px`)
    // 认语义换行(idle 的"什么出去 / 什么留下"各占一行),窄处仍可折行;
    // 不用省略号截断 —— 截掉的正是要用户看清的那半句边界声明
    expect(hint).toContain('white-space: pre-line')
    expect(hint).not.toContain('text-overflow')
  })

  it('视觉区分靠"有没有底"这一条:整合行常驻知识库绿软底,候选行静止时完全无底', () => {
    // v2.7.0 撤掉了整合行那圈绿描边 —— 新面板里候选行全都无底无框,
    // "有底的只有这一块"已经足够把它读成动作,再叠一层描边是多余的重量
    expect(aiRow).toContain(`background: ${lightTheme.knowledgeSurface}`)
    const cand = rule(/\.pddcs-cand \{[^}]*\}/)
    // 只禁"设了底色",不禁 transition 里的 background-color(那不是底色)
    expect(cand).not.toContain('background:')
    expect(cand).not.toContain('border:')
    // 候选行的"底"只在悬浮/选中时出现,且是中性灰(与整合行的绿是两个体系)
    const candHover = rule(/\.pddcs-cand:hover,[^{]*\{[^}]*\}/)
    expect(candHover).toContain(lightTheme.selectedBg)
    expect(candHover).not.toContain(lightTheme.knowledgeSurface)
    // 整合行不挂类别徽标:它是一次动作,不是一个类别
    expect(css).not.toContain('.pddcs-ai-row .pddcs-badge')
  })

  it('动作面按主题走令牌:浮层材料是半透明的,同一份 alpha 在中灰上立不住', () => {
    // 这一行压在半透明材料上 —— 深色主题下材料压在白色平台页上合成出中灰,
    // 固定 9% 的绿到那上面只剩一点色偏。故动作面必须随主题,且深色要更实
    const alpha = (s: string) => Number(s.match(/([\d.]+)\)$/)![1])
    expect(alpha(darkTheme.knowledgeSurface)).toBeGreaterThan(alpha(lightTheme.knowledgeSurface))
    expect(alpha(darkTheme.knowledgeSurfaceHover)).toBeGreaterThan(
      alpha(darkTheme.knowledgeSurface),
    )
    const darkAi = buildOverlayCss(darkTheme).match(/\.pddcs-cand\.pddcs-ai-row \{[^}]*\}/)![0]
    expect(darkAi).toContain(`background: ${darkTheme.knowledgeSurface}`)
    expect(darkAi).not.toContain(lightTheme.knowledgeSurface)
  })

  it('悬浮/选中态显式补写(双类选择器会盖过单类的 .pddcs-cand:hover / -selected)', () => {
    // 不补写的话,整合行悬浮时会被自己的基础规则压住,看着像"没反应"
    expect(css).toContain('.pddcs-cand.pddcs-ai-row:hover')
    expect(css).toContain('.pddcs-cand.pddcs-ai-row.pddcs-cand-selected')
    // 且悬浮态是同色加深,不是候选行那层中性灰
    const hover = rule(/\.pddcs-cand\.pddcs-ai-row:hover,[\s\S]*?\{[^}]*\}/)
    expect(hover).toContain(lightTheme.knowledgeSurfaceHover)
    expect(hover).not.toContain(`background: ${lightTheme.selectedBg}`)
  })

  it('只有 idle 态整行可点(idle 才给手型),其余态的整行不再是触发器', () => {
    expect(aiRow).toContain('cursor: default')
    expect(rule(/\.pddcs-cand\.pddcs-ai-row\.is-idle \{[^}]*\}/)).toContain('cursor: pointer')
  })

  it('✦ 与主文案走知识库语义绿,且主文案取面板唯一主层(13.5px,与候选正文同档)', () => {
    expect(rule(/\.pddcs-ai-icon \{[^}]*\}/)).toContain(`color: ${semantic.knowledge}`)
    const label = rule(/\.pddcs-ai-label \{[^}]*\}/)
    expect(label).toContain(`color: ${semantic.knowledge}`)
    expect(label).toContain(`font-size: ${fontSize.title}px`)
    expect(rule(/\.pddcs-cand-text \{[^}]*\}/)).toContain(`font-size: ${fontSize.title}px`)
  })

  it('失败态:文案转红 + 整行转红软底(不靠文案里的"失败"二字表意)', () => {
    const colorRule = rule(/\.pddcs-ai-row\.is-error \.pddcs-ai-icon,[\s\S]*?\{[^}]*\}/)
    expect(colorRule).toContain(`color: ${semantic.danger}`)
    expect(colorRule).toContain('.pddcs-ai-label')
    const surface = rule(/\.pddcs-cand\.pddcs-ai-row\.is-error \{[^}]*\}/)
    expect(surface).toContain('rgba(217, 48, 38,')
    expect(surface).not.toContain(lightTheme.knowledgeSurface)
    // 撤掉描边后,红底是失败态唯一的"整行信号" —— 得比绿底明显
    const alpha = (r: string) => Number(r.match(/rgba\(217, 48, 38, ([\d.]+)\)/)![1])
    expect(alpha(surface)).toBeGreaterThan(0.09)
  })

  it('生成结果按候选正文口径排版(同字号同截断行数),流式时行高不跳', () => {
    const draft = rule(/\.pddcs-ai-draft \{[^}]*\}/)
    const text = rule(/\.pddcs-cand-text \{[^}]*\}/)
    for (const decl of [`font-size: ${fontSize.title}px`, 'line-height: 1.6']) {
      expect(draft).toContain(decl)
      expect(text).toContain(decl)
    }
    expect(draft).toContain('white-space: pre-wrap')
    expect(draft).toContain('word-break: break-word')
    expect(draft.match(/-webkit-line-clamp: (\d+)/)![1]).toBe(text.match(/-webkit-line-clamp: (\d+)/)![1])
  })

  it('正文与说明行走主题令牌(浅/深两套产物不同,不硬编码),正文取主文本色', () => {
    const dark = buildOverlayCss(darkTheme)
    expect(rule(/\.pddcs-ai-draft \{[^}]*\}/)).toContain(`color: ${lightTheme.text}`)
    expect(rule(/\.pddcs-ai-hint \{[^}]*\}/)).toContain(`color: ${lightTheme.textMuted}`)
    expect(dark.match(/\.pddcs-ai-draft \{[^}]*\}/)![0]).toContain(`color: ${darkTheme.text}`)
    expect(css).not.toBe(dark)
  })

  it('重试钮在主行右端、按 24px 行内控件档等高,不另起一行拉高行高', () => {
    const retry = rule(/\.pddcs-ai-retry \{[^}]*\}/)
    expect(retry).toContain(`height: ${controlH.inline}px`)
    expect(retry).toContain('margin-left: auto')
    expect(retry).toContain('box-sizing: border-box') // 覆盖层注入平台页面,不享受 popup 的全局重置
    // v2.7.0:与关闭钮同一套"安静填充 + 全圆端"语言,不再是有描边的次级按钮
    expect(retry).toContain(`border-radius: ${radius.pill}px`)
    expect(retry).toContain(`background: ${lightTheme.fillQuiet}`)
    expect(retry).not.toContain('border: 1px')
  })

  it('在途 = ✦ 原地转圈,且尊重"减少动态效果"', () => {
    expect(css).toContain('.pddcs-ai-row.is-busy .pddcs-ai-icon { animation: pddcs-spin')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .pddcs-ai-row.is-busy .pddcs-ai-icon { animation: none; } }')
  })

  it('说明行不参与行高竞争:不给它 -webkit-line-clamp(那是正文的截断规则)', () => {
    expect(rule(/\.pddcs-ai-hint \{[^}]*\}/)).not.toContain('line-clamp')
    // 主行与第二层之间的间距 = 候选行的行内节奏,两类行的"疏"才是同一套
    expect(ROW_GAP_Y).toBeGreaterThan(0)
    expect(aiRow).toContain(`gap: ${ROW_GAP_Y}px`)
    expect(rule(/\.pddcs-cand-top \{[^}]*\}/)).toContain(`margin-bottom: ${ROW_GAP_Y}px`)
  })
})

describe('buildOverlayCss:Apple 式材料重设计(2026-09-17 第四十九轮 v2.7.0)', () => {
  // 用户原话:「可以重新设计推荐回复面板吗。不要带着现有设计的框架,大胆一点,简约风格,
  // 类似 apple 的设计」。这组用例把"材料"这件事拆成可断言的不变量 ——
  // 面板与页面的分界从"实心底 + 描边"换成"半透明底 + 背景模糊 + 一圈 0.5px 亮环"。
  const css = buildOverlayCss(lightTheme)
  const popup = css.match(/\.pddcs-popup \{[^}]*\}/)![0]

  it('面板是毛玻璃材料:背景模糊取 material 令牌,且 -webkit- 前缀同值', () => {
    const filter = `saturate(${material.saturate}) blur(${material.blurPx}px)`
    expect(popup).toContain(`backdrop-filter: ${filter}`)
    expect(popup).toContain(`-webkit-backdrop-filter: ${filter}`)
    // 模糊半径是"看不看得见后面"的唯一旋钮,低于 12px 后面的文字仍可辨认(见 material 注释)
    expect(material.blurPx).toBeGreaterThanOrEqual(12)
  })

  it('材料的两条硬约束:不透明度 ≥ 0.75(不做成"看得见后面"的虚面板),且只给浮层用', () => {
    for (const [name, tk] of [
      ['浅色', lightTheme],
      ['深色', darkTheme],
    ] as const) {
      const alpha = Number(tk.surfaceOverlay.match(/([\d.]+)\)$/)![1])
      expect(alpha, `${name}材料不透明度`).toBeGreaterThanOrEqual(0.75)
      expect(alpha, `${name}材料必须真的半透明`).toBeLessThan(1)
      // 材料底必须与不透明面色不同源,否则"支持模糊"这条分支等于没走
      expect(tk.surfaceOverlay).not.toBe(tk.bg)
    }
  })

  it('panelSurface 单点决定"材料还是面色":支持模糊给半透明,不支持退回不透明', () => {
    expect(panelSurface(lightTheme, true)).toBe(lightTheme.surfaceOverlay)
    expect(panelSurface(lightTheme, false)).toBe(lightTheme.bg)
    expect(panelSurface(darkTheme, true)).toBe(darkTheme.surfaceOverlay)
    expect(panelSurface(darkTheme, false)).toBe(darkTheme.bg)
  })

  it('面板不挂描边:与页面之间那条硬边改由阴影里的 0.5px 亮环承担', () => {
    expect(popup).toContain('border: none')
    expect(popup).toContain(`box-shadow: ${lightTheme.shadow}`)
    expect(lightTheme.shadow.startsWith('0 0 0 0.5px')).toBe(true)
  })

  it('分层不再用分隔线:头/脚都没有 hairline,整块是一张连续材料', () => {
    expect(css).not.toContain('border-bottom')
    expect(css.match(/\.pddcs-popup-foot \{[^}]*\}/)![0]).not.toContain('border-top')
    expect(css.match(/\.pddcs-popup-head \{[^}]*\}/)![0]).not.toContain('border-bottom')
  })

  it('无描边小控件统一为全圆端 + 安静填充(关闭钮 / 图标钮 / 重试钮同形)', () => {
    const close = css.match(/\.pddcs-popup-close \{[^}]*\}/)![0]
    expect(close).toContain(`border-radius: ${radius.pill}px`)
    expect(close).toContain(`background: ${lightTheme.fillQuiet}`)
    expect(close).not.toContain('background: none') // 常驻可见,不再"悬浮才找得到"
    expect(css.match(/\.pddcs-icon-btn \{[^}]*\}/)![0]).toContain(`border-radius: ${radius.pill}px`)
    expect(css.match(/\.pddcs-icon-btn:hover \{[^}]*\}/)![0]).toContain(
      `background: ${lightTheme.fillQuietHover}`,
    )
  })

  it('关闭钮恒有可见的圆底,且两主题都取本主题的安静填充', () => {
    const dark = buildOverlayCss(darkTheme)
    expect(dark.match(/\.pddcs-popup-close \{[^}]*\}/)![0]).toContain(
      `background: ${darkTheme.fillQuiet}`,
    )
    expect(darkTheme.fillQuiet).not.toBe(lightTheme.fillQuiet)
  })

  it('标题与页脚站在列表内容那条竖线上(头部不自成一套缩进)', () => {
    // 面板名是这张列表的标题,不是浮层里另一个区块的标题 ——
    // 它的左缘必须落在「行内缩量 + 行内边距」这条线上,和每条行内容的左缘重合
    expect(PANEL_PAD_X).toBe(ROW_INSET_X + ROW_PAD_X)
    expect(css.match(/\.pddcs-popup-head \{[^}]*\}/)![0]).toContain(
      `padding: ${spacing.xxl}px ${PANEL_PAD_X}px ${spacing.md}px`,
    )
    expect(css.match(/\.pddcs-popup-foot \{[^}]*\}/)![0]).toContain(
      `padding: 0 ${PANEL_PAD_X}px`,
    )
  })

  it('页脚是居中的静音小字(不再是贴了灰带的一段)', () => {
    const foot = css.match(/\.pddcs-popup-foot \{[^}]*\}/)![0]
    expect(foot).toContain('text-align: center')
    expect(foot).toContain(`color: ${lightTheme.textTertiary}`)
  })

  it('入场动效走减速曲线,并尊重"减少动态效果"', () => {
    expect(popup).toContain('animation: pddcs-pop-in .22s cubic-bezier(0.32, 0.72, 0, 1)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .pddcs-popup { animation: none; } }')
  })
})

describe('parseThemeMode:存储值容错解析', () => {
  it("有效值 'light'/'dark' 原样返回", () => {
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('dark')).toBe('dark')
  })
  it('非法/缺失值回退浅色', () => {
    expect(parseThemeMode(undefined)).toBe('light')
    expect(parseThemeMode('blue')).toBe('light')
    expect(parseThemeMode(1)).toBe('light')
  })
  it('存储键与 popup 主题上下文一致(pddcs:theme)', () => {
    expect(THEME_STORAGE_KEY).toBe('pddcs:theme')
  })
})
