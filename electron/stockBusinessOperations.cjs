const {RECEIPT_REVIEW_KIND,hasReceiptLots}=require('./receiptReview.mjs')
const {isProcurement}=require('./procurementRules.mjs')
const {canonicalSignature,operationHeader}=require('./operationRules.mjs')
const {signature:checkoutSignature}=require('./checkoutSignature.mjs')
const {refundSignature}=require('./refundSafety.cjs')
const {stockLedgerError,assertStockCustodyMatchesBook}=require('./stockOpeningPlan.mjs')
const {stockUnits,STOCK_BUSINESS_METHODS}=require('./stockBusinessPlan.mjs')
const {salesDate}=require('./salesRules.mjs')

// Integrate the real business writers, including their original receipts, in
// the same SQLite transaction. This scope is never exposed over IPC or HTTPS.
module.exports=function installStockBusinessOperations(db,api,store){
 const originals=Object.fromEntries([...STOCK_BUSINESS_METHODS,'updateProduct','deleteProduct','addOrder','updateOrderStatus','checkoutReceipt','addManualEntry','deleteManualEntry'].map(method=>[method,api[method]]))
 const actorAt={checkout:3,refundOrder:2,addProduct:1,addWaste:1,applyInventoryOperation:1,applyRestaurantOperation:1,applySalesOperation:1}
 function actor(value,owner=false){
  const account=value?.userId&&api.getUsers().find(row=>row.id===value.userId)
  if(!account||!['owner',...(owner?[]:['staff'])].includes(value.role)||account.role!==value.role||account.username!==value.username)throw Error('權限不足')
  return {userId:account.id,username:account.username,role:account.role}
 }
 function current(){
  const data=store.read(),opening=data.entries[0]?.input
  if(!data.projection||opening.storeId!==api.getSetting('sharedStoreId')||!store.matchesEpoch(data))throw stockLedgerError('HISTORY')
  assertStockCustodyMatchesBook(data.projection.custody,api.getProducts(),api.getRestaurantState().entries,data.projection.warehousing)
  return data
 }
 function normalize(method,args){
  const raw=method==='refundOrder'?args[1]:args[0]
  if(method==='checkout')return JSON.parse(checkoutSignature(raw))
  if(method==='refundOrder')return {id:raw.id,time:raw.time,...JSON.parse(refundSignature(raw))}
  return structuredClone(raw)
 }
 function sourceExists(method,id){
  const targets={checkout:['orders','id'],refundOrder:['orders','id'],addProduct:['products','id'],addWaste:['waste_log','id'],applyRestaurantOperation:['restaurant_operations','id'],applySalesOperation:['sales_operations','id'],applyInventoryOperation:['audit_log','id']}
  const [table,column]=targets[method]
  return !!db.prepare('SELECT 1 FROM '+table+' WHERE '+column+'=?').get(method==='applyInventoryOperation'?'stock-operation:'+id:id)
 }
 const requiresCost=(method,input)=>method==='applyInventoryOperation'?['receive','receive-lots','receive-reviewed','purchase-return','purchase-return-lots','stocktake'].includes(input.kind):method==='applySalesOperation'?['deliver','return'].includes(input.action):method==='applyRestaurantOperation'?input.action!=='configure':true
 function before(method,input){
  const products=api.getProducts(),facts={products}
  if(method==='refundOrder'){facts.original=api.getOrder(input.refundOf);facts.previousRefunds=api.getOrders().filter(row=>row.refundOf===input.refundOf)}
  if(method==='applyInventoryOperation')facts.purchase=api.getPurchases().find(row=>row.id===input.purchaseId)
  if(method==='applyRestaurantOperation'){const restaurant=api.getRestaurantState();facts.beforeEntry=restaurant.entries.find(row=>row.id===(input.action==='create'?input.id:input.entryId))||null;facts.restaurantConfig=restaurant.config}
  return facts
 }
 function evidence(method,input,facts,result){
  const output={},ids=new Set(),after=api.getProducts(),old=new Map(facts.products.map(row=>[row.id,row])),next=new Map(after.map(row=>[row.id,row]))
  const include=items=>{for(const row of items||[])ids.add(row.productId||row.id)}
  if(method==='checkout'||method==='refundOrder'){
   output.order=api.getOrder(input.id);include(output.order?.items)
   if(method==='refundOrder'){output.original=facts.original;output.previousRefunds=facts.previousRefunds}
  }else if(method==='addProduct')ids.add(input.id)
  else if(method==='addWaste'){output.waste=api.getWasteLog().find(row=>row.id===input.id);ids.add(input.productId)}
  else if(method==='applyRestaurantOperation'){
   output.beforeEntry=facts.beforeEntry;output.entry=api.getRestaurantState().entries.find(row=>row.id===(input.action==='create'?input.id:input.entryId))
   if(input.action==='create')output.costBasis=require('./stockReportBasis.mjs').captureRestaurantCostBasis(output.entry,facts.restaurantConfig)
   include(output.beforeEntry?.allocations);include(output.entry?.allocations)
  }else if(method==='applyInventoryOperation'){
   if(input.kind==='stocktake'){include(input.counts);if(result.receipt?.stocktake)output.stocktake=structuredClone(result.receipt.stocktake)}
   else{
    const purchase=api.getPurchases().find(row=>row.id===input.purchaseId),modern=isProcurement(purchase)
    if(!purchase||!facts.purchase)throw stockLedgerError('HISTORY')
    const event=modern?purchase.procurement[['receive','receive-lots','receive-reviewed'].includes(input.kind)?'receipts':'returns'].find(row=>row.id===input.id):null
    output.inventory={kind:input.kind,purchaseId:purchase.id,modern,items:purchase.items,beforeReceived:facts.purchase.items.map(row=>row.received||0),event,creditCents:['purchase-return','purchase-return-lots'].includes(input.kind)?Math.round(event?.amount*100):0}
    include(purchase.items.filter((_,index)=>input.quantities[index]>0))
   }
  }else if(method==='applySalesOperation'){
   const document=result.document,key=input.action==='deliver'?'deliveries':'returns',event=document?.[key]?.find(row=>row.id===input.id)
   output.document={id:document?.id,items:document?.items};output.event=event
   output.originalDelivery=input.action==='return'?document.deliveries.find(row=>row.id===event?.deliveryId):null
   output.previousReturns=input.action==='return'?document.returns.filter(row=>row.id!==input.id&&row.deliveryId===event?.deliveryId):[]
   include(document?.items.filter((_,index)=>event?.quantities[index]>0))
  }
  for(const row of after)if(!old.has(row.id)||old.get(row.id).stock!==row.stock)ids.add(row.id)
  output.products=[...ids].sort().map(id=>{
   const previous=old.get(id),product=next.get(id)
   if(!product||previous&&previous.unit!==product.unit)throw stockLedgerError('HISTORY')
   const afterUnits=stockUnits(product.stock),normalized=afterUnits/1000
   if(product.stock!==normalized){
    if(Math.abs(product.stock-normalized)>4*Number.EPSILON*Math.max(1,Math.abs(normalized)))throw stockLedgerError('HISTORY')
    db.prepare('UPDATE products SET stock=? WHERE id=?').run(normalized,id)
   }
   return {id,unit:product.unit,beforeUnits:previous?stockUnits(previous.stock):0,afterUnits,referenceUnitCostCents:Math.round(product.cost*100)}
  })
  return output
 }
 for(const method of STOCK_BUSINESS_METHODS)api[method]=function(...args){
  if(!store.active()){
   if(method==='applyInventoryOperation'&&hasReceiptLots(args[0]||{}))return {success:false,committed:false,error:'請先核對庫存成本與批次，再使用分批收貨'}
   if(method==='applyInventoryOperation'&&args[0]?.kind==='purchase-return-lots')return {success:false,committed:false,error:'請先核對庫存成本與批次，再使用批次退貨'}
   if(method==='applyInventoryOperation'&&args[0]?.protocol==='pos-physical-stocktake/v1')return db.transaction(()=>{const result=originals[method].apply(api,args);if(result?.success)store.ensureCompatibility();return result})()
   return originals[method].apply(api,args)
  }
  let existing=false,replayed=false
  try{return db.transaction(()=>{
   const verified=actor(args[actorAt[method]],['refundOrder','applySalesOperation'].includes(method)),input=normalize(method,args)
   if(typeof input?.id!=='string'||!input.id)throw stockLedgerError('INPUT')
   const saved=store.lookup(input,verified,method);replayed=!!saved
   const state=current(),cost=requiresCost(method,input);existing=sourceExists(method,input.id)
   if(saved){
    if(!existing)throw stockLedgerError('HISTORY')
    const result=method==='addProduct'?{success:true}:originals[method].apply(api,args)
    if(result?.success!==true)throw stockLedgerError('HISTORY')
    return {...result,costReceipt:saved}
   }
   if(existing&&cost){
    if(!state.projection.legacyOperationIds?.[method]?.includes(input.id))throw stockLedgerError('HISTORY')
    const result=originals[method].apply(api,args)
    if(result?.success!==true)throw stockLedgerError('HISTORY')
    current();return result
   }
   if(method==='applyInventoryOperation'&&hasReceiptLots(input)&&(!state.projection.lots||input.lots?.storeId!==api.getSetting('sharedStoreId')||input.lots?.epoch!==db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value))throw stockLedgerError('STALE')
   if(method==='applyInventoryOperation'&&input.kind==='purchase-return-lots'&&(!state.projection.lots||input.lots?.storeId!==api.getSetting('sharedStoreId')||input.lots?.epoch!==db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value))throw stockLedgerError('STALE')
   if(method==='applyInventoryOperation'&&input.kind===RECEIPT_REVIEW_KIND&&!!state.projection.lots!==hasReceiptLots(input))throw stockLedgerError('STALE')
   if(cost&&method!=='addProduct'){
    operationHeader(input)
    if(Math.abs(Date.now()-Date.parse(input.time))>300000)throw stockLedgerError('STALE')
   }
   const facts=cost?before(method,input):null
   return store.scope(()=>{
    const result=originals[method].apply(api,args)
    if(result?.success!==true){current();return result}
    if(!cost){current();return result}
    const proof=evidence(method,input,facts,result),now=new Date(),date=method==='applySalesOperation'?input.date:salesDate(new Date(input.time||now))
    const receipt=store.append(input,verified,{time:now.toISOString(),date},method,proof,projection=>{if(projection.lots)for(const product of proof.products)db.prepare('UPDATE products SET stock=? WHERE id=?').run(require('./warehousePlan.mjs').warehouseLocationUnits(projection.custody,'main',product.id,product.unit)/1000,product.id)})
    if(hasReceiptLots(input)){require('./databaseFeatureFence.cjs').installReceiptLotsFence(db);db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('stockReceiptLotsVersionFence','1')}
    if(input.kind==='purchase-return-lots'){require('./databaseFeatureFence.cjs').installSupplierLotReturnsFence(db);db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('stockSupplierLotReturnsVersionFence','1')}
    current()
    const products=new Map(api.getProducts().map(row=>[row.id,row]))
    return {...result,...(Array.isArray(result.products)?{products:result.products.map(row=>products.get(row.id))}:{}),...(result.product?{product:products.get(result.product.id)}:{}),costReceipt:receipt}
   })
  })()}catch(error){return {success:false,committed:existing||replayed||error.code==='STOCK_LEDGER_HISTORY'?null:false,error:error.message,errorCode:error.code||null}}
 }
 function metadata(method,id,data,who){
  actor(who,method==='deleteProduct')
  return db.transaction(()=>{
  const state=current(),product=api.getProducts().find(row=>row.id===id),history=state.projection.warehousing?.units.some(row=>row.productId===id)||state.projection.custody.sources.some(row=>row.productId===id)||state.projection.legacyOperationIds?.addProduct?.includes(id)||state.entries.some(row=>row.method==='addProduct'&&row.input.id===id)||!!db.prepare('SELECT 1 FROM order_items WHERE productId=? LIMIT 1').get(id)
   if(method==='updateProduct'&&product){
    if(data.stock!=null&&data.stock!==product.stock)throw stockLedgerError('ADJUST')
    if(history&&data.unit!=null&&data.unit!==product.unit)throw stockLedgerError('RETAIN')
   }
   if(method==='deleteProduct'&&history)throw stockLedgerError('RETAIN')
   const result=store.scope(()=>originals[method].apply(api,method==='updateProduct'?[id,data]:[id]));current();return result
  })()
 }
 api.updateProduct=function(id,data,who){return store.active()?metadata('updateProduct',id,data,who):originals.updateProduct.call(api,id,data)}
 api.deleteProduct=function(id,who){return store.active()?metadata('deleteProduct',id,null,who):originals.deleteProduct.call(api,id)}
 api.addManualEntry=function(data,who){
  if(!store.active())return originals.addManualEntry.call(api,data)
  actor(who,true)
  return db.transaction(()=>{
   const state=current()
   if(typeof data?.id!=='string'||!data.id)throw Error('帳務分錄需要核對')
   const frozen=state.projection.legacyJournals.find(row=>row.id===data.id)
   if(frozen){const old=api.getManualJournal().find(row=>row.id===data.id);if(!old||canonicalSignature(old)!==canonicalSignature({...old,...data}))throw Error('開帳前的帳務已保留，請新增更正分錄');return {success:true}}
   if(data.lines?.some(line=>['1211','2291'].includes(line.account)))throw Error('存貨與待核對成本請由進貨、盤點或成本確認處理')
   const result=store.scope(()=>originals.addManualEntry.call(api,data));current();return result
  })()
 }
 api.deleteManualEntry=function(id,who){
  if(!store.active())return originals.deleteManualEntry.call(api,id)
  actor(who,true)
  return db.transaction(()=>{const state=current();if(state.projection.legacyJournals.some(row=>row.id===id))throw Error('開帳前的帳務已保留，請新增更正分錄');const result=store.scope(()=>originals.deleteManualEntry.call(api,id));current();return result})()
 }
 api.addOrder=function(data){
  if(!store.active())return originals.addOrder.call(api,data)
  // This anonymous route only records a pending customer request. It cannot
  // create a paid sale, change stock, attach a member or mint a cost receipt.
  if(data?.source!=='customer'||data.status!=='pending'||data.payMethod!=='pending'||data.paid!==0||data.change!==0||data.memberId||data.pointsUsed||data.pointsEarned||data.refundOf||!/^CO[0-9a-f-]{36}$/i.test(data.id)||typeof data.requestSignature!=='string'||!/^[0-9a-f]{64}$/.test(data.trackingTokenHash))throw stockLedgerError('FLOW')
  return db.transaction(()=>{current();const result=store.scope(()=>originals.addOrder.call(api,data));current();return result})()
 }
 api.updateOrderStatus=function(id,status,who){
  if(!store.active())return originals.updateOrderStatus.call(api,id,status)
  actor(who);return db.transaction(()=>{current();const result=store.scope(()=>originals.updateOrderStatus.call(api,id,status));current();return result})()
 }
 api.checkoutReceipt=function(id){
  if(!store.active())return originals.checkoutReceipt.call(api,id)
  return db.transaction(()=>{
   const result=originals.checkoutReceipt.call(api,id)
   if(result?.success!==true||result.order?.source==='customer')return result
   const state=current(),event=state.entries.find(row=>row.evidence?.order?.id===id||row.evidence?.entry?.saleId===id&&row.input.action==='pay'||row.evidence?.entry?.refundId===id&&row.input.action==='cancel')
   const legacy=[...(state.projection.legacyOperationIds?.checkout||[]),...(state.projection.legacyOperationIds?.refundOrder||[])]
   if(result.found===false){if(event||legacy.includes(id))throw stockLedgerError('HISTORY');return result}
   if(event){const operation=state.operations.find(row=>row.method===event.method&&row.operationId===event.input.id);if(!operation)throw stockLedgerError('HISTORY');return {...result,costReceipt:structuredClone(operation.receipt)}}
   if(!legacy.includes(id))throw stockLedgerError('HISTORY')
   return result
  })()
 }
 return api
}
