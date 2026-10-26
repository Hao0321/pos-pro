module.exports=function(db,api,stmts){
 const model=require('./purchaseCorrection.mjs'),read=require('./supplierState.cjs')(db,stmts),previous=api.lookupPrivateDraftOriginal
 api.lookupPrivateDraftOriginal=function(input,actor){
  if(input?.family!==model.PURCHASE_CORRECTION_FAMILY)return previous.call(this,input,actor)
  return db.transaction(()=>{
   const current=this.getPrivateDraftContext(actor);model.assertCorrectionLookup(input,current)
   const proof=model.purchaseCorrectionOriginal(input,current,read())
   if(proof.status==='missing'&&db.prepare("SELECT 1 FROM recovery_original_ids WHERE method='applyInventoryOperation' AND operation_id=? LIMIT 1").get(input.id))throw Object.assign(Error('更正原紀錄需要核對，請保留原因，勿重複操作。'),{historyUncertain:true})
   return proof
  })()
 }
}
