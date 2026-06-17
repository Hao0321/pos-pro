import { describe, it, expect } from 'vitest'
import {
  payloadFromOrder, payloadFromLowStock, payloadFromExpiring, payloadFromShift,
  WEBHOOK_EVENTS,
} from './webhook'

describe('payloadFromOrder', () => {
  it('組出訂單摘要與欄位', () => {
    const order = {
      id: 'O123456', payMethod: 'cash', cashier: '小明',
      total: 350, items: [{ name: '紫菜', qty: 2 }, { name: '冬粉', qty: 3 }],
    }
    const member = { name: '陳大文' }
    const p = payloadFromOrder(order, member)
    expect(p.total).toBe(350)
    expect(p._description).toContain('紫菜 × 2')
    expect(p._description).toContain('冬粉 × 3')
    expect(p._fields.find(f => f.name === '會員').value).toBe('陳大文')
    expect(p._fields.find(f => f.name === '收銀員').value).toBe('小明')
  })

  it('無會員顯示散客', () => {
    const p = payloadFromOrder({ id: 'O1', total: 100, items: [] }, null)
    expect(p._fields.find(f => f.name === '會員').value).toBe('散客')
  })

  it('退貨訂單用絕對值顯示總額', () => {
    const p = payloadFromOrder({ id: 'R1', refundOf: 'O1', total: -200, items: [{ name: 'X', qty: -1 }] }, null)
    expect(p._description).toContain('200')
    expect(p._title).toContain('退貨')
  })

  it('缺 total / 品項缺 name 不產生 NaN / undefined / 非數值 字串', () => {
    const p = payloadFromOrder({ id: 'O9', items: [{ qty: 2 }] }, null) // 無 total、品項無 name
    expect(p._description).not.toContain('undefined')
    expect(p._description).not.toContain('NaN')
    expect(p._description).not.toContain('非數值')
  })
})

describe('payloadFromLowStock', () => {
  it('摘要含商品數與最多 10 筆明細', () => {
    const products = Array.from({ length: 15 }, (_, i) => ({ name: `商品${i}`, stock: 1, reorderLevel: 5 }))
    const p = payloadFromLowStock(products)
    expect(p.count).toBe(15)
    expect(p._fields.length).toBe(10) // 只取前 10
    expect(p._description).toContain('15')
  })
})

describe('payloadFromExpiring', () => {
  it('區分已過期與即將到期數量', () => {
    const p = payloadFromExpiring(
      [{ name: 'A', daysLeft: -2 }],
      [{ name: 'B', daysLeft: 3 }]
    )
    expect(p.expired).toBe(1)
    expect(p.soon).toBe(1)
  })
})

describe('payloadFromShift', () => {
  it('開班含開班時間與零用金', () => {
    const p = payloadFromShift({ cashier: '小明', openTime: '2026-05-01T08:00:00.000Z', openCash: 2000 }, 'open')
    expect(p._title).toContain('開班')
    expect(p._fields.some(f => f.name === '零用金')).toBe(true)
  })
  it('關班含營業額與差異', () => {
    const p = payloadFromShift(
      { cashier: '小明' }, 'close',
      { cashSales: 5000, cardSales: 3000, orderCount: 42, expected: 7000, closeCash: 7000, diff: 0 }
    )
    expect(p._title).toContain('關班')
    expect(p._fields.some(f => f.name === '差異')).toBe(true)
  })
})

describe('WEBHOOK_EVENTS', () => {
  it('每個事件都有 key/label/desc', () => {
    WEBHOOK_EVENTS.forEach(e => {
      expect(e.key).toBeTruthy()
      expect(e.label).toBeTruthy()
      expect(e.desc).toBeTruthy()
    })
  })
})
