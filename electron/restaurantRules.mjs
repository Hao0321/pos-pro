import {operationHeader,moneyValue,quantityValue,canonicalSignature} from './operationRules.mjs'
import {normalizeTableOrdering,customerIntakeSource,assertCustomerOrderLink,validateTableOrderSources} from './tableOrdering.mjs'
import {normalizeKitchenPrinting} from './kitchenPrint.mjs'
import {initializeFundedRestaurant,planFundedRestaurant,fundedRestaurantReceipt} from './restaurantFundedPlan.mjs'
import {validateFundedRestaurantRecords} from './restaurantFundedRecords.mjs'
import {restaurantCapacityQuantity} from './restaurantFunds.mjs'
import {assertRestaurantFundsSetupProposal} from './restaurantFundsSetup.mjs'

export const RESTAURANT_KIND='restaurant'
export const RESTAURANT_STATES=['reserved','cooking','ready','dispatched','completed','cancelled']
export const defaultRestaurantConfig=()=>({enabled:false,dailyCapacity:30,slotCapacity:5,recipes:{}})
const units=(v,label)=>Math.round(quantityValue(v,label)*1000)
const cents=v=>Math.round(moneyValue(v,'金額')*100)
const text=(v,max,label)=>{if(typeof v!=='string'||v.length>max)throw Error(label+'格式不正確');return v.trim()}
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(v))throw Error('品項編號格式不正確');return v}
const positiveInt=(v,label,max=100000)=>{if(!Number.isSafeInteger(v)||v<1||v>max)throw Error(label+'須為有效正整數');return v}

