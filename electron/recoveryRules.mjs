import {canonicalSignature} from './operationRules.mjs'
import {readExchangeTextSetting,EXCHANGE_ACTION} from './businessExchange.mjs'
import {INVENTORY_ACTION} from './inventoryOperations.mjs'

export const RECOVERY_PROTOCOL='pos-recovery-v1'
const materialAudit=new Set([INVENTORY_ACTION,EXCHANGE_ACTION,'SCENARIO_TEMPLATE_APPLY'])
export const isMaterialAudit=row=>materialAudit.has(row.action)
// Customer tracking identity belongs to its restored order records. Login and
// integration credentials remain current; a tracking key is not an owner login.
export const isCredentialSetting=key=>key!=='orderTrackingSecret'&&/shared|supabase|cloud|token|secret|password|credential|api.?key/i.test(key)
export const recoveryStoreId=book=>readExchangeTextSetting(book.settings||[],'sharedStoreId')||''
const sorted=rows=>[...rows].sort((a,b)=>String(a.id??a.key).localeCompare(String(b.id??b.key)))
export const BROWSER_COLLECTIONS={products:'pos2_products',members:'pos2_members',orders:'pos2_orders',manualJournal:'pos2_manual_j',users:'pos_users',suppliers:'pos_suppliers',purchases:'pos_purchases',promotions:'pos_promotions',heldOrders:'pos2_held_orders',shifts:'pos2_shifts',cashLog:'pos2_cash_log',wasteLog:'pos2_waste',memberTopups:'pos2_topups',auditLog:'pos_audit_log',settings:'pos_business_settings',restaurantOrders:'pos_restaurant_orders',restaurantOperations:'pos_restaurant_operations',salesDocuments:'pos_sales_documents',salesOperations:'pos_sales_operations',customerEntries:'pos_customer_entries',customerOperations:'pos_customer_operations',supplierEntries:'pos_supplier_entries',supplierOperations:'pos_supplier_operations'}
export const browserToBook=data=>Object.fromEntries(Object.entries(BROWSER_COLLECTIONS).map(([key,local])=>[key,data[local]??[]]))
export const bookToBrowser=book=>Object.fromEntries(Object.entries(BROWSER_COLLECTIONS).map(([key,local])=>[local,book[key]??[]]))
export const recoveryOperationId=id=>typeof id==='number'&&Number.isSafeInteger(id)?String(id):id

// Login/export audit traffic cannot hide a new sale, changed price or stock count.
// Credentials are preserved separately and never rolled back with the business.
export function materialSignature(book){
  const copy={}
  for(const [key,rows] of Object.entries(book)){
    if(key==='_revision'||key==='users')continue
    if(!Array.isArray(rows))throw Error('備份資料集合格式錯誤：'+key)
    copy[key]=sorted(key==='auditLog'?rows.filter(isMaterialAudit):key==='settings'?rows.filter(s=>!isCredentialSetting(s.key)):rows)
  }
  return canonicalSignature(copy)
}

export function protectedRestoreBook(current,source){
  if(!source||typeof source!=='object'||Array.isArray(source))throw Error('備份格式錯誤')
  if(Object.keys(source).some(key=>key!=='_revision'&&!Object.hasOwn(current,key)))throw Error('備份含有目前版本不支援的資料，請保留原檔並使用相容版本')
  if(Object.hasOwn(source,'users')&&(!Array.isArray(source.users)||current.users.length&&!source.users.some(user=>user.role==='owner')))throw Error('備份必須保留管理員帳號')
  const currentId=recoveryStoreId(current),sourceId=recoveryStoreId(source)
  const blank=Object.entries(current).every(([key,rows])=>key==='_revision'||key==='users'||key==='settings'||key==='auditLog'&&!rows.some(isMaterialAudit)||Array.isArray(rows)&&rows.length===0)
  const switching=currentId&&sourceId&&currentId!==sourceId
  if(switching&&!blank)throw Error('備份屬於另一間店，請回到原店面核對')
  const next={}
  for(const key of Object.keys(current).filter(k=>k!=='_revision')){
    const rows=source[key]??[]
    if(!Array.isArray(rows))throw Error('備份資料集合格式錯誤：'+key)
    next[key]=structuredClone(rows)
  }
  if(current.users.length)next.users=structuredClone(current.users)
  if(next.settings.some(row=>typeof row.key!=='string'||!row.key||typeof row.value!=='string')||new Set(next.settings.map(row=>row.key)).size!==next.settings.length)throw Error('備份設定格式不正確')
  const settings=new Map(next.settings.map(row=>[row.key,row]))
  for(const row of current.settings.filter(row=>isCredentialSetting(row.key)&&!(sourceId&&(!currentId||switching)&&row.key==='sharedStoreId')))settings.set(row.key,structuredClone(row))
  next.settings=[...settings.values()]
  const audit=new Map(next.auditLog.map(row=>[row.id,row]))
  for(const row of current.auditLog.filter(row=>!isMaterialAudit(row)))audit.set(row.id,row)
  next.auditLog=[...audit.values()]
  for(const rows of Object.values(next))rows.sort((a,b)=>String(a.id??a.key).localeCompare(String(b.id??b.key)))
  return next
}

