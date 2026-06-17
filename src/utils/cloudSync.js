// 雲端同步（手動 push/pull）
// push：把本機（localStorage 或 SQLite）資料 upsert 到 Supabase
// pull：從 Supabase 拉全部資料，覆蓋本機
import { getSupabase, isCloudEnabled } from './supabaseClient'
import { isElectron } from './dataAccess'

// ===== Tables 設定 =====
// localKey：localStorage key（Browser 模式）
// cloud：Supabase table 名
// pick：上傳前的欄位過濾 + 型別轉換
const TABLES = [
  {
    localKey: 'pos2_products', cloud: 'products',
    pick: (p) => ({
      id: p.id, name: p.name || '', category: p.category || '',
      price: Number(p.price) || 0, cost: Number(p.cost) || 0, stock: Number(p.stock) || 0,
      barcode: p.barcode || '', unit: p.unit || '個',
      noBarcode: !!p.noBarcode, imageUrl: p.imageUrl || '', expiryDate: p.expiryDate || '',
      supplierId: p.supplierId || '', reorderLevel: Number(p.reorderLevel) || 0,
    }),
  },
  {
    localKey: 'pos2_members', cloud: 'members',
    pick: (m) => ({
      id: m.id, name: m.name || '', phone: m.phone || '',
      points: Number(m.points) || 0, tier: m.tier || 'normal',
      totalSpent: Number(m.totalSpent) || 0, joinDate: m.joinDate || '',
      balance: Number(m.balance) || 0, birthday: m.birthday || '',
      lastBirthdayBonus: m.lastBirthdayBonus || '',
    }),
  },
  {
    localKey: 'pos2_orders', cloud: 'orders',
    pick: (o) => ({
      id: o.id,
      items: Array.isArray(o.items) ? o.items : [],
      subtotal: Number(o.subtotal) || 0, discount: Number(o.discount) || 0,
      manualDiscount: Number(o.manualDiscount) || 0, balanceUsed: Number(o.balanceUsed) || 0,
      total: Number(o.total) || 0,
      payMethod: o.payMethod || 'cash', paid: Number(o.paid) || 0,
      change: Number(o.change ?? o.change_amount) || 0,
      payments: Array.isArray(o.payments) ? o.payments : [],
      memberId: o.memberId || null,
      pointsUsed: Number(o.pointsUsed) || 0, pointsEarned: Number(o.pointsEarned) || 0,
      time: o.time, source: o.source || 'pos', status: o.status || 'completed',
      tableNum: o.tableNum || '', note: o.note || '', taxId: o.taxId || '',
      shiftId: o.shiftId || '', refundOf: o.refundOf || '', cashier: o.cashier || '',
      fullRefund: !!o.fullRefund,
    }),
  },
  {
    localKey: 'pos_suppliers', cloud: 'suppliers',
    pick: (s) => ({
      id: s.id, name: s.name || '', contact: s.contact || '',
      phone: s.phone || '', payTerms: s.payTerms || '', note: s.note || '',
    }),
  },
  {
    localKey: 'pos_purchases', cloud: 'purchases',
    pick: (p) => ({
      id: p.id, supplierId: p.supplierId || '', supplierName: p.supplierName || '',
      status: p.status || 'draft', date: p.date || '',
      receivedDate: p.receivedDate || '', paidDate: p.paidDate || '',
      note: p.note || '', total: Number(p.total) || 0,
      items: Array.isArray(p.items) ? p.items : [],
    }),
  },
  {
    localKey: 'pos_promotions', cloud: 'promotions',
    pick: (p) => ({
      id: p.id, name: p.name || '', type: p.type || '',
      condition: p.condition || {}, enabled: !!p.enabled,
      startAt: p.startAt || '', endAt: p.endAt || '',
    }),
  },
  {
    localKey: 'pos_users', cloud: 'users',
    pick: (u) => ({
      id: u.id, username: u.username || '', password: u.password || '', role: u.role || 'staff',
    }),
  },
  {
    localKey: 'pos2_manual_j', cloud: 'manual_journal',
    pick: (j) => ({
      id: j.id, orderId: j.orderId || '', date: j.date || '',
      description: j.description || '', type: j.type || 'manual',
      lines: Array.isArray(j.lines) ? j.lines : [],
    }),
  },
  {
    localKey: 'pos2_held_orders', cloud: 'held_orders',
    pick: (h) => ({
      id: h.id, label: h.label || '',
      cart: Array.isArray(h.cart) ? h.cart : [],
      memberId: h.memberId || '', manualDiscount: Number(h.manualDiscount) || 0,
      note: h.note || '', createdAt: h.createdAt || new Date().toISOString(),
      cashier: h.cashier || '',
    }),
  },
  {
    localKey: 'pos2_shifts', cloud: 'shifts',
    pick: (s) => ({
      id: s.id, cashier: s.cashier || '', cashierId: s.cashierId || '',
      openTime: s.openTime || '', closeTime: s.closeTime || '',
      openCash: Number(s.openCash) || 0, closeCash: Number(s.closeCash) || 0,
      expectedCash: Number(s.expectedCash) || 0, diff: Number(s.diff) || 0,
      cashSales: Number(s.cashSales) || 0, cardSales: Number(s.cardSales) || 0,
      orderCount: Number(s.orderCount) || 0, refundCount: Number(s.refundCount) || 0,
      refundAmount: Number(s.refundAmount) || 0, note: s.note || '',
      status: s.status || 'open',
    }),
  },
  {
    localKey: 'pos2_cash_log', cloud: 'cash_log',
    pick: (c) => ({
      id: c.id, shiftId: c.shiftId || '', time: c.time, type: c.type,
      amount: Number(c.amount) || 0, reason: c.reason || '', cashier: c.cashier || '',
    }),
  },
  {
    localKey: 'pos2_waste', cloud: 'waste_log',
    pick: (w) => ({
      id: w.id, productId: w.productId, productName: w.productName || '',
      qty: Number(w.qty) || 0, reason: w.reason || '', cost: Number(w.cost) || 0,
      time: w.time, cashier: w.cashier || '',
    }),
  },
  {
    localKey: 'pos2_topups', cloud: 'member_topups',
    pick: (t) => ({
      id: t.id, memberId: t.memberId, amount: Number(t.amount) || 0,
      bonus: Number(t.bonus) || 0, payMethod: t.payMethod || 'cash',
      time: t.time, cashier: t.cashier || '', note: t.note || '',
    }),
  },
  {
    localKey: 'pos_audit_log', cloud: 'audit_log',
    pick: (a) => ({
      id: a.id, timestamp: a.timestamp, action: a.action,
      level: a.level || 'info', label: a.label || '',
      userId: a.userId || '', username: a.username || '', role: a.role || '',
      detail: typeof a.detail === 'object' ? a.detail : (() => { try { return JSON.parse(a.detail) } catch { return {} } })(),
    }),
  },
]

