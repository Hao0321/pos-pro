module.exports=function(db,api,stmts){
 const model=require('./purchasePayment.mjs'),read=require('./supplierState.cjs')(db,stmts),previous=api.lookupPrivateDraftOriginal
 api.lookupPrivateDraftOriginal=function(input,actor){
  if(input?.family!==model.PURCHASE_PAYMENT_FAMILY)return previous.call(this,input,actor)
  return db.transaction(()=>{const current=this.getPrivateDraftContext(actor);model.assertPaymentLookup(input,current);const proof=model.purchasePaymentOriginal(input,current,read())
   if(proof.status==='missing'&&db.prepare("SELECT 1 FROM recovery_original_ids WHERE method='applyInventoryOperation' AND operation_id=? LIMIT 1").get(input.id))throw Object.assign(Error('付款原紀錄需要核對，請保留輸入，勿重複付款。'),{historyUncertain:true})
   return proof
  })()
 }
}
