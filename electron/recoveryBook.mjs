import {readMasterMigrationHistory as requireMasterHistory} from './masterMigration.mjs'
import {RECEIPT_REVIEW_FEATURE,RECEIPT_REVIEW_SETTING} from './receiptReview.mjs'
import {PURCHASE_UNITS_FEATURE,PURCHASE_UNITS_SETTING} from './purchaseUnitPricing.mjs'
import {BROWSER_COLLECTIONS,OPTIONAL_COLLECTIONS,browserToBook,materialSignature} from './recoveryRules.mjs'
import {validateStockCostBook} from './stockBackup.mjs'
import {replayStockLedger,stockLedgerDigest} from './stockLedgerModel.mjs'
import {STOCK_COMPAT_SETTING} from './stockCompatibility.mjs'
import {validateProcurementRecords} from './procurementRules.mjs'
import {validateExchangeSettings,readExchangeTextSetting,readExchangeStore,EXCHANGE_SETTING} from './businessExchange.mjs'
import {validateSalesRecords} from './salesPlan.mjs'
import {validateCustomerLedgerRecords} from './customerLedger.mjs'
import {validateSupplierLedgerRecords} from './supplierLedger.mjs'
import {validateRestaurantRecords,readRestaurantConfig} from './restaurantRules.mjs'
import {validateSettingRows,settingsForValidation} from './settingEncoding.mjs'
import {convertLogicalBook} from './storageConversion.mjs'
import {usesRestaurantIntake,RESTAURANT_INTAKE_FEATURE} from './tableOrdering.mjs'
import {usesKitchenPrinting,validateKitchenRecords,KITCHEN_PRINT_FEATURE} from './kitchenPrint.mjs'
import {usesRestaurantFunds,RESTAURANT_FUNDS_FEATURE} from './restaurantFunds.mjs'
import {usesRestaurantMenu,RESTAURANT_MENU_FEATURE,RESTAURANT_MENU_CONFIG_KEY} from './restaurantMenuOriginal.mjs'
import {usesRestaurantPublicMenu,RESTAURANT_PUBLIC_MENU_FEATURE} from './restaurantCustomerMenu.mjs'
import {usesPrivateQuickDrafts,PRIVATE_QUICK_FEATURE} from './privateDrafts.mjs'
import {WAREHOUSE_FEATURE,WAREHOUSE_SETTING} from './warehouseRules.mjs'

