import { describe, it, expect } from 'vitest'
import {
  effectiveOrders, computeSalesVelocity, suggestReorderQty,
  productPerformance, computeMemberRFM, getExpiringProducts,
  getReorderList, averageTicket, profitAnalysis, customerSegmentation,
  getProductHistory,
} from './analytics'

const DAY = 86400000
const now = Date.now()
const daysAgo = (d) => new Date(now - d * DAY).toISOString()
const ymd = (d) => new Date(now - d * DAY).toISOString().slice(0, 10)

describe('effectiveOrders', () => {
  it('排除完整退貨原訂單與配對負數訂單', () => {
    const orders = [
      { id: 'o1', status: 'completed', total: 100 },
      { id: 'o2', status: 'refunded', total: 200 },          // 完整退貨原單 → 排除
      { id: 'r1', refundOf: 'o2', fullRefund: true, total: -200 }, // 配對負數 → 排除
      { id: 'r2', refundOf: 'o3', fullRefund: false, total: -50 },  // 部分退貨 → 保留
    ]
    const result = effectiveOrders(orders)
    expect(result.map(o => o.id)).toEqual(['o1', 'r2'])
  })
})

describe('computeSalesVelocity', () => {
  it('計算近 N 天每日均銷量', () => {
    const orders = [
      { time: daysAgo(1), status: 'completed', items: [{ id: 'p1', qty: 30 }] },
    ]
    const v = computeSalesVelocity(orders, 30)
    expect(v.get('p1')).toBeCloseTo(1, 5) // 30 件 / 30 天 = 1/天
  })

  it('排除超過期間的訂單', () => {
    const orders = [
      { time: daysAgo(40), status: 'completed', items: [{ id: 'p1', qty: 100 }] },
      { time: daysAgo(5), status: 'completed', items: [{ id: 'p1', qty: 15 }] },
    ]
    const v = computeSalesVelocity(orders, 30)
    expect(v.get('p1')).toBeCloseTo(0.5, 5) // 只算 15 件 / 30 天
  })

  it('支援 item.productId 與 item.id 兩種 key', () => {
    const orders = [
      { time: daysAgo(1), status: 'completed', items: [{ productId: 'p2', qty: 60 }] },
    ]
    const v = computeSalesVelocity(orders, 30)
    expect(v.get('p2')).toBeCloseTo(2, 5)
  })
})

describe('suggestReorderQty', () => {
  it('依日均 × 供貨天數 + 安全庫存 - 現有 算建議量', () => {
    const product = { stock: 10, reorderLevel: 5 }
    const r = suggestReorderQty(product, 2, 14)
    // projectedDemand = 2*14 = 28；targetStock = 28+5 = 33；suggested = 33-10 = 23
    expect(r.projectedDemand).toBe(28)
    expect(r.targetStock).toBe(33)
    expect(r.suggested).toBe(23)
    expect(r.daysOfStock).toBeCloseTo(5, 1) // 10 / 2
  })

  it('庫存已足夠時至少建議 1', () => {
    const product = { stock: 1000, reorderLevel: 5 }
    const r = suggestReorderQty(product, 1, 14)
    expect(r.suggested).toBe(1)
  })

  it('無銷售時 daysOfStock 為 null', () => {
    const r = suggestReorderQty({ stock: 10, reorderLevel: 0 }, 0, 14)
    expect(r.daysOfStock).toBeNull()
  })
})

describe('computeMemberRFM', () => {
  const member = { id: 'm1' }
  it('無消費 → 未消費', () => {
    expect(computeMemberRFM(member, []).tag).toBe('未消費')
  })
  it('近期高頻高額 → VIP', () => {
    const orders = Array.from({ length: 5 }, (_, i) => ({
      memberId: 'm1', status: 'completed', time: daysAgo(i + 1), total: 1200,
    }))
    expect(computeMemberRFM(member, orders).tag).toBe('VIP')
  })
  it('60 天以上沒來 → 沉睡會員', () => {
    const orders = [{ memberId: 'm1', status: 'completed', time: daysAgo(90), total: 500 }]
    expect(computeMemberRFM(member, orders).tag).toBe('沉睡會員')
  })
  it('30-60 天 → 流失預警', () => {
    const orders = [{ memberId: 'm1', status: 'completed', time: daysAgo(45), total: 500 }]
    expect(computeMemberRFM(member, orders).tag).toBe('流失預警')
  })
  it('只算該會員的訂單', () => {
    const orders = [
      { memberId: 'other', status: 'completed', time: daysAgo(1), total: 9999 },
      { memberId: 'm1', status: 'completed', time: daysAgo(2), total: 100 },
    ]
    const r = computeMemberRFM(member, orders)
    expect(r.frequency).toBe(1)
    expect(r.monetary).toBe(100)
  })
})

