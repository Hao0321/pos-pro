import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'
import {canonicalSignature} from './operationRules.mjs'

export const RESTAURANT_MENU_PROTOCOL='pos-restaurant-menu/v1'
export const RESTAURANT_MENU_QUOTE_PROTOCOL='pos-restaurant-menu-quote/v1'
// M6 replaces this boundary only when menu commits, history and recovery are wired.
// Unsupported intent must never become a successful plain-price reservation.
export function assertRestaurantMenuBoundary(request,{configuration=false,creation=false}={}){
 const keys=['menuProtocol','menuQuote','menuReview','agentDraft','ordinaryReview','draftContext','offerId','variantId','lineId','selections','choices','options','modifiers']
 const hasIntent=value=>value&&typeof value==='object'&&keys.some(key=>Object.hasOwn(value,key))
 if(!creation&&hasIntent(request)||!configuration&&request?.config&&Object.hasOwn(request.config,'menu')||Array.isArray(request?.items)&&request.items.some(hasIntent))throw error('餐點選項需要重新核對，請保留原單。','RESTAURANT_MENU_UNWIRED')
}
const MAX_CENTS=100000000000n,MAX_UNITS=1000000000000n,MAX_CAPACITY=1000000000n
const error=(message='餐點選項資料需要核對，請保留原選擇。',code='RESTAURANT_MENU_INVALID',details={})=>Object.assign(Error(message),{code,...details})
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const ordinal=(a,b)=>a===b?0:a<b?-1:1
const optional=(value,key,fallback)=>Object.hasOwn(value,key)?value[key]:fallback
const digest=value=>'sha256:'+bytesToHex(sha256(new TextEncoder().encode(canonicalSignature(value))))
export const restaurantMenuDigest=digest
function boundedStructure(value,maxNodes=35000,maxChars=350000){
 const pending=[{value,depth:0}];let nodes=0,chars=0
 while(pending.length){const {value,depth}=pending.pop();if(++nodes>maxNodes||depth>18)throw error('這張餐點的選項資料過多，請分開核對。');if(typeof value==='string'){chars+=value.length;if(chars>maxChars)throw error('這張餐點的選項資料過多，請分開核對。')}else if(value&&typeof value==='object'){const values=Object.values(value);if(values.length>1000)throw error();for(const child of values)pending.push({value:child,depth:depth+1})}else if(value!==null&&!['number','boolean','undefined'].includes(typeof value))throw error()}
}
function object(value,allowed,required=allowed){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw error()
 return value
}
function array(value,min,max){
 if(!Array.isArray(value)||value.length<min||value.length>max||Object.keys(value).length!==value.length)throw error()
 for(let index=0;index<value.length;index++)if(!Object.hasOwn(value,index))throw error()
 return value
}
function identifier(value,max=128){if(typeof value!=='string'||value.length>max||!/^[-A-Za-z0-9_:]+$/.test(value))throw error();return value}
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw error();return value.trim()}
function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw error();return value}
function scaled(value,places,{signed=false,max=MAX_UNITS}={}){
 if(typeof value!=='number'||!Number.isFinite(value)||Object.is(value,-0))throw error()
 const raw=String(value),match=/^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw)
 if(!match||match[3]?.length>places||match[1]&&!signed)throw error()
 const multiplier=10n**BigInt(places),amount=(BigInt(match[2])*multiplier+BigInt((match[3]||'').padEnd(places,'0')||'0'))*(match[1]?-1n:1n)
 if(amount>max||amount< -max)throw error('餐點選項的數量或金額超過支援範圍。')
 return amount
}
const cents=(value,signed=false)=>scaled(value,2,{signed,max:MAX_CENTS})
const units=(value,signed=false)=>scaled(value,3,{signed,max:MAX_UNITS})
function bounded(value,max){if(value<0n||value>max)throw error('餐點選項的數量或金額超過支援範圍。');return Number(value)}
function unique(values,key){const seen=new Set();for(const value of values){const id=key(value);if(seen.has(id))throw error();seen.add(id)}return values}
function productIndex(products){const index=new Map();for(const product of array(products,1,20000)){identifier(product?.id);if(index.has(product.id))throw error();index.set(product.id,product)}return index}
function components(input,products,signed=false){
 return unique(array(input,signed?0:1,100).map(row=>{object(row,['id','qty']);identifier(row.id);if(!products.has(row.id)||units(row.qty,signed)===0n)throw error();return {id:row.id,qty:row.qty}}),row=>row.id).sort((a,b)=>ordinal(a.id,b.id))
}
function selectedChoices(input,group,{defaults=false}={}){
 const choices=unique(array(input,0,20).map(row=>{object(row,['id','qty']);identifier(row.id,64);const choice=group.choices.find(choice=>choice.id===row.id);if(!choice)throw error();integer(row.qty,1,choice.max);return {id:row.id,qty:row.qty}}),row=>row.id).sort((a,b)=>ordinal(a.id,b.id))
 const count=choices.reduce((sum,row)=>sum+row.qty,0)
 if(count>group.max||count<group.min&&(!defaults||choices.length))throw error('請完成餐點的必選項目。','RESTAURANT_MENU_SELECTION',{groupId:group.id})
 return choices
}
function normalizeGroup(raw,products){
 object(raw,['id','name','min','max','defaults','choices']);identifier(raw.id,64);text(raw.name,60);integer(raw.min,0,100);integer(raw.max,1,100);if(raw.min>raw.max)throw error()
 const choices=unique(array(raw.choices,1,20).map(choice=>{
  object(choice,['id','name','priceDelta','max','components','omit'],['id','name','priceDelta','max','components']);identifier(choice.id,64);text(choice.name,40);cents(choice.priceDelta,true);integer(choice.max,1,100)
  const omit=unique(array(optional(choice,'omit',[]),0,100).map(value=>{identifier(value);if(!products.has(value))throw error();return value}),value=>value).sort()
  return {id:choice.id,name:choice.name.trim(),priceDelta:choice.priceDelta,max:choice.max,components:components(choice.components,products,true),omit}
 }),choice=>choice.id)
 const group={id:raw.id,name:raw.name.trim(),min:raw.min,max:raw.max,choices,defaults:[]};group.defaults=selectedChoices(raw.defaults,group,{defaults:true});return group
}
export function normalizeRestaurantMenu(input,products){
 boundedStructure(input)
 object(input,['protocol','offers']);if(input.protocol!==RESTAURANT_MENU_PROTOCOL)throw error()
 const index=productIndex(products),offers=unique(array(input.offers,1,100).map(raw=>{
  object(raw,['id','productId','name','defaultVariantId','variants','groups'],['id','productId','defaultVariantId','variants']);identifier(raw.id,64);identifier(raw.productId);identifier(raw.defaultVariantId,64)
  const product=index.get(raw.productId);if(!product)throw error();const name=text(optional(raw,'name',product.name),120)
  const variants=unique(array(raw.variants,1,20).map(variant=>{object(variant,['id','name','price','capacity','components'],['id','name']);identifier(variant.id,64);text(variant.name,40);const price=optional(variant,'price',product.price),capacity=optional(variant,'capacity',1);cents(price);integer(capacity,1,100);return {id:variant.id,name:variant.name.trim(),price,capacity,components:components(optional(variant,'components',[{id:product.id,qty:1}]),index)}}),variant=>variant.id)
  if(!variants.some(variant=>variant.id===raw.defaultVariantId))throw error()
  const groups=unique(array(optional(raw,'groups',[]),0,8).map(group=>normalizeGroup(group,index)),group=>group.id)
  return {id:raw.id,productId:raw.productId,name,defaultVariantId:raw.defaultVariantId,variants,groups}
 }),offer=>offer.id)
 return {protocol:RESTAURANT_MENU_PROTOCOL,offers}
}
export function normalizeRestaurantSelections(input,menu){
 const lines=new Map()
 for(const raw of array(input,1,100)){
  object(raw,['offerId','variantId','qty','selections'],['offerId','qty']);identifier(raw.offerId,64);integer(raw.qty,1,100000)
  const offer=menu.offers.find(offer=>offer.id===raw.offerId);if(!offer)throw error()
  const variantId=optional(raw,'variantId',offer.defaultVariantId);identifier(variantId,64);if(!offer.variants.some(variant=>variant.id===variantId))throw error()
  const selections=unique(array(optional(raw,'selections',[]),0,8).map(row=>{object(row,['groupId','choices']);identifier(row.groupId,64);const group=offer.groups.find(group=>group.id===row.groupId);if(!group)throw error();return {groupId:row.groupId,choices:selectedChoices(row.choices,group)}}),row=>row.groupId)
  const complete=offer.groups.map(group=>({groupId:group.id,choices:selectedChoices(selections.find(row=>row.groupId===group.id)?.choices??group.defaults,group)}))
  const key=digest({offerId:offer.id,variantId,selections:complete.map(row=>({...row,choices:[...row.choices]})).sort((a,b)=>ordinal(a.groupId,b.groupId))}),old=lines.get(key),qty=(old?.qty||0)+raw.qty;integer(qty,1,100000)
  lines.set(key,{offerId:offer.id,variantId,qty,selections:complete})
 }
 return [...lines.values()]
}
function sourceFor(input,menu,products,config){
 const selectedIds=new Set(input.map(row=>row.offerId)),offers=menu.offers.filter(offer=>selectedIds.has(offer.id)).sort((a,b)=>ordinal(a.id,b.id)),index=productIndex(products),ids=new Set(),componentIds=new Set(),recipes=Object.create(null)
 for(const offer of offers){ids.add(offer.productId);for(const variant of offer.variants)for(const component of variant.components)componentIds.add(component.id);for(const group of offer.groups)for(const choice of group.choices){for(const component of choice.components)componentIds.add(component.id);for(const id of choice.omit)ids.add(id)}}
 if(config!==undefined&&(!config||typeof config!=='object'||Array.isArray(config)))throw error()
 const rawRecipes=config===undefined?{}:optional(config,'recipes',{});if(!rawRecipes||typeof rawRecipes!=='object'||Array.isArray(rawRecipes))throw error();const outputs=new Set(Object.keys(rawRecipes))
 for(const id of [...componentIds].sort()){
  ids.add(id)
  if(!Object.hasOwn(rawRecipes,id))continue
  const rows=unique(array(rawRecipes[id],1,100).map(row=>{object(row,['id','qty']);identifier(row.id);if(!index.has(row.id)||outputs.has(row.id)||units(row.qty)<=0n)throw error('餐點配方需要核對，請使用原料與包材。');ids.add(row.id);return {id:row.id,qty:row.qty}}),row=>row.id).sort((a,b)=>ordinal(a.id,b.id));recipes[id]=rows
 }
 if(ids.size>1000)throw error()
 const sources=[...ids].sort().map(id=>{const product=index.get(id);if(!product)throw error();text(product.name,500);cents(product.price);cents(product.cost);const unit=optional(product,'unit','');if(typeof unit!=='string'||unit.length>100)throw error();return {id,name:product.name,price:product.price,cost:product.cost,unit}})
 return {menu:{protocol:RESTAURANT_MENU_PROTOCOL,offers},products:sources,recipes}
}
function expanded(components,source){
 const result=new Map()
 for(const part of components){const amount=units(part.qty,true);for(const row of source.recipes[part.id]||[{id:part.id,qty:1}])result.set(row.id,(result.get(row.id)||0n)+amount*units(row.qty))}
 return result
}
function lineResources(offer,variant,selections,source){
 const amounts=expanded(variant.components,source),changes=new Map(),omitted=new Set()
 for(const selection of selections){const group=offer.groups.find(group=>group.id===selection.groupId);for(const selected of selection.choices){const choice=group.choices.find(choice=>choice.id===selected.id);for(const id of choice.omit){if(omitted.has(id)||!amounts.has(id))throw error('餐點選項彼此衝突，請重新選擇。');omitted.add(id)}for(const [id,value]of expanded(choice.components,source))changes.set(id,(changes.get(id)||0n)+value*BigInt(selected.qty))}}
 for(const id of omitted){if(changes.has(id))throw error('餐點選項彼此衝突，請重新選擇。');amounts.delete(id)}
 for(const [id,value]of changes)amounts.set(id,(amounts.get(id)||0n)+value)
 const rows=[]
 for(const [id,numerator]of [...amounts].sort(([a],[b])=>ordinal(a,b))){
  if(numerator<0n)throw error('餐點選項扣除的原料超過原配方。')
  if(numerator%1000n)throw error('原料用量太細，請改用較小單位再設定。')
  const amount=numerator/1000n;if(!amount)continue
  const product=source.products.find(product=>product.id===id);if(!product)throw error();rows.push({id,name:product.name,qty:bounded(amount,MAX_UNITS)/1000,unitCost:product.cost})
 }
 if(!rows.length||rows.length>100)throw error('餐點必須保留可核對的原料或成品。')
 return rows
}
export function restaurantMenuLineSummary(input,menu){
 const offer=menu.offers.find(offer=>offer.id===input.offerId),variant=offer.variants.find(variant=>variant.id===input.variantId),selections=input.selections
 let price=cents(variant.price);const labels=[offer.name,variant.name]
 for(const selection of selections){const group=offer.groups.find(group=>group.id===selection.groupId);for(const selected of selection.choices){const choice=group.choices.find(choice=>choice.id===selected.id);price+=cents(choice.priceDelta,true)*BigInt(selected.qty);labels.push(choice.name+(selected.qty>1?' × '+selected.qty:''))}}
 const name=labels.join(' · ');if(name.length>500)throw error('餐點選項名稱太長，請縮短後再設定。');bounded(price,MAX_CENTS)
 const id='ml-'+digest({offerId:offer.id,variantId:variant.id,selections:selections.map(row=>({...row,choices:[...row.choices]})).sort((a,b)=>ordinal(a.groupId,b.groupId))}).slice(7)
 return {id,name,price:Number(price)/100,qty:input.qty}
}
function lineFacts(input,source){
 const offer=source.menu.offers.find(offer=>offer.id===input.offerId),variant=offer.variants.find(variant=>variant.id===input.variantId),selections=input.selections,summary=restaurantMenuLineSummary(input,source.menu),id=summary.id,rows=lineResources(offer,variant,selections,source)
 const costNumerator=rows.reduce((sum,row)=>sum+cents(row.unitCost)*units(row.qty),0n),cost=bounded((costNumerator+500n)/1000n,MAX_CENTS)
 return {item:{...summary,cost:cost/100},costNumerator,allocation:{itemId:id,rows},identity:{lineId:id,offerId:offer.id,productId:offer.productId,variantId:variant.id,selections:structuredClone(selections),capacityPerUnit:variant.capacity}}
}
function scopeFor(data){
 identifier(data?.storeId);identifier(data?.epoch);if(!['active','reference'].includes(data?.costMode))throw error()
 return {storeId:data.storeId,epoch:data.epoch,costMode:data.costMode}
}
function clock(value){const instant=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;if(!Number.isSafeInteger(instant)||instant<0||instant>8640000000000000)throw error();const iso=new Date(instant).toISOString();return {instant,iso}}
function buildQuote(data,input){
 const menu=normalizeRestaurantMenu(data.menu,data.products),normalized=normalizeRestaurantSelections(input,menu),source=sourceFor(normalized,menu,data.products,data.config),scope=scopeFor(data),now=clock(data.now),lines=normalized.map(row=>lineFacts(row,source)),resources=new Map()
 let total=0n,cost=0n,capacity=0n,quantity=0n
 for(const line of lines){const amount=BigInt(line.item.qty);total+=cents(line.item.price)*amount;cost+=line.costNumerator*amount;capacity+=BigInt(line.identity.capacityPerUnit)*amount;quantity+=amount;for(const row of line.allocation.rows){const old=resources.get(row.id);resources.set(row.id,{id:row.id,name:row.name,unitCost:row.unitCost,amount:(old?.amount||0n)+units(row.qty)*amount})}}
 // Keep the original fund ledger's first-use ordering across distinct lines.
 // Per-line resources and source identities already use ordinal ordering.
 const allocations=[...resources.values()].map(({amount,...row})=>({...row,qty:bounded(amount,MAX_UNITS)/1000})),body={protocol:RESTAURANT_MENU_QUOTE_PROTOCOL,scope,input:normalized,source,items:lines.map(line=>line.item),itemAllocations:lines.map(line=>line.allocation),lineFacts:lines.map(line=>line.identity),allocations,totalCents:bounded(total,MAX_CENTS),referenceCostCents:bounded((cost+500n)/1000n,MAX_CENTS),quantity:bounded(quantity,10000000n),capacity:bounded(capacity,MAX_CAPACITY)}
 const quote={...body,issuedAt:now.iso,signature:digest(body)}
 if(new TextEncoder().encode(JSON.stringify(quote)).length>262144)throw error('這張餐點的選項資料過多，請分開核對。')
 return quote
}
function availabilityFor(data,quote){
 const index=productIndex(data.products),stocks=new Map()
 for(const row of quote.source.products){const product=index.get(row.id);if(!product)throw error();stocks.set(row.id,units(product.stock,true))}
 const shortages=quote.allocations.flatMap(row=>{const available=stocks.get(row.id),required=units(row.qty);return required>available?[{productId:row.id,requiredUnits:Number(required),availableUnits:Number(available>0n?available:0n)}]:[]})
 const lines=quote.itemAllocations.map(allocation=>{let available=null;for(const row of allocation.rows){const stock=stocks.get(row.id),count=(stock>0n?stock:0n)/units(row.qty);available=available===null||count<available?count:available}return {lineId:allocation.itemId,available:bounded(available,MAX_UNITS)}})
 return {available:shortages.length===0,lines,shortages}
}
export function quoteRestaurantMenu(data,input){const quote=buildQuote(data,input);return {quote,availability:availabilityFor(data,quote)}}
export function validateRestaurantMenuQuote(value){
 boundedStructure(value,65000,262144)
 object(value,['protocol','scope','input','source','items','itemAllocations','lineFacts','allocations','totalCents','referenceCostCents','quantity','capacity','issuedAt','signature'])
 object(value.scope,['storeId','epoch','costMode']);object(value.source,['menu','products','recipes'])
 if(value.protocol!==RESTAURANT_MENU_QUOTE_PROTOCOL||typeof value.signature!=='string'||!/^sha256:[a-f0-9]{64}$/.test(value.signature))throw error()
 for(const product of array(value.source.products,1,1000))object(product,['id','name','price','cost','unit'])
 const rebuilt=buildQuote({...value.scope,now:value.issuedAt,menu:value.source.menu,products:value.source.products,config:{recipes:value.source.recipes}},value.input)
 if(!same(rebuilt,value))throw error('餐點報價與原選擇不同，請重新核對。')
 return structuredClone(value)
}
export function reviewRestaurantMenuQuote(data,value){
 const original=validateRestaurantMenuQuote(value),scope=scopeFor(data)
 if(!same(original.scope,scope))throw error('餐點報價屬於不同店面或還原版本，請重新核對。','RESTAURANT_MENU_SCOPE')
 const age=clock(data.now).instant-clock(original.issuedAt).instant
 if(age<0||age>300000)throw error('餐點報價已過期，請重新核對。','RESTAURANT_MENU_EXPIRED')
 const current=quoteRestaurantMenu(data,original.input)
 if(current.quote.signature!==original.signature)throw error('餐點價格或配方已變更，請重新核對。','RESTAURANT_MENU_STALE')
 if(!current.availability.available)throw error('原料可用量不足，請調整餐點。','RESTAURANT_MENU_STOCK',{shortages:current.availability.shortages})
 return current
}
export function captureRestaurantMenuConfiguration(config,products){
 const menu=normalizeRestaurantMenu(config.menu,products),source=sourceFor(menu.offers.map(offer=>({offerId:offer.id})),menu,products,config)
 const result={protocol:'pos-restaurant-menu-configuration/v1',source}
 if(new TextEncoder().encode(JSON.stringify(result)).length>524288)throw error('這張餐點的選項資料過多，請分開核對。')
 return result
}
export function validateRestaurantMenuConfiguration(value,config){
 boundedStructure(value,65000,524288);object(value,['protocol','source']);object(value.source,['menu','products','recipes']);if(value.protocol!=='pos-restaurant-menu-configuration/v1')throw error()
 for(const product of array(value.source.products,1,1000))object(product,['id','name','price','cost','unit'])
 if(!same(captureRestaurantMenuConfiguration(config,value.source.products),value))throw error('餐點報價與原選擇不同，請重新核對。')
 return value
}
export function assertRestaurantMenuQuoteConfiguration(quote,configuration){
 const selected=new Set(quote.input.map(row=>row.offerId)),menu={protocol:RESTAURANT_MENU_PROTOCOL,offers:configuration.source.menu.offers.filter(offer=>selected.has(offer.id))}
 if(!same(sourceFor(quote.input,menu,quote.source.products,{recipes:configuration.source.recipes}),quote.source))throw error('餐點報價與原選擇不同，請重新核對。')
}
