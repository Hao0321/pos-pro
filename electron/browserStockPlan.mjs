import {canonicalSignature,operationHeader,moneyValue,quantityValue} from './operationRules.mjs'
import {updateBrowserSettings} from './settingEncoding.mjs'
import {signature as checkoutSignature} from './checkoutSignature.mjs'
import {prepareCheckout} from '../src/utils/checkoutSafety.mjs'
import {prepareRefund,refundSignature} from '../src/utils/refundSafety.mjs'
import {planRestaurant,readRestaurantConfig,restaurantProductReferences} from './restaurantRules.mjs'
import {planSupplierInventory} from './supplierInventory.mjs'
import {planSales} from './salesPlan.mjs'
import {readExchangeTextSetting,readExchangeStore,EXCHANGE_SETTING} from './businessExchange.mjs'
import {assertProductPricingUnchanged} from './costPricing.mjs'
import {captureRestaurantCostBasis} from './stockReportBasis.mjs'
import {stockUnits} from './stockBusinessPlan.mjs'
import {validateCustomerLedgerRecords} from './customerLedger.mjs'
import {verifyRefundReview} from './refundReview.mjs'
import {salesDate} from './salesRules.mjs'
import {RESTAURANT_MENU_CONFIG_KEY} from './restaurantMenuOriginal.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
export function browserStockActor(book,actor,method,input=null){
  const ownerOnly=['refundOrder','applySalesOperation','deleteProduct'].includes(method)||method==='applyInventoryOperation'&&input?.kind!=='stocktake'
  const account=book.users.find(row=>row.id===actor?.userId)
  if(!account||account.username!==actor.username||account.role!==actor.role||!['owner',...(ownerOnly?[]:['staff'])].includes(actor.role))throw Error('權限不足')
  return {userId:account.id,username:account.username,role:account.role}
}
export function normalizeStockBusinessInput(method,request){
  if(method==='checkout')return JSON.parse(checkoutSignature(request))
  if(method==='refundOrder')return {id:request.id,time:request.time,...JSON.parse(refundSignature(request))}
  return structuredClone(request)
}
export const browserBusinessNeedsCost=(method,input)=>method==='applyInventoryOperation'?['receive','purchase-return','stocktake'].includes(input.kind):method==='applySalesOperation'?['deliver','return'].includes(input.action):method==='applyRestaurantOperation'?input.action!=='configure':['checkout','refundOrder','addProduct','addWaste'].includes(method)
export function browserBusinessSource(book,method,input){
  const [rows,id]=method==='checkout'||method==='refundOrder'?[book.orders,input.id]:method==='addProduct'?[book.products,input.id]:method==='addWaste'?[book.wasteLog,input.id]:method==='applyInventoryOperation'?[book.auditLog,'stock-operation:'+input.id]:method==='applyRestaurantOperation'?[book.restaurantOperations,input.id]:method==='applySalesOperation'?[book.salesOperations,input.id]:[[],null]
  return rows.find(row=>row.id===id)||null
}
export function browserStockContexts(book,runtime){
  const storeId=readExchangeTextSetting(book.settings,'sharedStoreId')
  const data={storeId,epoch:runtime.epoch,products:book.products,purchases:book.purchases,suppliers:book.suppliers,restaurantEntries:book.restaurantOrders,costMode:runtime.state?.projection?'active':'reference',
    openShift:book.shifts.find(row=>row.status==='open')||null,cashLogs:book.cashLog,ownerIds:book.users.filter(row=>row.role==='owner').map(row=>row.id),
    supplierFence:runtime.supplierFence,supplierEntries:book.supplierEntries,supplierOperations:book.supplierOperations,inventoryAudits:book.auditLog,
    documents:book.salesDocuments,operations:book.salesOperations,salesOperations:book.salesOperations,customerEntries:book.customerEntries,customerOperations:book.customerOperations,
    quotes:readExchangeStore(readExchangeTextSetting(book.settings,EXCHANGE_SETTING)).quotes}
  data.customerLedger=validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data)
  return data
}
export function browserRestaurantData(book,runtime={}){
  const settings=Object.fromEntries(book.settings.map(row=>[row.key,JSON.parse(row.value)]))
  const now=Date.parse(runtime.timestamp||new Date().toISOString())
  return {products:book.products,users:book.users,suppliers:book.suppliers||[],menuConfigurationId:settings[RESTAURANT_MENU_CONFIG_KEY]||'',entries:book.restaurantOrders,operations:book.restaurantOperations,orders:book.orders,waste:book.wasteLog,cashLogs:book.cashLog,shifts:book.shifts,settings,config:readRestaurantConfig(settings.restaurantConfig,book.products),storeId:settings.sharedStoreId||'',epoch:runtime.epoch,costMode:book.stockCostEntries?.length?'active':'reference',now,date:salesDate(new Date(now))}
}
function productWithDefaults(data){
  for(const key of ['price','cost'])moneyValue(data[key]??0,key)
  for(const key of ['stock','reorderLevel'])quantityValue(data[key]??0,key)
  if(typeof data.id!=='string'||!data.id||data.id.length>128)throw Error('商品編號格式不正確')
  return {id:data.id,name:data.name||'',category:data.category||'',price:data.price??0,cost:data.cost??0,stock:data.stock??0,barcode:data.barcode||'',unit:data.unit||'個',noBarcode:!!data.noBarcode,imageUrl:data.imageUrl||'',expiryDate:data.expiryDate||'',supplierId:data.supplierId||'',reorderLevel:data.reorderLevel??0}
}
// The complete allowed business postimage is reconstructed from production
// planners. Callers cannot attach unrelated changes to a stock-cost command.
export function planBrowserStockBusiness(book,runtime,method,request,actor){
  browserStockActor(book,actor,method,request)
  const next=structuredClone(book)
  let result={success:true}
  if(method==='checkout'){
    const setting=(key,fallback)=>Number(readExchangeTextSetting(book.settings,key)??fallback)
    const plan=prepareCheckout({cart:request.items,products:book.products,members:book.members,activeMember:request.memberId?{id:request.memberId}:null,
      pointsRule:{earn:setting('pointsEarnRate',10),redeem:setting('pointsRedeemRate',1)},birthdayBonus:setting('birthdayBonus',100),openShift:book.shifts.find(row=>row.id===request.shiftId),
      payMethod:request.payMethod,paid:request.paid,pointsUsed:request.pointsUsed,id:request.id,now:new Date(request.time),
      opts:{taxId:request.taxId,cashier:request.cashier,manualDiscountAmt:request.manualDiscount,balanceUsed:request.balanceUsed,...(request.payMethod==='mixed'?{payments:request.payments}:{})}})
    if(!same(plan.order,request))throw Error('交易資料已改變，請重新確認')
    const order={...plan.order,source:'pos',itemCosts:Object.fromEntries(plan.order.items.map(row=>[row.id,book.products.find(p=>p.id===row.id).cost||0]))}
    next.products=book.products.map(row=>{const update=plan.stockUpdates.find(u=>u.id===row.id);return update?{...row,stock:(stockUnits(row.stock)-stockUnits(-update.delta))/1000}:row})
    next.members=book.members.map(row=>row.id===plan.memberUpdate?.id?{...row,points:row.points+plan.memberUpdate.pointsDelta,totalSpent:(row.totalSpent||0)+plan.memberUpdate.spentDelta,balance:(row.balance||0)+plan.memberUpdate.balanceDelta,tier:plan.memberUpdate.tier,...(plan.memberUpdate.lastBirthdayBonus?{lastBirthdayBonus:plan.memberUpdate.lastBirthdayBonus}:{})}:row)
    next.orders=[order,...book.orders]
    result.order=order
  }else if(method==='refundOrder'){
    if(request.review!==undefined){
      if(request.cashier!==actor.username)throw Error('退款帳號已更新，請重新登入')
      verifyRefundReview(request,{storeId:readExchangeTextSetting(book.settings,'sharedStoreId'),epoch:runtime.epoch,costMode:runtime.state?.projection?'active':'reference',orders:book.orders,members:book.members,products:book.products,shifts:book.shifts,restaurantEntries:book.restaurantOrders})
    }
    if(!book.shifts.some(row=>row.id===request.shiftId&&row.status==='open'))throw Error('請先開班，將退款記入目前班別')
    if(book.restaurantOrders.some(row=>row.saleId===request.refundOf))throw Error('預訂退款請在「預訂出餐」取消原單')
    const original=book.orders.find(row=>row.id===request.refundOf),member=book.members.find(row=>row.id===original?.memberId)
    const plan=prepareRefund(original,book.orders.filter(row=>row.refundOf===original?.id),request,member)
    if(plan.stockUpdates.some(row=>!book.products.some(p=>p.id===row.id)))throw Error('退貨商品已不存在，請先核對庫存')
    const updated={...original,...(plan.order.fullRefund?{status:'refunded'}:{})}
    next.orders=[plan.order,...book.orders.map(row=>row.id===updated.id?updated:row)]
    next.products=book.products.map(row=>{const update=plan.stockUpdates.find(u=>u.id===row.id);return update?{...row,stock:(stockUnits(row.stock)+stockUnits(update.delta))/1000}:row})
    next.members=book.members.map(row=>row.id===plan.member?.id?plan.member:row)
    result={...result,order:plan.order,original:updated}
  }else if(method==='applyRestaurantOperation'){
    const data=browserRestaurantData(book,runtime),plan=planRestaurant(request,data,actor,{prepareCheckout,prepareRefund})
    Object.assign(next,{products:plan.next.products,orders:plan.next.orders,wasteLog:plan.next.waste,cashLog:plan.next.cashLogs||book.cashLog,restaurantOrders:plan.next.entries,restaurantOperations:[...data.operations,plan.receipt]})
    if(request.action==='configure')next.settings=updateBrowserSettings(book.settings,{restaurantConfig:JSON.stringify(JSON.stringify(plan.config)),...(plan.config.menu?{[RESTAURANT_MENU_CONFIG_KEY]:JSON.stringify(request.id)}:{})})
    result.plan=plan
  }else if(method==='applyInventoryOperation'){
    const plan=planSupplierInventory(request,browserStockContexts(book,runtime),actor)
    next.products=[...book.products.map(row=>plan.products.find(p=>p.id===row.id)||row),...plan.products.filter(row=>plan.created.includes(row.id))]
    next.purchases=plan.createPurchase?[plan.purchase,...book.purchases]:book.purchases.map(row=>row.id===plan.purchase?.id?plan.purchase:row)
    next.suppliers=book.suppliers.map(row=>row.id===plan.supplier?.id?plan.supplier:row)
    next.cashLog=plan.cashLog?[plan.cashLog,...book.cashLog]:book.cashLog
    next.auditLog=[{id:'stock-operation:'+request.id,action:'INVENTORY_OPERATION',detail:plan.receipt,timestamp:runtime.timestamp,userId:actor.userId,username:actor.username,role:actor.role},...book.auditLog]
    if(plan.supplierRegistration){next.supplierEntries=[...book.supplierEntries,plan.supplierRegistration.event];next.supplierOperations=[...book.supplierOperations,plan.supplierRegistration.receipt]}
    result.plan=plan
  }else if(method==='applySalesOperation'){
    const plan=planSales(request,browserStockContexts(book,runtime),actor)
    next.salesDocuments=[plan.document,...book.salesDocuments.filter(row=>row.id!==plan.document.id)]
    next.salesOperations=[...book.salesOperations,plan.receipt]
    next.products=book.products.map(row=>plan.products.find(p=>p.id===row.id)||row)
    next.cashLog=[...book.cashLog,...(plan.cashLog?[plan.cashLog]:[])]
    result.plan=plan
  }else if(method==='addWaste'){
    operationHeader(request);quantityValue(request.qty,'損耗數量',.001)
    const product=book.products.find(row=>row.id===request.productId)
    if(!product||stockUnits(request.qty)>stockUnits(product.stock))throw Error('損耗商品或數量不正確')
    const waste={...request,productName:product.name,cost:product.cost||0,reason:request.reason||'',cashier:request.cashier||''}
    next.products=book.products.map(row=>row.id===product.id?{...row,stock:(stockUnits(row.stock)-stockUnits(request.qty))/1000}:row)
    next.wasteLog=[waste,...book.wasteLog];result.waste=waste
  }else if(method==='addProduct'){
    if(book.products.some(row=>row.id===request.id))throw Error('商品編號已存在，請核對原商品')
    next.products=[...book.products,productWithDefaults(request)]
  }else if(method==='updateProduct'||method==='deleteProduct'){
    const product=book.products.find(row=>row.id===request.id)
    if(!product)throw Error('商品不存在')
    const history=runtime.state.projection.custody.sources.some(row=>row.productId===request.id)||runtime.state.projection.legacyOperationIds?.addProduct?.includes(request.id)||runtime.state.entries.some(row=>row.method==='addProduct'&&row.input.id===request.id)||book.orders.some(row=>row.items.some(item=>item.id===request.id))
    if(method==='updateProduct'){
      const data=request.data
      assertProductPricingUnchanged(product,data._expectedPricing)
      if(data.stock!=null&&data.stock!==product.stock)throw Error('庫存數量請使用盤點調整')
      if(Object.hasOwn(data,'_expectedStock')&&data.stock!=null&&data._expectedStock!==product.stock)throw Error('庫存已變更，請重新核對')
      if(history&&data.unit!=null&&data.unit!==product.unit)throw Error('商品已有歷史，請保留原單位')
      const fields=['name','category','price','cost','stock','barcode','unit','noBarcode','imageUrl','expiryDate','supplierId','reorderLevel']
      if(Object.keys(data).some(key=>!fields.includes(key)&&!['id','_expectedStock','_expectedPricing','_creationId'].includes(key)))throw Error('商品欄位需要核對')
      const clean=Object.fromEntries(fields.filter(key=>data[key]!=null).map(key=>[key,key==='noBarcode'?!!data[key]:data[key]]))
      for(const key of ['price','cost'])if(clean[key]!=null)moneyValue(clean[key],key)
      if(clean.reorderLevel!=null)quantityValue(clean.reorderLevel,'安全庫存')
      next.products=book.products.map(row=>row.id===request.id?{...row,...clean}:row)
    }else{
      const config=browserRestaurantData(book).config
      if(history||book.salesDocuments.some(row=>row.items.some(item=>item.productId===request.id))||book.purchases.some(row=>row.procurement&&row.items.some(item=>item.productId===request.id))||restaurantProductReferences(config,book.restaurantOrders).has(request.id))throw Error('商品已有歷史或仍在使用，請保留以供核對')
      next.products=book.products.filter(row=>row.id!==request.id)
    }
  }else throw Error('庫存業務流程不正確')
  // Preserve exact milliunits after older planners' floating subtraction.
  next.products=next.products.map(row=>{const old=book.products.find(p=>p.id===row.id);if(old?.stock===row.stock)return row;const units=stockUnits(row.stock),stock=units/1000;if(Math.abs(row.stock-stock)>4*Number.EPSILON*Math.max(1,Math.abs(stock)))throw Error('庫存精度需要核對');return {...row,stock}})
  return {book:next,result}
}

