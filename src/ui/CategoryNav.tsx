/**
 * 分类导航栏(记忆页 / 标准回答页共用)— **独立组件**(第六十四轮自 components.tsx 抽出)。
 *
 * `全部 | 未分类 1 | 订单物流 14 | 尺码 3`
 *
 * **列表不再按分类分组,分类改由这一条导航表达**(用户:「不要按照文件夹的样式设计了…在顶部
 * 增加导航栏,导航栏中展示全部分类」)。点一个分类 = 只看这一类,列表平铺。
 *
 * 三条口径:
 *  - **展示全部分类**,含当前没有条目的(数量写 0)。用户要的就是"一眼看到有哪些分类";
 *    藏掉空分类反而会让人以为类型丢了(标准回答页还要在这里改名 / 删除自定义类型)。
 *  - **单行,不换行**(用户:「导航为一行,鼠标滚轮控制滑动」):放不下的分类横向滚 ——
 *    滚轮纵移直接映射为横移(原生 wheel 监听,passive:false 才拦得住页面滚动),
 *    滚动条整根隐藏,可滚动的一侧以渐隐提示"还有"。
 *  - **矩形双态**(用户:「未选中状态为黑色灰色矩形,选中状态为实心黑色」):
 *    未选中 = 1px 结构线描边的黑灰矩形,选中 = 反白实心(浅色纯黑底白字)。
 *    反白是本系统里"当前在哪"的唯一表达 —— 与主按钮、面板选中行同一套语言。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThemeTokens } from './theme'
import { categoryNav, controlH, fontSize, fontWeight, motion, radius } from './design'

/** 分类导航里"全部"这一档的 id(不是一个真的类型 id,故用一个不可能冲突的字面量) */
export const ALL_CATEGORIES = 'all'

export type CategoryNavItem = { id: string; name: string; count: number }

export function CategoryNav({
  tk,
  items,
  active,
  onSelect,
}: {
  tk: ThemeTokens
  /** 顺序即展示顺序;调用方负责把"全部"放在第一位 */
  items: CategoryNavItem[]
  active: string
  onSelect: (id: string) => void
}) {
  const scrollRef = useRef<HTMLElement | null>(null)
  /** 可滚动的两侧渐隐:滚到头的那侧不再隐,提示才不说谎 */
  const [edge, setEdge] = useState({ left: false, right: false })

  /** 量两侧是否还有内容(滚动 / 条目变化 / 容器尺寸变化都要重量) */
  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdge({ left: el.scrollLeft > 1, right: max > 1 && el.scrollLeft < max - 1 })
  }, [])

  useEffect(() => {
    measure()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [measure, items])

  // 滚轮纵移 → 横移。React 的 onWheel 挂在根上是 passive 的,拦不住页面滚动,
  // 必须自己挂原生监听(passive:false)。不可滚动时直接放行,让页面照常滚。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 激活项滚进可视区:切到的分类在屏外时(比如导航被滚到了中段)把它带回来。
  // block:'nearest' 保证本来就可见时不产生任何滚动。
  useEffect(() => {
    const nav = scrollRef.current
    if (!nav) return
    const btn = Array.from(nav.querySelectorAll<HTMLButtonElement>('[data-category-id]')).find(
      (b) => b.dataset.categoryId === active,
    )
    if (btn && typeof btn.scrollIntoView === 'function') {
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [active, items])

  // 渐隐方向:edge.left/right = "这一侧还有内容没滚到"。有内容的一侧才渐隐,
  // 滚到头的那侧恢复实色 —— 提示才不说谎(此前的写法正好反了)
  const fadeL = edge.left ? categoryNav.fadeWidth : 0
  const fadeR = edge.right ? categoryNav.fadeWidth : 0
  const mask =
    fadeL > 0 || fadeR > 0
      ? `linear-gradient(to right, transparent 0, #000 ${fadeL}px, #000 calc(100% - ${fadeR}px), transparent 100%)`
      : undefined

  return (
    <nav
      ref={scrollRef}
      aria-label="按问题分类筛选"
      className="pddcs-catnav"
      onScroll={measure}
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: categoryNav.gap,
        overflowX: 'auto',
        // 渐隐走 mask:它只作用于自己的内容,不占布局,也不需要额外的遮罩元素
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    >
      {items.map((it) => {
        const on = it.id === active
        return (
          <button
            key={it.id}
            type="button"
            // 稳定锚点:单测与验收脚本按它选分类,而不是靠按钮文字
            //(文字里还拼着计数,``${name}${count}`` 这种查找一改版就静默失配)
            data-category-id={it.id}
            aria-current={on ? 'true' : undefined}
            onClick={() => onSelect(it.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 4,
              flexShrink: 0,
              height: controlH.inline,
              padding: `0 ${categoryNav.padX}px`,
              border: `${categoryNav.borderWidth}px solid ${on ? 'transparent' : tk.borderStrong}`,
              borderRadius: radius.sm,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              backgroundColor: on ? tk.controlActive : 'transparent',
              color: on ? tk.controlKnobBg : tk.textMuted,
              fontSize: fontSize.secondary,
              fontWeight: on ? fontWeight.semibold : fontWeight.regular,
              transition: `background-color ${motion.fast}, color ${motion.fast}, border-color ${motion.fast}`,
            }}
            onMouseEnter={(e) => {
              if (on) return
              e.currentTarget.style.backgroundColor = tk.fillQuiet
            }}
            onMouseLeave={(e) => {
              if (on) return
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            {it.name}
            {/* 计数与分类名同档、降一档透明度:它们是同一个标签的两部分,不该抢成两个层级 */}
            <span
              style={{
                fontSize: fontSize.caption,
                opacity: 0.65,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {it.count}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
