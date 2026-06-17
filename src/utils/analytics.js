// 進階分析工具：銷售速度、RFM、熱賣/滯銷、過期警示
// 所有函式都是 pure function，方便測試與快取
// 訂單格式：{ id, items: [{id, qty, price}], total, time, status, refundOf, fullRefund, memberId }

const DAY_MS = 86400000
const now = () => Date.now()

// ===== 過濾出「有效訂單」（排除完整退貨配對）=====
export function effectiveOrders(orders = []) {
  return orders.filter(o =>
    o.status !== 'refunded' && !(o.refundOf && o.fullRefund)
  )
}

// ===== 銷售速度：每日均銷量 =====
// 回傳 Map<productId, dailyAvgQty>
export function computeSalesVelocity(orders = [], days = 30) {
  days = Math.max(1, Number(days) || 30)   // 防 days<=0 造成除以零 → Infinity
  const since = now() - days * DAY_MS
  const tally = new Map()
  for (const o of effectiveOrders(orders)) {
    if (new Date(o.time).getTime() < since) continue
    for (const item of (o.items || [])) {
      const id = item.id || item.productId
      if (!id) continue
      tally.set(id, (tally.get(id) || 0) + (item.qty || 0))
    }
  }
  const out = new Map()
  for (const [id, total] of tally) out.set(id, total / days)
  return out
}

// ===== 建議叫貨量 =====
// 基於日均銷量 + 預期供貨週期，加安全餘量
// 預設假設下次到貨還有 14 天（雜貨店週期）+ 安全庫存
export function suggestReorderQty(product, dailyAvg, leadDays = 14) {
  product = product || {}
  const avg = Number(dailyAvg) || 0           // velocity.get() 對無銷售商品回 undefined → 防 NaN/crash
  const stock = Number(product.stock) || 0
  const reorderLevel = Number(product.reorderLevel) || 0
  // 預期需求量 = 日均 × 預期天數
  const projectedDemand = Math.ceil(avg * leadDays)
  // 目標庫存 = 預期需求 + 安全庫存
  const targetStock = projectedDemand + reorderLevel
  // 建議叫貨 = 目標 - 現有
  const suggested = Math.max(1, targetStock - stock)
  return {
    dailyAvg: +avg.toFixed(2),
    projectedDemand,
    targetStock,
    suggested,
    daysOfStock: avg > 0 ? +(stock / avg).toFixed(1) : null,
  }
}

// ===== 商品熱賣 / 滯銷分析 =====
// 回傳：{ topSellers, slowMovers, deadStock }
export function productPerformance(products = [], orders = [], days = 30) {
  days = Math.max(1, Number(days) || 30)
  const velocity = computeSalesVelocity(orders, days)

  const enriched = products.map(p => {
    const dailyAvg = velocity.get(p.id) || 0
    const totalSold = dailyAvg * days
    const stock = Number(p.stock) || 0
    const cost = Number(p.cost) || 0
    const price = Number(p.price) || 0
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0
    const revenue = totalSold * price
    const profit = totalSold * (price - cost)
    return {
      ...p,
      dailyAvg, totalSold,
      revenue, profit, margin,
      daysOfStock: dailyAvg > 0 ? stock / dailyAvg : null,  // null = 無銷量（Infinity 會被 JSON 序列化成 null，故統一用 null）
    }
  })

  // 熱賣 Top（按銷售數量）
  const topSellers = [...enriched]
    .filter(p => p.totalSold > 0)
    .sort((a, b) => b.totalSold - a.totalSold)
    .slice(0, 10)

  // 滯銷：30 天賣不到 1 件，但有庫存
  const slowMovers = enriched
    .filter(p => p.totalSold < 1 && (p.stock || 0) > 0)
    .sort((a, b) => (b.stock || 0) * (b.cost || 0) - (a.stock || 0) * (a.cost || 0))
    .slice(0, 20)

  // 高毛利 Top（須有銷量）
  const highMargin = [...enriched]
    .filter(p => p.totalSold > 0 && p.margin > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 10)

  return { enriched, topSellers, slowMovers, highMargin }
}

