import { describe, it, expect } from 'vitest'
import { orderToJournalEntries, topupToJournalEntries, buildPnL, ACCOUNTS } from './accounting'

const products = [
  { id: 'p1', cost: 10 },
  { id: 'p2', cost: 20 },
]

function sumLines(entry) {
  const debit = entry.lines.reduce((s, l) => s + l.debit, 0)
  const credit = entry.lines.reduce((s, l) => s + l.credit, 0)
  return { debit, credit }
}

describe('orderToJournalEntries', () => {
  const order = {
    id: 'O123', time: '2026-05-01T10:00:00.000Z', payMethod: 'cash',
    total: 100, discount: 0,
    items: [{ id: 'p1', qty: 3 }, { id: 'p2', qty: 1 }],
  }

  it('每筆分錄借貸必須平衡', () => {
    const entries = orderToJournalEntries(order, products)
    entries.forEach(e => {
      const { debit, credit } = sumLines(e)
      expect(debit).toBeCloseTo(credit, 5)
    })
  })

  it('產生收入分錄與銷貨成本分錄', () => {
    const entries = orderToJournalEntries(order, products)
    const types = entries.map(e => e.type)
    expect(types).toContain('auto_sale')
    expect(types).toContain('auto_cogs')
  })

  it('銷貨成本 = Σ(cost × qty)', () => {
    const entries = orderToJournalEntries(order, products)
    const cogs = entries.find(e => e.type === 'auto_cogs')
    // 10*3 + 20*1 = 50
    expect(cogs.lines[0].debit).toBe(50)
  })

  it('現金付款記入現金科目 1101', () => {
    const entries = orderToJournalEntries(order, products)
    const sale = entries.find(e => e.type === 'auto_sale')
    expect(sale.lines[0].account).toBe('1101')
  })

  it('電子支付記入銀行存款科目 1103', () => {
    const cardOrder = { ...order, payMethod: 'card' }
    const entries = orderToJournalEntries(cardOrder, products)
    const sale = entries.find(e => e.type === 'auto_sale')
    expect(sale.lines[0].account).toBe('1103')
  })

  it('無成本資料時不產生 cogs 分錄', () => {
    const noCostOrder = { ...order, items: [{ id: 'unknown', qty: 5 }] }
    const entries = orderToJournalEntries(noCostOrder, products)
    expect(entries.find(e => e.type === 'auto_cogs')).toBeUndefined()
  })

  it('有點數折抵時：現金不被折抵虛減、營收認列原價、借貸平衡', () => {
    const discOrder = { ...order, total: 80, discount: 20 } // 原價 100、折抵 20、實收 80
    const entries = orderToJournalEntries(discOrder, products)
    const sale = entries.find(e => e.type === 'auto_sale')
    const { debit, credit } = sumLines(sale)
    expect(debit).toBeCloseTo(credit, 5)
    // 現金 1101 = 實收淨額 80（不會被折抵再扣一次）
    expect(sale.lines.find(l => l.account === '1101').debit).toBe(80)
    // 銷售收入 4101 認列原價 100
    expect(sale.lines.find(l => l.account === '4101').credit).toBe(100)
    // 折抵以 4191 借方作 contra-revenue
    expect(sale.lines.find(l => l.account === '4191').debit).toBe(20)
    // 不再產生會虛減現金的 auto_discount 分錄
    expect(entries.find(e => e.type === 'auto_discount')).toBeUndefined()
  })

  it('折抵後 P&L 淨營收 = 實收金額（原價 − 折抵）', () => {
    const discOrder = { ...order, time: '2026-05-01T10:00:00.000Z', total: 80, discount: 20 }
    const pnl = buildPnL(orderToJournalEntries(discOrder, products), '2026-05-01', '2026-05-31')
    expect(pnl.revenue).toBe(80)
  })

  it('退貨單（qty 負）必須沖回 COGS 與存貨', () => {
    const refundOrder = {
      id: 'R1', time: '2026-05-02T10:00:00.000Z', payMethod: 'cash',
      total: -30, discount: 0, refundOf: 'O123',
      items: [{ id: 'p1', qty: -3 }], // cost 10 → cogs -30
    }
    const entries = orderToJournalEntries(refundOrder, products)
    const cogs = entries.find(e => e.type === 'auto_cogs')
    expect(cogs).toBeDefined() // 舊版 cogs>0 會漏記退貨成本
    expect(cogs.lines.find(l => l.account === '5101').debit).toBe(-30) // 沖回銷貨成本
    expect(cogs.lines.find(l => l.account === '1211').credit).toBe(-30) // 回補存貨
  })

  it('退貨單完整反轉原銷售（營收與現金都回到 0）', () => {
    const sale = orderToJournalEntries(
      { id: 'O9', time: '2026-05-01T10:00:00.000Z', payMethod: 'cash', total: 100, discount: 0, items: [{ id: 'p1', qty: 1 }] },
      products)
    const refund = orderToJournalEntries(
      { id: 'R9', time: '2026-05-01T11:00:00.000Z', payMethod: 'cash', total: -100, discount: 0, refundOf: 'O9', items: [{ id: 'p1', qty: -1 }] },
      products)
    const pnl = buildPnL([...sale, ...refund], '2026-05-01', '2026-05-31')
    expect(pnl.revenue).toBe(0)
    expect(pnl.grossProfit).toBe(0)
  })

  it('缺 items / time 不應 throw', () => {
    expect(() => orderToJournalEntries({ id: 'X', total: 0 }, products)).not.toThrow()
  })
})

