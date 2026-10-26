module.exports=function(db,api,stmts,stock){
 const model=require('./ordinarySupplierReturn.mjs'),read=require('./supplierState.cjs')(db,stmts),write=api.applyInventoryOperation,lookup=api.lookupPrivateDraftOriginal
 api.applyInventoryOperation=function(input,actor){
  if(!model.isOrdinaryReturn(input))return write.call(this,input,actor)
  let checked=false,existing=false
  try{return db.transaction(()=>{
   const current=this.getPrivateDraftContext(actor);model.assertOrdinaryReturnHeader(input,current)
   existing=!!db.prepare('SELECT 1 FROM audit_log WHERE id=?').get('stock-operation:'+input.id);checked=true
   if(!existing){const data=read(),po=data.purchases.find(p=>p.id===input.purchaseId),supplier=data.suppliers.find(s=>s.id===po?.supplierId),state=stock.read();model.admitOrdinaryReturn(input,current,{po,supplier,products:data.products,costActive:!!state.projection,lotsActive:!!state.projection?.lots})}
   return write.call(this,input,actor)
  })()}catch(error){return {success:false,committed:checked&&!existing&&!error.historyUncertain?false:null,error:error.message,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{})}}
 }
 api.lookupPrivateDraftOriginal=function(input,actor){
  if(input?.family!==model.ORDINARY_RETURN_FAMILY)return lookup.call(this,input,actor)
  return db.transaction(()=>{
   const current=this.getPrivateDraftContext(actor);model.assertOrdinaryReturnLookup(input,current)
   const data=read(),proof=model.ordinaryReturnOriginal(input,current,data),state=stock.read()
   if(proof.status==='missing'){
    if(state.operations.some(row=>row.id===require('./operationRules.mjs').canonicalSignature(['applyInventoryOperation',input.id]))||db.prepare("SELECT 1 FROM recovery_original_ids WHERE method='applyInventoryOperation' AND operation_id=? LIMIT 1").get(input.id))throw Object.assign(Error('退貨原紀錄需要核對，請保留輸入，勿重複退貨。'),{historyUncertain:true})
    return proof
   }
   if(state.projection){require('./stockBackup.mjs').validateStockCostBook(this.exportData(),state);const receipt=stock.lookup(proof.request,actor,'applyInventoryOperation');if(!receipt&&!state.projection.legacyOperationIds?.applyInventoryOperation?.includes(input.id))throw Error('原單缺少成本回執，請保留原編號核對');if(receipt)proof.result.costReceipt=receipt}
   model.verifyOrdinaryReturnProof(input,proof);return proof
  })()
 }
}