export function recoverySummary(book){
  return {products:book.products.length,orders:book.orders.length,salesDocuments:book.salesDocuments.length,
    salesPayments:book.salesDocuments.reduce((n,d)=>n+(d.payments?.length||0),0),cashLogs:book.cashLog.length,
    purchases:book.purchases.length,members:book.members.length,customerEntries:(book.customerEntries||[]).length,customerReceipts:(book.customerEntries||[]).filter(e=>e.action==='receive').length,supplierEntries:(book.supplierEntries||[]).length,supplierPayments:(book.supplierEntries||[]).filter(e=>e.action==='pay').length}
}

export function operationRecords(book){
  const rows=[],add=(method,id,receipt)=>{id=recoveryOperationId(id);if(typeof id!=='string'||!id)throw Error('原始異動紀錄需要核對');rows.push({method,id,receipt})}
  for(const order of book.orders){add(order.refundOf?'refundOrder':'checkout',order.id,order)}
  for(const [key,method] of [['memberTopups','addTopup'],['cashLog','addCashLog'],['wasteLog','addWaste'],['manualJournal','addManualEntry'],['purchases','addPurchase']])
    for(const row of book[key])add(method,row.id,row)
  for(const row of book.shifts){add('openShift',row.id,row);if(row.status==='closed')add('closeShift',row.id,row)}
  for(const [key,method] of [['restaurantOperations','applyRestaurantOperation'],['salesOperations','applySalesOperation'],['customerOperations','applyCustomerLedgerOperation'],['supplierOperations','applySupplierLedgerOperation']])
    for(const row of book[key]||[])if(!(key==='supplierOperations'&&row.internal))add(method,row.id,row)
  for(const row of book.auditLog){
    if(!isMaterialAudit(row))continue
    const receipt=typeof row.detail==='string'?JSON.parse(row.detail):row.detail
    const method=row.action===INVENTORY_ACTION?'applyInventoryOperation':row.action===EXCHANGE_ACTION?'applyExchangeOperation':'applyScenarioTemplate'
    add(method,method==='applyScenarioTemplate'?receipt.operationId:receipt.id,receipt)
  }
  return rows
}

export function pendingOperation(pending){
  if(!pending||JSON.stringify(pending).length>1024*1024)throw Error('待確認異動紀錄需要核對')
  const request=pending.kind==='checkout'?pending.plan?.order:pending.request
  const method=({checkout:'checkout',refund:'refundOrder',topup:'addTopup',cashlog:'addCashLog',waste:'addWaste',restaurant:'applyRestaurantOperation',exchange:'applyExchangeOperation',sales:'applySalesOperation','customer-ledger':'applyCustomerLedgerOperation','supplier-ledger':'applySupplierLedgerOperation'})[pending.kind]
    ||(['stocktake','receive'].includes(pending.kind)||pending.kind?.startsWith('purchase-')?'applyInventoryOperation':null)
  if(!method||typeof request?.id!=='string'||!request.id||request.id.length>128)throw Error('待確認異動紀錄需要核對')
  return {method,id:request.id,request}
}

export function originalMatches(record,operation,{checkoutSignature,refundSignature}={}){
  if(record.method!==operation.method||record.id!==operation.id)return false
  const row=record.receipt,request=operation.request
  if(record.method.startsWith('apply'))return row.signature===canonicalSignature(request)
  if(record.method==='checkout')return typeof checkoutSignature==='function'&&(row.requestSignature||checkoutSignature(row))===checkoutSignature(request)
  if(record.method==='refundOrder')return typeof refundSignature==='function'&&row.requestSignature===refundSignature(request)
  const fields=({addTopup:['memberId','amount','bonus','payMethod','time','cashier','note','shiftId'],addCashLog:['shiftId','time','type','amount','reason','cashier'],addWaste:['productId','qty','reason','time','cashier','shiftId']})[record.method]
  return !!fields&&fields.every(key=>(row[key]??'')===(request[key]??''))
}
