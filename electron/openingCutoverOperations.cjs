const {OPENING_CUTOVER_PROTOCOL,OPENING_CUTOVER_FENCE,OPENING_CUTOVER_HEAD,openingActivationRequest}=require('./openingCutoverRules.mjs'),{previewOpeningCutover,verifyOpeningCutover,cutoverCustomerRequest,cutoverEconomicDigest}=require('./openingCutoverModel.mjs'),{openingCutoverMasterRequest}=require('./openingCutoverSource.mjs'),{readOpeningCutoverHistory,openingCutoverAudit}=require('./openingCutoverHistory.mjs'),{makeOpeningCutoverReceipt,cutoverOpeningRows,assertOpeningCutoverResult}=require('./openingCutoverReceipt.mjs'),{openingBootstrap,openingStockEvidence}=require('./openingMigration.mjs'),{readStockOpening}=require('./stockOpeningOperations.cjs'),{stockLedgerDigest}=require('./stockLedgerModel.mjs'),{planCustomerOpeningActivation}=require('./customerLedger.mjs'),{planSupplierOpeningActivation}=require('./supplierLedger.mjs')
module.exports=function(db,api,stmts,store,openingMasters){
 const {OPENING_CUTOVER_LOOKUP,lookupOpeningCutover}=require('./openingCutoverLookup.mjs')
 const legacyPreview=api.previewOpeningMigration,legacyApply=api.applyOpeningMigration,readCustomer=require('./tradingState.cjs')(db,stmts),readSupplier=require('./supplierState.cjs')(db,stmts)
 api.previewOpeningMigration=(input,actor)=>input?.protocol===OPENING_CUTOVER_LOOKUP?db.transaction(()=>{const scope=api.getPrivateDraftContext(actor),knownOriginal=!!db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get('applyOpeningMigration',input.id);return lookupOpeningCutover(input,api.exportData(),scope,actor,{knownOriginal})})():input?.protocol===OPENING_CUTOVER_PROTOCOL?db.transaction(()=>{const scope=api.getPrivateDraftContext(actor);return previewOpeningCutover(input,api.exportData(),scope,actor)})():legacyPreview(input,actor)
 api.applyOpeningMigration=(input,actor)=>{
  if(input?.protocol!==OPENING_CUTOVER_PROTOCOL)return legacyApply(input,actor)
  let checked=false,existing=false
  try{return db.transaction(()=>store.scope(()=>{
   const scope=api.getPrivateDraftContext(actor),book=api.exportData(),history=readOpeningCutoverHistory(book);existing=history.byId.has(input.id)
   if(!existing){if(db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get('applyOpeningMigration',input.id))throw Error('原搬家編號曾經保存，請使用復原引導核對，勿重新搬入。');checked=true}
   const verified=verifyOpeningCutover(input,book,scope,actor);if(verified.receipt)return assertOpeningCutoverResult(input,{success:true,receipt:verified.receipt})
   const plan=verified.preview.plan,time=new Date().toISOString(),child=openingCutoverMasterRequest(input);let childSaved=null,masterId=null,bootstrapId=null,stockReceipt=null
   if(child){const view=openingMasters.preview(child,actor);childSaved=openingMasters.apply({...child,review:view.review},actor);if(childSaved?.success!==true)throw Error(childSaved?.error||'主檔尚未保存，整批仍保留。');masterId=childSaved.receipt.id}
   const supplierCreates=[],customerCreates=[]
   for(const row of plan.parties.creations.filter(row=>row.side==='payable')){const result=api.addSupplier(row.values);if(result?.success!==true)throw Error(result?.error||'供應商尚未保存。');supplierCreates.push({sourceKey:row.sourceKey,supplierId:row.values.id,values:structuredClone(row.values)})}
   for(const row of plan.parties.creations.filter(row=>row.side==='receivable')){const data=readCustomer(),request=cutoverCustomerRequest(input,row,data.customerEntries.length,time),result=api.applyCustomerLedgerOperation(request,actor);if(result?.success!==true)throw Error(result?.error||'往來客戶尚未保存。');customerCreates.push({sourceKey:row.sourceKey,customerId:row.values.id,operationId:request.id,revision:result.event.revision,profile:structuredClone(result.event.customer)})}
   // Capture both prior ledgers before either activation marker is inserted.
   // No public reader may observe the intentionally incomplete inner postimage.
   const customer=readCustomer(),supplier=readSupplier(),afterMasters=api.exportData()
   if(plan.stockRows.length){
    const bootstrap=openingBootstrap(afterMasters,scope,input,time)
    if(bootstrap){const snapshot=readStockOpening(api,actor,db),request={...bootstrap.input,snapshotDigest:stockLedgerDigest(snapshot.material)};store.append(request,actor,{openingMaterial:snapshot.material,time,date:input.cutoffDate});bootstrapId=request.id}
    const evidence=openingStockEvidence({opening:cutoverOpeningRows(plan)},afterMasters)
    stockReceipt=store.append(input,actor,{time,date:input.cutoffDate},'applyOpeningMigration',evidence,projection=>{for(const row of evidence.products){if(projection.lots?.products.some(p=>p.productId===row.id&&p.required))throw Error('來源還需要原批號資料，整批尚未保存。');const result=db.prepare('UPDATE products SET stock=? WHERE id=? AND stock=0 AND unit=?').run(row.afterUnits/1000,row.id,row.unit);if(result.changes!==1)throw Error('商品或庫存已更新，請重新核對。')}})
   }
   const receipt=makeOpeningCutoverReceipt(input,plan,history,actor,time,{masterId,stockReceipt,bootstrapId,customerCreates,supplierCreates,customerRevision:customer.customerEntries.length+1,supplierRevision:supplier.supplierEntries.length+1,priorCustomerDigest:customer.customerLedger.openingDigest||null,priorSupplierDigest:supplier.supplierLedger.openingDigest||null}),ar=planCustomerOpeningActivation(openingActivationRequest(receipt,'receivable',scope),customer,actor,receipt),ap=planSupplierOpeningActivation(openingActivationRequest(receipt,'payable',scope),supplier,actor,receipt)
   const fences=require('./databaseFeatureFence.cjs');fences.installCustomerFence(db);fences.installSupplierFence(db)
   for(const [table,value]of [['customer_entries',ar.event],['customer_operations',ar.receipt],['supplier_entries',ap.event],['supplier_operations',ap.receipt]])db.prepare('INSERT INTO '+table+' (id,data) VALUES (?,?)').run(value.id,JSON.stringify(value))
   childSaved?.complete();fences.installCutoverFence(db);fences.installOpeningMigrationFence(db);fences.installWorkbookMigrationFence(db);fences.installTabularMigrationFence(db);fences.installMasterMigrationFence(db)
   for(const key of ['agentMasterMigrationVersionFence','agentTabularMigrationVersionFence','agentWorkbookMigrationVersionFence','stockOpeningMigrationVersionFence',OPENING_CUTOVER_FENCE])stmts.setSetting.run(key,'1')
   stmts.setSetting.run(OPENING_CUTOVER_HEAD,JSON.stringify(receipt.hash));stmts.insertAuditLog.run(openingCutoverAudit(receipt))
   const final=api.exportData(),saved=readOpeningCutoverHistory(final),economic=cutoverEconomicDigest(final,scope,saved.context,plan,childSaved?.receipt)
   if(economic.digest!==input.review.trialDigest)throw Error('保存後的主檔、庫存或帳款與核對結果不同，整批尚未保存。')
   return assertOpeningCutoverResult(input,{success:true,receipt})
  }))()}catch(error){return {success:false,committed:error.historyUncertain||!checked||existing?null:false,error:error.message}}
 }
}