describe('getExpiringProducts', () => {
  it('區分已過期與即將過期', () => {
    const products = [
      { id: 'a', expiryDate: ymd(3) },   // 3 天前 → 已過期
      { id: 'b', expiryDate: ymd(-3) },  // 3 天後 → 即將過期
      { id: 'c', expiryDate: ymd(-30) }, // 30 天後 → 不算
      { id: 'd' },                        // 無到期日 → 不算
    ]
    const { expired, soon } = getExpiringProducts(products, 7)
    expect(expired.map(p => p.id)).toContain('a')
    expect(soon.map(p => p.id)).toContain('b')
    expect(soon.map(p => p.id)).not.toContain('c')
    expect([...expired, ...soon].map(p => p.id)).not.toContain('d')
  })
})

describe('getReorderList', () => {
  it('只回傳 stock <= reorderLevel 且 reorderLevel > 0', () => {
    const products = [
      { id: 'a', stock: 3, reorderLevel: 5 },  // 補貨
      { id: 'b', stock: 10, reorderLevel: 5 }, // 充足
      { id: 'c', stock: 0, reorderLevel: 0 },  // 沒設安全庫存 → 不算
      { id: 'd', stock: 5, reorderLevel: 5 },  // 等於 → 補貨
    ]
    expect(getReorderList(products).map(p => p.id)).toEqual(['a', 'd'])
  })
})

describe('averageTicket', () => {
  it('count 只算銷售筆數，total 含退貨抵銷', () => {
    const orders = [
      { time: daysAgo(1), status: 'completed', total: 100 },
      { time: daysAgo(2), status: 'completed', total: 300 },
      { time: daysAgo(3), status: 'completed', total: -50, refundOf: 'x' }, // 部分退貨：不算筆數，但金額抵銷
    ]
    const r = averageTicket(orders, 30)
    expect(r.count).toBe(2)           // 2 筆銷售
    expect(r.total).toBe(350)         // 100 + 300 - 50（退貨抵銷淨營收）
    expect(r.avg).toBe(175)           // 350 / 2
  })
})

describe('profitAnalysis', () => {
  it('營收 - 成本 = 毛利，並算毛利率', () => {
    const products = [{ id: 'p1', cost: 10 }]
    const orders = [
      { time: daysAgo(1), status: 'completed', total: 100, items: [{ id: 'p1', qty: 5 }] },
    ]
    const r = profitAnalysis(orders, products, 30)
    expect(r.revenue).toBe(100)
    expect(r.cost).toBe(50) // 10 * 5
    expect(r.profit).toBe(50)
    expect(r.marginRate).toBeCloseTo(50, 1)
  })
})

describe('customerSegmentation', () => {
  it('區分會員與散客營收', () => {
    const members = [{ id: 'm1', tier: 'gold' }]
    const orders = [
      { status: 'completed', memberId: 'm1', total: 500 },
      { status: 'completed', memberId: null, total: 300 },
    ]
    const r = customerSegmentation(orders, members)
    expect(r.memberRevenue).toBe(500)
    expect(r.anonRevenue).toBe(300)
    expect(r.tierRevenue.gold).toBe(500)
  })
})

describe('productPerformance', () => {
  it('分類出熱賣 / 滯銷 / 高毛利', () => {
    const products = [
      { id: 'hot', name: '熱賣', stock: 50, cost: 10, price: 30 },
      { id: 'dead', name: '滯銷', stock: 20, cost: 5, price: 10 },
    ]
    const orders = [
      { time: daysAgo(1), status: 'completed', items: [{ id: 'hot', qty: 60, price: 30 }] },
    ]
    const r = productPerformance(products, orders, 30)
    expect(r.topSellers[0].id).toBe('hot')
    expect(r.slowMovers.map(p => p.id)).toContain('dead') // 30 天賣不到 1 件且有庫存
  })
})

