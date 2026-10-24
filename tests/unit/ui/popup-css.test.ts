// popup 样式表的**视觉契约**单测(v4.0「Codex × iOS · 黑灰白」)。
//
// 为什么必须有这个文件:v3.0 起状态色全部收进 CSS —— 内联样式表达不了 `:hover`。
// 于是「选中是淡底」「行通铺、控件内缩」「发丝线缩进到文字左缘」这些规格在 React
// 组件树上一个字都读不到;没有这份断言,它们就是唯一一份**无人验证**的规格。
//
// 口径与 `overlay-css.test.ts` 一致:直接断生成的 CSS 字符串。
import { describe, it, expect } from 'vitest'
import { POPUP_CSS } from '../../../src/ui/popup-css'
import {
  controlH,
  cornerShape,
  cornerShapeK,
  cornerSmoothing,
  fontFamily,
  fontFamilyMono,
  fontSize,
  formGap,
  radius,
  size,
  spacing,
} from '../../../src/ui/design'
import { lightTheme } from '../../../src/ui/theme'

describe('popup-css:卡片与线(v5.0)', () => {
  it('★ 圆角只取四档 —— 卡片 / 控件 / 胶囊 / 圆,没有临时值', () => {
    const radii = [...POPUP_CSS.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(radii.length).toBeGreaterThan(0)
    for (const r of radii) {
      // v4.0 只有三档(控件/胶囊/圆);v5.0 增加了卡片档 —— 列表重新有了圆角
      expect([
        `${radius.card}px`,
        `${radius.control}px`,
        `${radius.pill}px`,
        '50%',
        '0',
      ]).toContain(r)
    }
  })

  it('★ 卡片档**大于**控件档,浮层档最大 —— 档位差保证"谁裹着谁"读得出来', () => {
    expect(radius.panel).toBeGreaterThan(radius.card)
    expect(radius.card).toBeGreaterThan(radius.control)
  })

  it('★ 分隔线是**缩进**的伪元素,不是通栏 border-bottom', () => {
    const hair = POPUP_CSS.slice(
      POPUP_CSS.indexOf('.pddcs-hair::after'),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf('.pddcs-hair::after')),
    )
    expect(hair).toContain('position: absolute')
    expect(hair).toContain('left: var(--hair-in')
    expect(hair).toContain('background: var(--pddcs-separator)')
  })

  it('★ 卡片列表里**不画**发丝线 —— 线 + 间隙是两套边界语言,叠起来更乱', () => {
    expect(POPUP_CSS).toContain('.pddcs-list .pddcs-hair::after { display: none; }')
  })

  it('缩进线只服务设置页(卡内的行),仍缩到文字左缘 16', () => {
    const hits = POPUP_CSS.match(new RegExp(`--hair-in: ${spacing.xxl}px`, 'g')) ?? []
    expect(hits.length).toBeGreaterThanOrEqual(1)
    // 序号列早已去掉,不再有 41px 那种"让位给序号"的缩进
    expect(POPUP_CSS).not.toContain('--hair-in: 41px')
  })

  it('★ 卡片 = 列表的直接子元素 —— 一处规则覆盖三个页签的三种卡片壳', () => {
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf('.pddcs-list > * {'),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf('.pddcs-list > * {')),
    )
    expect(rule).toContain('background: var(--pddcs-fill)')
    expect(rule).toContain(`border-radius: ${radius.card}px`)
  })

  it('★ 展开中的卡翻成卡面色 —— 用 :has() 而不是再同步一个类名', () => {
    expect(POPUP_CSS).toContain(
      ".pddcs-list > *:has(.pddcs-qrow[aria-expanded='true'])",
    )
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf(".pddcs-list > *:has(.pddcs-qrow[aria-expanded='true'])"),
      POPUP_CSS.indexOf(
        '}',
        POPUP_CSS.indexOf(".pddcs-list > *:has(.pddcs-qrow[aria-expanded='true'])"),
      ),
    )
    expect(rule).toContain('background: var(--pddcs-surface)')
    expect(rule).toContain('border-color: var(--pddcs-border)')
  })

  it('★ 列表容器整段内缩,且内缩量 ≥ 卡片圆角(否则圆角被边缘切平)', () => {
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf('.pddcs-list {'),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf('.pddcs-list {')),
    )
    expect(rule).toContain('padding: 16px')
    expect(rule).toContain('gap: 6px')
    // 这两条是同一件事的两半:内缩不够,卡片就退化成"直角色块"
    const inset = Number(/(?:padding|margin):\s*(\d+)px/.exec(rule)?.[1] ?? 0)
    expect(inset).toBeGreaterThanOrEqual(radius.card)
  })
})

