import { describe, it, expect } from 'vitest'
import { mergeCategories, groupByCategory, DEFAULT_CATEGORIES } from './categories'

describe('mergeCategories', () => {
  it('合併 preset 與既有分類並去重', () => {
    const result = mergeCategories(['雜貨', '自訂分類'])
    expect(result).toContain('自訂分類')
    expect(result).toContain('雜貨')
    // 去重：雜貨只出現一次
    expect(result.filter(c => c === '雜貨').length).toBe(1)
  })

  it('preset 全部包含', () => {
    const result = mergeCategories([])
    DEFAULT_CATEGORIES.forEach(c => expect(result).toContain(c))
  })

  it('過濾空值', () => {
    const result = mergeCategories(['', null, undefined, '有效'])
    expect(result).toContain('有效')
    expect(result).not.toContain('')
  })
})

describe('groupByCategory', () => {
  it('依分類分組，未分類墊底', () => {
    const products = [
      { id: '1', category: '雜貨' },
      { id: '2', category: '雜貨' },
      { id: '3', category: '' },        // 未分類
      { id: '4', category: '飲料' },
    ]
    const groups = groupByCategory(products)
    const zaHuo = groups.find(g => g.category === '雜貨')
    expect(zaHuo.products.length).toBe(2)
    // 未分類在最後
    expect(groups[groups.length - 1].category).toBe('未分類')
  })

  it('依 DEFAULT_CATEGORIES 順序排列', () => {
    const products = [
      { id: '1', category: '飲料' },   // preset 第 10
      { id: '2', category: '雜貨' },   // preset 第 1
    ]
    const groups = groupByCategory(products)
    expect(groups[0].category).toBe('雜貨') // 雜貨排在飲料前
  })

  it('自訂分類排在 preset 之後、未分類之前', () => {
    const products = [
      { id: '1', category: '我的自訂' },
      { id: '2', category: '雜貨' },
      { id: '3', category: '' },
    ]
    const groups = groupByCategory(products)
    const cats = groups.map(g => g.category)
    expect(cats.indexOf('雜貨')).toBeLessThan(cats.indexOf('我的自訂'))
    expect(cats.indexOf('我的自訂')).toBeLessThan(cats.indexOf('未分類'))
  })
})