describe('buildPnL', () => {
  it('營收 - 成本 = 毛利', () => {
    const entries = orderToJournalEntries(
      { id: 'O1', time: '2026-05-01T10:00:00.000Z', payMethod: 'cash', total: 100, discount: 0,
        items: [{ id: 'p1', qty: 1 }] }, // cost 10
      products
    )
    const pnl = buildPnL(entries, '2026-05-01', '2026-05-31')
    expect(pnl.revenue).toBe(100)
    expect(pnl.cogs).toBe(10)
    expect(pnl.grossProfit).toBe(90)
  })

  it('期間外的分錄不計入', () => {
    const entries = orderToJournalEntries(
      { id: 'O1', time: '2026-01-01T10:00:00.000Z', payMethod: 'cash', total: 100, discount: 0, items: [] },
      products
    )
    const pnl = buildPnL(entries, '2026-05-01', '2026-05-31')
    expect(pnl.revenue).toBe(0)
  })
})

describe('ACCOUNTS 科目表', () => {
  it('每個科目都有 type 與 normal', () => {
    Object.values(ACCOUNTS).forEach(a => {
      expect(['asset', 'liability', 'equity', 'revenue', 'expense']).toContain(a.type)
      expect(['debit', 'credit']).toContain(a.normal)
    })
  })
})

describe('topupToJournalEntries 會員儲值', () => {
  it('加值含贈送：借貸平衡、現金=實收、贈送列促銷費、預收款=實收+贈送', () => {
    const e = topupToJournalEntries({ id: 'TP1', time: '2026-05-01T10:00:00.000Z', payMethod: 'cash', amount: 1000, bonus: 100 })[0]
    const { debit, credit } = sumLines(e)
    expect(debit).toBe(credit)
    expect(e.lines.find(l => l.account === '1101').debit).toBe(1000)
    expect(e.lines.find(l => l.account === '5207').debit).toBe(100)
    expect(e.lines.find(l => l.account === '2191').credit).toBe(1100)
  })
  it('無贈送：不產生促銷費列，電子支付記銀行 1103', () => {
    const e = topupToJournalEntries({ id: 'TP2', time: '2026-05-01', payMethod: 'card', amount: 500, bonus: 0 })[0]
    expect(e.lines.find(l => l.account === '5207')).toBeUndefined()
    expect(e.lines.find(l => l.account === '1103').debit).toBe(500)
    expect(e.lines.find(l => l.account === '2191').credit).toBe(500)
  })
  it('金額與贈送全 0 不產生分錄', () => {
    expect(topupToJournalEntries({ id: 'TP3', amount: 0, bonus: 0 }).length).toBe(0)
  })
})

describe('儲值折抵 auto_balance', () => {
  it('用儲值付的部分認列收入(4101)並沖預收款(2191)', () => {
    const order = { id: 'O5', time: '2026-05-01T10:00:00.000Z', payMethod: 'cash', total: 70, discount: 0, balanceUsed: 30, items: [{ id: 'p1', qty: 1 }] }
    const bal = orderToJournalEntries(order, products).find(e => e.type === 'auto_balance')
    expect(bal).toBeDefined()
    expect(bal.lines.find(l => l.account === '2191').debit).toBe(30)
    expect(bal.lines.find(l => l.account === '4101').credit).toBe(30)
  })
  it('退貨單帶負 balanceUsed → auto_balance 反向沖回預收款(2191) 與儲值消費營收', () => {
    const refundOrder = { id: 'RB', time: '2026-05-02T10:00:00.000Z', payMethod: 'cash', total: -70, discount: 0, balanceUsed: -30, refundOf: 'O5', items: [{ id: 'p1', qty: -1 }] }
    const bal = orderToJournalEntries(refundOrder, products).find(e => e.type === 'auto_balance')
    expect(bal).toBeDefined()
    expect(bal.lines.find(l => l.account === '2191').debit).toBe(-30) // 借方負 = 貸記 → 回補預收款
    expect(bal.lines.find(l => l.account === '4101').credit).toBe(-30) // 貸方負 = 借記 → 沖回儲值消費營收
  })

  it('完整生命週期：加值1100 → 用儲值消費1100，預收款歸零、營收=1100', () => {
    const topup = topupToJournalEntries({ id: 'TP9', time: '2026-05-01T09:00:00.000Z', payMethod: 'cash', amount: 1000, bonus: 100 })
    const o1 = orderToJournalEntries({ id: 'OA', time: '2026-05-02T10:00:00.000Z', payMethod: 'cash', total: 0, discount: 0, balanceUsed: 600, items: [] }, products)
    const o2 = orderToJournalEntries({ id: 'OB', time: '2026-05-03T10:00:00.000Z', payMethod: 'cash', total: 0, discount: 0, balanceUsed: 500, items: [] }, products)
    const pnl = buildPnL([...topup, ...o1, ...o2], '2026-05-01', '2026-05-31')
    const liab = pnl.totals['2191']
    expect(liab.credit - liab.debit).toBe(0)   // 預收款歸零
    expect(pnl.revenue).toBe(1100)             // 儲值消費全額認列營收
  })
})
