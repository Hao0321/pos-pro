import {canonicalSignature,moneyValue,quantityValue} from './operationRules.mjs'
import {summarizeRestaurantFunds} from './restaurantFunds.mjs'
import {validateCustomerMenuOrder,assertCustomerMenuIntake} from './restaurantCustomerMenu.mjs'

export const RESTAURANT_INTAKE_FEATURE='restaurant-intake-v1'
export function normalizeTableOrdering(value){
 if(!value||value.version!==1||typeof value.enabled!=='boolean'||!Array.isArray(value.tables)||value.tables.length>200||value.enabled&&!value.tables.length||Object.keys(value).some(k=>!['version','enabled','tables'].includes(k)))throw Error('桌碼設定需要核對')
 const ids=new Set(),labels=new Set(),tables=value.tables.map(row=>{
  if(!row||Object.keys(row).length!==2||typeof row.id!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(row.id)||typeof row.label!=='string'||!row.label.trim()||row.label!==row.label.trim()||row.label.length>40||/[\x00-\x1f\x7f]/.test(row.label)||ids.has(row.id)||labels.has(row.label))throw Error('桌碼設定需要核對')
  ids.add(row.id);labels.add(row.label);return {id:row.id,label:row.label}
 })
 return {version:1,enabled:value.enabled,tables}
}
export const usesRestaurantIntake=(config,entries=[],orders=[])=>Object.hasOwn(config||{},'tableOrdering')||entries.some(e=>Object.hasOwn(e,'customerOrderId'))||orders.some(o=>o.tableId||o.trackingProof)
export function validateTableOrderSources(orders){for(const o of orders){
 if(Object.hasOwn(o,'trackingProof')){const p=o.trackingProof,fields=p?.version===2?'data,iv,menuSignature,tag,version':'data,iv,tag,version';if(o.source!=='customer'||!p||Object.keys(p).sort().join(',')!==fields||![1,2].includes(p.version)||p.version===2&&(!Object.hasOwn(o,'customerMenu')||typeof p.menuSignature!=='string'||!/^[a-f0-9]{64}$/.test(p.menuSignature))||typeof p.iv!=='string'||!/^[a-f0-9]{24}$/.test(p.iv)||typeof p.tag!=='string'||!/^[a-f0-9]{32}$/.test(p.tag)||typeof p.data!=='string'||!/^[a-f0-9]{128}$/.test(p.data)||typeof o.trackingTokenHash!=='string'||!/^[a-f0-9]{64}$/.test(o.trackingTokenHash))throw Error('顧客追蹤紀錄需要核對')}
 if(Object.hasOwn(o,'tableId')||Object.hasOwn(o,'tableSignature')){if(o.source!=='customer'||typeof o.tableId!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(o.tableId)||typeof o.tableSignature!=='string'||!/^[a-f0-9]{64}$/.test(o.tableSignature)||typeof o.tableNum!=='string'||!o.tableNum||o.tableNum.length>40)throw Error('顧客桌碼紀錄需要核對')}
}}
export function customerOrderSnapshot(order){
 return canonicalSignature({id:order.id,source:order.source,status:order.status,time:order.time,requestSignature:order.requestSignature||'',tableNum:order.tableNum||'',tableId:order.tableId||'',items:order.items.map(i=>({id:i.id,name:i.name,price:i.price,qty:i.qty})),total:order.total,note:order.note||'',...(Object.hasOwn(order,'customerMenu')?{customerMenu:order.customerMenu}:{})})
}
export function makeCustomerIntake(order,now=new Date()){
 const pad=n=>String(n).padStart(2,'0')
 if(order.customerMenu)validateCustomerMenuOrder(order)
 return {action:'create',customerOrderId:order.id,customerOrderSignature:customerOrderSnapshot(order),channel:'walkin',day:now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate()),slot:pad(now.getHours())+':'+pad(Math.floor(now.getMinutes()/15)*15),customer:'',contact:'',note:order.note||'',...(order.customerMenu?{menuProtocol:'pos-restaurant-menu/v1'}:{items:order.items.map(i=>({id:i.id,qty:i.qty,price:i.price}))})}
}
export function customerIntakeSource(request,data){
 const source=data.orders.find(o=>o.id===request.customerOrderId)
 if(!source||source.source!=='customer'||source.status!=='pending'||source.payMethod!=='pending'||source.paid!==0||source.refundOf||data.entries.some(e=>e.customerOrderId===source.id))throw Error('這張顧客原單已處理，請重新核對')
 if(request.customerOrderSignature!==customerOrderSnapshot(source)||!source.customerMenu&&canonicalSignature(request.items)!==canonicalSignature(source.items.map(i=>({id:i.id,qty:i.qty,price:i.price})))||request.channel!=='walkin'||request.customer!==''||request.contact!==''||request.note!==(source.note||''))throw Error('顧客原單內容已變更，請重新核對')
 if(source.customerMenu){if(request.items!==undefined||request.menuProtocol!=='pos-restaurant-menu/v1'||!request.menuReview)throw Error('顧客原單內容已變更，請重新核對');assertCustomerMenuIntake(source,request.menuReview)}
 const current=makeCustomerIntake(source,new Date(request.time))
 if(request.day!==current.day||request.slot!==current.slot)throw Error('接單日期或時段需要重新核對')
 return source
}
export function customerOrderView(order,entries){
 const entry=entries.find(e=>e.customerOrderId===order.id)
 if(!entry)return order
 if(entry.funds){
  const summary=summarizeRestaurantFunds(entry.funds)
  return {...order,status:entry.status==='cancelled'?'rejected':entry.status==='completed'?'completed':'accepted',restaurantId:entry.id,fulfilmentStatus:entry.status,pickupNumber:entry.pickupNumber,paymentReceived:entry.status!=='cancelled'&&summary.dueCents===0,currentTotal:summary.totalCents/100,amountReceived:summary.retainedCents/100,amountDue:summary.dueCents/100,amountRefunded:summary.refundedCents/100,remainingItems:entry.items.map(({id,name,price,qty})=>({id,name,price,qty}))}
 }
 return {...order,status:entry.status==='cancelled'?'rejected':entry.status==='completed'?'completed':'accepted',restaurantId:entry.id,fulfilmentStatus:entry.status,pickupNumber:entry.pickupNumber,paymentReceived:!!entry.saleId}
}
export function assertCustomerOrderLink(entry,orders){
 const source=orders.find(o=>o.id===entry.customerOrderId)
 if(!!source?.customerMenu!==!!entry.menu)throw Error('顧客原單與出餐紀錄需要核對')
 if(source?.customerMenu)assertCustomerMenuIntake(source,{configurationId:entry.menu.configurationId,quote:entry.menu.quote})
 const originalItems=entry.funds?.items||entry.items,originalTotal=entry.funds?summarizeRestaurantFunds(entry.funds).originalTotalCents/100:entry.total
 if(!source||source.source!=='customer'||source.payMethod!=='pending'||source.paid!==0||source.refundOf||entry.channel!=='walkin'||(entry.tableNum||'')!==(source.tableNum||'')||(entry.tableId||'')!==(source.tableId||'')||originalTotal!==source.total||canonicalSignature(originalItems.map(i=>({id:i.id,price:i.price,qty:i.qty})))!==canonicalSignature(source.items.map(i=>({id:i.id,price:i.price,qty:i.qty}))))throw Error('顧客原單與出餐紀錄需要核對')
}
const units=v=>BigInt(Math.round(quantityValue(v,'庫存數量')*1000))
export function publicOrderingMenu(products,config){
 const ingredients=new Set(config.enabled?Object.values(config.recipes).flat().map(i=>i.id):[])
 return products.filter(p=>!ingredients.has(p.id)&&p.price>0).map(p=>{
  const recipe=config.enabled?config.recipes[p.id]:null
  const stock=recipe?Number(recipe.reduce((min,r)=>{const available=units(products.find(p=>p.id===r.id).stock)/units(r.qty);return min===null||available<min?available:min},null)):p.stock
  return {id:p.id,name:p.name,category:p.category,price:moneyValue(p.price,'售價'),stock,unit:p.unit}
 }).filter(p=>p.stock>0)
}
export function assertPublicRecipeAvailability(items,products,config){
 if(!config.enabled)return
 const totals=new Map()
 for(const item of items)for(const row of config.recipes[item.id]||[{id:item.id,qty:1}])totals.set(row.id,(totals.get(row.id)||0n)+units(row.qty)*BigInt(item.qty))
 for(const [id,required]of totals)if(required>units(products.find(p=>p.id===id).stock))throw Error('原料可用量已變更，請重新確認餐點')
}
