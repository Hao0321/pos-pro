import {RECEIPT_REVIEW_KIND,RECEIPT_REVIEW_SETTING} from '../../electron/receiptReview.mjs'
import {appendBrowserWarehouse} from '../../electron/browserWarehouse.mjs'
import {appendBrowserPurchaseUnits} from '../../electron/browserPurchaseUnits.mjs'
import {PURCHASE_UNITS_KIND,PURCHASE_UNITS_SETTING} from '../../electron/purchaseUnitPricing.mjs'
import {appendBrowserLots} from '../../electron/browserLots.mjs'
import {appendBrowserStockSetup} from '../../electron/browserStockSetup.mjs'
import {stockSetupBrowserEnabled} from './stockSetupAvailability.mjs'
// One atomic record replaces coordinated writes to separate localStorage keys.
// Legacy keys remain intact for recovery; reads use this record after migration.
import {validateRestaurantRecords,readRestaurantConfig} from '../../electron/restaurantRules.mjs'
import {validateProcurementRecords} from '../../electron/procurementRules.mjs'
import {validateExchangeSettings,readExchangeTextSetting,readExchangeStore,EXCHANGE_SETTING} from '../../electron/businessExchange.mjs'
import {validateSalesRecords} from '../../electron/salesPlan.mjs'
import {validateCustomerLedgerRecords} from '../../electron/customerLedger.mjs'
import {validateSupplierLedgerRecords} from '../../electron/supplierLedger.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {signature as checkoutSignature} from '../../electron/checkoutSignature.mjs'
import {refundSignature} from './refundSafety.mjs'
import {RECOVERY_PROTOCOL,browserToBook,bookToBrowser,materialSignature,protectedRestoreBook,operationRecords,recoveryStoreId,recoveryOperationId,originalMatches} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {guardUnintegratedStockWrite} from '../../electron/stockBrowserGuard.mjs'
import {STOCK_COMPAT_SETTING} from '../../electron/stockCompatibility.mjs'
import {browserProtectionGraph,browserProtectionMetadata,browserProtectionRevision,validateBrowserProtection} from './browserProtection'
import {mergeRecoveryGraphs} from '../../electron/recoveryGraph.mjs'
import {retainRecoveryFeatures,recoveryFeatureFloor} from '../../electron/recoveryBook.mjs'
import {usesPrivateQuickDrafts} from '../../electron/privateDrafts.mjs'
import {appendPhysicalStocktakeBook} from '../../electron/physicalStocktakeCommit.mjs'
import {appendBrowserStockBusiness} from '../../electron/browserStockCommit.mjs'
import {STOCK_BOOK_HEAD} from '../../electron/stockBookAnchor.mjs'
import {validateSettingRows,updateBrowserSettings} from '../../electron/settingEncoding.mjs'
import {usesRestaurantIntake} from '../../electron/tableOrdering.mjs'
import {usesKitchenPrinting,validateKitchenRecords,appendKitchenRestaurant,planKitchenAction} from '../../electron/kitchenPrint.mjs'
import {usesRestaurantFunds} from '../../electron/restaurantFunds.mjs'
import {usesRestaurantMenu,RESTAURANT_MENU_CONFIG_KEY} from '../../electron/restaurantMenuOriginal.mjs'
import {usesRestaurantPublicMenu} from '../../electron/restaurantCustomerMenu.mjs'
export const RECORD_KEY = 'pos_atomic_records_v1'
export const DATA_KEYS = ['pos2_products','pos2_members','pos2_orders','pos2_manual_j',
  'pos_users','pos_suppliers','pos_purchases','pos_promotions','pos2_held_orders',
  'pos2_shifts','pos2_cash_log','pos2_waste','pos2_topups','pos_audit_log','pos_business_settings','pos_restaurant_orders','pos_restaurant_operations','pos_sales_documents','pos_sales_operations','pos_customer_entries','pos_customer_operations','pos_supplier_entries','pos_supplier_operations','pos_stock_cost_entries','pos_stock_cost_operations','pos_kitchen_print_jobs','pos_kitchen_print_operations']