// ===== 會員 RFM 分群 =====
// Recency 最近購買、Frequency 頻次、Monetary 金額
// 自動 tag：VIP / 核心會員 / 新會員 / 流失預警 / 沉睡會員
export function computeMemberRFM(member, orders = []) {
  const memberOrders = effectiveOrders(orders).filter(o => o.memberId === member.id)
  // 頻次與最近購買只看「銷售單」：退貨單不算一次來店，也不該讓退貨時間誤判為最近活躍
  const sales = memberOrders.filter(o => !o.refundOf)
  const monetary = memberOrders.reduce((s, o) => s + (o.total || 0), 0) // 淨額（含退貨負數）
  if (sales.length === 0) {
    return { recencyDays: null, frequency: 0, monetary, tag: '未消費', tagColor: 'var(--text-tertiary)' }
  }
  const times = sales.map(o => new Date(o.time).getTime()).sort((a, b) => b - a)
  const recencyDays = Math.floor((now() - times[0]) / DAY_MS)
  const frequency = sales.length

  let tag, tagColor
  // 分群規則（雜貨店週期短、頻次高）
  if (recencyDays <= 7 && frequency >= 5 && monetary >= 5000) {
    tag = 'VIP'; tagColor = 'var(--gold)'
  } else if (recencyDays <= 14 && frequency >= 3) {
    tag = '核心會員'; tagColor = 'var(--green)'
  } else if (recencyDays <= 30 && frequency <= 2) {
    tag = '新會員'; tagColor = 'var(--blue)'
  } else if (recencyDays > 30 && recencyDays <= 60) {
    tag = '流失預警'; tagColor = 'var(--amber)'
  } else if (recencyDays > 60) {
    tag = '沉睡會員'; tagColor = 'var(--red)'
  } else {
    tag = '一般會員'; tagColor = 'var(--text-secondary)'
  }

  return { recencyDays, frequency, monetary, tag, tagColor }
}

// 批次計算所有會員的 RFM
export function computeAllRFM(members = [], orders = []) {
  return members.map(m => ({ ...m, rfm: computeMemberRFM(m, orders) }))
}

// ===== 過期商品警示 =====
// 回傳：{ expired: [], soon: [] } — 已過期 / 7 天內到期
export function getExpiringProducts(products = [], soonDays = 7) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const soonTs = today.getTime() + soonDays * DAY_MS
  const expired = []
  const soon = []
  for (const p of products) {
    if (!p.expiryDate) continue
    // 純日期字串 (YYYY-MM-DD) 用「本地午夜」解析；否則 JS 當 UTC 午夜，在 UTC+8 會把「今天到期」誤判成昨天已過期
    const raw = String(p.expiryDate)
    const exp = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T00:00:00') : new Date(raw)
    if (isNaN(exp.getTime())) continue
    const expTs = exp.getTime()
    if (expTs < today.getTime()) {
      expired.push({ ...p, daysLeft: Math.floor((expTs - today.getTime()) / DAY_MS) })
    } else if (expTs <= soonTs) {
      soon.push({ ...p, daysLeft: Math.ceil((expTs - today.getTime()) / DAY_MS) })
    }
  }
  // 已過期最久的排前面；快到期的最近排前面
  expired.sort((a, b) => a.daysLeft - b.daysLeft)
  soon.sort((a, b) => a.daysLeft - b.daysLeft)
  return { expired, soon }
}

// ===== 待補貨清單 =====
// stock <= reorderLevel 且 reorderLevel > 0
export function getReorderList(products = []) {
  return products.filter(p => {
    const r = Number(p.reorderLevel) || 0
    const s = Number(p.stock) || 0
    return r > 0 && s <= r
  })
}

