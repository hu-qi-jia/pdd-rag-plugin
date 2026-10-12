// 记忆列表按问题类型分区的纯逻辑单测(第五十七轮 Task 5)。
// 两条不变量最要紧:
//  ① 一条都不能丢 —— 类型表里没有的 categoryId(旧库自定义类型被删,条目还在)
//     必须并进「未分类」组,不能静默消失;
//  ② 未分类恒排最后一组,不管它的 position。
import { describe, it, expect } from 'vitest'
import { categoryNavItems, categoryOrder, groupByCategory, navBucketOf } from '../../../src/popup/logic'
import type { PanelCategory } from '../../../src/types/messages'

const cat = (
  id: string,
  name: string,
  position: number,
  kind: PanelCategory['kind'] = 'preset',
): PanelCategory => ({ id, name, kind, filterable: kind !== 'uncategorized', position })

const item = (id: string, categoryId: string) => ({ id, categoryId })

describe('categoryOrder', () => {
  it('按 position 升序;未分类恒最后,不管 position', () => {
    const a = cat('a', '尺码', 2)
    const b = cat('b', '物流', 1)
    // 未分类 position 故意给最小,仍须排最后
    const unc = cat('uncategorized', '未分类', 0, 'uncategorized')
    expect(categoryOrder([a, b, unc]).map((c) => c.id)).toEqual(['b', 'a', 'uncategorized'])
  })
})

describe('groupByCategory', () => {
  it('按类型 id 分桶,空桶不返回', () => {
    const a = cat('a', '尺码', 1)
    const b = cat('b', '物流', 2)
    const out = groupByCategory([item('1', 'a'), item('2', 'a')], [a, b])
    expect(out).toHaveLength(1)
    expect(out[0].category.id).toBe('a')
    expect(out[0].items.map((x) => x.id)).toEqual(['1', '2'])
  })

  it('未分类恒排最后一组,不管它的 position', () => {
    const a = cat('a', '尺码', 1)
    const unc = cat('uncategorized', '未分类', 0, 'uncategorized')
    const out = groupByCategory([item('1', 'uncategorized'), item('2', 'a')], [unc, a])
    expect(out.map((g) => g.category.id)).toEqual(['a', 'uncategorized'])
  })

  it('★ 组内保持传入顺序(调用方已按时间排好,不要再排一次)', () => {
    const a = cat('a', '尺码', 1)
    const out = groupByCategory(
      [item('3', 'a'), item('1', 'a'), item('2', 'a')],
      [a],
    )
    expect(out[0].items.map((x) => x.id)).toEqual(['3', '1', '2'])
  })

  it('未知的 categoryId(库里有、类型表里没有)落进未分类组,不丢条目', () => {
    const a = cat('a', '尺码', 1)
    const items = [item('1', 'a'), item('2', 'ghost'), item('3', 'uncategorized')]
    const out = groupByCategory(items, [a])
    const flat = out.flatMap((g) => g.items)
    expect(flat).toHaveLength(items.length)
    expect(flat.map((x) => x.id).sort()).toEqual(['1', '2', '3'])
    const unc = out.find((g) => g.category.id === 'uncategorized')!
    expect(unc).toBeTruthy()
    expect(unc.category.name).toBe('未分类')
    expect(unc.items.map((x) => x.id)).toEqual(['2', '3'])
  })

  it('类型表为空时,全部落未分类组', () => {
    const items = [item('1', 'x'), item('2', 'uncategorized')]
    const out = groupByCategory(items, [])
    expect(out).toHaveLength(1)
    expect(out[0].category.id).toBe('uncategorized')
    expect(out[0].items).toHaveLength(2)
  })

  it('每个组的计数等于组内条目数(合计等于入参条目数)', () => {
    const a = cat('a', '尺码', 1)
    const b = cat('b', '物流', 2)
    const items = [
      item('1', 'a'),
      item('2', 'b'),
      item('3', 'b'),
      item('4', 'ghost'),
    ]
    const out = groupByCategory(items, [a, b])
    const counts = new Map(out.map((g) => [g.category.id, g.items.length]))
    expect(counts.get('a')).toBe(1)
    expect(counts.get('b')).toBe(2)
    expect(counts.get('uncategorized')).toBe(1)
    expect(out.reduce((n, g) => n + g.items.length, 0)).toBe(items.length)
  })
})

// ── v3.0 第四版:分类由"分区"改为"顶部导航筛选",这里锁导航的纯逻辑 ──────────
// 最要紧的一条:**计数与筛选同源**。两边各自实现一份"这条属于哪一类",
// 迟早出现"导航上写着 3 条、点进去一条都没有" —— 那是最难自查的一类 bug。
describe('navBucketOf / categoryNavItems', () => {
  const CATS = [cat('size', '尺码', 1), cat('logistics', '物流', 2), cat('uncategorized', '未分类', 9999, 'uncategorized')]

  it('★ 类型表里没有的 categoryId 并进未分类(与 groupByCategory 同一口径)', () => {
    expect(navBucketOf('ghost', CATS)).toBe('uncategorized')
    expect(navBucketOf('size', CATS)).toBe('size')
    expect(navBucketOf('uncategorized', CATS)).toBe('uncategorized')
  })

  it('★ 导航计数与「按桶筛选」逐项一致 —— 不会出现"写着 3 条、点进去 0 条"', () => {
    const items = [
      item('1', 'size'),
      item('2', 'size'),
      item('3', 'ghost'), // 类型表里没有 → 归未分类
      item('4', 'uncategorized'),
    ]
    const nav = categoryNavItems(items, CATS)
    for (const n of nav) {
      const shown = items.filter((it) => navBucketOf(it.categoryId, CATS) === n.id)
      expect(shown.length, `${n.name} 的计数与筛出来的条数不一致`).toBe(n.count)
    }
    // 各档相加 = 总数(一条都不能在两处重复计、也不能漏)
    expect(nav.reduce((a, b) => a + b.count, 0)).toBe(items.length)
  })

  it('顺序 = categoryOrder(未分类恒最后)', () => {
    const nav = categoryNavItems([], CATS)
    expect(nav.map((n) => n.id)).toEqual(['size', 'logistics', 'uncategorized'])
  })

  it('★ 类型表里没有「未分类」时也给它一档(它恰恰是最容易被忽略的那一类)', () => {
    const nav = categoryNavItems([item('1', 'ghost')], [CATS[0]])
    const unc = nav.find((n) => n.id === 'uncategorized')
    expect(unc, '未分类那一档没产出').toBeTruthy()
    expect(unc!.count).toBe(1) // 幽灵类型并进来,不是 0
  })

  it('展示**全部**分类,含当前 0 条的(藏掉会让人以为类型丢了)', () => {
    const nav = categoryNavItems([item('1', 'size')], CATS)
    expect(nav.find((n) => n.id === 'logistics')?.count).toBe(0)
    expect(nav).toHaveLength(3)
  })
})
