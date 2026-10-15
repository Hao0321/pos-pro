import './sharedBridge'
import { browserStorage, writeRecords, readRecords, withSalesLock,writeBusinessSettings } from './browserStorage'
import { commitBrowserSale, browserReceipt, commitBrowserRefund } from './browserSales'
import { summarizeShift } from '../../electron/shiftReconciliation.mjs'
import {moneyValue,quantityValue,operationHeader,sameCommand} from '../../electron/operationRules.mjs'
import {commitBrowserInventory} from './browserInventory'
import {commitBrowserRestaurant,browserRestaurantState} from './browserRestaurant'
import {makeAgentContext} from '../../electron/agentDraftRules.mjs'
import {readAgentMappings,mergeAgentMappings} from '../../electron/businessDocument.mjs'
// 資料存取抽象層 — 自動判斷 Electron (SQLite) 或 瀏覽器 (localStorage)
export const isElectron = !!(typeof window !== 'undefined' && window.electronAPI)
export const isSharedStore = !!(typeof window !== 'undefined' && window.electronAPI?.sharedStore)
export async function applyInventoryOperation(request,actor){return isElectron?window.electronAPI.db.applyInventoryOperation(request):commitBrowserInventory(request,actor)}
export async function loadRestaurantState(){return isElectron?window.electronAPI.db.getRestaurantState():browserRestaurantState()}
export async function applyRestaurantOperation(request,actor){return isElectron?window.electronAPI.db.applyRestaurantOperation(request):commitBrowserRestaurant(request,actor)}
export async function getAgentContext(actor){
  if(isElectron)return window.electronAPI.db.getAgentContext()
  if(!actor||!['owner','staff'].includes(actor.role))throw Error('請先登入')
  let storeId=await getSetting('sharedStoreId');if(!storeId){storeId=crypto.randomUUID();await setSetting('sharedStoreId',storeId)}
  return makeAgentContext({storeId,products:await loadProducts([]),suppliers:actor.role==='owner'?await loadSuppliers([]):[],restaurantConfig:browserRestaurantState().config,role:actor.role,mappings:readAgentMappings(await getSetting('agentMappings'))})
}
export async function rememberAgentMappings(input,actor){
  if(isElectron)return window.electronAPI.db.rememberAgentMappings(input)
  return withSalesLock(()=>{const data=readRecords().data,raw=data.pos_business_settings.find(r=>r.key==='agentMappings')?.value;const mappings=mergeAgentMappings(raw==null?null:JSON.parse(raw),input,data.pos2_products,actor);writeBusinessSettings({agentMappings:JSON.stringify(mappings)});return {success:true,mappings}})
}

function loadLS(key, fallback) { const value=browserStorage.getItem(key);return value==null?fallback:JSON.parse(value) }

function saveLS(key, value) { browserStorage.setItem(key, JSON.stringify(value)) }

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
  return commitBrowserSale(orderData)
}
export async function lookupCheckout(id) {
  if (isElectron) return window.electronAPI.db.checkoutReceipt(id)
  return browserReceipt(id)
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
  if(String(entry.id||'').startsWith('stock-operation:')||entry.action==='INVENTORY_OPERATION'||String(entry.id||'').startsWith('scenario-template:')||entry.action==='SCENARIO_TEMPLATE_APPLY')throw Error('交易回執只能由正式异動流程建立')
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
export async function setSettings(values){if(isElectron)return window.electronAPI.settings.setMany(values);writeBusinessSettings(Object.fromEntries(Object.entries(values).map(([k,v])=>[k,JSON.stringify(v)])));return {success:true}}
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
      users: [], // Accounts are preserved by the dedicated bootstrap
      suppliers: loadLS('pos_suppliers', []),
      purchases: loadLS('pos_purchases', []),
      promotions: loadLS('pos_promotions', []),
      heldOrders:loadLS('pos2_held_orders',[]),shifts:loadLS('pos2_shifts',[]),cashLog:loadLS('pos2_cash_log',[]),
      wasteLog:loadLS('pos2_waste',[]),memberTopups:loadLS('pos2_topups',[]),auditLog:loadLS('pos_audit_log',[]),
      settings:loadLS('pos_business_settings',[]).map(s=>({key:s.key,value:String(JSON.parse(s.value))})),
    }

    const hasData = Object.values(data).some(arr => arr && arr.length > 0)
    if (!hasData) return false

    await window.electronAPI.db.migrateFromLocalStorage(data)
    return true
  } catch(error) { throw new Error('舊資料匯入未完成，請保留原始資料：'+error.message) }
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
  return commitBrowserRefund(refundData)
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
  if(typeof data.openCash!=='number'||!Number.isFinite(data.openCash)||data.openCash<0||data.openCash>1e9)throw new Error('開班現金不正確')
  const arr = loadLS('pos2_shifts', [])
  if(arr.some(s=>s.status==='open'))throw new Error('已有開啟中的班別')
  arr.unshift({ ...data, status: 'open' })
  saveLS('pos2_shifts', arr)
  return { success: true, id: data.id }
}
export async function closeShift(id, data) {
  if (isElectron) return window.electronAPI.db.closeShift(id, data)
  if(typeof data.closeCash!=='number'||!Number.isFinite(data.closeCash)||data.closeCash<0||data.closeCash>1e9)throw new Error('交班現金不正確')
  return withSalesLock(()=>{
    const current=readRecords(),arr=current.data.pos2_shifts,shift=arr.find(s=>s.id===id)
    if(!shift)throw new Error('班別不存在')
    if(shift.status==='closed'){
      if(shift.closeCash!==data.closeCash || shift.note!==(data.note||''))throw new Error('已交班內容不同，請核對原交班紀錄')
      return {success:true,expected:shift.expectedCash,diff:shift.diff}
    }
    if(shift.status!=='open')throw new Error('班別狀態需要核對')
    const stats=summarizeShift(shift,current.data.pos2_orders,current.data.pos2_cash_log,current.data.pos2_topups)
    const closed={...shift,status:'closed',closeTime:new Date().toISOString(),closeCash:data.closeCash,note:data.note||'',expectedCash:stats.expected,diff:Math.round((data.closeCash-stats.expected)*100)/100,cashSales:stats.cash,cardSales:stats.card,orderCount:stats.orderCount,refundCount:stats.refundCount,refundAmount:stats.refundAmt}
    writeRecords({pos2_shifts:arr.map(s=>s.id===id?closed:s)},current.revision)
    return {success:true,expected:closed.expectedCash,diff:closed.diff}
  })
}
export async function loadCashLog(shiftId) {
  if (isElectron) return window.electronAPI.db.getCashLog(shiftId)
  return loadLS('pos2_cash_log', []).filter(c => !shiftId || c.shiftId === shiftId)
}
export async function addCashLog(data) {
  if (isElectron) return window.electronAPI.db.addCashLog(data)
  return withSalesLock(()=>{
    try{
      operationHeader(data);const current=readRecords(),records=current.data,old=records.pos2_cash_log.find(l=>l.id===data.id)
      if(old){if(!sameCommand(old,data,['shiftId','time','type','amount','reason','cashier']))throw Error('現金流水編號內容不一致');return {success:true,cashLog:old}}
      moneyValue(data.amount,'現金流水',.01)
      if(!['in','out'].includes(data.type)||records.pos2_shifts.find(s=>s.id===data.shiftId)?.status!=='open')throw Error('現金異動或班別不正確')
      writeRecords({pos2_cash_log:[data,...records.pos2_cash_log]},current.revision)
      return {success:true,cashLog:data}
    }catch(error){return {success:false,committed:false,error:error.message}}
  })
}

