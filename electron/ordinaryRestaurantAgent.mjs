import {canonicalSignature,moneyValue,quantityValue} from './operationRules.mjs'
import {AGENT_PROTOCOL,makeAgentContextSync,validateAgentDraft} from './agentDraftRules.mjs'
import {restaurantMenuDigest} from './restaurantMenu.mjs'
import {restaurantAgentFields} from './restaurantAgentDraft.mjs'

export const ORDINARY_RESTAURANT_AGENT_REVIEW='pos-restaurant-agent-ordinary-review/v1'
const invalid=()=>Error('餐點草稿格式不完整，請保留原內容核對。'),same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
function clock(value){const now=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;if(!Number.isSafeInteger(now)||now<0)throw invalid();return now}
function object(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw invalid()}
function array(value,min,max){if(!Array.isArray(value)||value.length<min||value.length>max||Object.keys(value).length!==value.length)throw invalid();return value}
function id(value,max=128){if(typeof value!=='string'||!/^[-A-Za-z0-9_:]+$/.test(value)||value.length>max)throw invalid()}
function text(value,max,empty=false){if(typeof value!=='string'||!empty&&!value.trim()||value.length>max)throw invalid()}
function count(value){if(!Number.isSafeInteger(value)||value<1||value>100000)throw invalid()}
function iso(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw invalid();const day=value.slice(0,10);if(new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw invalid()}
function bounded(value,max=262144){if(new TextEncoder().encode(JSON.stringify(value)).length>max)throw Error('這張餐點的資料過多，請分開核對。')}
const actorAllowed=(actor,users)=>{if(!actor||!['owner','staff'].includes(actor.role)||!users?.some(row=>row.id===actor.userId&&row.username===actor.username&&row.role===actor.role))throw Error('權限不足')}
export function assertOrdinaryRestaurantAgentDraft(draft){
 object(draft,['protocol','id','issuedAt','storeId','catalogueRevision','kind','items','supplierId','date','channel','day','slot','customer','contact','note'],['protocol','id','issuedAt','storeId','catalogueRevision','kind','items'])
 if(draft.protocol!==AGENT_PROTOCOL||draft.kind!=='restaurant'||!/^[-A-Za-z0-9_]{8,80}$/.test(draft.id||'')||typeof draft.catalogueRevision!=='string'||!/^[a-f0-9]{64}$/.test(draft.catalogueRevision))throw invalid()
 id(draft.storeId);iso(draft.issuedAt);const seen=new Set()
 for(const row of array(draft.items,1,100)){object(row,['productId','qty']);id(row.productId);count(row.qty);if(seen.has(row.productId))throw invalid();seen.add(row.productId)}
 for(const [key,max]of [['supplierId',128],['date',10],['channel',10],['day',10],['slot',5],['customer',100],['contact',100],['note',1000]])if(Object.hasOwn(draft,key))text(draft[key],max,true)
 bounded(draft,32768);return draft
}
export function ordinaryRestaurantAgentContext(data,actor){return makeAgentContextSync({storeId:data.storeId,products:data.products,suppliers:data.suppliers||[],restaurantConfig:data.config,role:actor.role})}
const inputFor=draft=>({protocol:AGENT_PROTOCOL,id:draft.id,issuedAt:draft.issuedAt,storeId:draft.storeId,catalogueRevision:draft.catalogueRevision,kind:'restaurant',items:structuredClone(draft.items)})
function scopeFor(data){id(data.storeId);if(typeof data.epoch!=='string'&&data.epoch!==undefined)throw invalid();if(!['active','reference'].includes(data.costMode))throw invalid();return {storeId:data.storeId,epoch:data.epoch||'',costMode:data.costMode}}
function sourceFor(data,draft){
 const ids=new Set(draft.items.map(row=>row.productId)),recipes=Object.create(null)
 for(const row of draft.items)if(Object.hasOwn(data.config.recipes,row.productId)){recipes[row.productId]=structuredClone(data.config.recipes[row.productId]);for(const part of recipes[row.productId])ids.add(part.id)}
 const products=[...ids].sort().map(id=>{const row=data.products.find(row=>row.id===id);if(!row)throw invalid();return {id,name:row.name,price:row.price,cost:row.cost,unit:row.unit||''}})
 const unassignedBasis=data.epoch?null:restaurantMenuDigest({config:data.config,products:data.products,entries:data.entries,operations:data.operations,orders:data.orders,cashLogs:data.cashLogs,waste:data.waste,shifts:data.shifts})
 return {enabled:data.config.enabled,fundsEnabled:data.config.fundsEnabled===true,recipes,products,unassignedBasis}
}
function bodyFor(scope,input,source){
 object(scope,['storeId','epoch','costMode']);id(scope.storeId);text(scope.epoch,128,true);if(!['active','reference'].includes(scope.costMode)||input.storeId!==scope.storeId)throw invalid()
 object(input,['protocol','id','issuedAt','storeId','catalogueRevision','kind','items']);assertOrdinaryRestaurantAgentDraft(input)
 object(source,['enabled','fundsEnabled','recipes','products','unassignedBasis'])
 if(source.enabled!==true||typeof source.fundsEnabled!=='boolean'||(source.fundsEnabled||scope.costMode==='active')&&!scope.epoch)throw invalid()
 if(scope.epoch?source.unassignedBasis!==null:typeof source.unassignedBasis!=='string'||!/^sha256:[a-f0-9]{64}$/.test(source.unassignedBasis))throw invalid()
 object(source.recipes,source.recipes&&typeof source.recipes==='object'?Object.keys(source.recipes):[],[]);const products=new Map(),needed=new Set(input.items.map(row=>row.productId))
 for(const row of array(source.products,1,20000)){object(row,['id','name','price','cost','unit']);id(row.id);text(row.name,500);text(row.unit,100,true);moneyValue(row.price,'售價');moneyValue(row.cost,'成本');if(products.has(row.id))throw invalid();products.set(row.id,row)}
 for(const [target,rows]of Object.entries(source.recipes)){if(!input.items.some(row=>row.productId===target))throw invalid();const seen=new Set();for(const part of array(rows,1,100)){object(part,['id','qty']);id(part.id);quantityValue(part.qty,'配方用量',.001);if(seen.has(part.id)||target===part.id||Object.hasOwn(source.recipes,part.id))throw invalid();seen.add(part.id);needed.add(part.id)}}
 if(products.size!==needed.size||[...needed].some(id=>!products.has(id)))throw invalid()
 const items=input.items.map(row=>{const product=products.get(row.productId);return {id:row.productId,name:product.name,price:product.price,qty:row.qty,unit:product.unit||'個'}}),total=items.reduce((sum,row)=>sum+BigInt(Math.round(row.price*100))*BigInt(row.qty),0n)
 if(total>100000000000n)throw Error('合計需為有效金額，最多兩位小數')
 return {protocol:ORDINARY_RESTAURANT_AGENT_REVIEW,scope:structuredClone(scope),input:structuredClone(input),source:structuredClone(source),items,totalCents:Number(total)}
}
function quoteFor(data,draft){const body=bodyFor(scopeFor(data),inputFor(draft),sourceFor(data,draft)),quote={...body,issuedAt:new Date(clock(data.now)).toISOString(),signature:restaurantMenuDigest(body)};bounded(quote);return quote}
export function validateOrdinaryRestaurantReview(value){
 bounded(value);object(value,['protocol','scope','input','source','items','totalCents','issuedAt','signature']);if(value.protocol!==ORDINARY_RESTAURANT_AGENT_REVIEW)throw invalid();iso(value.issuedAt)
 const body=bodyFor(value.scope,value.input,value.source),rebuilt={...body,issuedAt:value.issuedAt,signature:restaurantMenuDigest(body)};if(!same(rebuilt,value))throw invalid();return structuredClone(value)
}
function availability(data,review){
 const amounts=new Map();for(const item of review.input.items)for(const row of Object.hasOwn(review.source.recipes,item.productId)?review.source.recipes[item.productId]:[{id:item.productId,qty:1}])amounts.set(row.id,(amounts.get(row.id)||0n)+BigInt(Math.round(row.qty*1000))*BigInt(item.qty))
 const shortages=[];for(const [id,amount]of amounts){if(amount>1000000000000n)throw Error('品項預留量超過支援範圍，請分開建單。');const product=data.products.find(row=>row.id===id);if(!product)throw invalid();const available=Math.max(0,Math.round(quantityValue(product.stock,'庫存')*1000));if(amount>BigInt(available))shortages.push({productId:id,requiredUnits:Number(amount),availableUnits:available})}
 return {available:!shortages.length,shortages}
}
export function ordinaryRestaurantAgentPreview(input,data,actor){
 actorAllowed(actor,data.users);assertOrdinaryRestaurantAgentDraft(input.draft)
 const context=ordinaryRestaurantAgentContext(data,actor),draft={...input.draft,...(input.refresh?{catalogueRevision:context.catalogueRevision}:{})},preview=validateAgentDraft(draft,context,clock(data.now),true),fields=restaurantAgentFields(draft,true),normalized={...preview.draft,...fields}
 if(normalized.items.some(row=>data.config.menu?.offers.some(offer=>offer.productId===row.productId)))throw Error('這道餐點有份量與加料，請改用菜單餐點建單。')
 const review=quoteFor(data,normalized);return {protocol:'pos-restaurant-agent-preview/v1',profile:'ordinary',status:'review',draft:normalized,ordinaryReview:review,availability:availability(data,review)}
}
export function reviewedOrdinaryRestaurantDraft(draft,context,result,now=Date.now(),allowIncomplete=false){
 assertOrdinaryRestaurantAgentDraft(draft);const checked=validateAgentDraft(draft,context,now,allowIncomplete),fields=restaurantAgentFields(draft,allowIncomplete),normalized={...checked.draft,...fields}
 if(result?.protocol!=='pos-restaurant-agent-preview/v1'||result.profile!=='ordinary'||result.status!=='review'||!same(inputFor(result.draft),inputFor(normalized))||typeof result.availability?.available!=='boolean')throw invalid()
 const review=validateOrdinaryRestaurantReview(result.ordinaryReview),items=checked.items.map(({id,name,price,qty,unit})=>({id,name,price,qty,unit}))
 if(!same(review.input,inputFor(normalized))||!same(review.items,items)||review.totalCents!==Math.round(checked.total*100))throw Error('餐點報價與原選擇不同，請重新核對。')
 return {...checked,draft:normalized,note:fields.note,ordinaryReview:review,availability:result.availability}
}
export function assertOrdinaryRestaurantAgentSource(request,{data=null,actor=null}={}){
 const draft=assertOrdinaryRestaurantAgentDraft(request.agentDraft),review=validateOrdinaryRestaurantReview(request.ordinaryReview),fields=restaurantAgentFields(draft),age=Date.parse(request.time)-Date.parse(draft.issuedAt)
 object(request,['id','kind','action','time','storeId','epoch','costMode','fundsProtocol','day','slot','channel','customer','contact','note','items','agentDraft','ordinaryReview','draftContext'],['id','kind','action','time','storeId','epoch','costMode','day','slot','channel','customer','contact','note','items','agentDraft','ordinaryReview'])
 const fundingMatches=review.source.fundsEnabled?request.fundsProtocol==='pos-restaurant-funds/v1':!Object.hasOwn(request,'fundsProtocol')
 const sourceMatches=request.kind==='restaurant'&&request.action==='create'&&request.id==='agent-'+draft.id&&request.time===review.issuedAt&&age>= -300000&&age<=86400000&&same(review.input,inputFor(draft))&&same(review.scope,{storeId:request.storeId,epoch:request.epoch,costMode:request.costMode})&&same(request.items,review.items.map(({id,price,qty})=>({id,price,qty})))&&!Object.entries(fields).some(([key,value])=>request[key]!==value)&&fundingMatches
 if(!sourceMatches)throw Error('原編號已用於不同內容，請保留原單核對。')
 if(data){actorAllowed(actor,data.users);validateAgentDraft(draft,ordinaryRestaurantAgentContext(data,actor),clock(data.now));const current=quoteFor(data,draft),age=clock(data.now)-Date.parse(review.issuedAt);if(age<0||age>300000)throw Error('餐點報價已過期，請重新核對。');if(current.signature!==review.signature)throw Error('餐點價格或配方已變更，請重新核對。');if(!availability(data,current).available)throw Error('原料可用量不足，請調整餐點。')}
 return review
}
export function ordinaryRestaurantAgentOriginal(draft,entry,receipt,storeId){
 assertOrdinaryRestaurantAgentDraft(draft);if(draft.storeId!==storeId||!entry||entry.menu||receipt?.action!=='create'||entry.id!=='agent-'+draft.id||receipt.id!==entry.id)throw Error('原編號已用於不同內容，請保留原單核對。')
 const request=JSON.parse(receipt.signature),fields=restaurantAgentFields(draft),items=draft.items.map(({productId,qty})=>({id:productId,qty})),originalItems=request.items?.map(({id,qty})=>({id,qty}))
 if((request.agentDraft?.issuedAt??request.time)!==draft.issuedAt||!same(items,originalItems)||Object.entries(fields).some(([key,value])=>value!==(typeof request[key]==='string'?request[key].trim():request[key])))throw Error('原編號已用於不同內容，請保留原單核對。')
 if(request.agentDraft){assertOrdinaryRestaurantAgentSource(request);for(const key of ['supplierId','date'])if((draft[key]??null)!==(request.agentDraft[key]??null))throw Error('原編號已用於不同內容，請保留原單核對。')}
 const totalCents=request.items.reduce((sum,row)=>sum+Math.round(row.price*100)*row.qty,0);if(!Number.isSafeInteger(totalCents)||totalCents<0)throw invalid();return {id:entry.id,status:entry.status,totalCents,currentTotalCents:Math.round(entry.total*100)}
}
