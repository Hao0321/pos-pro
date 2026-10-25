import {readRecords,writeRecords,withSalesLock,RECORD_KEY,assertOriginalOperationAvailable} from './browserStorage'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {admitWasteEntry} from '../../electron/wasteEntryDraft.mjs'
import {hasBrowserStockCost,commitBrowserStockBusiness} from './browserStockBusiness'
export function commitBrowserWasteEntry(input,actor){return withSalesLock(()=>{
 let writing=false,beforeRaw=null
 try{
  const record=readRecords(),context=privateDraftContext(readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),record.salesEpoch,actor,record.data.pos_users),checked=admitWasteEntry(input,context,{products:record.data.pos2_products,wasteLog:record.data.pos2_waste},actor)
  assertOriginalOperationAvailable('addWaste',input.id,record,checked.data);beforeRaw=localStorage.getItem(RECORD_KEY)
  if(hasBrowserStockCost(record)){writing=true;const result=commitBrowserStockBusiness('addWaste',checked.data,actor,record);if(result?.success===false&&localStorage.getItem(RECORD_KEY)!==beforeRaw)return {...result,committed:null};return result}
  const current=record.data.pos2_products.find(row=>row.id===input.productId)
  if(checked.original)return {success:true,waste:checked.original,product:current||{id:input.productId}}
  const product={...current,stock:(Math.round(current.stock*1000)-Math.round(checked.data.qty*1000))/1000},waste={...checked.data,productName:current.name,cost:current.cost||0}
  writing=true;writeRecords({pos2_waste:[waste,...record.data.pos2_waste],pos2_products:record.data.pos2_products.map(row=>row.id===product.id?product:row)},record.revision)
  return {success:true,waste,product}
 }catch(error){if(writing)return {success:false,committed:localStorage.getItem(RECORD_KEY)===beforeRaw?false:null,error:error.message};if(error.code==='WASTE_ENTRY_REVIEW_CHANGED')return {success:false,committed:false,error:error.message};throw error}
})}