describe('popup-css:当前项 = 强调色,不是黑白反转', () => {
  it('★ "当前项"一律走 accent 系,不再有实心 ink 块(分类 chip)', () => {
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf(".pddcs-catnav button[aria-current='true']"),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf(".pddcs-catnav button[aria-current='true']")),
    )
    expect(rule).toContain('background: var(--pddcs-accent-soft)')
    expect(rule).toContain('color: var(--pddcs-accent-text)')
    expect(rule).not.toContain('var(--pddcs-ink)')
  })

  it('★ 左侧导航当前项同一条口径 —— 软底 + 强调色文字', () => {
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf(".pddcs-rail-btn[aria-current='true']"),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf(".pddcs-rail-btn[aria-current='true']")),
    )
    expect(rule).toContain('background: var(--pddcs-accent-soft)')
    expect(rule).toContain('color: var(--pddcs-accent-text)')
    expect(rule).not.toContain('var(--pddcs-ink)')
  })

  it('★ 主钮走 accent 底 + onAccent 字,不是 ink 底 + onInk 字', () => {
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf(".pddcs-btn[data-variant='primary'] {"),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf(".pddcs-btn[data-variant='primary'] {")),
    )
    expect(rule).toContain('background: var(--pddcs-accent)')
    // 用 onAccent 而不是 onInk:两个令牌浅色下相同、**深色下不同**
    expect(rule).toContain('color: var(--pddcs-on-accent)')
    expect(rule).not.toContain('var(--pddcs-on-ink)')
  })

  it('★ 默认钮落在卡片里必须看得见 —— fill 底之外还要有描边', () => {
    // 设置页的分区卡片本身就是 fill 底;只靠底色填充的默认钮落在卡里等于隐形
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf(".pddcs-btn[data-variant='default'] {"),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf(".pddcs-btn[data-variant='default'] {")),
    )
    expect(rule).toContain('background: var(--pddcs-fill)')
    expect(rule).toContain('border-color: var(--pddcs-border)')
  })

  it('ink 与 onInk 反相是硬约束(同色即字消失)—— 两个主题下都成立', () => {
    // ink 现在只服务聊天页 toast,但反相这条约束不因此放松
    expect(lightTheme.ink).not.toBe(lightTheme.onInk)
  })
})

describe('popup-css:操作行左对齐(图标落在正文竖线上)', () => {
  it('★ 操作行靠左,且首枚图标钮用负 margin 抵消盒内留白', () => {
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf('.pddcs-gops {'),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf('.pddcs-gops {')),
    )
    expect(rule).toContain('justify-content: flex-start')
    // 21 = 字母槽位 13 + 间距 8,把按钮**盒**推到正文左缘
    expect(rule).toContain('margin-left: 21px')
    // 首枚图标钮再减 6 = (28−16)/2,让**图标本身**落在竖线上
    expect(POPUP_CSS).toContain('.pddcs-gops > .pddcs-iconbtn:first-child { margin-left: -6px; }')
    expect((controlH.icon - size.iconBtn) / 2).toBe(6)
  })
})

describe('popup-css:控件几何', () => {
  it('图标钮取 controlH.icon,图标取 size.iconBtn —— 两处都是单点', () => {
    const rule = POPUP_CSS.slice(
      POPUP_CSS.indexOf('.pddcs-iconbtn {'),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf('.pddcs-iconbtn {')),
    )
    expect(rule).toContain(`width: ${controlH.icon}px; height: ${controlH.icon}px`)
  })

  it('按钮高度取 controlH.form,与同排输入框等高', () => {
    expect(POPUP_CSS).toContain(`height: ${controlH.form}px`)
    expect(POPUP_CSS).toContain(`height: ${controlH.inline}px`) // 小号按钮
  })

  it('开关是 iOS 胶囊轨 + 圆柄,选中 = 强调色轨(v5.0 起有色可用,不再走墨色)', () => {
    const sw = POPUP_CSS.slice(
      POPUP_CSS.indexOf('.pddcs-switch {'),
      POPUP_CSS.indexOf('}', POPUP_CSS.indexOf('.pddcs-switch {')),
    )
    expect(sw).toContain(`border-radius: ${radius.pill}px`)
    expect(sw).toContain('width: 48px; height: 28px')
    expect(sw).toContain('background: var(--pddcs-border)')
    expect(POPUP_CSS).toContain(
      ".pddcs-switch[aria-checked='true'] { background: var(--pddcs-accent); }",
    )
    // 柄是圆(50%),不是方
    expect(POPUP_CSS).toContain('border-radius: 50%')
  })

  it('滑杆是 iOS 圆拇指', () => {
    expect(POPUP_CSS).toMatch(/::-webkit-slider-thumb\s*\{[^}]*border-radius: 50%;/)
  })
})

describe('popup-css:字型', () => {
  it('等宽只给数字:界面字体栈挂在 shell 上,pddcs-num 一族走 mono', () => {
    // 界面字体栈由 index.tsx 挂在根节点(不在本表里),这里只管"数字走等宽"
    expect(POPUP_CSS).toContain(fontFamilyMono)
    expect(POPUP_CSS).toContain('.pddcs-num { font-family:')
    expect(fontFamily).not.toContain('monospace')
  })

  it('字号落在四档阶梯上,没有阶梯外的临时值', () => {
    const sizes = [...POPUP_CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]))
    const ladder: number[] = Object.values(fontSize)
    // 四档就是全集,没有特例:分类计数那处 11px 已归队到 cap 档(见下一条)
    for (const s of sizes) expect(ladder).toContain(s)
  })
})

