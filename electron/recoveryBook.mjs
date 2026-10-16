import {BROWSER_COLLECTIONS,browserToBook,materialSignature} from './recoveryRules.mjs'
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

export const RECOVERY_FEATURES=[RESTAURANT_INTAKE_FEATURE,'record-shapes-v1','cross-storage-v1','customer-ledger-v1','stock-cost-v1','supplier-ledger-v1']
export const recoveryDataError=()=>Error('備份保護紀錄不完整或內容不同，請保留原檔核對')
export function retainRecoveryFeatures(book,features){
 if(!features.includes('stock-cost-v1'))return book
 const settings=new Map(book.settings.map(row=>[row.key,row]));settings.set(STOCK_COMPAT_SETTING,{key:STOCK_COMPAT_SETTING,value:'1'});return {...book,settings:[...settings.values()]}
}
export function recoveryBook(data,storage,{complete=false,digest=stockLedgerDigest}={}){
 if(!data||typeof data!=='object'||Array.isArray(data)||!['sqlite','browser'].includes(storage))throw recoveryDataError()
 const names=storage==='sqlite'?Object.keys(BROWSER_COLLECTIONS):Object.values(BROWSER_COLLECTIONS),allowed=new Set([...names,...(storage==='sqlite'?['_revision']:[])])
 if(Object.keys(data).some(key=>!allowed.has(key))||complete&&names.some(key=>!Object.hasOwn(data,key)))throw recoveryDataError()
 if(Object.hasOwn(data,'_revision')&&typeof data._revision!=='string')throw recoveryDataError()
 const costKeys=storage==='sqlite'?['stockCostEntries','stockCostOperations']:['pos_stock_cost_entries','pos_stock_cost_operations']
 if(Object.hasOwn(data,costKeys[0])!==Object.hasOwn(data,costKeys[1])||costKeys.some(key=>Object.hasOwn(data,key)&&!Array.isArray(data[key])))throw Error('庫存成本回執需要核對，請保留原編號與資料')
 for(const key of names)if(Object.hasOwn(data,key)&&!Array.isArray(data[key]))throw recoveryDataError()
 const present=storage==='sqlite'?data:Object.fromEntries(Object.entries(BROWSER_COLLECTIONS).filter(([,local])=>Object.hasOwn(data,local)).map(([key,local])=>[key,data[local]]))
 const state=replayStockLedger(present.stockCostEntries||[],present.stockCostOperations||[],digest)
 validateStockCostBook(present,state)
 const book=storage==='sqlite'?Object.fromEntries(names.map(key=>[key,data[key]??[]])):browserToBook(data)
 validateSettingRows(book.settings,storage)
 const settings=settingsForValidation(book.settings,storage)
 const storeId=readExchangeTextSetting(settings,'sharedStoreId'),exchange=readExchangeStore(readExchangeTextSetting(settings,EXCHANGE_SETTING))
 validateProcurementRecords(book.purchases,book.cashLog);validateExchangeSettings(settings,book.purchases,book.auditLog)
 validateSalesRecords(book.salesDocuments,book.salesOperations,book.cashLog,storeId,book.products,exchange.quotes)
 validateCustomerLedgerRecords(book.customerEntries,book.customerOperations,{storeId,documents:book.salesDocuments,salesOperations:book.salesOperations,cashLogs:book.cashLog})
 validateSupplierLedgerRecords(book.supplierEntries,book.supplierOperations,{storeId,suppliers:book.suppliers,purchases:book.purchases,inventoryAudits:book.auditLog,cashLogs:book.cashLog})
 validateRestaurantRecords(book.restaurantOrders,book.restaurantOperations,book.orders,book.products)
 const restaurantConfig=settings.find(row=>row.key==='restaurantConfig')?.value
 const checkedRestaurantConfig=readRestaurantConfig(storage==='browser'&&restaurantConfig!=null?JSON.parse(restaurantConfig):restaurantConfig??null,book.products)
 const features=[]
 if(usesRestaurantIntake(checkedRestaurantConfig,book.restaurantOrders,book.orders))features.push(RESTAURANT_INTAKE_FEATURE)
 if(book.settings.some(row=>Object.hasOwn(row,'encoding')||storage==='sqlite'&&Object.hasOwn(row,'id')))features.push('cross-storage-v1')
 if(book.customerEntries.length)features.push('customer-ledger-v1')
 if(state.projection||settings.some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))features.push('stock-cost-v1')
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