// ===== Waste 損耗 =====
export async function loadWasteLog() {
  if (isElectron) return window.electronAPI.db.getWasteLog()
  return loadLS('pos2_waste', [])
}
export async function addWaste(data) {
  if (isElectron) return window.electronAPI.db.addWaste(data)
  return withSalesLock(()=>{
    try{
    const current=readRecords(),records=current.data,p=records.pos2_products.find(p=>p.id===data.productId)
    operationHeader(data);const old=records.pos2_waste.find(w=>w.id===data.id)
    if(old){if(!sameCommand(old,data,['productId','qty','reason','time','cashier']))throw Error('損耗編號內容不一致');return {success:true,waste:old,product:p||null}}
    quantityValue(data.qty,'損耗數量',.001)
    if(!p||data.qty>p.stock)throw new Error('損耗商品或數量不正確')
    const product={...p,stock:p.stock-data.qty},waste={...data,productName:p.name,cost:p.cost||0}
    writeRecords({pos2_waste:[waste,...records.pos2_waste],pos2_products:records.pos2_products.map(x=>x.id===p.id?product:x)},current.revision)
    return {success:true,product,waste}
    }catch(error){return {success:false,committed:false,error:error.message}}
  })
}
export async function deleteWaste(id) {
  throw Error('損耗已扣庫並入帳，紀錄須保留；請用盤點與會計更正，不能直接刪除')
}

// ===== Topups 會員儲值 =====
export async function loadTopups(memberId) {
  if (isElectron) return window.electronAPI.db.getTopups(memberId)
  const all = loadLS('pos2_topups', [])
  return memberId ? all.filter(t => t.memberId === memberId) : all
}
export async function addTopup(data) {
  if (isElectron) return window.electronAPI.db.addTopup(data)
  return withSalesLock(()=>{
    try {
      const current=readRecords(),records=current.data,old=records.pos2_topups.find(t=>t.id===data.id)
      const member=records.pos2_members.find(m=>m.id===data.memberId)
      if (old) {
        if(!sameCommand(old,data,['memberId','amount','bonus','payMethod','time','cashier','note','shiftId']))throw new Error('儲值單號內容不一致')
        return {success:true,member:member||null,topup:old}
      }
      operationHeader(data);moneyValue(data.amount,'儲值金額',.01);moneyValue(data.bonus,'贈額')
      if(!member)throw Error('會員不存在')
      if(!['cash','card'].includes(data.payMethod))throw Error('儲值付款方式不正確')
      if(records.pos2_shifts.find(s=>s.id===data.shiftId)?.status!=='open')throw Error('請先開班再收取儲值款項')
      moneyValue((member.balance||0)+data.amount+data.bonus,'儲值餘額')
      const next={...member,balance:Math.round(((member.balance||0)+data.amount+data.bonus)*100)/100}
      writeRecords({pos2_topups:[data,...records.pos2_topups],pos2_members:records.pos2_members.map(m=>m.id===next.id?next:m)},current.revision)
      return {success:true,member:next,topup:data}
    }catch(error){return {success:false,committed:false,error:error.message}}
  })
}