describe('getProductHistory', () => {
  it('合併銷售/退貨/進貨/損耗並時間倒序', () => {
    const orders = [
      { id: 'o1', time: daysAgo(2), items: [{ id: 'p1', qty: 3, price: 30 }] },             // 銷售 -3
      { id: 'r1', time: daysAgo(1), refundOf: 'o1', items: [{ id: 'p1', qty: 1, price: 30 }] }, // 退貨 +1
    ]
    const wasteLog = [{ id: 'w1', productId: 'p1', time: daysAgo(3), qty: 2, reason: '破損' }] // 損耗 -2
    const purchases = [{ id: 'po1', status: 'received', receivedDate: ymd(4), supplierName: 'A', items: [{ productId: 'p1', received: 50, unitCost: 12 }] }] // 進貨 +50
    const h = getProductHistory('p1', { orders, wasteLog, purchases })
    expect(h.length).toBe(4)
    expect(h[0].type).toBe('refund')   // 最近（1 天前）
    expect(h[0].delta).toBe(1)
    const sale = h.find(e => e.type === 'sale')
    expect(sale.delta).toBe(-3)
    const purchase = h.find(e => e.type === 'purchase')
    expect(purchase.delta).toBe(50)
  })

  it('品項缺 qty 時 delta 為 0，不會變 NaN', () => {
    const orders = [{ id: 'o1', time: daysAgo(1), items: [{ id: 'p1', price: 30 }] }] // 無 qty
    const h = getProductHistory('p1', { orders })
    expect(h[0].delta).toBeCloseTo(0)        // -0 與 +0 皆可（算術等價、序列化為 "0"）
    expect(Number.isNaN(h[0].delta)).toBe(false)
  })
})

// ===== 第三輪 audit 回歸測試 =====
describe('回歸：邊界與防呆', () => {
  it('suggestReorderQty velocity 為 undefined（無銷售紀錄）不應 throw', () => {
    expect(() => suggestReorderQty({ stock: 5, reorderLevel: 3 }, undefined, 14)).not.toThrow()
    const r = suggestReorderQty({ stock: 5, reorderLevel: 3 }, undefined, 14)
    expect(r.dailyAvg).toBe(0)
    expect(Number.isFinite(r.suggested)).toBe(true)
  })

  it('computeSalesVelocity days<=0 不產生 Infinity', () => {
    const orders = [{ time: daysAgo(0.1), status: 'completed', items: [{ id: 'p1', qty: 10 }] }]
    const v = computeSalesVelocity(orders, 0)
    expect(Number.isFinite(v.get('p1') ?? 0)).toBe(true)
  })

  it('computeMemberRFM 退貨單不計入頻次、不影響最近購買', () => {
    const member = { id: 'm1' }
    const orders = [
      { memberId: 'm1', status: 'completed', time: daysAgo(40), total: 500 }, // 唯一銷售在 40 天前
      { memberId: 'm1', refundOf: 'x', time: daysAgo(1), total: -100 },        // 1 天前退貨
    ]
    const r = computeMemberRFM(member, orders)
    expect(r.frequency).toBe(1)                       // 不含退貨
    expect(r.recencyDays).toBeGreaterThanOrEqual(39)  // 以 40 天前的銷售為準，而非退貨的 1 天前
    expect(r.monetary).toBe(400)                      // 淨額 500 - 100
  })

  it('getExpiringProducts 用本地日期：N 天後到期回報 daysLeft = N（時區修正、不 off-by-one）', () => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    const plus = new Date(d.getTime() + 3 * DAY)
    const local3 = `${plus.getFullYear()}-${String(plus.getMonth() + 1).padStart(2, '0')}-${String(plus.getDate()).padStart(2, '0')}`
    const { soon } = getExpiringProducts([{ id: 'x', expiryDate: local3 }], 7)
    const hit = soon.find(p => p.id === 'x')
    expect(hit).toBeTruthy()
    expect(hit.daysLeft).toBe(3)
  })

  it('productPerformance 無銷量商品 daysOfStock 為 null（JSON 安全）', () => {
    const r = productPerformance([{ id: 'z', name: 'Z', stock: 10, cost: 5, price: 10 }], [], 30)
    const z = r.enriched.find(p => p.id === 'z')
    expect(z.daysOfStock).toBeNull()
    expect(JSON.parse(JSON.stringify(z)).daysOfStock).toBeNull() // 序列化後仍是 null
  })
})
