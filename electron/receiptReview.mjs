import {canonicalSignature,quantityValue} from './operationRules.mjs'
import {warehouseRecord,warehouseText} from './warehouseRules.mjs'
import {receiptNewItemPrices} from './receiptLots.mjs'

export const RECEIPT_REVIEW_KIND='receive-reviewed',RECEIPT_REVIEW_PROTOCOL='pos-receipt-review/v1'
export const RECEIPT_REVIEW_FEATURE='stock-receipt-review-v1',RECEIPT_REVIEW_SETTING='stockReceiptReviewVersionFence'
export const isReceiving=kind=>['receive','receive-lots',RECEIPT_REVIEW_KIND].includes(kind)
export const hasReceiptLots=request=>request.kind==='receive-lots'||request.kind===RECEIPT_REVIEW_KIND&&Object.hasOwn(request,'lots')
const changed=()=>Error('入庫商品或單位已變更，原輸入已保留，請重新核對')

// RI2: this is the single authority used by preview and by the atomic writer.
// Stock and existing selling prices do not form part of identity consent.
export function receiptReviewFacts(request,data){
 const po=data.purchases.find(row=>row.id===request.purchaseId)
 if(!po||request.expectedPurchase!==canonicalSignature(po)||!Array.isArray(request.quantities)||request.quantities.length!==po.items.length)throw changed()
 const prices=receiptNewItemPrices(request.lots?.newItems??request.newItems??[],request.quantities.map(q=>Math.round(quantityValue(q,'本次到貨量')*1000))),supplier=data.suppliers.find(row=>row.id===po.supplierId),rows=[]
 for(const [lineIndex,item]of po.items.entries()){
  const quantityUnits=Math.round(quantityValue(request.quantities[lineIndex],'本次到貨量')*1000)
  if(!quantityUnits)continue
  const catalog=!item.productId&&item.catalogId?supplier?.catalog?.find(row=>row.id===item.catalogId):null
  if(!item.productId&&item.catalogId&&!catalog)throw changed()
  const linked=item.productId||catalog?.productId,product=linked?data.products.find(row=>row.id===linked):null,price=prices.find(row=>row.lineIndex===lineIndex)
  if(linked&&!product||product&&item.unit&&(product.unit||'個')!==item.unit||product&&price)throw changed()
  if(!product&&!price)throw Error('請確認新商品的售價')
  rows.push({lineIndex,productId:product?.id||'p-'+request.id+'-'+lineIndex,name:product?.name||item.name,unit:item.unit||product?.unit||'個',quantityUnits,newPriceCents:product?null:price.priceCents})
 }
 if(!rows.length||prices.some(price=>!rows.some(row=>row.lineIndex===price.lineIndex&&row.newPriceCents!==null)))throw changed()
 return rows
}
export function readReceiptReview(request){
 try{
  warehouseRecord(request,['kind','purchaseId','expectedPurchase','quantities','receiptReview',...['id','time','supplierContext','lots','newItems'].filter(key=>Object.hasOwn(request||{},key))])
  if(Object.hasOwn(request,'lots')&&Object.hasOwn(request,'newItems'))throw changed()
  const review=request.receiptReview;warehouseRecord(review,['protocol','storeId','epoch','mode','confirmed','rows'])
  if(request.kind!==RECEIPT_REVIEW_KIND||review.protocol!==RECEIPT_REVIEW_PROTOCOL||review.confirmed!==true||!['quantity','lots'].includes(review.mode)||review.mode!==(hasReceiptLots(request)?'lots':'quantity'))throw changed()
  warehouseText(review.storeId);warehouseText(review.epoch)
  if(!Array.isArray(review.rows)||!review.rows.length||review.rows.length>10000)throw changed()
  const seen=new Set()
  for(const row of review.rows){warehouseRecord(row,['lineIndex','productId','name','unit','quantityUnits','newPriceCents']);if(!Number.isSafeInteger(row.lineIndex)||row.lineIndex<0||row.lineIndex>=request.quantities?.length||seen.has(row.lineIndex)||!Number.isSafeInteger(row.quantityUnits)||row.quantityUnits<1||row.quantityUnits>1e12||row.newPriceCents!==null&&(!Number.isSafeInteger(row.newPriceCents)||row.newPriceCents<0||row.newPriceCents>1e11))throw changed();warehouseText(row.productId);warehouseText(row.name,500);warehouseText(row.unit,32);seen.add(row.lineIndex)}
  if(request.quantities.some((qty,index)=>{quantityValue(qty,'本次到貨量');const row=review.rows.find(row=>row.lineIndex===index);return qty>0?row?.quantityUnits!==Math.round(qty*1000):!!row}))throw changed()
  return review
 }catch{throw changed()}
}
export function makeReceiptReview(request,data){return {protocol:RECEIPT_REVIEW_PROTOCOL,storeId:data.storeId,epoch:data.epoch,mode:hasReceiptLots(request)?'lots':'quantity',confirmed:true,rows:receiptReviewFacts(request,data)}}
export function assertLiveReceiptReview(request,data){
 if(request.kind!==RECEIPT_REVIEW_KIND){
  if(request.receiptReview!==undefined)throw changed()
  // Accepted legacy IDs are replayed before this guard. A fresh, unfiled line
  // needs explicit target review instead of trusting a mutable catalogue link.
  const po=data.purchases.find(row=>row.id===request.purchaseId)
  if(isReceiving(request.kind)&&po?.items.some((item,index)=>!item.productId&&request.quantities?.[index]>0))throw Error('請先核對實際入庫商品，再確認到貨')
  return
 }
 const review=readReceiptReview(request)
 if(review.storeId!==data.storeId||review.epoch!==data.epoch||canonicalSignature(review)!==canonicalSignature(makeReceiptReview(request,data)))throw changed()
}
export function assertReceiptReviewHistory(request,purchase,productIds){
 const review=readReceiptReview(request)
 for(const row of review.rows){const item=purchase?.items?.[row.lineIndex];if(!item||item.productId!==row.productId||item.unit&&item.unit!==row.unit||!productIds.includes(row.productId))throw changed()}
 const expected=[...new Set(review.rows.map(row=>row.productId))]
 if(expected.length!==productIds.length)throw changed()
 return review
}
export function retainReceiptReviewFeature(book){return {...book,settings:[...(book.settings||[]).filter(row=>row.key!==RECEIPT_REVIEW_SETTING),{key:RECEIPT_REVIEW_SETTING,value:'1'}]}}
export function assertReceiptReviewFeature(book){
 const flag=(book.settings||[]).find(row=>row.key===RECEIPT_REVIEW_SETTING)
 if(flag&&flag.value!=='1')throw changed()
 for(const audit of book.auditLog||[]){
  if(audit.action!=='INVENTORY_OPERATION')continue
  const receipt=typeof audit.detail==='string'?JSON.parse(audit.detail):audit.detail
  if(receipt?.kind!==RECEIPT_REVIEW_KIND)continue
  if(!flag)throw changed()
  const request=JSON.parse(receipt.signature)
  if(receipt.id!==request.id||receipt.signature!==canonicalSignature(request))throw changed()
  assertReceiptReviewHistory(request,book.purchases?.find(row=>row.id===request.purchaseId),receipt.productIds)
 }
}
