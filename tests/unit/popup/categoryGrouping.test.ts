// 记忆列表按问题类型分区的纯逻辑单测(第五十七轮 Task 5)。
// 两条不变量最要紧:
//  ① 一条都不能丢 —— 类型表里没有的 categoryId(旧库自定义类型被删,条目还在)
//     必须并进「未分类」组,不能静默消失;
//  ② 未分类恒排最后一组,不管它的 position。
import { describe, it, expect } from 'vitest'
import { categoryOrder, groupByCategory } from '../../../src/popup/logic'
import type { PanelCategory } from '../../../src/types/messages'

const cat = (
  id: string,
  name: string,
  position: number,
  kind: PanelCategory['kind'] = 'preset',
): PanelCategory => ({ id, name, kind, filterable: kind !== 'uncategorized', route: 'retrieve', position })

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
