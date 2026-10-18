const {readMasterMigrationInput,readMasterMigrationHistory,previewMasterMigration,verifyMasterMigration,masterMigrationReceipt,masterMigrationAudit,MASTER_MIGRATION_HEAD,MASTER_MIGRATION_FENCE,assertMasterMigrationResult}=require('./masterMigration.mjs')
module.exports=function installMasterMigration(db,api,stmts){
  const current=actor=>{const scope=api.getPrivateDraftContext(actor);return {book:api.exportData(),scope}}
  api.previewMasterMigration=(input,actor)=>db.transaction(()=>{const {book,scope}=current(actor);return previewMasterMigration(input,book,scope,actor)})()
  api.applyMasterMigration=(input,actor)=>{
    let checked=false,existing=false
    try{return db.transaction(()=>{
      const {book,scope}=current(actor);readMasterMigrationInput(input);existing=readMasterMigrationHistory(book).byId.has(input.id);checked=true
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
      require('./databaseFeatureFence.cjs').installMasterMigrationFence(db)
      stmts.insertAuditLog.run(masterMigrationAudit(saved))
      stmts.setSetting.run(MASTER_MIGRATION_FENCE,'1');stmts.setSetting.run(MASTER_MIGRATION_HEAD,JSON.stringify(saved.hash))
      readMasterMigrationHistory(api.exportData())
      return assertMasterMigrationResult(input,{success:true,receipt:saved})
    })()}catch(error){return {success:false,committed:checked&&!existing?false:null,error:error.message}}
  }
}
