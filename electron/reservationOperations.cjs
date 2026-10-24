const {RESERVATION_ACTION,RESERVATION_FENCE,RESERVATION_HEAD,RESERVATION_METHOD,reservationError}=require('./reservationConfig.mjs'),{readReservationBook,reservationKnownReceipts,reservationAudit,assertReservationResult}=require('./reservationHistory.mjs'),{projectReservationBook,reservationView,reservationData,assertReservationTableChange}=require('./reservationCommit.mjs'),{reservationAvailability}=require('./reservationCapacity.mjs'),{draftObject}=require('./privateDrafts.mjs')
module.exports=function(db,api,stmts,stockStore,kitchenRuntime){
 const graph=require('./recoveryGraphStorage.cjs')(db),rows=()=>db.prepare('SELECT data FROM restaurant_operations ORDER BY id').all().map(row=>JSON.parse(row.data)),book=()=>({settings:stmts.getAllSettings.all(),auditLog:db.prepare("SELECT * FROM audit_log WHERE action=? OR id LIKE 'reservation:%' ORDER BY id").all(RESERVATION_ACTION),restaurantOperations:rows(),restaurantOrders:api.getRestaurantState().entries,products:api.getProducts(),users:api.getUsers(),members:api.getMembers(),cashLog:db.prepare("SELECT * FROM cash_log WHERE id LIKE 'reservation-deposit-%' ORDER BY time,id").all(),shifts:[stmts.getOpenShift.get()].filter(Boolean)}),known=scope=>db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? LIMIT 1').get(RESERVATION_METHOD)?reservationKnownReceipts(graph.read(),scope.storeId):[]
 api.getReservationState=actor=>db.transaction(()=>{const scope=api.getPrivateDraftContext(actor),before=book();return reservationView(before,scope,Date.now(),known(scope))})()
 api.getReservationDiningContext=(input,actor)=>db.transaction(()=>{const scope=api.getPrivateDraftContext(actor),before=book(),state=reservationView(before,scope,Date.now(),known(scope));return require('./reservationDiningContext.mjs').reservationDiningContext(input,state,api.getRestaurantState(),before.products,before.members,stockStore.active()?'active':'reference')})()
 api.getReservationAvailability=(input,actor)=>db.transaction(()=>{draftObject(input,['date','partySize','online']);if(typeof input.online!=='boolean')throw reservationError('CONFIG');const scope=api.getPrivateDraftContext(actor),now=Date.now(),{history}=reservationData(book(),scope,now,known(scope));return {storeId:scope.storeId,epoch:scope.epoch,revision:history.state.revision,...reservationAvailability(history.state,input.date,input.partySize,now,{online:input.online})}})()
 const commit=(input,actor,trustedScope=null,options={})=>{
  let checked=false,existing=false
  try{return db.transaction(()=>stockStore.scope(()=>{
   const scope=trustedScope||api.getPrivateDraftContext(actor),before=book(),retained=known(scope),history=readReservationBook(before,retained);checked=true;existing=history.byId.has(input?.id)
   const saved=projectReservationBook(before,input,scope,actor,options.timestamp||new Date().toISOString(),retained,options)
   if(saved.existing)return assertReservationResult(input,{...saved.result,state:reservationView(before,scope,Date.now(),retained)})
   if(db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(RESERVATION_METHOD,input.id)&&!history.byId.has(input.id))throw reservationError('HISTORY')
   require('./databaseFeatureFence.cjs').installReservationFence(db)
   if(saved.book.settings.some(row=>row.key==='reservationDepositApplicationVersionFence'))require('./databaseFeatureFence.cjs').installReservationDepositApplicationFence(db)
   if(saved.book.settings.some(row=>row.key==='reservationDepositVersionFence'))require('./databaseFeatureFence.cjs').installReservationDepositFence(db)
   if(saved.book.settings.some(row=>row.key==='reservationServiceVersionFence'))require('./databaseFeatureFence.cjs').installReservationServiceFence(db)
   if(saved.book.settings.some(row=>row.key==='reservationPublicVersionFence'))require('./databaseFeatureFence.cjs').installReservationPublicFence(db)
   for(const receipt of [...saved.missing,saved.receipt])stmts.insertAuditLog.run(reservationAudit(receipt))
   const cash=require('./reservationDeposits.mjs').reservationDepositCashLog(saved.event);if(cash)stmts.insertCashLog.run(cash)
   if(saved.activation)db.prepare('INSERT INTO restaurant_operations(id,data) VALUES (?,?)').run(saved.activation.id,JSON.stringify(saved.activation))
   for(const key of ['agentMasterMigrationVersionFence','agentTabularMigrationVersionFence','agentWorkbookMigrationVersionFence','stockOpeningMigrationVersionFence','openingCutoverVersionFence',RESERVATION_FENCE])stmts.setSetting.run(key,'1');stmts.setSetting.run(RESERVATION_HEAD,JSON.stringify(saved.event.hash))
   if(saved.book.settings.some(row=>row.key==='reservationServiceVersionFence'))stmts.setSetting.run('reservationServiceVersionFence','1')
   if(saved.book.settings.some(row=>row.key==='reservationDepositVersionFence'))stmts.setSetting.run('reservationDepositVersionFence','1')
   if(saved.book.settings.some(row=>row.key==='reservationDepositApplicationVersionFence'))stmts.setSetting.run('reservationDepositApplicationVersionFence','1')
   if(saved.book.settings.some(row=>row.key==='reservationPublicVersionFence'))stmts.setSetting.run('reservationPublicVersionFence','1')
   const final=book(),actual=readReservationBook(final,retained)
   if(actual.state.head!==saved.event.hash||actual.state.needsRecovery)throw reservationError('HISTORY')
   require('./stockBackup.mjs').validateStockCostBook(api.exportData())
   return assertReservationResult(input,{...saved.result,state:reservationView(final,scope,Date.now(),retained)})
  })).immediate()}catch(error){return {success:false,committed:!checked||existing?null:false,error:/SQLITE_BUSY/.test(error.code||'')?reservationError('STALE').message:error.message,errorCode:error.code||'RESERVATION_WRITE'}}
 }
 const restaurant=api.applyRestaurantOperation.bind(api),dining=require('./reservationDiningOperations.cjs')(db,api,stockStore,kitchenRuntime,{book,known,commit,restaurant})
 const returns=require('./reservationDepositReturnOperations.cjs')(db,api,stockStore,kitchenRuntime,{book,known,commit,restaurant})
 api.applyReservationOperation=(input,actor)=>input?.action==='deposit-return'?returns.applyRoot(input,actor):['dine','deposit-apply'].includes(input?.action)?dining.apply(input,actor):commit(input,actor)
 require('./reservationPublicOperations.cjs')(db,api,{book,known,commit})
 const deleteMember=api.deleteMember.bind(api);api.deleteMember=id=>db.transaction(()=>{const before=book();require('./reservationCommit.mjs').assertReservationMemberRemoval(before,{members:before.members.filter(row=>row.id!==id)},known({storeId:api.getSetting('sharedStoreId')}));return deleteMember(id)}).immediate()
 api.applyRestaurantOperation=function(input,actor){
  if(Object.hasOwn(input||{},'reservationDining'))return dining.existingChild(input,actor)
  if(['funds-refund','cancel','cancel-part'].includes(input?.action)){
   const row=db.prepare('SELECT data FROM restaurant_orders WHERE id=?').get(input.entryId),entry=row?JSON.parse(row.data):null
   if(entry?.funds?.events.some(event=>event.input.action==='funds-deposit-apply'))return returns.applyRestaurant(input,actor)
  }
  if(input?.action!=='configure'||!db.prepare('SELECT 1 FROM settings WHERE key=?').get(RESERVATION_FENCE))return restaurant.call(this,input,actor)
  return db.transaction(()=>{const scope=api.getPrivateDraftContext(actor),before=book(),after={...before,settings:before.settings.filter(row=>row.key!=='restaurantConfig').concat({key:'restaurantConfig',value:JSON.stringify(input.config)})};assertReservationTableChange(before,after,Date.now(),known(scope));return restaurant.call(this,input,actor)}).immediate()
 }
 require('./reservationCustodyOperations.cjs')(db,api,{book,known})
}
