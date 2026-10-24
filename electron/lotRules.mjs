import {warehouseRecord,warehouseText} from './warehouseRules.mjs'
export const LOT_METHOD='applyLotOperation',LOT_PROTOCOL='pos-stock-lots/v1',LOT_FEATURE='stock-lots-v1',LOT_SETTING='stockLotVersionFence'
const messages={INPUT:'批次資料需要核對，請保留輸入',STALE:'批次或庫存已更新，請重新看結果',AUTHORITY:'只有店主能設定批次與效期',HISTORY:'批次與成本來源需要核對，請保留原資料',QUANTITY:'這批可核對的數量不足，請重新選擇',EXPIRED:'這批已過期或效期未確認，請先核對批次',RESERVED:'預留的這批已過期或效期未確認，請先核對原單',CLOCK:'店面日期需要核對，請保留原資料',COUNT:'這個商品有批次，請先核對各批實際數量',DISPOSE:'這個商品有批次，請從批次清單選要報廢的貨'}
export const lotError=code=>Object.assign(Error(messages[code]||messages.HISTORY),{code:'STOCK_LOT_'+code})
export function lotDate(value){try{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)!==value)throw lotError('INPUT');return value}catch{throw lotError('INPUT')}}
export function lotTimeZone(value){warehouseText(value,128);try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0)}catch{throw lotError('INPUT')}return value}
export function lotDay(time,timeZone){const date=new Date(time);if(!Number.isFinite(date.getTime()))throw lotError('CLOCK');const parts=new Intl.DateTimeFormat('en-CA',{timeZone:lotTimeZone(timeZone),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),value=type=>parts.find(row=>row.type===type)?.value;return lotDate(value('year')+'-'+value('month')+'-'+value('day'))}
export function lotUnits(value){if(!Number.isSafeInteger(value)||value<1||value>1e12)throw lotError('QUANTITY');return value}
function optionalText(value,max){if(value!==null&&value!=='')warehouseText(value,max);else if(value!==null&&typeof value!=='string')throw lotError('INPUT')}
function timestamp(value){if(value!==null&&(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value))throw lotError('INPUT')}
export function lotCommand(raw){
 const fields={count:['locationId','counts'],activate:['timeZone'],track:['productId','required'],label:['sourceId','quantityUnits','code','expiryDate','receivedAt'],correct:['lotId','code','expiryDate','receivedAt','reason'],expire:['day'],release:['lotId','locationId','quantityUnits','reason'],dispose:['lotId','locationId','quantityUnits','reason']},descriptor=raw&&Object.getOwnPropertyDescriptor(raw,'action'),action=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:null,extra=Object.hasOwn(fields,action)?fields[action]:null
 if(!extra)throw lotError('INPUT');warehouseRecord(raw,['protocol','id','time','storeId','epoch','expectedStateDigest','action',...extra]);if(raw.protocol!==LOT_PROTOCOL||!/^sha256:[a-f0-9]{64}$/.test(raw.expectedStateDigest))throw lotError('INPUT')
 for(const key of ['id','storeId','epoch'])warehouseText(raw[key],128);timestamp(raw.time);if(raw.time===null)throw lotError('INPUT')
 for(const key of ['sourceId','lotId','locationId','productId'])if(Object.hasOwn(raw,key))warehouseText(raw[key],key==='sourceId'?256:128)
 if(raw.action==='count'){if(!Array.isArray(raw.counts)||!raw.counts.length||raw.counts.length>10000)throw lotError('INPUT');const keys=new Set();for(const row of raw.counts){warehouseRecord(row,['key','quantityUnits']);warehouseText(row.key,1024);if(keys.has(row.key)||!Number.isSafeInteger(row.quantityUnits)||row.quantityUnits<0||row.quantityUnits>1e12)throw lotError('INPUT');keys.add(row.key)}}
 if(Object.hasOwn(raw,'quantityUnits'))lotUnits(raw.quantityUnits)
 if(Object.hasOwn(raw,'code')){if(typeof raw.code!=='string')throw lotError('INPUT');optionalText(raw.code,128)}
 if(Object.hasOwn(raw,'expiryDate')&&raw.expiryDate!==null)lotDate(raw.expiryDate)
 if(Object.hasOwn(raw,'receivedAt')){timestamp(raw.receivedAt);if(raw.receivedAt!==null&&raw.receivedAt>raw.time)throw lotError('INPUT')}
 if(Object.hasOwn(raw,'required')&&typeof raw.required!=='boolean')throw lotError('INPUT')
 if(Object.hasOwn(raw,'reason'))warehouseText(raw.reason,256)
 if(raw.action==='activate')lotTimeZone(raw.timeZone)
 if(raw.action==='expire')lotDate(raw.day)
 return structuredClone(raw)
}
export function lotRegistry(raw,custody){
 warehouseRecord(raw,['version','timeZone','observedDay','products','items']);if(raw.version!==1||custody.version!==2||!Array.isArray(raw.products)||!Array.isArray(raw.items)||raw.products.length>10000||raw.items.length>100000)throw lotError('HISTORY');lotTimeZone(raw.timeZone);lotDate(raw.observedDay)
 const products=new Set(),ids=new Set(),ranges=new Map(),sources=new Map(custody.sources.map(row=>[row.id,row]))
 for(const row of raw.products){warehouseRecord(row,['productId','required']);warehouseText(row.productId,256);if(typeof row.required!=='boolean'||products.has(row.productId))throw lotError('HISTORY');products.add(row.productId)}
 for(const row of raw.items){warehouseRecord(row,['id','sourceId','segments','code','expiryDate','receivedAt']);warehouseText(row.id,128);const source=sources.get(row.sourceId);if(!source||ids.has(row.id)||typeof row.code!=='string'||!Array.isArray(row.segments)||!row.segments.length)throw lotError('HISTORY');ids.add(row.id);optionalText(row.code,128);if(row.expiryDate!==null)lotDate(row.expiryDate);timestamp(row.receivedAt)
  const list=ranges.get(row.sourceId)||[];for(const part of row.segments){warehouseRecord(part,['offsetUnits','quantityUnits']);lotUnits(part.quantityUnits);if(!Number.isSafeInteger(part.offsetUnits)||part.offsetUnits<0||part.offsetUnits+part.quantityUnits>source.quantityUnits)throw lotError('HISTORY');list.push(part)}ranges.set(row.sourceId,list)
 }
 for(const list of ranges.values()){list.sort((a,b)=>a.offsetUnits-b.offsetUnits);for(let i=1;i<list.length;i++)if(list[i-1].offsetUnits+list[i-1].quantityUnits>list[i].offsetUnits)throw lotError('HISTORY')}
 return structuredClone(raw)
}
