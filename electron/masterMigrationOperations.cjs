const {readMasterMigrationInput,readMasterMigrationHistory,previewMasterMigration,verifyMasterMigration,masterMigrationReceipt,masterMigrationAudit,MASTER_MIGRATION_HEAD,MASTER_MIGRATION_FENCE,assertMasterMigrationResult,assertPublicMasterMigration}=require('./masterMigration.mjs'),{OPENING_MASTER_PROTOCOL}=require('./openingMigrationSource.mjs')
module.exports=function installMasterMigration(db,api,stmts){
  const current=actor=>{const scope=api.getPrivateDraftContext(actor);return {book:api.exportData(),scope}}
  const assertOpening=input=>{if(!db.inTransaction||input?.protocol!==OPENING_MASTER_PROTOCOL&&!require('./openingCutoverRules.mjs').isOpeningCutoverMaster(input?.protocol))throw Error('期初主檔只能與原期初批次一起保存。')}
  const preview=(input,actor)=>db.transaction(()=>{const {book,scope}=current(actor);return previewMasterMigration(input,book,scope,actor)})()
  const persist=(parsed,saved,validate=true)=>{
    require('./databaseFeatureFence.cjs').installMasterMigrationFence(db)
    if(['pos-tabular-migration/v1','pos-workbook-migration/v1'].includes(parsed.source.protocol)){require('./databaseFeatureFence.cjs').installTabularMigrationFence(db);stmts.setSetting.run('agentTabularMigrationVersionFence','1')}
    if(parsed.source.protocol==='pos-workbook-migration/v1'){require('./databaseFeatureFence.cjs').installWorkbookMigrationFence(db);stmts.setSetting.run('agentWorkbookMigrationVersionFence','1')}
    if(require('./migrationBatchDraft.mjs').migrationBatchSourceText(JSON.parse(saved.signature).sourceText)){const fence=require('./databaseFeatureFence.cjs');fence.installMigrationBatchFence(db);fence.installFinancialFileFence(db);for(const key of ['migrationSourceBatchVersionFence','financialFileMigrationVersionFence'])stmts.setSetting.run(key,'1')}
    stmts.insertAuditLog.run(masterMigrationAudit(saved))
    stmts.setSetting.run(MASTER_MIGRATION_FENCE,'1');stmts.setSetting.run(MASTER_MIGRATION_HEAD,JSON.stringify(saved.hash))
    if(validate)readMasterMigrationHistory(api.exportData())
  }
  const apply=(input,actor,opening=false)=>{
    let checked=false,existing=false
    try{return db.transaction(()=>{
      if(opening)assertOpening(input);else assertPublicMasterMigration(input)
      const {book,scope}=current(actor),parsed=readMasterMigrationInput(input);existing=readMasterMigrationHistory(book).byId.has(input.id);checked=true
      const {preview,receipt}=verifyMasterMigration(input,book,scope,actor)
      checked=true
      if(receipt)return assertMasterMigrationResult(input,{success:true,receipt})
      if(db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get('applyMasterMigration',input.id))throw Error('原編號曾經保存，請使用復原引導核對，勿重新搬入。')
      const history=readMasterMigrationHistory(book)
      for(const entity of ['suppliers','products','customers'])for(const row of preview.rows.filter(row=>row.entity===entity&&['create','update'].includes(row.action))){
        const value={...row.values,id:row.targetId},create=row.action==='create'
        const result=entity==='products'?(create?api.addProduct({...value,stock:0},actor):api.updateProduct(row.targetId,row.values,actor)):entity==='suppliers'?(create?api.addSupplier(value):api.updateSupplier(row.targetId,row.values)):(create?api.addMember(value):api.updateMember(row.targetId,row.values))
        if(result?.success!==true)throw Error(result?.error||'搬入尚未完成，原資料仍保留。')
      }
      const saved=masterMigrationReceipt(input,preview,history,actor,new Date().toISOString(),api.exportData())
      if(opening){let completed=false;return {...assertMasterMigrationResult(input,{success:true,receipt:saved}),complete(){assertOpening(input);if(completed)throw Error('期初主檔已核對。');persist(parsed,saved,false);completed=true}}}
      persist(parsed,saved)
      return assertMasterMigrationResult(input,{success:true,receipt:saved})
    })()}catch(error){return {success:false,committed:checked&&!existing?false:null,error:error.message}}
  }
  api.previewMasterMigration=(input,actor)=>{assertPublicMasterMigration(input);return preview(input,actor)}
  api.applyMasterMigration=(input,actor)=>apply(input,actor)
  // This facade is held by the opening transaction, never installed on api,
  // preload, IPC or HTTPS. Its receipt is finalized with the parent posting.
  return {preview(input,actor){assertOpening(input);return preview(input,actor)},apply(input,actor){assertOpening(input);return apply(input,actor,true)}}
}
