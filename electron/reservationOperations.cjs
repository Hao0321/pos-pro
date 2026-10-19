const {RESERVATION_ACTION,RESERVATION_FENCE,RESERVATION_HEAD,RESERVATION_METHOD,reservationError}=require('./reservationConfig.mjs'),{readReservationBook,reservationKnownReceipts,reservationAudit,assertReservationResult}=require('./reservationHistory.mjs'),{projectReservationBook,reservationView,reservationData,assertReservationTableChange}=require('./reservationCommit.mjs'),{reservationAvailability}=require('./reservationCapacity.mjs'),{draftObject}=require('./privateDrafts.mjs')
module.exports=function(db,api,stmts,stockStore){
 const graph=require('./recoveryGraphStorage.cjs')(db),rows=()=>db.prepare('SELECT data FROM restaurant_operations ORDER BY id').all().map(row=>JSON.parse(row.data)),book=()=>({settings:stmts.getAllSettings.all(),auditLog:db.prepare("SELECT * FROM audit_log WHERE action=? OR id LIKE 'reservation:%' ORDER BY id").all(RESERVATION_ACTION),restaurantOperations:rows(),products:api.getProducts(),users:api.getUsers()}),known=scope=>db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? LIMIT 1').get(RESERVATION_METHOD)?reservationKnownReceipts(graph.read(),scope.storeId):[]
 api.getReservationState=actor=>db.transaction(()=>{const scope=api.getPrivateDraftContext(actor),before=book();return reservationView(before,scope,Date.now(),known(scope))})()
 api.getReservationAvailability=(input,actor)=>db.transaction(()=>{draftObject(input,['date','partySize','online']);if(typeof input.online!=='boolean')throw reservationError('CONFIG');const scope=api.getPrivateDraftContext(actor),now=Date.now(),{history}=reservationData(book(),scope,now,known(scope));return {storeId:scope.storeId,epoch:scope.epoch,revision:history.state.revision,...reservationAvailability(history.state,input.date,input.partySize,now,{online:input.online})}})()
 api.applyReservationOperation=(input,actor)=>{
  let checked=false,existing=false
  try{return db.transaction(()=>stockStore.scope(()=>{
   const scope=api.getPrivateDraftContext(actor),before=book(),retained=known(scope),history=readReservationBook(before,retained);checked=true;existing=history.byId.has(input?.id)
   const saved=projectReservationBook(before,input,scope,actor,new Date().toISOString(),retained)
   if(saved.existing)return assertReservationResult(input,saved.result)
   if(db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(RESERVATION_METHOD,input.id)&&!history.byId.has(input.id))throw reservationError('HISTORY')
   require('./databaseFeatureFence.cjs').installReservationFence(db)
   for(const receipt of [...saved.missing,saved.receipt])stmts.insertAuditLog.run(reservationAudit(receipt))
   if(saved.activation)db.prepare('INSERT INTO restaurant_operations(id,data) VALUES (?,?)').run(saved.activation.id,JSON.stringify(saved.activation))
   for(const key of ['agentMasterMigrationVersionFence','agentTabularMigrationVersionFence','agentWorkbookMigrationVersionFence','stockOpeningMigrationVersionFence','openingCutoverVersionFence',RESERVATION_FENCE])stmts.setSetting.run(key,'1');stmts.setSetting.run(RESERVATION_HEAD,JSON.stringify(saved.event.hash))
   const final=book(),actual=readReservationBook(final,retained)
   if(actual.state.head!==saved.event.hash||actual.state.needsRecovery)throw reservationError('HISTORY')
   require('./stockBackup.mjs').validateStockCostBook(api.exportData())
   return assertReservationResult(input,{...saved.result,state:reservationView(final,scope,Date.now(),retained)})
  })).immediate()}catch(error){return {success:false,committed:!checked||existing?null:false,error:/SQLITE_BUSY/.test(error.code||'')?reservationError('STALE').message:error.message,errorCode:error.code||'RESERVATION_WRITE'}}
 }
 const restaurant=api.applyRestaurantOperation
 api.applyRestaurantOperation=function(input,actor){
  if(input?.action!=='configure'||!db.prepare('SELECT 1 FROM settings WHERE key=?').get(RESERVATION_FENCE))return restaurant.call(this,input,actor)
  return db.transaction(()=>{const scope=api.getPrivateDraftContext(actor),before=book(),after={...before,settings:before.settings.filter(row=>row.key!=='restaurantConfig').concat({key:'restaurantConfig',value:JSON.stringify(input.config)})};assertReservationTableChange(before,after,Date.now(),known(scope));return restaurant.call(this,input,actor)}).immediate()
 }
}