// ===== 平均客單價 =====
// count = 正常銷售筆數（退貨單不算一筆客單）
// total = 淨營收（含退貨負數抵銷）
// avg = 淨營收 / 銷售筆數
export function averageTicket(orders = [], days = 30) {
  days = Math.max(1, Number(days) || 30)
  const since = now() - days * DAY_MS
  const inRange = effectiveOrders(orders).filter(o => new Date(o.time).getTime() >= since)
  const sales = inRange.filter(o => !o.refundOf)
  if (sales.length === 0) return { avg: 0, count: 0, total: 0 }
  const total = inRange.reduce((s, o) => s + (o.total || 0), 0) // 退貨負數一併計入
  return { avg: total / sales.length, count: sales.length, total }
}

// ===== 毛利分析 =====
// 計算指定期間的營收、成本、毛利
export function profitAnalysis(orders = [], products = [], days = 30) {
  days = Math.max(1, Number(days) || 30)
  const productMap = new Map(products.map(p => [p.id, p]))
  const since = now() - days * DAY_MS
  let revenue = 0, cost = 0
  for (const o of effectiveOrders(orders)) {
    if (new Date(o.time).getTime() < since) continue
    revenue += o.total || 0
    for (const it of (o.items || [])) {
      const id = it.id || it.productId
      const p = productMap.get(id)
      if (p) cost += (Number(p.cost) || 0) * (it.qty || 0)
    }
  }
  const profit = revenue - cost
  const marginRate = revenue > 0 ? (profit / revenue) * 100 : 0
  return { revenue, cost, profit, marginRate }
}

// ===== 商品變動歷史 =====
// 從 orders / wasteLog / purchases 反推某商品所有出入庫紀錄
// 回傳：[{ time, type:'sale'|'refund'|'purchase'|'waste', delta, note, refId }]
export function getProductHistory(productId, { orders = [], wasteLog = [], purchases = [] } = {}) {
  const events = []

  for (const o of orders) {
    const items = o.items || []
    const item = items.find(i => (i.id || i.productId) === productId)
    if (!item) continue
    const isRefund = !!o.refundOf
    const q = Math.abs(Number(item.qty) || 0)   // 防缺 qty → NaN 污染庫存重算
    events.push({
      time: o.time,
      type: isRefund ? 'refund' : 'sale',
      delta: isRefund ? q : -q,
      note: isRefund
        ? `退貨 #${o.refundOf?.slice(-6) || ''}`
        : `銷售 #${(o.id || '').slice(-6)}${o.cashier ? ' · ' + o.cashier : ''}`,
      refId: o.id,
      unitPrice: item.price,
    })
  }

  for (const w of wasteLog) {
    if (w.productId !== productId) continue
    events.push({
      time: w.time,
      type: 'waste',
      delta: -Math.abs(w.qty || 0),
      note: `損耗 · ${w.reason || ''}`,
      refId: w.id,
    })
  }

  for (const po of purchases) {
    if (po.status !== 'received' && po.status !== 'partial' && po.status !== 'paid') continue
    const it = (po.items || []).find(i => i.productId === productId)
    if (!it || !it.received) continue
    events.push({
      time: po.receivedDate || po.date,
      type: 'purchase',
      delta: Math.abs(it.received),
      note: `進貨 · ${po.supplierName || ''}`,
      refId: po.id,
      unitPrice: it.unitCost,
    })
  }

  // 時間倒序
  events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  return events
}

// ===== 會員消費結構分析 =====
// 散客 vs 會員、各層級會員的銷售貢獻
export function customerSegmentation(orders = [], members = []) {
  const memberMap = new Map(members.map(m => [m.id, m]))
  let memberRevenue = 0, anonRevenue = 0, memberOrders = 0, anonOrders = 0
  const tierRevenue = { normal: 0, silver: 0, gold: 0 }
  for (const o of effectiveOrders(orders)) {
    if (o.refundOf) continue
    if (o.memberId) {
      memberRevenue += o.total || 0
      memberOrders += 1
      const m = memberMap.get(o.memberId)
      const tier = m?.tier || 'normal'
      tierRevenue[tier] = (tierRevenue[tier] || 0) + (o.total || 0)
    } else {
      anonRevenue += o.total || 0
      anonOrders += 1
    }
  }
  return { memberRevenue, anonRevenue, memberOrders, anonOrders, tierRevenue }
}