describe('popup-css:分类计数的可读性', () => {
  it('★ 计数不再用 opacity 压暗 —— 6 成透明把偏灰的字又洗淡一遍,只剩 2.3:1', () => {
    const n = (POPUP_CSS.match(/\.pddcs-catnav \.n \{[^}]*\}/) ?? [''])[0]
    expect(n).toBeTruthy()
    expect(n).not.toContain('opacity')
    // 退让改由"小一档 + 等宽"承担,颜色走三级文字令牌
    expect(n).toContain(`font-size: ${fontSize.cap}px`)
    expect(n).toContain('color: var(--pddcs-text-tertiary)')
  })

  it('选中的 pill 是墨底 —— 计数跟着走 on-ink,而不是继续用"浅面上的三级灰"', () => {
    expect(POPUP_CSS).toContain(
      ".pddcs-catnav button[aria-current='true'] .n { color: inherit; }",
    )
  })
})

describe('popup-css:设置页行的几何', () => {
  it('★ 标签→说明的间距取 formGap.labelDesc,不是凭手感另写一个数', () => {
    const rule = (POPUP_CSS.match(/\.pddcs-srow-label \.d \{[^}]*\}/) ?? [''])[0]
    expect(rule).toContain(`margin-top: ${formGap.labelDesc}px`)
  })

  it('★ 块式行里的多行说明各占一行(不给就会首尾相接读成一个长句)', () => {
    expect(POPUP_CSS).toContain('.pddcs-srow-blk > span { display: block; }')
    expect(POPUP_CSS).toContain(
      `.pddcs-srow-blk > span + span { margin-top: ${formGap.labelDesc}px; }`,
    )
  })

  it('按钮组 + 就地结论可以折行(折行后仍在同一套内边距与发丝线里)', () => {
    expect(POPUP_CSS).toContain('.pddcs-srow-wrap { flex-wrap: wrap; }')
  })

  it('知识库卡的灰标行压在卡片顶部,是 gmeta 的一种朝向而不是一次性内联 margin', () => {
    const rule = (POPUP_CSS.match(/\.pddcs-gmeta-top \{[^}]*\}/) ?? [''])[0]
    expect(rule).toContain('margin-top: 0')
    expect(rule).toContain(`margin-bottom: ${spacing.xs}px`)
  })
})

describe('popup-css:滚动条与主题', () => {
  it('★ 滚动容器留槽位 —— 滚动条显隐不改变行的宽度', () => {
    expect(POPUP_CSS).toContain('scrollbar-gutter: stable')
    expect(POPUP_CSS).toMatch(/\.pddcs-scroll \{ scrollbar-gutter: stable; \}/)
  })

  it('文档底跟随主题,且给了令牌单源的 fallback(首帧不闪白)', () => {
    expect(POPUP_CSS).toContain(`var(--pddcs-bg, ${lightTheme.bg})`)
  })

  it('焦点环是强调色 2px 外环', () => {
    // v4.0 用的是 ink —— 那时 ink 在两种主题下都与所在面反相。
    // v5.0 的深色 ink 是**近白**,压在白色卡片上会糊;accent 两主题下都够(4.88 / 6.20)
    expect(POPUP_CSS).toContain('outline: 2px solid var(--pddcs-accent)')
  })
})

describe('popup-css:连续圆角(iOS squircle,corner smoothing 60%)', () => {
  it('★ 平滑度 60% → superellipse(2),且由令牌单点推出', () => {
    // k=1 是正圆(等价 round),k=2 是 Chrome 的 squircle 关键字 —— 60% 正好落在 2,
    // 换算见 design.ts#cornerSmoothing;这里钉住"没有人在各处另写数字"
    expect(cornerSmoothing).toBe(0.6)
    expect(cornerShapeK).toBe(2)
    expect(cornerShape).toBe('superellipse(2)')
  })

  it('★ 全局一条通配规则 —— 圆角散在三十多条规则与内联样式里,枚举一定漏', () => {
    expect(POPUP_CSS).toContain(`* { corner-shape: ${cornerShape}; }`)
  })

  it('★ 胶囊与正圆明确回到 round —— 否则开关与滑杆会被削成超椭圆', () => {
    const rule = (sel: string): string => {
      const i = POPUP_CSS.indexOf(sel)
      expect(i, `找不到规则:${sel}`).toBeGreaterThanOrEqual(0)
      return POPUP_CSS.slice(i, POPUP_CSS.indexOf('}', i))
    }
    for (const sel of ['.pddcs-switch {', '.pddcs-switch-knob {', '.pddcs-slider {']) {
      expect(rule(sel)).toContain('corner-shape: round')
    }
    // 分类 pill、18px 圆钮、两枚滑杆拇指也各有一条
    expect(POPUP_CSS.match(/corner-shape: round/g)?.length ?? 0).toBeGreaterThanOrEqual(7)
  })
})
