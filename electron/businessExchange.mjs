import {canonicalSignature,moneyValue,quantityValue,operationHeader} from './operationRules.mjs'
import {procurementLineCents} from './procurementAmounts.mjs'

export const QUOTE_PROTOCOL='business-quote/v1'
export const CATALOGUE_PROTOCOL='business-catalogue/v1'
export const PARTY_PROTOCOL='business-party/v1'
export const EXCHANGE_SETTING='businessExchangeV1'
export const EXCHANGE_ACTION='business-quote'
export const EXCHANGE_PREFIX='exchange:'
export const QUOTE_PRICING='all-inclusive-unit'
export function only(value,keys,label='報價'){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error(label+'含不支援的欄位或操作')
}
export function text(value,max,label,required=true){
  if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error(label+'格式不正確')
  return value.trim()
}
export function businessId(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(value))throw Error('公司或單據代碼格式不正確')
  return value
}
function instant(value){
  const match=typeof value==='string'&&/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.exec(value)
  if(!match||!Number.isFinite(Date.parse(value)))throw Error('報價日期格式不正確')
  const [year,month,day,hour,minute,second]=match.slice(1).map(Number),calendar=new Date(0)
  calendar.setUTCFullYear(year,month-1,day);calendar.setUTCHours(hour,minute,second,0)
  if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||calendar.getUTCHours()!==hour||calendar.getUTCMinutes()!==minute||calendar.getUTCSeconds()!==second)throw Error('報價日期格式不正確')
  return Date.parse(value)
}
export function party(value){
  only(value,['id','name'],'店面資料')
  return {id:businessId(value.id),name:text(value.name,100,'店名')}
}
export {instant as businessInstant}
export function makePartyCard(sender){return {protocol:PARTY_PROTOCOL,business:party(sender)}}
export function readPartyCard(value){
  only(value,['protocol','business'],'店面資料')
  if(value.protocol!==PARTY_PROTOCOL)throw Error('請貼上對方的店面資料卡')
  return party(value.business)
}
export function quoteTotal(items){return items.reduce((n,i)=>n+procurementLineCents(i.qty,i.unitPrice),0)/100}
export function validateQuote(quote,{now,recipientStoreId}={}){
  only(quote,['protocol','id','revision','createdAt','issuedAt','validUntil','sender','recipient','currency','pricing','items','total','note'])
  if(quote.protocol!==QUOTE_PROTOCOL||quote.currency!=='TWD'||quote.pricing!==QUOTE_PRICING)throw Error('報價僅支援台幣、單價已含本單全部費用的格式')
  businessId(quote.id)
  if(!Number.isSafeInteger(quote.revision)||quote.revision<1)throw Error('報價修訂版本不正確')
  const created=instant(quote.createdAt),issued=instant(quote.issuedAt),expires=instant(quote.validUntil)
  if(issued<created||expires<=issued||expires-issued>366*86400000)throw Error('請確認報價的生效與到期時間')
  party(quote.sender);party(quote.recipient)
  if(quote.sender.id===quote.recipient.id)throw Error('請選擇另一間店作為報價收件人')
  if(recipientStoreId!==undefined&&quote.recipient.id!==recipientStoreId)throw Error('這份報價是給另一間店的，沒有建立任何單據')
  if(now!==undefined&&(now>=expires||issued-now>300000))throw Error('這份報價已過期或尚未生效，請向對方取得新報價')
  if(!Array.isArray(quote.items)||!quote.items.length||quote.items.length>100)throw Error('請選擇 1 至 100 個品項')
  const seen=new Set()
  for(const row of quote.items){
    only(row,['sku','name','unit','qty','unitPrice'],'報價品項')
    businessId(row.sku);text(row.name,200,'商品名稱');text(row.unit,30,'商品單位')
    quantityValue(row.qty,'數量',.001);moneyValue(row.unitPrice,'報價單價')
    if(seen.has(row.sku))throw Error('報價有重複品項，請核對')
    seen.add(row.sku)
  }
  moneyValue(quote.total,'報價合計')
  if(Math.round(quote.total*100)!==Math.round(quoteTotal(quote.items)*100))throw Error('報價合計與明細不符')
  text(quote.note,500,'報價備註',false)
  if(new TextEncoder().encode(JSON.stringify(quote)).length>32768)throw Error('報價太大，請減少品項或備註')
  return quote
}
export function readExchangeStore(raw){
  if(raw==null||raw==='')return {version:1,revision:0,pricebooks:[],quotes:[]}
  if(typeof raw==='string'&&new TextEncoder().encode(raw).length>8*1024*1024)throw Error('報價歷史過大，請先備份並聯絡維護者')
  const state=typeof raw==='string'?JSON.parse(raw):raw
  only(state,['version','revision','pricebooks','quotes'],'報價歷史')
  if(state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.pricebooks)||state.pricebooks.length>2000||!Array.isArray(state.quotes)||state.quotes.length>10000)throw Error('報價歷史格式錯誤，已保留原資料')
  const buyers=new Set(),families=new Map()
  for(const book of state.pricebooks){
    only(book,['recipient','prices','updatedAt'],'客戶價格');party(book.recipient);instant(book.updatedAt)
    if(buyers.has(book.recipient.id)||!Array.isArray(book.prices)||book.prices.length>1000)throw Error('客戶價格格式錯誤')
    buyers.add(book.recipient.id)
    const seen=new Set()
    for(const row of book.prices){only(row,['productId','unit','unitPrice'],'客戶價格');businessId(row.productId);text(row.unit,40,'商品單位');moneyValue(row.unitPrice,'報價單價');const key=canonicalSignature([row.productId,row.unit]);if(seen.has(key))throw Error('客戶價格含重複品項');seen.add(key)}
  }
  for(const quote of state.quotes){
    validateQuote(quote)
    const old=families.get(quote.id)
    if(quote.revision!==(old?.revision||0)+1||old&&(quote.sender.id!==old.sender.id||quote.recipient.id!==old.recipient.id||quote.createdAt!==old.createdAt||Date.parse(quote.issuedAt)<Date.parse(old.issuedAt))||!old&&quote.createdAt!==quote.issuedAt)throw Error('報價版本歷史不完整，請保留原始備份')
    families.set(quote.id,quote)
  }
  if(state.revision!==state.quotes.length)throw Error('報價歷史版本與筆數不符')
  return state
}
export function readExchangeTextSetting(settings,key){
  const raw=settings.find(s=>s.key===key)?.value
  if(typeof raw!=='string')return raw
  try{const value=JSON.parse(raw);return typeof value==='string'?value:raw}catch{return raw}
}
export function validateExchangeSettings(settings,purchases=[],auditLogs){
  const raw=readExchangeTextSetting(settings||[],EXCHANGE_SETTING)
  const state=readExchangeStore(raw),storeId=readExchangeTextSetting(settings,'sharedStoreId')
  if((state.quotes.length||state.pricebooks.length)&&(!storeId||state.quotes.some(q=>q.sender.id!==storeId)))throw Error('報價歷史與店面身份不符')
  if(purchases.some(p=>p.procurement?.sourceQuote&&p.procurement.sourceQuote.document.recipient.id!==storeId))throw Error('採購報價與收件店面不符')
  if(purchases.some(p=>p.procurement?.sourceCatalogue&&p.procurement.sourceCatalogue.document.recipientStoreId!==storeId))throw Error('目錄採購與收件店面不符。')
  if(auditLogs===undefined)return
  const receipts=new Map(),books=[]
  for(const entry of auditLogs.filter(row=>row.action===EXCHANGE_ACTION||String(row.id).startsWith(EXCHANGE_PREFIX))){
    const receipt=typeof entry.detail==='string'?JSON.parse(entry.detail):entry.detail
    if(entry.action!==EXCHANGE_ACTION||entry.id!==EXCHANGE_PREFIX+receipt?.id)throw Error('報價回執需要核對')
    const key=canonicalSignature([receipt.quoteId,receipt.quoteRevision])
    if(receipts.has(key))throw Error('報價回執需要核對')
    receipts.set(key,receipt)
  }
  if(receipts.size!==state.quotes.length)throw Error('報價回執找不到原修訂，請保留紀錄核對')
  state.quotes.forEach((quote,index)=>{
    const receipt=receipts.get(canonicalSignature([quote.id,quote.revision]))
    if(!receipt)throw Error('報價回執需要核對')
    const request=JSON.parse(receipt.signature)
    if(request.kind!=='exchange'||request.expectedRevision!==index||typeof request.rememberPrices!=='boolean')throw Error('報價回執需要核對')
    assertExchangeReceipt(request,{quote,receipt})
    if(!request.rememberPrices)return
    let book=books.find(b=>b.recipient.id===quote.recipient.id)
    if(!book){book={recipient:quote.recipient,prices:[],updatedAt:quote.issuedAt};books.push(book)}
    book.recipient=quote.recipient;book.updatedAt=quote.issuedAt
    for(const row of quote.items){const previous=book.prices.find(p=>p.productId===row.sku&&p.unit===row.unit);if(previous)previous.unitPrice=row.unitPrice;else book.prices.push({productId:row.sku,unit:row.unit,unitPrice:row.unitPrice})}
  })
  if(canonicalSignature(books)!==canonicalSignature(state.pricebooks))throw Error('客戶價格與原報價回執不符，請保留原始備份')
}
export function validateQuotedPurchase(purchase,source,{now,recipientStoreId,products}={}){
  only(source,['document','products'],'採購報價來源')
  const quote=validateQuote(source.document,{now,recipientStoreId})
  if(!Array.isArray(source.products)||source.products.length!==quote.items.length||purchase.items.length!==quote.items.length||quote.total!==purchase.total)throw Error('採購與報價明細不符')
  const seen=new Set()
  quote.items.forEach((row,index)=>{
    const link=source.products[index],item=purchase.items[index]
    only(link,['sku','productId'],'報價商品對照')
    businessId(link.productId)
    if(link.sku!==row.sku||link.productId!==item.productId||seen.has(item.productId)||row.unit!==item.unit||row.qty!==item.qty||row.unitPrice!==item.unitCost||products&&products.find(p=>p.id===item.productId)?.unit!==row.unit)throw Error('採購的品項、單位、數量或單價與報價不同，請重新核對')
    seen.add(item.productId)
  })
}
export const productReference=p=>({name:p.name,unit:p.unit||'個',price:p.price})
export function planExchange(request,state,products,sender,actor,now=Date.now()){
  if(actor?.role!=='owner')throw Error('權限不足')
  only(request,['id','time','kind','storeId','expectedRevision','quoteId','expectedQuoteRevision','recipient','validUntil','items','note','rememberPrices','pricing'])
  operationHeader(request)
  if(request.kind!=='exchange'||request.storeId!==sender.id)throw Error('報價店面不符，請回到原店面確認')
  if(request.expectedRevision!==state.revision)throw Error('報價或客戶價格已更新，請重新載入後核對')
  if(typeof request.rememberPrices!=='boolean'||request.pricing!==QUOTE_PRICING||!Number.isSafeInteger(request.expectedQuoteRevision)||request.expectedQuoteRevision<0)throw Error('請確認報價條件與修訂版本')
  if(Math.abs(now-Date.parse(request.time))>86400000)throw Error('報價草稿時間過久，請重新核對再開立')
  const recipient=party(request.recipient),previous=request.quoteId?state.quotes.filter(q=>q.id===businessId(request.quoteId)).at(-1):null
  if(request.quoteId&&!previous||request.expectedQuoteRevision!==(previous?.revision||0)||previous&&previous.recipient.id!==recipient.id)throw Error('報價版本或收件人已改變，請重新核對')
  if(!Array.isArray(request.items)||!request.items.length||request.items.length>100)throw Error('請選擇 1 至 100 個品項')
  const items=request.items.map(row=>{
    only(row,['productId','qty','unitPrice','expectedProduct'],'報價品項')
    const product=products.find(p=>p.id===row.productId)
    if(!product||canonicalSignature(row.expectedProduct)!==canonicalSignature(productReference(product)))throw Error('商品名稱、單位或一般售價已更新，請重新選取商品')
    return {sku:product.id,name:product.name,unit:product.unit||'個',qty:row.qty,unitPrice:row.unitPrice}
  })
  const quote={protocol:QUOTE_PROTOCOL,id:previous?.id||request.id,revision:request.expectedQuoteRevision+1,createdAt:previous?.createdAt||request.time,issuedAt:request.time,validUntil:request.validUntil,sender:party(sender),recipient,currency:'TWD',pricing:QUOTE_PRICING,items,total:quoteTotal(items),note:text(request.note,500,'報價備註',false)}
  validateQuote(quote,{now})
  if(previous&&Date.parse(quote.issuedAt)<Date.parse(previous.issuedAt))throw Error('新修訂的時間不能早於原報價')
  const pricebooks=structuredClone(state.pricebooks)
  if(request.rememberPrices){
    let book=pricebooks.find(b=>b.recipient.id===recipient.id)
    if(!book){book={recipient,prices:[],updatedAt:request.time};pricebooks.push(book)}
    book.recipient=recipient;book.updatedAt=request.time
    for(const row of items){const old=book.prices.find(p=>p.productId===row.sku&&p.unit===row.unit);if(old)old.unitPrice=row.unitPrice;else book.prices.push({productId:row.sku,unit:row.unit,unitPrice:row.unitPrice})}
  }
  const next={version:1,revision:state.revision+1,pricebooks,quotes:[...state.quotes,quote]}
  readExchangeStore(next)
  if(new TextEncoder().encode(JSON.stringify(next)).length>8*1024*1024)throw Error('報價歷史過大，請先備份並聯絡維護者')
  return {state:next,quote,receipt:{id:request.id,kind:'exchange',signature:canonicalSignature(request),quoteId:quote.id,quoteRevision:quote.revision}}
}
export function exchangeReceipt(request,receipt,state){
  if(receipt?.kind!=='exchange'||receipt.id!==request.id||receipt.signature!==canonicalSignature(request))throw Object.assign(Error('原報價編號已使用且內容不同，請先核對已保存報價'),{operationConflict:true})
  const quote=state.quotes.find(q=>q.id===receipt.quoteId&&q.revision===receipt.quoteRevision)
  if(!quote)throw Error('報價回執找不到原修訂，請保留紀錄核對')
  const result={success:true,receipt,quote}
  assertExchangeReceipt(request,result)
  return result
}
export function assertExchangeReceipt(request,result){
  const {receipt,quote}=result||{}
  validateQuote(quote)
  if(receipt?.id!==request.id||receipt.kind!=='exchange'||receipt.signature!==canonicalSignature(request)||receipt.quoteId!==quote.id||receipt.quoteRevision!==quote.revision||quote.id!==(request.quoteId||request.id)||quote.revision!==request.expectedQuoteRevision+1||quote.sender.id!==request.storeId||canonicalSignature(quote.recipient)!==canonicalSignature(party(request.recipient))||quote.issuedAt!==request.time||quote.validUntil!==request.validUntil||quote.note!==request.note.trim()||canonicalSignature(quote.items)!==canonicalSignature(request.items.map(row=>({sku:row.productId,name:row.expectedProduct.name,unit:row.expectedProduct.unit,qty:row.qty,unitPrice:row.unitPrice}))))throw Error('報價保存結果尚未確認：回覆內容不符')
}
export async function makeCatalogue(products,sender,now=new Date()){
  const items=products.map(p=>({sku:businessId(p.id),name:text(p.name,200,'商品名稱'),unit:text(p.unit||'個',40,'商品單位'),unitPrice:moneyValue(p.price,'售價')}))
  const content={sender:party(sender),currency:'TWD',pricing:'reference-unit-price',items}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalSignature(content)))
  return {protocol:CATALOGUE_PROTOCOL,revision:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),generatedAt:now.toISOString(),...content}
}
