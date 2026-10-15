// 路线决策纯逻辑单测(第五十八轮)—— 直接喂夹具,不碰 IO/chrome/网络。
//
// 这组钉住三件事:
//  ① 判不准 / jev 不可用 → 绝不筛(no-filter 是"与今天一致"的那条路);
//  ② 多意图取**并集**(概率 ≥ 阈值的所有类型),不取胜者;
//  ③ 池子恒含 filterable=false 的类型与未分类 —— 它们不参与 jev 分类,
//     一旦漏掉,里面的条目在任何查询下都搜不到(纯召回倒退)。
import { describe, it, expect } from 'vitest'
import {
  FILTER_MARGIN,
  decideRoute,
  filterAllowed,
  pickByMargin,
} from '../../../src/background/route'
import { LOW_CONFIDENCE_LINE } from '../../../src/shared/constants'
import type { CategoryRecord } from '../../../src/types/memory'
import type { RankedSource } from '../../../src/background/retrieval'

function makeCat(over: Partial<CategoryRecord> & { id: string }): CategoryRecord {
  const now = Date.now()
  return {
    name: over.id,
    criteria: '描述',
    kind: 'preset',
    route: 'retrieve',
    filterable: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

/** 六个预置类型 + 一个自建 + 一个迁移来的旧文件夹 + 未分类 */
const CATS: CategoryRecord[] = [
  makeCat({ id: 'preset:size', name: '尺码推荐', route: 'size' }),
  makeCat({ id: 'preset:order', name: '订单物流' }),
  makeCat({ id: 'preset:price', name: '价格优惠' }),
  makeCat({ id: 'preset:attr', name: '商品属性' }),
  makeCat({ id: 'custom:mine', name: '我的自建', kind: 'custom' }),
  makeCat({ id: 'legacy:old', name: '旧文件夹', kind: 'custom', filterable: false }),
  makeCat({
    id: 'uncategorized',
    name: '未分类',
    kind: 'uncategorized',
    filterable: false,
    position: 9999,
  }),
]

/** 只有 id 与余弦对判据有意义的假排名结果 */
function rs(id: string, cosine: number): RankedSource {
  return {
    source: { id, kind: 'history', question: id, questionTs: 0, categoryId: null },
    cosine,
    rrfScore: cosine,
  }
}

describe('decideRoute', () => {
  it('★ probabilities 为 null(jev 不可用) → no-filter', () => {
    expect(decideRoute(CATS, null, 0.2)).toEqual({ kind: 'no-filter' })
  })

  it('★ 概率全低于阈值 → no-filter(判不准就别乱筛)', () => {
    expect(decideRoute(CATS, { 'preset:order': 0.17, 'preset:price': 0.16 }, 0.2)).toEqual({
      kind: 'no-filter',
    })
  })

  it('★ 类型集合恰为 {尺码推荐} → size-only', () => {
    // 纯尺码:池里一个 retrieve 型都没有 —— 不检索,走尺码生成
    expect(decideRoute(CATS, { 'preset:size': 0.9, 'preset:order': 0.05 }, 0.2)).toEqual({
      kind: 'size-only',
    })
  })

  it('类型集合是 {订单物流} → filter,且池 = 订单物流 ∪ 所有 filterable=false 的类型', () => {
    const r = decideRoute(CATS, { 'preset:order': 0.9, 'preset:price': 0.05 }, 0.2)
    expect(r.kind).toBe('filter')
    if (r.kind !== 'filter') return
    expect(r.picked).toEqual(['preset:order'])
    expect([...r.allowed].sort()).toEqual(['legacy:old', 'preset:order', 'uncategorized'])
    // 没被选中的类型不进池
    expect(r.allowed.has('preset:price')).toBe(false)
    expect(r.allowed.has('preset:size')).toBe(false)
  })

  it('★ 多意图:概率 ≥ 阈值的所有类型都进集合,不是只取胜者', () => {
    // {订单物流: 0.52, 尺码推荐: 0.43, 价格优惠: 0.03},阈值 0.2
    // → 集合 = {订单物流, 尺码推荐}(价格 0.03 不进)
    const r = decideRoute(
      CATS,
      { 'preset:order': 0.52, 'preset:size': 0.43, 'preset:price': 0.03 },
      0.2,
    )
    expect(r.kind).toBe('filter')
    if (r.kind !== 'filter') return
    expect([...r.picked].sort()).toEqual(['preset:order', 'preset:size'])
    // 池含订单物流
    expect(r.allowed.has('preset:order')).toBe(true)
    // 且路线里带"要挂尺码行"的信号(尺码类型进了 picked)
    expect(r.picked).toContain('preset:size')
  })

  it('★ {尺码推荐, 订单物流} → filter(不是 size-only) —— 买家一次问了两件事', () => {
    const r = decideRoute(CATS, { 'preset:size': 0.6, 'preset:order': 0.5 }, 0.2)
    expect(r.kind).toBe('filter')
  })

  it('自定义类型(用户自建、filterable=true)可被选中并进池', () => {
    const r = decideRoute(CATS, { 'custom:mine': 0.8 }, 0.2)
    expect(r.kind).toBe('filter')
    if (r.kind !== 'filter') return
    expect(r.allowed.has('custom:mine')).toBe(true)
    expect(r.picked).toEqual(['custom:mine'])
  })

  it('filterable=false 的自定义类型(迁移来的旧文件夹)恒在池里', () => {
    const r = decideRoute(CATS, { 'preset:order': 0.9 }, 0.2)
    expect(r.kind).toBe('filter')
    if (r.kind !== 'filter') return
    expect(r.allowed.has('legacy:old')).toBe(true)
  })

  it('阈值边界取含(恰好等于阈值算过)—— 取值踩在低置信线上,两个边界一起验', () => {
    // 原来用 0.2 做边界值,而 0.2 现在会被低置信守卫拦下(见下方那一组)。
    // 换成 0.5 既保住"取含"这条性质,又刚好是守卫的下边界(线是「低于」)
    const r = decideRoute(CATS, { 'preset:order': LOW_CONFIDENCE_LINE }, LOW_CONFIDENCE_LINE)
    expect(r.kind).toBe('filter')
  })

  it('尺码类型(route=size)即使被选中也不会进池', () => {
    const r = decideRoute(CATS, { 'preset:size': 0.5, 'preset:order': 0.5 }, 0.2)
    expect(r.kind).toBe('filter')
    if (r.kind !== 'filter') return
    expect(r.allowed.has('preset:size')).toBe(false)
  })
})

// ─── 低置信守卫(第六十七轮)──────────────────────────────────────────────────
//
// 一个开关同时管"打标"与"检索路由",而默认阈值只有 0.2 —— 7 个类型下均匀分布约 0.14,
// 一条 0.21 的判定基本是噪声,却会实打实地把记录从其余所有类型的池子里排除掉。
// 守卫要挡住的就是这个:**弱信号不许产生硬后果**。

describe('decideRoute:低置信守卫', () => {
  it('★ 最高概率低于复核线 → 不筛,即便它已经过了阈值', () => {
    // 阈值 0.2,它 0.3 —— 过线了。但 0.3 是噪声级信号,不该拿它收窄池子
    const r = decideRoute(CATS, { 'preset:order': 0.3 }, 0.2)
    expect(r.kind).toBe('no-filter')
  })

  it('★ 弱信号的**尺码**判定也不许跳过检索 —— 两种后果一起挡', () => {
    // size-only 的后果(完全不检索)比 filter(收窄)更限制用户能搜到什么,
    // 只挡小的、放过大的说不通
    const r = decideRoute(CATS, { 'preset:size': 0.3 }, 0.2)
    expect(r.kind).toBe('no-filter')
  })

  it('恰好等于复核线 → 正常走(线是「低于」,不是「不高于」)', () => {
    const r = decideRoute(CATS, { 'preset:order': LOW_CONFIDENCE_LINE }, 0.2)
    expect(r.kind).toBe('filter')
  })

  it('信号够强时守卫不介入,既有三种路线逐项不变', () => {
    expect(decideRoute(CATS, { 'preset:order': 0.9 }, 0.2).kind).toBe('filter')
    expect(decideRoute(CATS, { 'preset:size': 0.9 }, 0.2).kind).toBe('size-only')
    expect(decideRoute(CATS, null, 0.2).kind).toBe('no-filter')
  })

  it('空概率分布 → no-filter(与"全低于阈值"殊途同归)', () => {
    expect(decideRoute(CATS, {}, 0.2).kind).toBe('no-filter')
  })

  it('★ 守卫与「低置信」标记共用同一条线 —— 界面说"可能判错了",检索就不该照它收窄', () => {
    // 断言的是**同源**:两处各写一个字面量迟早会漂移,而漂移的后果是自相矛盾
    const justBelow = LOW_CONFIDENCE_LINE - 0.01
    const justAbove = LOW_CONFIDENCE_LINE + 0.01
    expect(decideRoute(CATS, { 'preset:order': justBelow }, 0.2).kind).toBe('no-filter')
    expect(decideRoute(CATS, { 'preset:order': justAbove }, 0.2).kind).toBe('filter')
  })
})

describe('filterAllowed', () => {
  it('未分类恒在池里(不依赖"未分类恰好 filterable=false"这个巧合)', () => {
    // 构造一个"未分类被标成 filterable=true"的坏数据,显式兜底仍要保住它
    const bad = CATS.map((c) => (c.id === 'uncategorized' ? { ...c, filterable: true } : c))
    expect(filterAllowed(bad, ['preset:order']).has('uncategorized')).toBe(true)
  })

  it('同一个类型集合,输出稳定(集合内容与顺序无关)', () => {
    const a = filterAllowed(CATS, ['preset:order', 'preset:price'])
    const b = filterAllowed(CATS, ['preset:price', 'preset:order'])
    expect([...a].sort()).toEqual([...b].sort())
  })

  it('传来的 picked 含未知 id → 忽略,不进池', () => {
    expect(filterAllowed(CATS, ['preset:nope']).has('preset:nope')).toBe(false)
  })
})

describe('pickByMargin(两遍 pass 的取舍,裁决 R11)', () => {
  it('全池没有显著更优(差距 < 余量)→ 用切片', () => {
    const narrowed = [rs('order-1', 0.8)]
    const full = [rs('order-1', 0.8), rs('price-1', 0.83)]
    expect(pickByMargin(narrowed, full)).toBe(narrowed)
  })

  it('全池显著更优(差距 ≥ 余量)→ 放宽到全池,正确答案回来', () => {
    const narrowed = [rs('order-1', 0.6)]
    const full = [rs('order-1', 0.6), rs('price-1', 0.92)]
    expect(pickByMargin(narrowed, full)).toBe(full)
  })

  it('切片为空、全池有货 → 放宽', () => {
    const full = [rs('price-1', 0.7)]
    expect(pickByMargin([], full)).toBe(full)
  })

  it('两遍都为空 → 仍是切片(空),不因"空"而误判', () => {
    const narrowed: RankedSource[] = []
    const full: RankedSource[] = []
    expect(pickByMargin(narrowed, full)).toBe(narrowed)
  })

  it('恰好等于余量 → 视为"显著更优",放宽(边界取全池)', () => {
    const narrowed = [rs('order-1', 0.8)]
    const full = [rs('order-1', 0.8), rs('price-1', 0.8 + FILTER_MARGIN)]
    expect(pickByMargin(narrowed, full)).toBe(full)
  })

  it('no-filter 路线传进来 narrowed === full(同一引用)→ 原样返回,无行为变化', () => {
    const full = [rs('a', 0.9)]
    expect(pickByMargin(full, full)).toBe(full)
  })
})
