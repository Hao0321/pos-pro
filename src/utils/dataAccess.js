// 資料存取抽象層 — 自動判斷 Electron (SQLite) 或 瀏覽器 (localStorage)
export const isElectron = !!(typeof window !== 'undefined' && window.electronAPI)

function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch { return fallback }
}

function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// ===== Products =====
export async function loadProducts(fallback) {
  if (isElectron) return window.electronAPI.db.getProducts()
  return loadLS('pos2_products', fallback)
}
export async function saveProducts(products) {
  if (!isElectron) saveLS('pos2_products', products)
}
export async function dbAddProduct(data) {
  if (isElectron) return window.electronAPI.db.addProduct(data)
}
export async function dbUpdateProduct(id, data) {
  if (isElectron) return window.electronAPI.db.updateProduct(id, data)
}
export async function dbDeleteProduct(id) {
  if (isElectron) return window.electronAPI.db.deleteProduct(id)
}
export async function dbFindByBarcode(code) {
  if (isElectron) return window.electronAPI.db.findByBarcode(code)
  return null
}

// ===== Members =====
export async function loadMembers(fallback) {
  if (isElectron) return window.electronAPI.db.getMembers()
  return loadLS('pos2_members', fallback)
}
export async function saveMembers(members) {
  if (!isElectron) saveLS('pos2_members', members)
}
export async function dbAddMember(data) {
  if (isElectron) return window.electronAPI.db.addMember(data)
}
export async function dbUpdateMember(id, data) {
  if (isElectron) return window.electronAPI.db.updateMember(id, data)
}
export async function dbDeleteMember(id) {
  if (isElectron) return window.electronAPI.db.deleteMember(id)
}

// ===== Orders =====
export async function loadOrders(fallback) {
  if (isElectron) return window.electronAPI.db.getOrders()
  return loadLS('pos2_orders', fallback)
}
export async function saveOrders(orders) {
  if (!isElectron) saveLS('pos2_orders', orders)
}
export async function dbCheckout(orderData, stockUpdates, memberUpdate) {
  if (isElectron) return window.electronAPI.db.checkout(orderData, stockUpdates, memberUpdate)
}

// ===== Manual Journal =====
export async function loadManualJournal(fallback) {
  if (isElectron) return window.electronAPI.db.getManualJournal()
  return loadLS('pos2_manual_j', fallback)
}
export async function saveManualJournal(entries) {
  if (!isElectron) saveLS('pos2_manual_j', entries)
}
export async function dbAddManualEntry(data) {
  if (isElectron) return window.electronAPI.db.addManualEntry(data)
}
export async function dbDeleteManualEntry(id) {
  if (isElectron) return window.electronAPI.db.deleteManualEntry(id)
}

// ===== Suppliers =====
export async function loadSuppliers(fallback) {
  if (isElectron) return window.electronAPI.db.getSuppliers()
  return loadLS('pos_suppliers', fallback)
}
export async function saveSuppliers(data) {
  if (!isElectron) saveLS('pos_suppliers', data)
}
export async function dbAddSupplier(data) {
  if (isElectron) return window.electronAPI.db.addSupplier(data)
}
export async function dbUpdateSupplier(id, data) {
  if (isElectron) return window.electronAPI.db.updateSupplier(id, data)
}
export async function dbDeleteSupplier(id) {
  if (isElectron) return window.electronAPI.db.deleteSupplier(id)
}

// ===== Purchases =====
export async function loadPurchases(fallback) {
  if (isElectron) return window.electronAPI.db.getPurchases()
  return loadLS('pos_purchases', fallback)
}
export async function savePurchases(data) {
  if (!isElectron) saveLS('pos_purchases', data)
}
export async function dbAddPurchase(data) {
  if (isElectron) return window.electronAPI.db.addPurchase(data)
}
export async function dbUpdatePurchase(id, data) {
  if (isElectron) return window.electronAPI.db.updatePurchase(id, data)
}
export async function dbDeletePurchase(id) {
  if (isElectron) return window.electronAPI.db.deletePurchase(id)
}

