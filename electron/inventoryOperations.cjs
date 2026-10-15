const {planInventory,inventoryReceipt,INVENTORY_ACTION,INVENTORY_PREFIX}=require('./inventoryOperations.mjs')
const {parsePurchase,purchaseParams}=require('./procurementRules.mjs')
module.exports=function(db,stmts,supplierParams){
  const current=()=>({products:stmts.getAllProducts.all().map(p=>({...p,noBarcode:!!p.noBarcode})),purchases:stmts.getAllPurchases.all().map(parsePurchase),suppliers:stmts.getAllSuppliers.all().map(s=>({...s,catalog:JSON.parse(s.catalog||'[]')})),openShift:stmts.getOpenShift.get(),cashLogs:db.prepare('SELECT * FROM cash_log').all()})
  return {applyInventoryOperation(request,actor){
    if(!actor||!['owner','staff'].includes(actor.role)||request.kind!=='stocktake'&&actor.role!=='owner')throw Error('權限不足')
    let replay=false,historyChecked=false
    try{return db.transaction(()=>{
      const key=INVENTORY_PREFIX+request.id,old=db.prepare('SELECT * FROM audit_log WHERE id=?').get(key)
      replay=!!old;historyChecked=true;const data={...current(),storeId:stmts.getSetting.get('sharedStoreId')?.value}
      if(old){if(old.action!==INVENTORY_ACTION)throw Error('庫存回執需要核對');return inventoryReceipt(request,JSON.parse(old.detail),data)}
      const plan=planInventory(request,data,actor)
      for(const p of plan.products){
        if(plan.created.includes(p.id))stmts.insertProduct.run({...p,noBarcode:p.noBarcode?1:0})
        else stmts.updateProductStock.run({id:p.id,delta:p.stock-data.products.find(old=>old.id===p.id).stock})
      }
      if(plan.purchase)(plan.createPurchase?stmts.insertPurchase:stmts.updatePurchase).run(purchaseParams(plan.purchase))
      if(plan.supplier)stmts.updateSupplier.run(supplierParams(plan.supplier,plan.supplier.id))
      if(plan.cashLog)stmts.insertCashLog.run(plan.cashLog)
      stmts.insertAuditLog.run({id:key,timestamp:new Date().toISOString(),action:INVENTORY_ACTION,level:'info',label:request.kind==='receive'?'進貨到貨':'庫存盤點',userId:actor.userId||'',username:actor.username||'',role:actor.role,detail:JSON.stringify(plan.receipt)})
      return inventoryReceipt(request,plan.receipt,current())
    })()}catch(error){return {success:false,committed:error.operationConflict===true||historyChecked&&!replay?false:null,error:error.message}}
  }}
}
