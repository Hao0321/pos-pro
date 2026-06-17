import { describe, it, expect } from 'vitest'
import { parseCSV, stringifyCSV, csvRowToProduct } from './csv'

describe('parseCSV', () => {
  it('解析基本 CSV', () => {
    const { headers, records } = parseCSV('name,price\n蘋果,30\n香蕉,20')
    expect(headers).toEqual(['name', 'price'])
    expect(records).toEqual([
      { name: '蘋果', price: '30' },
      { name: '香蕉', price: '20' },
    ])
  })

  it('處理引號包住的逗號', () => {
    const { records } = parseCSV('name,note\n"糖果, 綜合",好吃')
    expect(records[0].name).toBe('糖果, 綜合')
    expect(records[0].note).toBe('好吃')
  })

  it('處理跳脫雙引號 ""', () => {
    const { records } = parseCSV('name\n"他說""你好"""')
    expect(records[0].name).toBe('他說"你好"')
  })

  it('處理引號內換行', () => {
    const { records } = parseCSV('name,desc\n"商品","第一行\n第二行"')
    expect(records[0].desc).toBe('第一行\n第二行')
  })

  it('略過空白行', () => {
    const { records } = parseCSV('name\n蘋果\n\n香蕉\n')
    expect(records.length).toBe(2)
  })

  it('空字串回傳空結果', () => {
    expect(parseCSV('').records).toEqual([])
  })
})

describe('stringifyCSV', () => {
  it('序列化物件陣列', () => {
    const csv = stringifyCSV([{ a: '1', b: '2' }], ['a', 'b'])
    expect(csv).toBe('a,b\n1,2')
  })

  it('含逗號/引號/換行的值自動加引號跳脫', () => {
    const csv = stringifyCSV([{ a: '有,逗號', b: '有"引號' }], ['a', 'b'])
    expect(csv).toBe('a,b\n"有,逗號","有""引號"')
  })

  it('round-trip：序列化後再解析應一致', () => {
    const original = [
      { name: '糖果, 綜合', price: '30', note: '含"特殊"字元' },
    ]
    const csv = stringifyCSV(original, ['name', 'price', 'note'])
    const { records } = parseCSV(csv)
    expect(records[0]).toEqual(original[0])
  })
})

describe('csvRowToProduct', () => {
  const supplierByName = new Map([['台北乾貨行', { id: 's001', name: '台北乾貨行' }]])

  it('對應供應商名稱到 id', () => {
    const p = csvRowToProduct({ '商品名稱': '紫菜', '售價': '35', '主要供應商': '台北乾貨行' }, supplierByName)
    expect(p.name).toBe('紫菜')
    expect(p.price).toBe(35)
    expect(p.supplierId).toBe('s001')
  })

  it('找不到供應商時 supplierId 留空但保留 supplierName', () => {
    const p = csvRowToProduct({ '商品名稱': '紫菜', '主要供應商': '不存在的廠商' }, supplierByName)
    expect(p.supplierId).toBe('')
    expect(p.supplierName).toBe('不存在的廠商')
  })

  it('有條碼時 noBarcode 為 false', () => {
    const p = csvRowToProduct({ '商品名稱': 'X', '條碼': '4710000000001' }, supplierByName)
    expect(p.noBarcode).toBe(false)
    expect(p.barcode).toBe('4710000000001')
  })

  it('無條碼時 noBarcode 為 true', () => {
    const p = csvRowToProduct({ '商品名稱': 'X' }, supplierByName)
    expect(p.noBarcode).toBe(true)
  })

  it('數值欄位轉型，非數字歸 0', () => {
    const p = csvRowToProduct({ '商品名稱': 'X', '售價': 'abc', '庫存': '15' }, supplierByName)
    expect(p.price).toBe(0)
    expect(p.stock).toBe(15)
  })

  it('整數欄位四捨五入而非截斷（庫存 12.9 → 13）', () => {
    const p = csvRowToProduct({ '商品名稱': 'X', '庫存': '12.9' }, supplierByName)
    expect(p.stock).toBe(13)
  })

  it('售價去貨幣符號與千分位（NT$1,200 → 1200，不再變 0）', () => {
    const p = csvRowToProduct({ '商品名稱': 'X', '售價': 'NT$1,200' }, supplierByName)
    expect(p.price).toBe(1200)
  })
})