// ===== Promotions =====
export async function loadPromotions(fallback) {
  if (isElectron) return window.electronAPI.db.getPromotions()
  return loadLS('pos_promotions', fallback)
}
export async function savePromotions(data) {
  if (!isElectron) saveLS('pos_promotions', data)
}
export async function dbAddPromotion(data) {
  if (isElectron) return window.electronAPI.db.addPromotion(data)
}
export async function dbUpdatePromotion(id, data) {
  if (isElectron) return window.electronAPI.db.updatePromotion(id, data)
}
export async function dbDeletePromotion(id) {
  if (isElectron) return window.electronAPI.db.deletePromotion(id)
}

// ===== Users =====
export async function loadUsers(fallback) {
  if (isElectron) return window.electronAPI.db.getUsers()
  return loadLS('pos_users', fallback)
}
export async function saveUsers(data) {
  if (!isElectron) saveLS('pos_users', data)
}
export async function dbAddUser(data) {
  if (isElectron) return window.electronAPI.db.addUser(data)
}
export async function dbUpdateUser(id, data) {
  if (isElectron) return window.electronAPI.db.updateUser(id, data)
}
export async function dbDeleteUser(id) {
  if (isElectron) return window.electronAPI.db.deleteUser(id)
}

// ===== Audit Log =====
export async function loadAuditLogs(filters) {
  if (isElectron) return window.electronAPI.db.getAuditLogs(filters)
  return loadLS('pos_audit_log', [])
}
export async function writeAuditLog(entry) {
  if (isElectron) return window.electronAPI.db.writeAuditLog(entry)
  // 瀏覽器模式: 寫入 localStorage
  const logs = loadLS('pos_audit_log', [])
  logs.unshift(entry)
  if (logs.length > 2000) logs.length = 2000
  saveLS('pos_audit_log', logs)
}

// ===== Backups =====
export async function loadBackups() {
  if (isElectron) return window.electronAPI.db.getBackups()
  return loadLS('pos_backups', [])
}
export async function createBackup(label, createdBy) {
  if (isElectron) return window.electronAPI.db.createBackup(label, createdBy)
}
export async function restoreBackup(id) {
  if (isElectron) return window.electronAPI.db.restoreBackup(id)
}
export async function exportData() {
  if (isElectron) return window.electronAPI.db.exportData()
  return null
}
export async function importData(data) {
  if (isElectron) return window.electronAPI.db.importData(data)
}

// ===== Settings =====
export async function getSetting(key) {
  if (isElectron) return window.electronAPI.settings.get(key)
  return loadLS('pos_settings_' + key, null)
}
export async function setSetting(key, value) {
  if (isElectron) return window.electronAPI.settings.set(key, value)
  saveLS('pos_settings_' + key, value)
}
export async function getAllSettings() {
  if (isElectron) return window.electronAPI.settings.getAll()
  return {}
}

// ===== Migration =====
export async function checkAndMigrate() {
  if (!isElectron) return false
  try {
    const isEmpty = await window.electronAPI.db.isEmpty()
    if (!isEmpty) return false

    const data = {
      products: loadLS('pos2_products', []),
      members: loadLS('pos2_members', []),
      orders: loadLS('pos2_orders', []),
      manualJournal: loadLS('pos2_manual_j', []),
      users: [],  // 不遷移舊帳號，用新的
      suppliers: loadLS('pos_suppliers', []),
      purchases: loadLS('pos_purchases', []),
      promotions: loadLS('pos_promotions', []),
    }

    const hasData = Object.values(data).some(arr => arr && arr.length > 0)
    if (!hasData) return false

    await window.electronAPI.db.migrateFromLocalStorage(data)
    return true
  } catch {
    return false
  }
}