export const RECOVERY_FEATURES=['agent-master-migration-v1',RECEIPT_REVIEW_FEATURE,PURCHASE_UNITS_FEATURE,'stock-supplier-lot-returns-v1','stock-receipt-lots-v1','stock-lot-count-v1','stock-lots-v1',WAREHOUSE_FEATURE,PRIVATE_QUICK_FEATURE,RESTAURANT_PUBLIC_MENU_FEATURE,RESTAURANT_MENU_FEATURE,RESTAURANT_FUNDS_FEATURE,KITCHEN_PRINT_FEATURE,RESTAURANT_INTAKE_FEATURE,'record-shapes-v1','cross-storage-v1','customer-ledger-v1','stock-cost-v1','supplier-ledger-v1']
export const recoveryDataError=()=>Error('備份保護紀錄不完整或內容不同，請保留原檔核對')
export function recoveryFeatureFloor(features=[],minimum=1){
 if(![1,2,3,4,5,6,7,8,9,10].includes(minimum)||!Array.isArray(features)||features.some(feature=>!RECOVERY_FEATURES.includes(feature)))throw recoveryDataError()
 return Math.max(minimum,features.includes('agent-master-migration-v1')?10:features.includes(PRIVATE_QUICK_FEATURE)?9:features.includes(RESTAURANT_PUBLIC_MENU_FEATURE)?8:features.includes(RESTAURANT_MENU_FEATURE)?7:features.includes(RESTAURANT_FUNDS_FEATURE)?6:features.includes(KITCHEN_PRINT_FEATURE)?5:features.includes(RESTAURANT_INTAKE_FEATURE)?4:features.includes('record-shapes-v1')?3:features.includes('cross-storage-v1')?2:1)
}
export function retainRecoveryFeatures(book,features){
 const settings=new Map(book.settings.map(row=>[row.key,row]))
 if(features.includes('agent-master-migration-v1'))settings.set('agentMasterMigrationVersionFence',{key:'agentMasterMigrationVersionFence',value:'1'})
 if(features.includes(RECEIPT_REVIEW_FEATURE))settings.set(RECEIPT_REVIEW_SETTING,{key:RECEIPT_REVIEW_SETTING,value:'1'})
 if(features.includes(PURCHASE_UNITS_FEATURE))settings.set(PURCHASE_UNITS_SETTING,{key:PURCHASE_UNITS_SETTING,value:'1'})
 if(features.includes('stock-cost-v1'))settings.set(STOCK_COMPAT_SETTING,{key:STOCK_COMPAT_SETTING,value:'1'})
 if(features.includes('stock-supplier-lot-returns-v1'))settings.set('stockSupplierLotReturnsVersionFence',{key:'stockSupplierLotReturnsVersionFence',value:'1'})
 if(features.includes('stock-receipt-lots-v1'))settings.set('stockReceiptLotsVersionFence',{key:'stockReceiptLotsVersionFence',value:'1'})
 if(features.includes('stock-lot-count-v1'))settings.set('stockLotCountVersionFence',{key:'stockLotCountVersionFence',value:'1'})
 if(features.includes('stock-lots-v1'))settings.set('stockLotVersionFence',{key:'stockLotVersionFence',value:'1'})
 if(features.includes(WAREHOUSE_FEATURE))settings.set(WAREHOUSE_SETTING,{key:WAREHOUSE_SETTING,value:'1'})
 return {...book,settings:[...settings.values()]}
}
export function recoveryBook(data,storage,{complete=false,digest=stockLedgerDigest}={}){
 if(!data||typeof data!=='object'||Array.isArray(data)||!['sqlite','browser'].includes(storage))throw recoveryDataError()
 const names=storage==='sqlite'?Object.keys(BROWSER_COLLECTIONS):Object.values(BROWSER_COLLECTIONS),allowed=new Set([...names,...(storage==='sqlite'?['_revision']:[])])
 const optional=storage==='sqlite'?OPTIONAL_COLLECTIONS:OPTIONAL_COLLECTIONS.map(key=>BROWSER_COLLECTIONS[key])
 if(Object.keys(data).some(key=>!allowed.has(key))||complete&&names.some(key=>!optional.includes(key)&&!Object.hasOwn(data,key)))throw recoveryDataError()
 if(Object.hasOwn(data,optional[0])!==Object.hasOwn(data,optional[1]))throw recoveryDataError()
 if(Object.hasOwn(data,'_revision')&&typeof data._revision!=='string')throw recoveryDataError()
 const costKeys=storage==='sqlite'?['stockCostEntries','stockCostOperations']:['pos_stock_cost_entries','pos_stock_cost_operations']
 if(Object.hasOwn(data,costKeys[0])!==Object.hasOwn(data,costKeys[1])||costKeys.some(key=>Object.hasOwn(data,key)&&!Array.isArray(data[key])))throw Error('庫存成本回執需要核對，請保留原編號與資料')
 for(const key of names)if(Object.hasOwn(data,key)&&!Array.isArray(data[key]))throw recoveryDataError()
 const present=storage==='sqlite'?data:Object.fromEntries(Object.entries(BROWSER_COLLECTIONS).filter(([,local])=>Object.hasOwn(data,local)).map(([key,local])=>[key,data[local]]))
 const state=replayStockLedger(present.stockCostEntries||[],present.stockCostOperations||[],digest)
 validateStockCostBook(present,state)
 const book=storage==='sqlite'?Object.fromEntries(names.filter(key=>!optional.includes(key)||Object.hasOwn(data,key)).map(key=>[key,data[key]??[]])):browserToBook(data)
 validateSettingRows(book.settings,storage)
 const settings=settingsForValidation(book.settings,storage)
 const storeId=readExchangeTextSetting(settings,'sharedStoreId'),exchange=readExchangeStore(readExchangeTextSetting(settings,EXCHANGE_SETTING))
 validateProcurementRecords(book.purchases,book.cashLog);validateExchangeSettings(settings,book.purchases,book.auditLog)
 validateSalesRecords(book.salesDocuments,book.salesOperations,book.cashLog,storeId,book.products,exchange.quotes)
 validateCustomerLedgerRecords(book.customerEntries,book.customerOperations,{storeId,documents:book.salesDocuments,salesOperations:book.salesOperations,cashLogs:book.cashLog})
 validateSupplierLedgerRecords(book.supplierEntries,book.supplierOperations,{storeId,suppliers:book.suppliers,purchases:book.purchases,inventoryAudits:book.auditLog,cashLogs:book.cashLog})
 const restaurantConfig=settings.find(row=>row.key==='restaurantConfig')?.value
 const checkedRestaurantConfig=readRestaurantConfig(storage==='browser'&&restaurantConfig!=null?JSON.parse(restaurantConfig):restaurantConfig??null,book.products)
 validateRestaurantRecords(book.restaurantOrders,book.restaurantOperations,book.orders,book.products,{cashLogs:book.cashLog,waste:book.wasteLog,storeId,config:checkedRestaurantConfig,menuConfigurationId:readExchangeTextSetting(settings,RESTAURANT_MENU_CONFIG_KEY),menuReceiptKey:readExchangeTextSetting(settings,'orderReceiptSecret')})
 requireMasterHistory(book)
 const features=[]
 if(settings.some(row=>row.key==='agentMasterMigrationVersionFence'&&row.value==='1'))features.push('agent-master-migration-v1')
 if(settings.some(row=>row.key===RECEIPT_REVIEW_SETTING&&row.value==='1'))features.push(RECEIPT_REVIEW_FEATURE)
 if(book.purchases.some(po=>po.procurement?.version===2)||settings.some(row=>row.key===PURCHASE_UNITS_SETTING&&row.value==='1'))features.push(PURCHASE_UNITS_FEATURE)
 if(usesPrivateQuickDrafts(book.restaurantOperations,book.auditLog)){
  if(!settings.some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))throw recoveryDataError()
  features.push(PRIVATE_QUICK_FEATURE)
 }
 if(usesRestaurantPublicMenu(book.orders))features.push(RESTAURANT_PUBLIC_MENU_FEATURE)
 if(usesRestaurantMenu(checkedRestaurantConfig,book.restaurantOrders,book.restaurantOperations))features.push(RESTAURANT_MENU_FEATURE)
 if(usesRestaurantFunds(checkedRestaurantConfig,book.restaurantOrders,book.orders))features.push(RESTAURANT_FUNDS_FEATURE)
 validateKitchenRecords(book.kitchenPrintJobs||[],book.kitchenPrintOperations||[],{entries:book.restaurantOrders,restaurantOperations:book.restaurantOperations})
 if(usesKitchenPrinting(checkedRestaurantConfig,book.kitchenPrintJobs,book.kitchenPrintOperations)){if(!optional.every(key=>Object.hasOwn(data,key)))throw recoveryDataError();features.push(KITCHEN_PRINT_FEATURE)}
 if(usesRestaurantIntake(checkedRestaurantConfig,book.restaurantOrders,book.orders))features.push(RESTAURANT_INTAKE_FEATURE)
 if(book.settings.some(row=>Object.hasOwn(row,'encoding')||storage==='sqlite'&&Object.hasOwn(row,'id')))features.push('cross-storage-v1')
 if(book.customerEntries.length)features.push('customer-ledger-v1')
 if(state.projection||settings.some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))features.push('stock-cost-v1')
 if(state.projection?.warehousing||settings.some(row=>row.key===WAREHOUSE_SETTING&&row.value==='1'))features.push(WAREHOUSE_FEATURE)
 if(state.projection?.supplierLotReturnsVersion===1||settings.some(row=>row.key==='stockSupplierLotReturnsVersionFence'&&row.value==='1'))features.push('stock-supplier-lot-returns-v1')
 if(state.projection?.receiptLotsVersion===1||settings.some(row=>row.key==='stockReceiptLotsVersionFence'&&row.value==='1'))features.push('stock-receipt-lots-v1')
 if(state.projection?.lotCountVersion===1||settings.some(row=>row.key==='stockLotCountVersionFence'&&row.value==='1'))features.push('stock-lot-count-v1')
 if(state.projection?.lots||settings.some(row=>row.key==='stockLotVersionFence'&&row.value==='1'))features.push('stock-lots-v1')
 if(book.supplierEntries.length)features.push('supplier-ledger-v1')
 return {book,storeId:storeId||'',features}
}

// A retained compatibility marker changes no sale or stock. Preserve original
// boundary bytes while accepting only this explicitly known metadata addition.
export function recoveryBoundaryMatches(boundary,book,storage,digest=stockLedgerDigest,sourceStorage=storage){
 const original=convertLogicalBook(book,storage,sourceStorage),variants=[original]
 if(original.settings.some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))variants.push({...original,settings:original.settings.filter(row=>row.key!==STOCK_COMPAT_SETTING)})
 return variants.some(value=>{const material=materialSignature(value);return boundary===(sourceStorage==='sqlite'?digest(material).slice(7):material)})
}
