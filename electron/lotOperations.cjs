const {LOT_METHOD,LOT_SETTING,lotCommand,lotError}=require('./lotRules.mjs')
const {lotEvidence,LOT_SYSTEM_ACTOR}=require('./lotPlan.mjs')
const {lotEffectiveDay,lotEligibility,splitLotSegments}=require('./lotSelection.mjs')
const {makeLotState}=require('./lotState.mjs')
const {assertStockCustodyMatchesBook}=require('./stockOpeningPlan.mjs')
const {warehouseLocationUnits}=require('./warehousePlan.mjs')
const {canonicalSignature}=require('./operationRules.mjs')
const {salesDate}=require('./salesRules.mjs')
module.exports=function installLots(db,api,store){
 const rawProducts=api.getProducts.bind(api);let depth=0
 function who(value,owner=false){const user=api.getUsers().find(row=>row.id===value?.userId);if(!user||!['owner',...(owner?[]:['staff'])].includes(value?.role)||user.role!==value.role||user.username!==value.username)throw Error('權限不足');return {userId:user.id,username:user.username,role:user.role}}
 const context=()=>({storeId:api.getSetting('sharedStoreId')||'',epoch:db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value||'',now:new Date().toISOString(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})
 function current(){const state=store.read();if(state.projection){if(!store.matchesEpoch(state)||state.entries[0].input.storeId!==context().storeId)throw lotError('HISTORY');assertStockCustodyMatchesBook(state.projection.custody,rawProducts(),api.getRestaurantState().entries,state.projection.warehousing)}return state}
 const result=(input,receipt)=>({success:true,command:structuredClone(input),receipt:structuredClone(receipt)})
 function save(raw,actor,system=false){let checked=false,existing=false;try{return db.transaction(()=>{
  const input=lotCommand(raw),verified=system?LOT_SYSTEM_ACTOR:who(actor,input.action!=='dispose');if(!system&&input.action==='expire'||system&&input.action!=='expire')throw lotError('AUTHORITY');checked=true
  const saved=store.lookup(input,verified,LOT_METHOD);existing=!!saved;if(saved)return result(input,saved)
  const state=current(),scope=context();if(!state.projection||input.storeId!==scope.storeId||input.epoch!==scope.epoch||input.expectedStateDigest!==state.stateDigest||Math.abs(Date.now()-Date.parse(input.time))>300000)throw lotError('STALE')
  const evidence=lotEvidence(state.projection,rawProducts(),input,verified),time=new Date().toISOString(),date=salesDate(new Date(time))
  return store.scope(()=>{const receipt=store.append(input,verified,{time,date},LOT_METHOD,evidence,projection=>{
   require('./databaseFeatureFence.cjs').installLotFence(db)
   db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(LOT_SETTING,'1')
   for(const product of evidence.products)db.prepare('UPDATE products SET stock=? WHERE id=?').run(warehouseLocationUnits(projection.custody,'main',product.id,product.unit)/1000,product.id)
   if(evidence.waste){const row=evidence.waste;db.prepare('INSERT INTO waste_log (id,productId,productName,qty,reason,cost,time,cashier) VALUES (@id,@productId,@productName,@qty,@reason,@cost,@time,@cashier)').run(row)}
  });current();return result(input,receipt)})
 })()}catch(error){return {success:false,committed:!checked||existing||['STOCK_LOT_HISTORY','STOCK_LEDGER_HISTORY'].includes(error.code)?null:false,error:error.message,errorCode:error.code||null}}}
 api.getLotState=actor=>db.transaction(()=>{const user=who(actor);return makeLotState(current(),rawProducts(),context(),{showCosts:user.role==='owner',wasteLog:api.getWasteLog()})})()
 api.applyLotOperation=(raw,actor)=>save(raw,actor)
 // Only native closures call this; there is no preload, IPC or RPC route.
 api.applySystemLotExpiry=()=>{const state=current(),scope=context();if(!state.projection?.lots)return {success:false,notRequired:true};const day=lotEffectiveDay(state.projection.lots,scope.now),input={protocol:'pos-stock-lots/v1',id:'lot-expire-'+day+'-'+state.stateDigest.slice(7,31),time:scope.now,storeId:scope.storeId,epoch:scope.epoch,expectedStateDigest:state.stateDigest,action:'expire',day};return save(input,LOT_SYSTEM_ACTOR,true)}
 function expire(){
  if(depth||db.inTransaction)return;depth++
  try{const state=current(),lots=state.projection?.lots;if(!lots)return;const day=lotEffectiveDay(lots,new Date().toISOString()),sources=new Map(state.projection.custody.sources.map(row=>[row.id,row]));const needed=day>lots.observedDay||state.projection.custody.positions.some(node=>node.owner.stage==='available'&&splitLotSegments(state.projection.custody,lots,node.segments).some(row=>lotEligibility(lots,sources.get(row.segment.sourceId).productId,row.lot,day)!=='eligible'));if(needed){const saved=api.applySystemLotExpiry();if(saved.success!==true)throw lotError('HISTORY')}}finally{depth--}
 }
 const actorAt={checkout:3,refundOrder:2,addProduct:1,addWaste:1,applyInventoryOperation:1,applyRestaurantOperation:1,applySalesOperation:1,applyWarehouseOperation:1,applyLotOperation:1,applyStockCostOperation:1,applyStockSetupOperation:1,getLotState:0,getWarehouseState:0,getStockCostState:0,getStockSetupState:0,getStockCostPreview:0,getStockAccountingState:0,getStockHistory:1,getStockSalesState:0,getStocktakeState:0,previewStockSetup:1}
 const ownerOnly=new Set(['refundOrder','applySalesOperation','applyStockCostOperation','applyStockSetupOperation','getStockCostState','getStockSetupState','getStockCostPreview','getStockAccountingState','getStockHistory','previewStockSetup'])
 function installGuards(){for(const name of ['getProducts','getStoreSnapshot','exportData','exportFullBackup',...Object.keys(actorAt)]){
  const original=api[name];if(typeof original!=='function')continue
  api[name]=function(...args){
   if(!depth&&!db.inTransaction){let permitted=true;const requireOwner=ownerOnly.has(name)||name==='applyLotOperation'&&args[0]?.action!=='dispose'||name==='applyWarehouseOperation'&&args[0]?.action!=='transfer'||name==='applyInventoryOperation'&&args[0]?.kind!=='stocktake'||name==='applyRestaurantOperation'&&args[0]?.action==='configure';if(Object.hasOwn(actorAt,name))try{who(args[actorAt[name]],requireOwner)}catch{permitted=false}
    let existing=false;const request=name==='refundOrder'?args[1]:args[0],method=({applyStockSetupOperation:'applyStockCostOperation'})[name]||name
    if(/^(?:apply|checkout|refundOrder|addProduct|addWaste)/.test(name)&&typeof request?.id==='string')existing=!!db.prepare('SELECT 1 FROM stock_cost_operations WHERE id=?').get(canonicalSignature([method,request.id]))||!!db.prepare('SELECT 1 FROM recovery_original_ids WHERE method=? AND operation_id=? LIMIT 1').get(method,request.id)
    if(permitted&&!existing)expire()
   }
   depth++;try{return original.apply(this,args)}finally{depth--}
  }
 }}
 return {installGuards}
}