// ===== 工具 =====
function loadLS(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : [] }
  catch { return [] }
}
function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// 從本機讀全部資料（Electron 用 exportData，Browser 用 localStorage）
async function readLocal() {
  if (isElectron) {
    const data = await window.electronAPI.db.exportData()
    return {
      pos2_products: data.products || [],
      pos2_members: data.members || [],
      pos2_orders: data.orders || [],
      pos_suppliers: data.suppliers || [],
      pos_purchases: data.purchases || [],
      pos_promotions: data.promotions || [],
      pos_users: data.users || [],
      pos2_manual_j: data.manualJournal || [],
      pos2_held_orders: data.heldOrders || [],
      pos2_shifts: data.shifts || [],
      pos2_cash_log: data.cashLog || [],
      pos2_waste: data.wasteLog || [],
      pos2_topups: data.memberTopups || [],
      pos_audit_log: data.auditLog || [],
    }
  }
  const all = {}
  for (const t of TABLES) all[t.localKey] = loadLS(t.localKey)
  return all
}

// 寫本機（Electron 統一走 importData；Browser 走 localStorage）
async function writeLocal(allByKey) {
  if (isElectron) {
    // importData 會 DELETE 14 張表後重新 insert，包含 held_orders/shifts/cash_log/waste_log/member_topups/audit_log
    await window.electronAPI.db.importData({
      products: allByKey['pos2_products'] || [],
      members: allByKey['pos2_members'] || [],
      orders: allByKey['pos2_orders'] || [],
      suppliers: allByKey['pos_suppliers'] || [],
      purchases: allByKey['pos_purchases'] || [],
      promotions: allByKey['pos_promotions'] || [],
      users: allByKey['pos_users'] || [],
      manualJournal: allByKey['pos2_manual_j'] || [],
      heldOrders: allByKey['pos2_held_orders'] || [],
      shifts: allByKey['pos2_shifts'] || [],
      cashLog: allByKey['pos2_cash_log'] || [],
      wasteLog: allByKey['pos2_waste'] || [],
      memberTopups: allByKey['pos2_topups'] || [],
      auditLog: allByKey['pos_audit_log'] || [],
    })
    return
  }
  for (const t of TABLES) {
    if (allByKey[t.localKey]) saveLS(t.localKey, allByKey[t.localKey])
  }
}

// ===== Push：本機 → 雲端（upsert） =====
export async function pushAll(onProgress = () => {}) {
  if (!isCloudEnabled()) throw new Error('尚未設定雲端')
  const sb = getSupabase()
  if (!sb) throw new Error('雲端 client 初始化失敗')

  const allLocal = await readLocal()
  const report = []

  for (const t of TABLES) {
    onProgress({ table: t.cloud, status: 'pushing' })
    const rows = (allLocal[t.localKey] || []).map(t.pick).filter(r => r.id)
    if (rows.length === 0) {
      report.push({ table: t.cloud, count: 0 })
      continue
    }
    // 分批 upsert（Supabase 單次預設 1000 行上限）
    const BATCH = 500
    let pushed = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH)
      const { error } = await sb.from(t.cloud).upsert(slice, { onConflict: 'id' })
      if (error) {
        report.push({ table: t.cloud, count: pushed, error: error.message })
        throw new Error(`${t.cloud}: ${error.message}`)
      }
      pushed += slice.length
    }
    report.push({ table: t.cloud, count: pushed })
  }
  return report
}

// ===== Pull：雲端 → 本機（全替換） =====
export async function pullAll(onProgress = () => {}) {
  if (!isCloudEnabled()) throw new Error('尚未設定雲端')
  const sb = getSupabase()
  if (!sb) throw new Error('雲端 client 初始化失敗')

  const result = {}
  const report = []
  for (const t of TABLES) {
    onProgress({ table: t.cloud, status: 'pulling' })
    // Supabase 預設 1000 行上限，分頁
    const PAGE = 1000
    let all = []
    let from = 0
    while (true) {
      const { data, error } = await sb.from(t.cloud).select('*').range(from, from + PAGE - 1)
      if (error) {
        report.push({ table: t.cloud, count: all.length, error: error.message })
        throw new Error(`${t.cloud}: ${error.message}`)
      }
      if (!data || data.length === 0) break
      all = all.concat(data)
      if (data.length < PAGE) break
      from += PAGE
    }
    result[t.localKey] = all
    report.push({ table: t.cloud, count: all.length })
  }
  await writeLocal(result)
  return report
}

export const SYNC_TABLES = TABLES.map(t => ({ local: t.localKey, cloud: t.cloud }))