export function browserStockEvidence(before,after,method,input,result){
  const evidence={},ids=new Set(),include=rows=>{for(const row of rows||[])ids.add(row.productId||row.id)}
  if(method==='checkout'||method==='refundOrder'){
    evidence.order=after.orders.find(row=>row.id===input.id);include(evidence.order.items)
    if(method==='refundOrder'){evidence.original=before.orders.find(row=>row.id===input.refundOf);evidence.previousRefunds=before.orders.filter(row=>row.refundOf===input.refundOf)}
  }else if(method==='addProduct')ids.add(input.id)
  else if(method==='addWaste'){evidence.waste=after.wasteLog.find(row=>row.id===input.id);ids.add(input.productId)}
  else if(method==='applyRestaurantOperation'){
    const id=input.action==='create'?input.id:input.entryId
    evidence.beforeEntry=before.restaurantOrders.find(row=>row.id===id)||null;evidence.entry=after.restaurantOrders.find(row=>row.id===id)
    if(input.action==='create')evidence.costBasis=captureRestaurantCostBasis(evidence.entry,browserRestaurantData(before).config)
    include(evidence.beforeEntry?.allocations);include(evidence.entry?.allocations)
  }else if(method==='applyInventoryOperation'){
    if(input.kind==='stocktake')include(input.counts)
    else{
      const purchase=after.purchases.find(row=>row.id===input.purchaseId),old=before.purchases.find(row=>row.id===input.purchaseId),modern=purchase?.procurement?.version===1
      if(!purchase||!old)throw Error('採購來源需要核對')
      const event=modern?purchase.procurement[input.kind==='receive'?'receipts':'returns'].find(row=>row.id===input.id):null
      evidence.inventory={kind:input.kind,purchaseId:purchase.id,modern,items:purchase.items,beforeReceived:old.items.map(row=>row.received||0),event,creditCents:input.kind==='purchase-return'?Math.round(event?.amount*100):0}
      include(purchase.items.filter((_,index)=>input.quantities[index]>0))
    }
  }else if(method==='applySalesOperation'){
    const document=result.plan.document,key=input.action==='deliver'?'deliveries':'returns',event=document[key].find(row=>row.id===input.id)
    evidence.document={id:document.id,items:document.items};evidence.event=event
    evidence.originalDelivery=input.action==='return'?document.deliveries.find(row=>row.id===event.deliveryId):null
    evidence.previousReturns=input.action==='return'?document.returns.filter(row=>row.id!==input.id&&row.deliveryId===event.deliveryId):[]
    include(document.items.filter((_,index)=>event.quantities[index]>0))
  }
  for(const product of after.products)if(!before.products.some(row=>row.id===product.id&&row.stock===product.stock))ids.add(product.id)
  evidence.products=[...ids].sort().map(id=>{const old=before.products.find(row=>row.id===id),product=after.products.find(row=>row.id===id);if(!product||old&&old.unit!==product.unit)throw Error('商品單位需要核對');return {id,unit:product.unit,beforeUnits:old?stockUnits(old.stock):0,afterUnits:stockUnits(product.stock),referenceUnitCostCents:Math.round(product.cost*100)}})
  return evidence
}
