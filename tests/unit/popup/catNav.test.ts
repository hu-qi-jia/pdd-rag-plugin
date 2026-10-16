// 分类导航的纯逻辑单测(v3.0:类型从页内分区标题改为顶部导航栏)。
//
// 最要紧的一条是**口径一致**:导航上的计数与 `filterByCategory` 点进去看到的条数
// 必须由同一套判据算出,各算各的就会出"未分类 3、点进去 2 条"。
import { describe, it, expect } from 'vitest'
import {
  ALL_CATEGORY_ID,
  catNavItems,
  filterByCategory,
} from '../../../src/popup/logic'
import type { PanelCategory } from '../../../src/types/messages'

const cat = (
  id: string,
  name: string,
  position: number,
  kind: PanelCategory['kind'] = 'preset',
): PanelCategory => ({ id, name, kind, filterable: kind !== 'uncategorized', route: 'retrieve', position })

const CATS = [
  cat('a', '尺码', 1),
  cat('b', '物流', 2),
  cat('c', '售后', 3),
  cat('uncategorized', '未分类', 9999, 'uncategorized'),
]

const item = (id: string, categoryId: string) => ({ id, categoryId })

describe('catNavItems', () => {
  it('首项是「全部」,计数为传入集合总数;末项是未分类', () => {
    const out = catNavItems([item('1', 'a'), item('2', 'b')], CATS)
    expect(out[0].id).toBe(ALL_CATEGORY_ID)
    expect(out[0].label).toBe('全部')
    expect(out[0].count).toBe(2)
    expect(out[out.length - 1].id).toBe('uncategorized')
  })

  it('类型顺序取 categoryOrder:按 position,未分类恒最后', () => {
    const out = catNavItems([], CATS)
    expect(out.map((e) => e.id)).toEqual([ALL_CATEGORY_ID, 'a', 'b', 'c', 'uncategorized'])
  })

  it('计数为 0 的类型照样产出(位置稳定,不随数据消失又跳回)', () => {
    const out = catNavItems([item('1', 'a')], CATS)
    expect(out.find((e) => e.id === 'c')).toEqual({ id: 'c', label: '售后', count: 0 })
    expect(out.find((e) => e.id === 'uncategorized')?.count).toBe(0)
  })

  it('类型表里没有的 categoryId 并进未分类,一条都不丢', () => {
    const out = catNavItems([item('1', 'ghost'), item('2', 'uncategorized')], CATS)
    expect(out.find((e) => e.id === 'uncategorized')?.count).toBe(2)
    expect(out[0].count).toBe(2)
  })

  it('计数描述的是传入集合的分布 —— 搜索筛后的集合进来,计数就跟着变', () => {
    const all = [item('1', 'a'), item('2', 'a'), item('3', 'b')]
    const filtered = all.slice(0, 1)
    expect(catNavItems(all, CATS).find((e) => e.id === 'a')?.count).toBe(2)
    expect(catNavItems(filtered, CATS).find((e) => e.id === 'a')?.count).toBe(1)
    expect(catNavItems(filtered, CATS).find((e) => e.id === 'b')?.count).toBe(0)
  })
})

describe('filterByCategory', () => {
  const items = [
    item('1', 'a'),
    item('2', 'b'),
    item('3', 'uncategorized'),
    item('4', 'ghost'),
  ]

  it('「全部」原样返回', () => {
    expect(filterByCategory(items, ALL_CATEGORY_ID, CATS)).toHaveLength(4)
  })

  it('按类型过滤', () => {
    expect(filterByCategory(items, 'a', CATS).map((x) => x.id)).toEqual(['1'])
  })

  it('未分类含「显式未分类」与「类型表里没有的 id」两类', () => {
    expect(filterByCategory(items, 'uncategorized', CATS).map((x) => x.id)).toEqual(['3', '4'])
  })

  it('与 catNavItems 同口径:导航计数 = 点进去看到的条数', () => {
    const nav = catNavItems(items, CATS)
    for (const entry of nav) {
      expect(filterByCategory(items, entry.id, CATS)).toHaveLength(entry.count)
    }
  })
})
