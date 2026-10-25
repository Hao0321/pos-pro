module.exports=function(db,api,stmts){
 const model=require('./purchaseInvoice.mjs'),read=require('./supplierState.cjs')(db,stmts),previous=api.lookupPrivateDraftOriginal
 api.lookupPrivateDraftOriginal=function(input,actor){
  if(input?.family!==model.PURCHASE_INVOICE_FAMILY)return previous.call(this,input,actor)
  return db.transaction(()=>{const current=this.getPrivateDraftContext(actor);model.assertInvoiceLookup(input,current);const proof=model.purchaseInvoiceOriginal(input,current,read())
   if(proof.status==='missing'&&db.prepare("SELECT 1 FROM recovery_original_ids WHERE method='applyInventoryOperation' AND operation_id=? LIMIT 1").get(input.id))throw Object.assign(Error('請款原紀錄需要核對，請保留輸入，勿重複建單。'),{historyUncertain:true})
   return proof
  })()
 }
}