export function normalizeRestaurantConfig(input,products){
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.enabled!=='boolean'||!input.recipes||typeof input.recipes!=='object'||Array.isArray(input.recipes))throw Error('預訂設定格式不正確')
  if(Object.hasOwn(input,'fundsEnabled')&&typeof input.fundsEnabled!=='boolean')throw Error('分次收款設定格式不正確。')
  const recipes=Object.entries(input.recipes).map(([target,rows])=>{
    id(target);if(!products.some(p=>p.id===target)||!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('配方商品不存在或明細不正確')
    const seen=new Set(),items=rows.map(row=>{
      id(row?.id);const p=products.find(p=>p.id===row.id)
      if(!p||target===row.id||seen.has(row.id))throw Error('配方原料不存在、重複或使用自身商品')
      seen.add(row.id);if(units(row.qty,'配方用量')<1)throw Error('配方用量必須大於零')
      return {id:row.id,qty:row.qty}
    })
    return [target,items]
  })
  // Recipe outputs cannot also be ingredient inputs: production has one explicit level.
  const outputs=new Set(recipes.map(([target])=>target))
  if(recipes.some(([,rows])=>rows.some(r=>outputs.has(r.id))))throw Error('配方不支援相互引用；請以原料與包材建檔')
  return {enabled:input.enabled,dailyCapacity:positiveInt(input.dailyCapacity,'每日產能'),slotCapacity:positiveInt(input.slotCapacity,'時段產能'),recipes:Object.fromEntries(recipes),...(Object.hasOwn(input,'fundsEnabled')?{fundsEnabled:input.fundsEnabled}:{}),...(Object.hasOwn(input,'tableOrdering')?{tableOrdering:normalizeTableOrdering(input.tableOrdering)}:{}),...(Object.hasOwn(input,'kitchenPrinting')?{kitchenPrinting:normalizeKitchenPrinting(input.kitchenPrinting)}:{})}
}
export function readRestaurantConfig(raw,products){
  return raw==null?defaultRestaurantConfig():normalizeRestaurantConfig(typeof raw==='string'?JSON.parse(raw):raw,products)
}
export function restaurantAvailability(product,config,products){
  const recipe=config?.enabled&&Object.hasOwn(config.recipes,product.id)?config.recipes[product.id]:null
  return recipe?Math.max(0,Math.min(...recipe.map(r=>Math.floor(Math.round((products.find(p=>p.id===r.id)?.stock||0)*1000)/Math.round(r.qty*1000))))):product.stock
}
function validateSchedule(day,slot){
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('取餐日期不正確')
  if(typeof slot!=='string'||!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(slot))throw Error('請選擇每 15 分鐘的取餐時段')
}
export function validateRestaurantRecords(entries,operations,orders,products,context={}){
  if(!Array.isArray(entries)||!Array.isArray(operations))throw Error('預訂紀錄格式不正確')
  validateTableOrderSources(orders)
  validateFundedRestaurantRecords(entries,operations,orders,products,context)
  const seen=new Set(),customerIds=new Set()
  for(const e of entries){
    id(e?.id);validateSchedule(e.day,e.slot)
    if(Object.hasOwn(e,'funds')){
      if(seen.has(e.id))throw Error('預訂歷史紀錄需要核對');seen.add(e.id)
      if(Object.hasOwn(e,'customerOrderId')){id(e.customerOrderId);if(customerIds.has(e.customerOrderId))throw Error('顧客原單已重複接單');customerIds.add(e.customerOrderId);assertCustomerOrderLink(e,orders)}
      continue
    }
    if(seen.has(e.id)||!RESTAURANT_STATES.includes(e.status)||!['preorder','walkin','delivery'].includes(e.channel)||!Number.isSafeInteger(e.version)||e.version<1||!Array.isArray(e.items)||!e.items.length||!Array.isArray(e.allocations)||!e.allocations.length)throw Error('預訂歷史紀錄需要核對')
    seen.add(e.id);text(e.customer,100,'稱呼');text(e.contact,100,'聯絡方式');text(e.note,1000,'備註');operationHeader({id:e.id,time:e.createdAt})
    if(Object.hasOwn(e,'customerOrderId')){id(e.customerOrderId);if(customerIds.has(e.customerOrderId))throw Error('顧客原單已重複接單');customerIds.add(e.customerOrderId);assertCustomerOrderLink(e,orders)}
    if(!['reserved','cancelled'].includes(e.status)&&!e.startedAt||e.startedAt&&!Number.isFinite(Date.parse(e.startedAt)))throw Error('製作紀錄需要核對')
    const itemIds=new Set(),resourceIds=new Set()
    let total=0
    for(const i of e.items){id(i.id);if(itemIds.has(i.id))throw Error('預訂明細重複');if(!products.some(p=>p.id===i.id))throw Error('預訂品項已不存在');itemIds.add(i.id);positiveInt(i.qty,'份數');text(i.name,500,'品名');cents(i.cost);total+=cents(i.price)*i.qty}
    if(cents(e.total)!==total||e.quantity!==e.items.reduce((n,i)=>n+i.qty,0))throw Error('預訂金額或份數需要核對')
    if(e.pickupNumber!=null)positiveInt(e.pickupNumber,'取餐號',1000000)
    for(const a of e.allocations){id(a.id);if(resourceIds.has(a.id)||units(a.qty,'預留量')<1)throw Error('預留明細需要核對');resourceIds.add(a.id);cents(a.unitCost);text(a.name,500,'原料名稱');if(!products.some(p=>p.id===a.id))throw Error('預留品項已不存在')}
    if(e.saleId){const sale=orders.find(o=>o.id===e.saleId);if(!sale||sale.refundOf||cents(sale.total)!==total||canonicalSignature(sale.items.map(i=>({id:i.id,price:i.price,qty:i.qty})))!==canonicalSignature(e.items.map(i=>({id:i.id,price:i.price,qty:i.qty}))))throw Error('預訂收款流水需要核對')}
    if(e.status==='completed'&&!e.saleId)throw Error('交付紀錄缺少收款')
    if(e.refundId){const refund=orders.find(o=>o.id===e.refundId);if(e.status!=='cancelled'||!e.saleId||!refund||refund.refundOf!==e.saleId||cents(Math.abs(refund.total))!==total)throw Error('預訂退款流水需要核對')}
    if(e.status==='cancelled'&&e.saleId&&!e.refundId)throw Error('已收款取消紀錄缺少退款')
  }
  const operationIds=new Set()
  for(const op of operations){id(op?.id);if(operationIds.has(op.id)||typeof op.signature!=='string'||op.kind!==RESTAURANT_KIND||op.entityId&&!seen.has(op.entityId))throw Error('預訂操作回執需要核對');operationIds.add(op.id);const original=JSON.parse(op.signature);operationHeader(original);if(original.id!==op.id||original.action!==op.action||canonicalSignature(original)!==op.signature)throw Error('預訂回執內容需要核對')}
}
export function restaurantReceipt(request,receipt,data){
  if(receipt.fundsProtocol)return fundedRestaurantReceipt(request,receipt,data)
  if(receipt.signature!==canonicalSignature(request))throw Object.assign(Error('原操作編號已存在且內容不同，請核對已建立單據；新單請重新整理草稿'),{operationConflict:true})
  const entry=receipt.entityId?data.entries.find(e=>e.id===receipt.entityId):null
  if(receipt.entityId&&!entry)throw Error('原預訂紀錄已不存在，請核對備份')
  const products=receipt.productIds.map(id=>data.products.find(p=>p.id===id))
  if(products.some(p=>!p))throw Error('原回執品項已不存在，請核對備份')
  return {success:true,receipt,entry,products,config:data.config,order:entry?.saleId?data.orders.find(o=>o.id===entry.saleId):null,refund:entry?.refundId?data.orders.find(o=>o.id===entry.refundId):null}
}
export function planRestaurant(request,data,actor,finance){
  if(request.action!=='configure'&&data.entries.some(entry=>entry.id===request.entryId&&entry.funds))return planFundedRestaurant(request,data,actor)
  const plan=planLegacyRestaurant(request,data,actor,finance)
  return request.action==='create'&&data.config.fundsEnabled?initializeFundedRestaurant(plan,request,data,actor):plan
}
function planLegacyRestaurant(request,data,actor,finance){
  operationHeader(request)
  if(!actor||!['owner','staff'].includes(actor.role))throw Error('權限不足')
  if(request.kind!==RESTAURANT_KIND)throw Error('預訂操作類型不正確')
  const next={...data,products:data.products.map(p=>({...p})),entries:data.entries.map(e=>structuredClone(e)),orders:[...data.orders],waste:[...data.waste]}
  let entry,order,original,waste=[],config=data.config,changedIds=[]
  function stock(allocations,direction){for(const a of allocations){const p=next.products.find(p=>p.id===a.id);if(!p)throw Error('預留品項不存在');const amount=units(p.stock,'可用庫存')+direction*units(a.qty,'預留量');if(amount<0)throw Error(`${p.name}可用庫存不足`);p.stock=quantityValue(amount/1000,'庫存');changedIds.push(p.id)}}
  if(request.action==='configure'){
    if(actor.role!=='owner')throw Error('只有老闆能修改預訂設定')
    if(request.expectedConfig!==canonicalSignature(config))throw Error('預訂設定已變更，請重新核對')
    assertRestaurantFundsSetupProposal(request,data)
    config=normalizeRestaurantConfig(request.config,data.products);next.config=config
  }else if(request.action==='create'){
    if(!config.enabled)throw Error('請先由老闆確認產能與配方，啟用預訂出餐')
    validateSchedule(request.day,request.slot)
    if(!['preorder','walkin','delivery'].includes(request.channel)||!Array.isArray(request.items)||!request.items.length||request.items.length>100)throw Error('訂單來源或品項不正確')
    if(data.entries.some(e=>e.id===request.id)||data.orders.some(o=>o.id===request.id))throw Error('預訂編號已存在')
    const customerSource=Object.hasOwn(request,'customerOrderId')?customerIntakeSource(request,data):null
    const seen=new Set(),resources=new Map(),items=request.items.map(i=>{
      id(i?.id);const p=data.products.find(p=>p.id===i.id)
      if(!p||seen.has(i.id))throw Error('商品不存在或重複');seen.add(i.id);positiveInt(i.qty,'份數');moneyValue(p.price,'售價');moneyValue(p.cost,'成本')
      if(i.price!==p.price)throw Error('售價已變更，請重新核對')
      const recipe=Object.hasOwn(config.recipes,p.id)?config.recipes[p.id]:[{id:p.id,qty:1}]
      let cost=0
      for(const r of recipe){const resource=data.products.find(p=>p.id===r.id);if(!resource)throw Error('配方原料已不存在');moneyValue(resource.cost,'原料成本');const qty=units(r.qty,'配方用量')*i.qty;const previous=resources.get(r.id);resources.set(r.id,{id:r.id,name:resource.name,qty:((previous?units(previous.qty,'預留量'):0)+qty)/1000,unitCost:resource.cost});cost+=resource.cost*r.qty}
      return {id:p.id,name:customerSource?.items.find(row=>row.id===p.id)?.name||p.name,price:p.price,qty:i.qty,cost:Math.round(cost*100)/100}
    })
    const quantity=items.reduce((n,i)=>n+i.qty,0),used=data.entries.filter(e=>e.day===request.day&&(e.status!=='cancelled'||e.startedAt))
    if(used.reduce((n,e)=>n+restaurantCapacityQuantity(e),0)+quantity>config.dailyCapacity)throw Error('已超過當日產能，請選其他日期')
    if(used.filter(e=>e.slot===request.slot).reduce((n,e)=>n+restaurantCapacityQuantity(e),0)+quantity>config.slotCapacity)throw Error('這個時段已滿，請選其他時段')
    entry={id:request.id,version:1,channel:request.channel,day:request.day,slot:request.slot,customer:text(request.customer,100,'稱呼'),contact:text(request.contact,100,'聯絡方式'),note:text(request.note,1000,'備註'),items,allocations:[...resources.values()],quantity,total:moneyValue(items.reduce((n,i)=>n+cents(i.price)*i.qty,0)/100,'應收'),status:'reserved',createdAt:request.time,startedAt:'',saleId:'',refundId:''}
    entry.pickupNumber=positiveInt(data.entries.filter(e=>e.day===entry.day).reduce((n,e)=>Math.max(n,e.pickupNumber||0),0)+1,'取餐號',1000000)
    if(customerSource){entry.customerOrderId=customerSource.id;entry.tableNum=customerSource.tableNum||'';if(customerSource.tableId)entry.tableId=customerSource.tableId;assertCustomerOrderLink(entry,data.orders)}
    if(entry.channel!=='walkin'&&!entry.contact||entry.channel==='delivery'&&!entry.note)throw Error('預訂／外送須填聯絡方式，外送另須填地址')
    stock(entry.allocations,-1);next.entries.unshift(entry)
  }else{
    entry=next.entries.find(e=>e.id===request.entryId)
    if(!entry)throw Error('預訂不存在')
    if(entry.version!==request.expectedVersion)throw Error('預訂已由其他裝置更新，請保留輸入並重新核對')
    if(request.action==='advance'){
      const allowed={reserved:'cooking',cooking:'ready',ready:entry.channel==='delivery'?'dispatched':'completed',dispatched:'completed'}
      if(allowed[entry.status]!==request.status)throw Error('出餐狀態轉換不正確')
      if(request.status==='completed'&&!entry.saleId)throw Error('請先確認收款才能完成交付')
      if(request.status==='cooking')entry.startedAt=request.time
      entry.status=request.status
    }else if(request.action==='pay'){
      if(entry.saleId||entry.status==='cancelled')throw Error('這張預訂已收款或取消，勿再次收款')
      const shift=data.shifts.find(s=>s.id===request.shiftId)
      if(!shift||shift.status!=='open')throw Error('請先開班再收款')
      const catalog=entry.items.map(i=>({...data.products.find(p=>p.id===i.id),name:i.name,stock:i.qty}))
      if(catalog.some(p=>!p.id))throw Error('預訂商品已不存在')
      const plan=finance.prepareCheckout({cart:entry.items,products:catalog,members:[],activeMember:null,pointsRule:{earn:Number(data.settings.pointsEarnRate??10),redeem:Number(data.settings.pointsRedeemRate??1)},birthdayBonus:Number(data.settings.birthdayBonus??100),openShift:shift,payMethod:request.payMethod,paid:request.paid,id:'sale-'+request.id,now:new Date(request.time),opts:{cashier:actor.username||'',taxId:request.taxId||''}})
      order={...plan.order,source:'pos',itemCosts:Object.fromEntries(entry.items.map(i=>[i.id,i.cost]))}
      if(data.orders.some(o=>o.id===order.id))throw Error('收款編號已存在')
      entry.saleId=order.id;entry.payMethod=request.payMethod;next.orders.unshift(order)
    }else if(request.action==='cancel'){
      if(entry.status==='cancelled')throw Error('預訂已取消')
      const reason=text(request.reason,1000,'取消原因');if(!reason)throw Error('請填寫取消原因')
      if(entry.saleId){
        if(actor.role!=='owner')throw Error('只有老闆能取消已收款預訂並退款')
        const shift=data.shifts.find(s=>s.id===request.shiftId);if(!shift||shift.status!=='open')throw Error('請先開班，將退款記入目前班別')
        original=data.orders.find(o=>o.id===entry.saleId)
        const plan=finance.prepareRefund(original,data.orders.filter(o=>o.refundOf===entry.saleId),{id:'refund-'+request.id,refundOf:entry.saleId,items:entry.items.map(i=>({id:i.id,qty:i.qty})),reason,cashier:actor.username||'',shiftId:shift.id,time:request.time},null)
        order=plan.order;original={...original,status:'refunded'};next.orders=next.orders.map(o=>o.id===original.id?original:o);next.orders.unshift(order);entry.refundId=order.id
      }
      if(!entry.startedAt)stock(entry.allocations,1)
      else waste=entry.allocations.map((a,index)=>({id:'rw-'+request.id+'-'+index,productId:a.id,productName:a.name,qty:a.qty,reason:'預訂取消：'+reason,cost:a.unitCost,time:request.time,cashier:actor.username||''}))
      next.waste.unshift(...waste);entry.status='cancelled';entry.cancelReason=reason
    }else throw Error('預訂操作不正確')
    entry.version++
  }
  if(entry)changedIds.push(...entry.allocations.map(a=>a.id),...entry.items.map(i=>i.id))
  const receipt={id:request.id,kind:RESTAURANT_KIND,action:request.action,signature:canonicalSignature(request),entityId:entry?.id||'',entityVersion:entry?.version||0,productIds:[...new Set(changedIds)],saleId:entry?.saleId||'',refundId:entry?.refundId||'',time:request.time,actor:{userId:actor.userId||'',username:actor.username||'',role:actor.role}}
  return {next,entry,order,original,waste,config,receipt}
}