// ===== Customer Orders =====
export async function loadCustomerOrders() {
  if (isElectron) return window.electronAPI.db.getCustomerOrders()
  return []
}
export async function updateOrderStatus(id, status) {
  if (isElectron) return window.electronAPI.db.updateOrderStatus(id, status)
}

// ===== Refund =====
export async function dbRefund(origId, refundData, stockUpdates, memberUpdate) {
  if (isElectron) return window.electronAPI.db.refundOrder(origId, refundData, stockUpdates, memberUpdate)
}

// ===== Held Orders 掛單 =====
export async function loadHeldOrders() {
  if (isElectron) return window.electronAPI.db.getHeldOrders()
  return loadLS('pos2_held_orders', [])
}
export async function addHeldOrder(data) {
  if (isElectron) return window.electronAPI.db.addHeldOrder(data)
  const arr = loadLS('pos2_held_orders', [])
  arr.unshift(data); saveLS('pos2_held_orders', arr)
}
export async function deleteHeldOrder(id) {
  if (isElectron) return window.electronAPI.db.deleteHeldOrder(id)
  const arr = loadLS('pos2_held_orders', []).filter(h => h.id !== id)
  saveLS('pos2_held_orders', arr)
}

// ===== Shifts 班別 =====
export async function loadShifts() {
  if (isElectron) return window.electronAPI.db.getShifts()
  return loadLS('pos2_shifts', [])
}
export async function getOpenShift() {
  if (isElectron) return window.electronAPI.db.getOpenShift()
  const all = loadLS('pos2_shifts', [])
  return all.find(s => s.status === 'open') || null
}
export async function openShift(data) {
  if (isElectron) return window.electronAPI.db.openShift(data)
  const arr = loadLS('pos2_shifts', [])
  arr.unshift({ ...data, status: 'open' })
  saveLS('pos2_shifts', arr)
  return { success: true, id: data.id }
}
export async function closeShift(id, data) {
  if (isElectron) return window.electronAPI.db.closeShift(id, data)
  const arr = loadLS('pos2_shifts', [])
  const idx = arr.findIndex(s => s.id === id)
  if (idx >= 0) arr[idx] = { ...arr[idx], ...data, status: 'closed' }
  saveLS('pos2_shifts', arr)
  return { success: true }
}
export async function loadCashLog(shiftId) {
  if (isElectron) return window.electronAPI.db.getCashLog(shiftId)
  return loadLS('pos2_cash_log', []).filter(c => !shiftId || c.shiftId === shiftId)
}
export async function addCashLog(data) {
  if (isElectron) return window.electronAPI.db.addCashLog(data)
  const arr = loadLS('pos2_cash_log', [])
  arr.unshift(data); saveLS('pos2_cash_log', arr)
}

// ===== Waste 損耗 =====
export async function loadWasteLog() {
  if (isElectron) return window.electronAPI.db.getWasteLog()
  return loadLS('pos2_waste', [])
}
export async function addWaste(data) {
  if (isElectron) return window.electronAPI.db.addWaste(data)
  const arr = loadLS('pos2_waste', [])
  arr.unshift(data); saveLS('pos2_waste', arr)
}
export async function deleteWaste(id) {
  if (isElectron) return window.electronAPI.db.deleteWaste(id)
  const arr = loadLS('pos2_waste', []).filter(w => w.id !== id)
  saveLS('pos2_waste', arr)
}

// ===== Topups 會員儲值 =====
export async function loadTopups(memberId) {
  if (isElectron) return window.electronAPI.db.getTopups(memberId)
  const all = loadLS('pos2_topups', [])
  return memberId ? all.filter(t => t.memberId === memberId) : all
}
export async function addTopup(data) {
  if (isElectron) return window.electronAPI.db.addTopup(data)
  const arr = loadLS('pos2_topups', [])
  arr.unshift(data); saveLS('pos2_topups', arr)
}
