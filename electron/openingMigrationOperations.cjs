const {previewOpeningMigration,verifyOpeningMigration,openingBootstrap,openingStockEvidence}=require('./openingMigration.mjs'),{readOpeningMigrationInput,openingMasterRequest,OPENING_MIGRATION_METHOD,OPENING_MIGRATION_FENCE,OPENING_MIGRATION_HEAD}=require('./openingMigrationSource.mjs'),{readOpeningMigrationHistory,makeOpeningMigrationReceipt,openingMigrationAudit,assertOpeningMigrationResult}=require('./openingMigrationHistory.mjs'),{stockLedgerDigest}=require('./stockLedgerModel.mjs'),{readStockOpening}=require('./stockOpeningOperations.cjs'),{validateStockCostBook}=require('./stockBackup.mjs')
module.exports=function installOpeningMigration(db,api,stmts,store,openingMasters){
 const current=actor=>{const scope=api.getPrivateDraftContext(actor);return {book:api.exportData(),scope}}
 api.previewOpeningMigration=(input,actor)=>db.transaction(()=>{const {book,scope}=current(actor);return previewOpeningMigration(input,book,scope,actor)})()
 api.applyOpeningMigration=(input,actor)=>{
  let checked=false,existing=false
  try{return db.transaction(()=>store.scope(()=>{
   const {book,scope}=current(actor),history=readOpeningMigrationHistory(book);existing=history.byId.has(input?.id);const {preview,receipt}=verifyOpeningMigration(input,book,scope,actor);checked=true
   if(receipt)return assertOpeningMigrationResult(input,{success:true,receipt})
   if(db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(OPENING_MIGRATION_METHOD,input.id))throw Error('原期初編號曾經保存，請使用復原引導核對，勿重新搬入。')
   const parsed=readOpeningMigrationInput(input),time=new Date().toISOString();let masterId=null,bootstrapId=null,childSaved=null
   if(parsed.masterSource){const child=openingMasterRequest(input,parsed.masterSource),view=openingMasters.preview(child,actor);childSaved=openingMasters.apply({...child,review:view.review},actor);if(childSaved?.success!==true)throw Error(childSaved?.error||'主檔尚未完成，期初資料仍保留。');masterId=childSaved.receipt.id}
   const afterMasters=api.exportData(),bootstrap=openingBootstrap(afterMasters,scope,input,time)
   if(bootstrap){const snapshot=readStockOpening(api,actor,db),request={...bootstrap.input,snapshotDigest:stockLedgerDigest(snapshot.material)};store.append(request,actor,{openingMaterial:snapshot.material,time,date:input.cutoffDate});bootstrapId=request.id}
   const evidence=openingStockEvidence(preview,api.exportData()),stockReceipt=store.append(input,actor,{time,date:input.cutoffDate},OPENING_MIGRATION_METHOD,evidence,projection=>{
    for(const row of evidence.products){if(projection.lots?.products.some(p=>p.productId===row.id&&p.required))throw Error('這項商品需要原批號資料，請先核對。');const changed=db.prepare('UPDATE products SET stock=? WHERE id=? AND stock=0 AND unit=?').run(row.afterUnits/1000,row.id,row.unit);if(changed.changes!==1)throw Error('本店商品或庫存已更新，請重新核對。')}
   })
   const saved=makeOpeningMigrationReceipt(input,preview,history,actor,time,stockReceipt,masterId,bootstrapId)
   childSaved?.complete()
   const fences=require('./databaseFeatureFence.cjs');fences.installOpeningMigrationFence(db);fences.installWorkbookMigrationFence(db);fences.installTabularMigrationFence(db);for(const key of ['agentWorkbookMigrationVersionFence','agentTabularMigrationVersionFence'])stmts.setSetting.run(key,'1');stmts.setSetting.run(OPENING_MIGRATION_FENCE,'1');stmts.setSetting.run(OPENING_MIGRATION_HEAD,JSON.stringify(saved.hash));stmts.insertAuditLog.run(openingMigrationAudit(saved))
   const final=api.exportData();readOpeningMigrationHistory(final);validateStockCostBook(final);return assertOpeningMigrationResult(input,{success:true,receipt:saved})
  }))()}catch(error){return {success:false,committed:checked&&!existing?false:null,error:error.message}}
 }
}
