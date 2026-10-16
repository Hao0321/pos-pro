import {readRecords,writeRecords,withSalesLock,assertOriginalOperationAvailable,RECORD_KEY} from './browserStorage'
import {browserToBook,bookToBrowser} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {canonicalSignature,operationHeader} from '../../electron/operationRules.mjs'
import {browserStockActor,normalizeStockBusinessInput,browserBusinessNeedsCost,browserBusinessSource,browserRestaurantData,browserStockContexts,planBrowserStockBusiness} from '../../electron/browserStockPlan.mjs'
import {restaurantReceipt} from '../../electron/restaurantRules.mjs'
import {salesReceipt} from '../../electron/salesPlan.mjs'
import {supplierInventoryReceipt} from '../../electron/supplierInventory.mjs'
import {assertProductPricingUnchanged} from '../../electron/costPricing.mjs'
import {refundSignature} from './refundSafety.mjs'

export const hasBrowserStockCost=record=>record.data.pos_stock_cost_entries.length>0
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const runtime=record=>({epoch:record.salesEpoch,supplierFence:record.supplierFence})
function priorCost(book,state,method,request,actor){
  const input=normalizeStockBusinessInput(method,request),operation=state.operations.find(row=>row.id===canonicalSignature([method,input.id]))
  if(operation){if(operation.signature!==canonicalSignature(input)||actor&&operation.actorId!==actor.userId&&actor.role!=='owner')throw Error('原編號內容或帳號不符，請核對原單');return operation.receipt}
  if(browserBusinessNeedsCost(method,input)&&!state.projection.legacyOperationIds?.[method]?.includes(input.id))throw Error('原單缺少成本回執，請保留原編號核對')
  return null
}
export function browserStockBusinessResult(method,request,record,actor=null){
  const book=browserToBook(record.data),state=validateStockCostBook(book)
  if(actor)browserStockActor(book,actor,method,request)
  const input=normalizeStockBusinessInput(method,request),source=browserBusinessSource(book,method,input)
  if(!source&&!['updateProduct','deleteProduct'].includes(method))throw Error('原單尚未找到，請保留原編號核對')
  const costReceipt=state.projection?priorCost(book,state,method,request,actor):null
  let result
  if(method==='checkout'||method==='refundOrder'){
    if(method==='checkout'&&(!same(normalizeStockBusinessInput(method,source),input)||source.refundOf||!['completed','refunded'].includes(source.status)))throw Error('單號內容不一致')
    if(method==='refundOrder'&&source.requestSignature!==refundSignature(request))throw Error('退貨單號內容不一致')
    result={protocol:'pos-checkout-v5',success:true,orderId:source.id,order:source,products:book.products.filter(row=>source.items.some(item=>item.id===row.id)),member:source.memberId?book.members.find(row=>row.id===source.memberId):null,
      ...(source.status==='refunded'&&!source.refundOf?{refunds:book.orders.filter(row=>row.refundOf===source.id)}:{}),...(method==='refundOrder'?{original:book.orders.find(row=>row.id===source.refundOf)}:{})}
  }else if(method==='applyRestaurantOperation')result=restaurantReceipt(request,source,browserRestaurantData(book))
  else if(method==='applyInventoryOperation')result=supplierInventoryReceipt(request,typeof source.detail==='string'?JSON.parse(source.detail):source.detail,browserStockContexts(book,{...runtime(record),state}))
  else if(method==='applySalesOperation')result=salesReceipt(request,source,browserStockContexts(book,{...runtime(record),state}))
  else{
    if(!costReceipt&&method==='addProduct'&&['name','price','cost','stock','barcode','category','supplierId'].some(key=>(source[key]??'')!==(request[key]??(typeof source[key]==='number'?0:''))))throw Error('商品編號已存在且內容不同，請核對原商品')
    if(!costReceipt&&method==='addWaste'&&['productId','qty','reason','time','cashier'].some(key=>(source[key]??'')!==(request[key]??'')))throw Error('損耗編號內容不一致')
    result={success:true,...(method==='addWaste'?{waste:source,product:book.products.find(row=>row.id===source.productId)}:{product:book.products.find(row=>row.id===request.id)||null})}
  }
  return {...result,...(costReceipt?{costReceipt:structuredClone(costReceipt)}:{})}
}
// Check the saved original as well as the reply before a caller clears its
// pending payment/financial journal. Missing cost metadata cannot opt out.
export function assertStoredBrowserCostReceipt(method,request,result){
  const record=readRecords()
  if(!hasBrowserStockCost(record))return result
  const book=browserToBook(record.data),state=validateStockCostBook(book),input=normalizeStockBusinessInput(method,request)
  if(!browserBusinessNeedsCost(method,input))return result
  const receipt=priorCost(book,state,method,request,null)
  if(receipt&&!same(result?.costReceipt,receipt))throw Error('成本回覆尚未確認，請保留原編號核對')
  return result
}
// Called only while the browser's existing business lock is held.
export function commitBrowserStockBusiness(method,request,actor,record){
  let checked=false,existing=false,writing=false,beforeRaw=null
  try{
    const before=browserToBook(record.data),state=validateStockCostBook(before)
    browserStockActor(before,actor,method,request)
    const input=normalizeStockBusinessInput(method,request)
    assertOriginalOperationAvailable(method,input.id,record,request)
    existing=!!browserBusinessSource(before,method,input);checked=true
    if(existing)return browserStockBusinessResult(method,request,record,actor)
    if(browserBusinessNeedsCost(method,input)&&method!=='addProduct'){operationHeader(input);if(Math.abs(Date.now()-Date.parse(input.time))>300000)throw Error('操作時間已過期，請重新核對')}
    const timestamp=new Date().toISOString(),planned=planBrowserStockBusiness(before,{...runtime(record),state,timestamp},method,request,actor)
    beforeRaw=localStorage.getItem(RECORD_KEY);writing=true
    const next=writeRecords(bookToBrowser(planned.book),record.revision,{stockBusiness:{method,request,actor,timestamp}})
    return browserStockBusinessResult(method,request,next,actor)
  }catch(error){
    if(writing)try{if(localStorage.getItem(RECORD_KEY)!==beforeRaw)return browserStockBusinessResult(method,request,readRecords(),actor)}catch{return {success:false,committed:null,error:'保存結果尚未確認，請保留原編號核對'}}
    const committed=error.historyUncertain||!checked||existing?null:false
    return {protocol:'pos-checkout-v5',success:false,orderId:request?.id,committed,error:error.message,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{})}
  }
}
export function commitBrowserProduct(method,request,actor){return withSalesLock(()=>{
  const record=readRecords()
  if(hasBrowserStockCost(record))return commitBrowserStockBusiness(method,request,actor,record)
  const products=record.data.pos2_products
  let next
  if(method==='addProduct'){
    const old=products.find(row=>row.id===request.id)
    if(old){if(!same(old,request))throw Error('商品編號已存在，請核對原商品');return {success:true,product:old}}
    next=[...products,request]
  }else if(method==='updateProduct'){
    const old=products.find(row=>row.id===request.id),data=request.data
    if(!old)throw Error('商品不存在')
    assertProductPricingUnchanged(old,data._expectedPricing)
    if(Object.hasOwn(data,'stock')&&old.stock!==data._expectedStock)throw Error('庫存已變更，請重新核對')
    const clean={...data};for(const key of ['_expectedStock','_expectedPricing','_creationId','id'])delete clean[key]
    next=products.map(row=>row.id===request.id?{...row,...clean}:row)
  }else if(method==='deleteProduct')next=products.filter(row=>row.id!==request.id)
  else throw Error('商品流程不正確')
  writeRecords({pos2_products:next},record.revision)
  return {success:true,product:next.find(row=>row.id===request.id)||null}
})}
