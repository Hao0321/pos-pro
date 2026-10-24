const {RECEIPT_REVIEW_KIND,RECEIPT_REVIEW_SETTING}=require('./receiptReview.mjs')
const {PURCHASE_UNITS_KIND,PURCHASE_UNITS_SETTING}=require('./purchaseUnitPricing.mjs')
const {INVENTORY_ACTION,INVENTORY_PREFIX}=require('./inventoryOperations.mjs')
const {planSupplierInventory,supplierInventoryReceipt}=require('./supplierInventory.mjs')
const {parsePurchase,purchaseParams}=require('./procurementRules.mjs')
const {randomUUID}=require('node:crypto')
const {PHYSICAL_STOCKTAKE,physicalStocktakeState}=require('./physicalStocktake.mjs')
module.exports=function(db,stmts,supplierParams){
  const readSupplier=require('./supplierState.cjs')(db,stmts),fence=require('./databaseFeatureFence.cjs')
  const current=()=>({products:stmts.getAllProducts.all().map(p=>({...p,noBarcode:!!p.noBarcode})),purchases:stmts.getAllPurchases.all().map(parsePurchase),suppliers:stmts.getAllSuppliers.all().map(s=>({...s,catalog:JSON.parse(s.catalog||'[]')})),openShift:stmts.getOpenShift.get(),cashLogs:db.prepare('SELECT * FROM cash_log').all()})
  const countData=()=>({storeId:stmts.getSetting.get('sharedStoreId')?.value,epoch:db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch').value,costMode:db.prepare('SELECT 1 FROM stock_cost_entries LIMIT 1').get()?'active':'reference',restaurantEntries:db.prepare('SELECT data FROM restaurant_orders ORDER BY id').all().map(row=>JSON.parse(row.data))})
  const verified=actor=>{if(!actor||!['owner','staff'].includes(actor.role)||!stmts.getAllUsers.all().some(row=>row.id===actor.userId&&row.username===actor.username&&row.role===actor.role))throw Error('權限不足')}
  return {getStocktakeState(actor){verified(actor);return db.transaction(()=>{if(!stmts.getSetting.get('sharedStoreId')?.value)stmts.setSetting.run('sharedStoreId',randomUUID());return physicalStocktakeState({...current(),...countData()})})()},applyInventoryOperation(request,actor){
    if(!actor||!['owner','staff'].includes(actor.role)||request.kind!=='stocktake'&&actor.role!=='owner')throw Error('權限不足')
    if(request.protocol===PHYSICAL_STOCKTAKE)verified(actor)
    if(request.kind===RECEIPT_REVIEW_KIND||request.kind===PURCHASE_UNITS_KIND||request.sourceCatalogue||stmts.getSetting.get(PURCHASE_UNITS_SETTING)?.value==='1')verified(actor)
    let replay=false,historyChecked=false
    try{return db.transaction(()=>{
      const key=INVENTORY_PREFIX+request.id,old=db.prepare('SELECT * FROM audit_log WHERE id=?').get(key)
      replay=!!old;historyChecked=true
      const read=()=>{const data=request.supplierContext||fence.hasSupplierFence(db)?readSupplier():{...current(),storeId:stmts.getSetting.get('sharedStoreId')?.value};return request.kind==='stocktake'||request.kind===RECEIPT_REVIEW_KIND?{...data,...countData()}:data},data=read()
      if(old){if(old.action!==INVENTORY_ACTION)throw Error('庫存回執需要核對');if(request.protocol===PHYSICAL_STOCKTAKE&&old.userId!==actor.userId&&actor.role!=='owner')throw Error('權限不足');return supplierInventoryReceipt(request,JSON.parse(old.detail),data)}
      const plan=planSupplierInventory(request,data,actor)
      if(request.sourceCatalogue){fence.installCataloguePurchaseFence(db);stmts.setSetting.run('cataloguePurchaseVersionFence','1')}
      if(request.draftContext){fence.installPrivateQuickFence(db);stmts.setSetting.run('stockCostVersionFence','1')}
      if(plan.supplierRegistration)fence.installSupplierFence(db)
      if(request.kind===PURCHASE_UNITS_KIND){fence.installPurchaseUnitsFence(db);stmts.setSetting.run(PURCHASE_UNITS_SETTING,'1')}
      if(request.kind===RECEIPT_REVIEW_KIND){fence.installReceiptReviewFence(db);stmts.setSetting.run(RECEIPT_REVIEW_SETTING,'1')}
      for(const p of plan.products){
        if(plan.created.includes(p.id))stmts.insertProduct.run({...p,noBarcode:p.noBarcode?1:0})
        else stmts.updateProductStock.run({id:p.id,delta:p.stock-data.products.find(old=>old.id===p.id).stock})
      }
      if(plan.purchase)(plan.createPurchase?stmts.insertPurchase:stmts.updatePurchase).run(purchaseParams(plan.purchase))
      if(plan.supplier)stmts.updateSupplier.run(supplierParams(plan.supplier,plan.supplier.id))
      if(plan.cashLog)stmts.insertCashLog.run(plan.cashLog)
      if(plan.supplierRegistration){
        db.prepare('INSERT INTO supplier_entries (id,data) VALUES (?,?)').run(plan.supplierRegistration.event.id,JSON.stringify(plan.supplierRegistration.event))
        db.prepare('INSERT INTO supplier_operations (id,data) VALUES (?,?)').run(plan.supplierRegistration.receipt.id,JSON.stringify(plan.supplierRegistration.receipt))
      }
      stmts.insertAuditLog.run({id:key,timestamp:new Date().toISOString(),action:INVENTORY_ACTION,level:'info',label:['receive','receive-lots','receive-reviewed'].includes(request.kind)?'進貨到貨':'庫存盤點',userId:actor.userId||'',username:actor.username||'',role:actor.role,detail:JSON.stringify(plan.receipt)})
      return supplierInventoryReceipt(request,plan.receipt,read())
    })()}catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||historyChecked&&!replay?false:null,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  }}
}
