import {canonicalSignature,moneyValue,quantityValue} from './operationRules.mjs'
import {procurementLineCents} from './procurementAmounts.mjs'
import {decimalUnits} from './decimalUnits.mjs'
import {CATALOGUE_PROTOCOL,party,businessId,only,text,readExchangeTextSetting} from './businessExchange.mjs'
import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'

export const CATALOGUE_ORDER_PROTOCOL='business-catalogue-order/v1'
export const CATALOGUE_ORDER_FEATURE='catalogue-purchase-v1'
export const CATALOGUE_ORDER_FENCE='cataloguePurchaseVersionFence'
export const CATALOGUE_ORDER_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export function retainCataloguePurchaseFeature(book){const flag=(book.settings||[]).find(row=>row.key===CATALOGUE_ORDER_FENCE);if(flag){if(readExchangeTextSetting(book.settings,CATALOGUE_ORDER_FENCE)!=='1')throw invalid();return book}return {...book,settings:[...(book.settings||[]),{key:CATALOGUE_ORDER_FENCE,value:'1'}]}}
export function assertCataloguePurchaseFeature(book){const flag=readExchangeTextSetting(book.settings||[],CATALOGUE_ORDER_FENCE);if(flag!=null&&flag!=='1'||(book.purchases||[]).some(row=>row.procurement?.version===3||row.procurement?.sourceCatalogue!==undefined)&&flag!=='1')throw Error('目錄採購的版本保護需要核對，請保留原單。');return flag==='1'}
const digest=value=>bytesToHex(sha256(new TextEncoder().encode(canonicalSignature(value))))
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const invalid=()=>Error('目錄與選品資料需要核對，原內容仍保留。')
export function readPublicCatalogue(value){
 only(value,['protocol','revision','generatedAt','sender','currency','pricing','items'],'公開目錄')
 if(value.protocol!==CATALOGUE_PROTOCOL||value.currency!=='TWD'||value.pricing!=='reference-unit-price'||typeof value.generatedAt!=='string'||!Number.isFinite(Date.parse(value.generatedAt))||!Array.isArray(value.items)||value.items.length>1000)throw invalid()
 only(value.sender,['id','name'],'目錄來源');party(value.sender)
 const seen=new Set()
 for(const row of value.items){only(row,['sku','name','unit','unitPrice'],'目錄品項');businessId(row.sku);text(row.name,200,'目錄品名');text(row.unit,40,'目錄單位');moneyValue(row.unitPrice,'目錄參考單價');decimalUnits(String(row.unitPrice),2,100000000000,'目錄參考單價需為有效金額，最多兩位小數');if(seen.has(row.sku))throw invalid();seen.add(row.sku)}
 const {sender,currency,pricing,items}=value
 if(value.revision!==digest({sender,currency,pricing,items}))throw Error('目錄內容與版本不符，請重新取得原目錄。')
 return value
}
export function readCatalogueOrder(value,{recipientStoreId}={}){
 only(value,['protocol','id','createdAt','recipientStoreId','catalogue','items'],'目錄採購草稿')
 if(value.protocol!==CATALOGUE_ORDER_PROTOCOL||typeof value.id!=='string'||!CATALOGUE_ORDER_ID.test(value.id)||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))throw invalid()
 businessId(value.recipientStoreId);if(recipientStoreId!==undefined&&value.recipientStoreId!==recipientStoreId)throw Error('這份草稿屬於另一間店，沒有建立任何單據')
 readPublicCatalogue(value.catalogue)
 if(!Array.isArray(value.items)||!value.items.length||value.items.length>100||new TextEncoder().encode(JSON.stringify(value)).length>32768)throw invalid()
 const seen=new Set();let total=0
 for(const row of value.items){only(row,['sku','qty'],'選取品項');businessId(row.sku);quantityValue(row.qty,'目錄數量',.001);decimalUnits(String(row.qty),3,1000000000000,'目錄數量需為有效數量，最多三位小數');const product=value.catalogue.items.find(item=>item.sku===row.sku);if(!product||seen.has(row.sku))throw invalid();seen.add(row.sku);total+=procurementLineCents(row.qty,product.unitPrice);if(!Number.isSafeInteger(total))throw invalid()}
 moneyValue(total/100,'目錄採購合計');return value
}
export const catalogueBusinessId=order=>'catalogue-'+digest([CATALOGUE_ORDER_PROTOCOL,order.catalogue.sender.id,order.id,order.recipientStoreId]).slice(0,48)
export const catalogueOrderNote=order=>'Reference catalogue · '+order.catalogue.sender.name
export function catalogueOrderItems(order){readCatalogueOrder(order);return order.items.map(row=>{const product=order.catalogue.items.find(item=>item.sku===row.sku);return {...product,qty:row.qty}})}
export function cataloguePurchaseSource(document,chosen){readCatalogueOrder(document);return {document:structuredClone(document),products:document.items.map(row=>({sku:row.sku,productId:chosen['sku:'+row.sku]}))}}
export function validateCataloguePurchase(purchase,source,{products,recipientStoreId}={}){
 only(source,['document','products'],'目錄採購來源');const document=readCatalogueOrder(source.document,{recipientStoreId}),rows=catalogueOrderItems(document)
 if(!Array.isArray(source.products)||source.products.length!==rows.length||!Array.isArray(purchase.items)||purchase.items.length!==rows.length||purchase.note!==catalogueOrderNote(document))throw invalid()
 const used=new Set();let total=0
 for(const [index,row]of rows.entries()){
  const mapping=source.products[index],item=purchase.items[index];only(mapping,['sku','productId'],'目錄品項對照');businessId(mapping.productId)
  if(mapping.sku!==row.sku||used.has(mapping.productId)||item.productId!==mapping.productId||item.catalogId||item.costBasis!==undefined||item.unit!==row.unit||item.qty!==row.qty||item.unitCost!==row.unitPrice)throw Error('目錄來源、數量、單位或價格已變更，請重新核對。')
  if(products){const current=products.find(product=>product.id===mapping.productId);if(!current||(current.unit||'個')!==item.unit||current.name!==item.name)throw Error('本店商品已更新，請重新核對目錄品項。')}
  used.add(mapping.productId);total+=procurementLineCents(row.qty,row.unitPrice)
 }
 if(!Number.isSafeInteger(total)||Math.round(purchase.total*100)!==total)throw Error('目錄小計與採購合計不同，請重新核對。')
 return source
}
export function assertCatalogueOriginal(document,request){
 if(!same(document,request.sourceCatalogue?.document))throw Error('原編號已用於不同內容，請保留原單核對。')
 validateCataloguePurchase({...request.purchase,total:request.purchase.items.reduce((sum,row)=>sum+procurementLineCents(row.qty,row.unitCost),0)/100},request.sourceCatalogue,{recipientStoreId:request.supplierContext?.storeId})
}