const optionalKitchen=new Set(['pos_kitchen_print_jobs','pos_kitchen_print_operations'])
const keys = new Set(DATA_KEYS)
const SETTINGS_PREFIX='pos_settings_'
const legacySettings=['pointsEarnRate','pointsRedeemRate','birthdayBonus','dailySalesGoal','storeName','storePhone','storeAddress','receiptFooter','serverPort']
function readLegacySettings(){return legacySettings.flatMap(key=>{const value=nativeStorage().getItem(SETTINGS_PREFIX+key);return value===null?[]:[{key,value}]})}
function nativeStorage() { return globalThis.localStorage }
function validArray(value) {
  if (!Array.isArray(value)) throw new Error('資料格式錯誤，已保留原始紀錄，請先備份。')
  return value
}
export function readRecords() {
  const raw = nativeStorage().getItem(RECORD_KEY)
  if (raw != null) {
    const record = JSON.parse(raw)
    if (record?.version !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1 || !record.data)
      throw new Error('本機資料紀錄損壞，請保留資料並還原備份。')
    if(record.salesEpoch!==undefined&&(typeof record.salesEpoch!=='string'||!record.salesEpoch))throw new Error('銷售還原識別損壞，請保留原資料核對。')
    if(record.supplierFence!==undefined&&typeof record.supplierFence!=='boolean')throw Error('供應商資料版本保護損壞，請保留原資料核對')
    // New collections may be absent in records written by earlier versions.
    if(!Object.hasOwn(record.data,'pos_business_settings'))record.data.pos_business_settings=readLegacySettings()
    if(Object.hasOwn(record.data,'pos_stock_cost_entries')!==Object.hasOwn(record.data,'pos_stock_cost_operations'))throw Error('庫存成本回執需要核對，請保留原編號與資料')
    if(!Object.hasOwn(record.data,'pos_stock_cost_entries')&&record.data.pos_business_settings.some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))throw Error('庫存成本回執需要核對，請保留原編號與資料')
    for(const key of ['pos_restaurant_orders','pos_restaurant_operations','pos_sales_documents','pos_sales_operations','pos_customer_entries','pos_customer_operations','pos_supplier_entries','pos_supplier_operations','pos_stock_cost_entries','pos_stock_cost_operations'])if(!Object.hasOwn(record.data,key))record.data[key]=[]
    if(Object.hasOwn(record.data,'pos_kitchen_print_jobs')!==Object.hasOwn(record.data,'pos_kitchen_print_operations')||record.recovery?.version===5&&!Object.hasOwn(record.data,'pos_kitchen_print_jobs'))throw Error('廚房列印紀錄需要核對，請保留原單')
    for (const key of DATA_KEYS) if(!optionalKitchen.has(key)||Object.hasOwn(record.data,key))validArray(record.data[key])
    if(Object.keys(record.data).some(key=>!keys.has(key)))throw Error('備份含有目前版本不支援的資料，請保留原檔並使用相容版本')
    recoveryMetadata(record)
    validateSettingRows(record.data.pos_business_settings,'browser')
    if(record.data.pos_business_settings.some(row=>row.encoding)&&![2,3,4,5,6,7,8,9].includes(record.recovery?.version))throw Error('復原保護索引損壞，請保留原資料核對')
    validateBrowserProtection(record)
    validateStockCostBook(browserToBook(record.data))
    const rawRestaurant=record.data.pos_business_settings.find(s=>s.key==='restaurantConfig')?.value,config=readRestaurantConfig(rawRestaurant==null?null:JSON.parse(rawRestaurant),record.data.pos2_products)
    if(usesRestaurantIntake(config,record.data.pos_restaurant_orders,record.data.pos2_orders)){
      if(![4,5,6,7,8,9].includes(record.recovery?.version))throw Error('復原保護索引損壞，請保留原資料核對')
    }
    const funded=usesRestaurantFunds(config,record.data.pos_restaurant_orders,record.data.pos2_orders)
    if(funded&&(![6,7,8,9].includes(record.recovery?.version)||!record.salesEpoch||!readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId')))throw Error('預訂款項缺少店面或復原識別，請保留原資料核對。')
    if(usesRestaurantPublicMenu(record.data.pos2_orders)&&![8,9].includes(record.recovery?.version))throw Error('顧客選餐原單需要核對，請保留原單。')
    if(usesPrivateQuickDrafts(record.data.pos_restaurant_operations,record.data.pos_audit_log)&&record.recovery?.version!==9)throw Error('備份含有目前版本不支援的資料，請保留原檔並使用相容版本')
    const menu=usesRestaurantMenu(config,record.data.pos_restaurant_orders,record.data.pos_restaurant_operations)
    if(menu&&![7,8,9].includes(record.recovery?.version))throw Error('餐點選項、菜單設定或原單來源不完整，請保留原單核對。')
    if(funded||menu||usesRestaurantIntake(config,record.data.pos_restaurant_orders,record.data.pos2_orders))validateRestaurantRecords(record.data.pos_restaurant_orders,record.data.pos_restaurant_operations,record.data.pos2_orders,record.data.pos2_products,{cashLogs:record.data.pos2_cash_log,waste:record.data.pos2_waste,storeId:readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),config,menuConfigurationId:readExchangeTextSetting(record.data.pos_business_settings,RESTAURANT_MENU_CONFIG_KEY),menuReceiptKey:readExchangeTextSetting(record.data.pos_business_settings,'orderReceiptSecret')})
    validateKitchenRecords(record.data.pos_kitchen_print_jobs||[],record.data.pos_kitchen_print_operations||[],{entries:record.data.pos_restaurant_orders,restaurantOperations:record.data.pos_restaurant_operations})
    if(usesKitchenPrinting(config,record.data.pos_kitchen_print_jobs,record.data.pos_kitchen_print_operations)&&!(record.recovery?.version>=5))throw Error('復原保護索引損壞，請保留原資料核對')
    return record
  }
  const data = {}
  if([...optionalKitchen].some(key=>nativeStorage().getItem(key)!==null))throw Error('廚房列印紀錄需要核對，請保留原單')
  for (const key of DATA_KEYS) {
    const old = nativeStorage().getItem(key)
    if(optionalKitchen.has(key)&&old===null)continue
    data[key] = old == null ? key==='pos_business_settings'?readLegacySettings():[] : validArray(JSON.parse(old))
  }
  if((nativeStorage().getItem('pos_stock_cost_entries')!==null)!==(nativeStorage().getItem('pos_stock_cost_operations')!==null))throw Error('庫存成本回執需要核對，請保留原編號與資料')
  if(nativeStorage().getItem('pos_stock_cost_entries')===null&&data.pos_business_settings.some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))throw Error('庫存成本回執需要核對，請保留原編號與資料')
  const legacyConfig=data.pos_business_settings.find(row=>row.key==='restaurantConfig')?.value
  if(usesRestaurantFunds(readRestaurantConfig(legacyConfig==null?null:JSON.parse(legacyConfig),data.pos2_products),data.pos_restaurant_orders,data.pos2_orders))throw Error('預訂款項缺少店面或復原識別，請保留原資料核對。')
  validateStockCostBook(browserToBook(data))
  return {version:1,revision:0,data}
}
export function recoveryMetadata(record=readRecords()){
  const value=record.recovery??{version:1,snapshots:[],originalIds:[],events:[]}
  if(![1,2,3,4,5,6,7,8,9].includes(value.version)||!Array.isArray(value.snapshots)||!Array.isArray(value.originalIds)||!Array.isArray(value.events)
    ||value.snapshots.some(s=>typeof s.id!=='string'||!s.data||typeof s.contentSignature!=='string'||typeof s.afterMaterial!=='string')
    ||value.originalIds.some(row=>!Array.isArray(row)||row.length!==3||row.some(v=>typeof v!=='string'))
    ||value.events.some(row=>typeof row.id!=='string'||typeof row.signature!=='string'||!row.receipt))throw Error('復原保護索引損壞，請保留原資料核對')
  return value
}
export function assertOriginalOperationAvailable(method,id,record=readRecords(),request=null){
  id=recoveryOperationId(id)
  if(!recoveryMetadata(record).originalIds.some(row=>row[0]===method&&row[1]===id))return
  const active=operationRecords(browserToBook(record.data)).find(row=>row.method===method&&row.id===id)
  if(active&&(!request||originalMatches(active,{method,id,request},{checkoutSignature,refundSignature})))return
  const error=new Error('原編號曾經保存，目前帳本無法確認這筆內容。請使用復原引導核對。')
  error.historyUncertain=true;throw error
}
export function writeRecords(updates, expectedRevision, {restore=false,ensureSalesEpoch=false,recoveryCommand=null,transfer=null,physicalStocktake=null,stockBusiness=null,stockSetup=null,kitchenPrint=null,warehouse=null,lots=null,purchaseUnits=null,receiptReview=null}={}) {
  if((purchaseUnits||receiptReview)&&(restore||physicalStocktake||stockBusiness||stockSetup||kitchenPrint||warehouse||lots||purchaseUnits&&receiptReview))throw Error('請一次保存一個原操作')
  if(lots&&(restore||kitchenPrint||stockSetup||stockBusiness||physicalStocktake||warehouse||Object.keys(updates).length))throw Error('請一次保存一個原操作')
  if(warehouse&&(restore||kitchenPrint||stockSetup||stockBusiness||physicalStocktake||Object.keys(updates).length))throw Error('請一次保存一個原操作')
  if(restore&&stockSetup||kitchenPrint&&(restore||stockSetup||stockBusiness||physicalStocktake||Object.keys(updates).length))throw Error('請一次保存一個原操作')
  const current = readRecords()
  if (expectedRevision != null && current.revision !== expectedRevision)
    throw new Error('本機資料已改變，請重新載入後再操作。')
  if(transfer?.expectedProtectionRevision&&transfer.expectedProtectionRevision!==browserProtectionRevision(current))throw Error('本機資料已改變，請重新載入後再操作。')
  if(transfer?.protection)mergeRecoveryGraphs(browserProtectionGraph(current),transfer.protection,'browser')
  for (const [key, value] of Object.entries(updates)) {
    if (!keys.has(key)) throw new Error('未知資料集合')
    validArray(value)
  }
  const next = {...current,version:1,revision:current.revision+1,data:{...current.data,...updates}}
  if(!restore){
    const before=browserToBook(current.data),after=browserToBook(next.data),oldFlag=before.settings.find(row=>row.key===STOCK_COMPAT_SETTING)||null,newFlag=after.settings.find(row=>row.key===STOCK_COMPAT_SETTING)||null
    if(canonicalSignature(oldFlag)!==canonicalSignature(newFlag))throw Error('成本資料的版本保護由完整備份流程管理')
    if(canonicalSignature(before.settings.find(row=>row.key==='warehouseVersionFence')||null)!==canonicalSignature(after.settings.find(row=>row.key==='warehouseVersionFence')||null))throw Error('成本資料的版本保護由完整備份流程管理')
    if(canonicalSignature(before.settings.find(row=>row.key==='stockLotVersionFence')||null)!==canonicalSignature(after.settings.find(row=>row.key==='stockLotVersionFence')||null))throw Error('成本資料的版本保護由完整備份流程管理')
    if(canonicalSignature(before.settings.find(row=>row.key==='stockLotCountVersionFence')||null)!==canonicalSignature(after.settings.find(row=>row.key==='stockLotCountVersionFence')||null))throw Error('成本資料的版本保護由完整備份流程管理')
    if(canonicalSignature(before.settings.find(row=>row.key==='stockSupplierLotReturnsVersionFence')||null)!==canonicalSignature(after.settings.find(row=>row.key==='stockSupplierLotReturnsVersionFence')||null))throw Error('成本資料的版本保護由完整備份流程管理')
    if(canonicalSignature(before.settings.find(row=>row.key==='stockReceiptLotsVersionFence')||null)!==canonicalSignature(after.settings.find(row=>row.key==='stockReceiptLotsVersionFence')||null))throw Error('成本資料的版本保護由完整備份流程管理')
    if(canonicalSignature(before.settings.find(row=>row.key===RECEIPT_REVIEW_SETTING)||null)!==canonicalSignature(after.settings.find(row=>row.key===RECEIPT_REVIEW_SETTING)||null)&&!(receiptReview||stockBusiness?.request?.kind===RECEIPT_REVIEW_KIND))throw Error('收貨核對的版本保護由正式收貨與完整備份流程管理')
    if(canonicalSignature(before.settings.find(row=>row.key===PURCHASE_UNITS_SETTING)||null)!==canonicalSignature(after.settings.find(row=>row.key===PURCHASE_UNITS_SETTING)||null)&&!(purchaseUnits||stockBusiness?.request?.kind===PURCHASE_UNITS_KIND))throw Error('包裝採購的版本保護由正式採購與完整備份流程管理')
    if(canonicalSignature(before.settings.find(row=>row.key===STOCK_BOOK_HEAD)||null)!==canonicalSignature(after.settings.find(row=>row.key===STOCK_BOOK_HEAD)||null))throw Error('成本帳的最後紀錄由正式交易或完整備份流程管理')
    const state=validateStockCostBook(before)
    if([physicalStocktake,stockBusiness,stockSetup].filter(Boolean).length>1)throw Error('請一次保存一個原操作')
    if(lots)next.data=bookToBrowser(appendBrowserLots(before,after,state,lots,{epoch:current.salesEpoch}))
    else if(warehouse)next.data=bookToBrowser(appendBrowserWarehouse(before,after,state,warehouse,{epoch:current.salesEpoch}))
    else if(stockSetup)next.data=bookToBrowser(appendBrowserStockSetup(before,after,state,stockSetup,{epoch:current.salesEpoch,stockSetupEnabled:stockSetupBrowserEnabled()}))
    else if(stockBusiness)next.data=bookToBrowser(appendBrowserStockBusiness(before,after,state,stockBusiness,{epoch:current.salesEpoch,supplierFence:current.supplierFence}))
    else if(purchaseUnits||receiptReview)next.data=bookToBrowser(appendBrowserPurchaseUnits(before,after,state,purchaseUnits||receiptReview,{epoch:current.salesEpoch,supplierFence:current.supplierFence}))
    else if(physicalStocktake)next.data=bookToBrowser(appendPhysicalStocktakeBook(before,after,state,physicalStocktake,{storeId:readExchangeTextSetting(before.settings,'sharedStoreId'),epoch:current.salesEpoch,costMode:state.projection?'active':'reference',restaurantEntries:before.restaurantOrders}))
    else guardUnintegratedStockWrite(before,after,state)
  }
  if(!restore){
    const readConfig=data=>{const raw=data.pos_business_settings.find(s=>s.key==='restaurantConfig')?.value;return readRestaurantConfig(raw==null?null:JSON.parse(raw),data.pos2_products)},oldPolicy=readConfig(current.data).kitchenPrinting??null,newConfig=readConfig(next.data)
    if(canonicalSignature(oldPolicy)!==canonicalSignature(newConfig.kitchenPrinting??null))throw Error('請在店面電腦或配對手機確認印表機')
    const beforePrint={jobs:current.data.pos_kitchen_print_jobs||[],operations:current.data.pos_kitchen_print_operations||[]},data={entries:next.data.pos_restaurant_orders,restaurantOperations:next.data.pos_restaurant_operations},known=new Set(current.data.pos_restaurant_operations.map(o=>o.id)),newRestaurantOperations=data.restaurantOperations.filter(o=>!known.has(o.id))
    let print=beforePrint;const epoch=current.salesEpoch||crypto.randomUUID()
    for(const op of newRestaurantOperations)print=appendKitchenRestaurant(print,data,JSON.parse(op.signature),op.actor,epoch,newConfig.kitchenPrinting?.enabled===true).state
    if(kitchenPrint)print=planKitchenAction(kitchenPrint.request,print,data,kitchenPrint.actor,{epoch,session:'',activeAttempts:[]}).state
    if(usesKitchenPrinting(newConfig,print.jobs,print.operations)||Object.hasOwn(current.data,'pos_kitchen_print_jobs')){next.data.pos_kitchen_print_jobs=print.jobs;next.data.pos_kitchen_print_operations=print.operations;next.salesEpoch=epoch}
  }
  if(!restore&&current.supplierFence&&updates.pos_purchases){
    const oldLegacy=current.data.pos_purchases.filter(po=>!po.procurement),newLegacy=next.data.pos_purchases.filter(po=>!po.procurement)
    if(canonicalSignature(oldLegacy)!==canonicalSignature(newLegacy))throw Error('歷史進貨單保留原帳，請使用新採購的正式收貨與付款流程')
  }
  const protection=recoveryMetadata(current)
  if(current.recovery)next.recovery=protection
  if(restore){
    const before=browserToBook(current.data),target=retainRecoveryFeatures(protectedRestoreBook(before,browserToBook(next.data)),transfer?.features||[])
    next.data=bookToBrowser(target)
    const snapshotId='rescue-'+crypto.randomUUID(),snapshot={id:snapshotId,createdAt:new Date().toISOString(),actorId:recoveryCommand?.actorId||'local-owner',
      storeId:recoveryStoreId(before),data:current.data,contentSignature:canonicalSignature(current.data),afterMaterial:materialSignature(target),operationId:recoveryCommand?.id??null}
    const originalIds=operationRecords(before).map(row=>[row.method,row.id,snapshotId])
    const receipt=recoveryCommand?{protocol:RECOVERY_PROTOCOL,success:true,id:recoveryCommand.id,sourceId:snapshotId,revision:String(next.revision),storeId:recoveryStoreId(target),
      ...(recoveryCommand.restoredSourceId?{restoredSourceId:recoveryCommand.restoredSourceId,originalOperationId:recoveryCommand.originalOperationId}:{})}:null
    next.recovery={version:recoveryFeatureFloor(transfer?.features||[],protection.version),snapshots:[...protection.snapshots,snapshot],originalIds:[...protection.originalIds,...originalIds],
      events:[...protection.events,...(receipt?[{id:recoveryCommand.id,actorId:recoveryCommand.actorId,signature:recoveryCommand.signature,receipt}]:[])]}
    if(transfer?.protection)next.recovery=browserProtectionMetadata(mergeRecoveryGraphs(browserProtectionGraph(next),transfer.protection,'browser'))
  }else if(protection.originalIds.length){
    const existing=new Set(operationRecords(browserToBook(current.data)).map(row=>JSON.stringify([row.method,row.id])))
    const known=new Set(protection.originalIds.map(row=>JSON.stringify(row.slice(0,2))))
    for(const row of operationRecords(browserToBook(next.data))){const key=JSON.stringify([row.method,row.id]);if(!existing.has(key)&&known.has(key))assertOriginalOperationAvailable(row.method,row.id,current)}
  }
  // The restore fence is local runtime metadata, excluded from business backups.
  // Rotate it in the SAME atomic write as a restore, never as a later side effect.
  if(restore||ensureSalesEpoch||current.salesEpoch||next.data.pos_sales_documents.length||next.data.pos_customer_entries.length||next.data.pos_supplier_entries.length)
    next.salesEpoch=restore?crypto.randomUUID():current.salesEpoch||crypto.randomUUID()
  if(current.supplierFence||next.data.pos_supplier_entries.length||transfer?.features?.includes('supplier-ledger-v1'))next.supplierFence=true
  validateProcurementRecords(next.data.pos_purchases,next.data.pos2_cash_log)
  validateExchangeSettings(next.data.pos_business_settings,next.data.pos_purchases,next.data.pos_audit_log)
  validateSalesRecords(next.data.pos_sales_documents,next.data.pos_sales_operations,next.data.pos2_cash_log,readExchangeTextSetting(next.data.pos_business_settings,'sharedStoreId'),next.data.pos2_products,readExchangeStore(readExchangeTextSetting(next.data.pos_business_settings,EXCHANGE_SETTING)).quotes)
  validateCustomerLedgerRecords(next.data.pos_customer_entries,next.data.pos_customer_operations,{storeId:readExchangeTextSetting(next.data.pos_business_settings,'sharedStoreId'),documents:next.data.pos_sales_documents,salesOperations:next.data.pos_sales_operations,cashLogs:next.data.pos2_cash_log})
  validateSupplierLedgerRecords(next.data.pos_supplier_entries,next.data.pos_supplier_operations,{storeId:readExchangeTextSetting(next.data.pos_business_settings,'sharedStoreId'),suppliers:next.data.pos_suppliers,purchases:next.data.pos_purchases,inventoryAudits:next.data.pos_audit_log,cashLogs:next.data.pos2_cash_log,supplierFence:next.supplierFence})
  const rawConfig=next.data.pos_business_settings.find(s=>s.key==='restaurantConfig')?.value
  const restaurantConfig=readRestaurantConfig(rawConfig==null?null:JSON.parse(rawConfig),next.data.pos2_products)
  validateRestaurantRecords(next.data.pos_restaurant_orders,next.data.pos_restaurant_operations,next.data.pos2_orders,next.data.pos2_products,{cashLogs:next.data.pos2_cash_log,waste:next.data.pos2_waste,storeId:readExchangeTextSetting(next.data.pos_business_settings,'sharedStoreId'),config:restaurantConfig,menuConfigurationId:readExchangeTextSetting(next.data.pos_business_settings,RESTAURANT_MENU_CONFIG_KEY),menuReceiptKey:readExchangeTextSetting(next.data.pos_business_settings,'orderReceiptSecret')})
  if(usesRestaurantIntake(restaurantConfig,next.data.pos_restaurant_orders,next.data.pos2_orders))next.recovery={...recoveryMetadata(next),version:Math.max(4,recoveryMetadata(next).version)}
  if(usesRestaurantFunds(restaurantConfig,next.data.pos_restaurant_orders,next.data.pos2_orders)){
    if(!readExchangeTextSetting(next.data.pos_business_settings,'sharedStoreId'))throw Error('預訂款項缺少店面或復原識別，請保留原資料核對。')
    next.salesEpoch??=crypto.randomUUID()
    next.recovery={...recoveryMetadata(next),version:Math.max(6,recoveryMetadata(next).version)}
  }
  if(usesRestaurantMenu(restaurantConfig,next.data.pos_restaurant_orders,next.data.pos_restaurant_operations))next.recovery={...recoveryMetadata(next),version:Math.max(7,recoveryMetadata(next).version)}
  if(usesRestaurantPublicMenu(next.data.pos2_orders))next.recovery={...recoveryMetadata(next),version:Math.max(8,recoveryMetadata(next).version)}
  if(usesPrivateQuickDrafts(next.data.pos_restaurant_operations,next.data.pos_audit_log)){
    next.recovery={...recoveryMetadata(next),version:9}
    const settings=next.data.pos_business_settings
    next.data.pos_business_settings=settings.some(row=>row.key===STOCK_COMPAT_SETTING)?settings.map(row=>row.key===STOCK_COMPAT_SETTING?{...row,value:'1'}:row):[...settings,{key:STOCK_COMPAT_SETTING,value:'1'}]
  }
  validateKitchenRecords(next.data.pos_kitchen_print_jobs||[],next.data.pos_kitchen_print_operations||[],{entries:next.data.pos_restaurant_orders,restaurantOperations:next.data.pos_restaurant_operations})
  if(usesKitchenPrinting(restaurantConfig,next.data.pos_kitchen_print_jobs,next.data.pos_kitchen_print_operations)){
    next.recovery={...recoveryMetadata(next),version:Math.max(5,recoveryMetadata(next).version)}
    next.data.pos_kitchen_print_jobs??=[];next.data.pos_kitchen_print_operations??=[]
  }
  if(next.recovery?.version===5){next.data.pos_kitchen_print_jobs??=[];next.data.pos_kitchen_print_operations??=[]}
  validateStockCostBook(browserToBook(next.data))
  validateSettingRows(next.data.pos_business_settings,'browser')
  if(next.data.pos_business_settings.some(row=>row.encoding)&&![2,3,4,5,6,7,8,9].includes(next.recovery?.version))throw Error('復原保護索引損壞，請保留原資料核對')
  validateBrowserProtection(next)
  // setItem is atomic: quota/security failure keeps the previous complete record.
  nativeStorage().setItem(RECORD_KEY, JSON.stringify(next))
  return next
}
export function restoreRecords(data,expectedRevision,recoveryCommand=null,transfer=null){
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('備份格式錯誤')
  const updates=Object.fromEntries(DATA_KEYS.filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]]))
  const current=readRecords();for(const key of optionalKitchen)if(!Object.hasOwn(updates,key)&&Object.hasOwn(current.data,key))updates[key]=[]
  if(Object.hasOwn(data,'pos_stock_cost_entries')!==Object.hasOwn(data,'pos_stock_cost_operations'))throw Error('庫存成本回執需要核對，請保留原編號與資料')
  for(const key of ['pos_sales_documents','pos_sales_operations','pos_customer_entries','pos_customer_operations','pos_supplier_entries','pos_supplier_operations','pos_stock_cost_entries','pos_stock_cost_operations'])if(!Object.hasOwn(updates,key))updates[key]=[]
  return writeRecords(updates,expectedRevision,{restore:true,recoveryCommand,transfer})
}
export const browserStorage = {
  getItem(key) {if(key.startsWith(SETTINGS_PREFIX))return readRecords().data.pos_business_settings.find(s=>s.key===key.slice(SETTINGS_PREFIX.length))?.value??null;return keys.has(key) ? JSON.stringify(readRecords().data[key]) : nativeStorage().getItem(key) },
  setItem(key, value) {if(key.startsWith(SETTINGS_PREFIX)){writeBusinessSettings({[key.slice(SETTINGS_PREFIX.length)]:value});return}if (keys.has(key)) writeRecords({[key]:validArray(JSON.parse(value))}); else nativeStorage().setItem(key,value) },
  removeItem(key) {if(key.startsWith(SETTINGS_PREFIX)){writeRecords({pos_business_settings:readRecords().data.pos_business_settings.filter(s=>s.key!==key.slice(SETTINGS_PREFIX.length))});return}if (keys.has(key)) writeRecords({[key]:[]}); else nativeStorage().removeItem(key) },
}
export function writeBusinessSettings(values){
 const current=readRecords()
 return writeRecords({pos_business_settings:updateBrowserSettings(current.data.pos_business_settings,values)},current.revision)
}
export async function withSalesLock(action) {
  if (!globalThis.navigator?.locks?.request)
    throw new Error('此瀏覽器缺少安全交易鎖。請使用新版瀏覽器的 HTTPS／localhost，或桌面版。')
  return navigator.locks.request('pos-sales-write-v1', action)
}
export function acquireBrowserEditor() {
  if (!globalThis.navigator?.locks?.request) return Promise.reject(new Error('瀏覽器缺少交易鎖，請使用新版瀏覽器的 HTTPS／localhost 或桌面版。'))
  return new Promise((resolve,reject)=>{
    navigator.locks.request('pos-editor-v1',{ifAvailable:true},lock=>{
      if (!lock) {reject(new Error('另一個 POS 分頁正在操作。請先關閉該分頁，再重新載入。'));return}
      return new Promise(release=>resolve(release))
    }).catch(reject)
  })
}
