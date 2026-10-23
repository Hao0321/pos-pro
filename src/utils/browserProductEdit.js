import {readRecords,writeRecords,withSalesLock,RECORD_KEY} from './browserStorage'
import {privateDraftContext} from '../../electron/privateDrafts.mjs'
import {readExchangeTextSetting} from '../../electron/businessExchange.mjs'
import {updateBrowserSettings} from '../../electron/settingEncoding.mjs'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {planBrowserStockBusiness} from '../../electron/browserStockPlan.mjs'
import {PRODUCT_EDIT_JOURNAL,admitProductEdit,productEditReceipt,productEditRejection,readProductEditJournal,productEditOriginal} from '../../electron/productEditDraft.mjs'
const context=(record,actor)=>privateDraftContext(readExchangeTextSetting(record.data.pos_business_settings,'sharedStoreId'),record.salesEpoch,actor,record.data.pos_users)
export function commitBrowserProductEdit(productId,input,actor){return withSalesLock(()=>{
 let admitted=false,writing=false,beforeRaw=null,lookup=null
 try{
  const record=readRecords(),current=context(record,actor),journal=readProductEditJournal(readExchangeTextSetting(record.data.pos_business_settings,PRODUCT_EDIT_JOURNAL)),product=record.data.pos2_products.find(row=>row.id===productId),checked=admitProductEdit(productId,input,current,product,journal)
  if(checked.original)return {success:true,product:product||null,receipt:journal.entries.find(row=>row.id===checked.request.id),alreadySaved:true}
  admitted=true;let products
  if(record.data.pos_stock_cost_entries.length){const book=browserToBook(record.data),state=validateStockCostBook(book);products=planBrowserStockBusiness(book,{epoch:record.salesEpoch,supplierFence:record.supplierFence,state},'updateProduct',{id:productId,data:checked.data},actor).book.products}
  else products=record.data.pos2_products.map(row=>row.id===productId?{...row,...checked.request.changes}:row)
  const receipt=productEditReceipt(checked.request,current),settings=updateBrowserSettings(record.data.pos_business_settings,{[PRODUCT_EDIT_JOURNAL]:JSON.stringify(JSON.stringify({version:1,entries:[...journal.entries,receipt]}))});lookup={id:receipt.id,digest:receipt.digest};beforeRaw=localStorage.getItem(RECORD_KEY);writing=true
  writeRecords({pos2_products:products,pos_business_settings:settings},record.revision)
  return {success:true,product:products.find(row=>row.id===productId),receipt}
 }catch(error){
  if(writing&&localStorage.getItem(RECORD_KEY)!==beforeRaw){try{const record=readRecords(),current=context(record,actor),journal=readProductEditJournal(readExchangeTextSetting(record.data.pos_business_settings,PRODUCT_EDIT_JOURNAL)),original=productEditOriginal(lookup,current,journal);if(original.status==='matched')return {success:true,product:record.data.pos2_products.find(row=>row.id===productId)||null,receipt:journal.entries.find(row=>row.id===lookup.id)}}catch{}return {success:false,committed:null,error:'商品保存紀錄需要核對，請保留原輸入。'}}
  if(admitted||error.code==='PRODUCT_EDIT_CONFLICT')return productEditRejection(productId,input,error);throw error
 }
})}
