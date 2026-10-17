const {WAREHOUSE_METHOD,WAREHOUSE_SETTING,warehouseCommand,warehouseError}=require('./warehouseRules.mjs')
const {warehouseState,warehouseProductEvidence,planWarehouse,warehouseLocationUnits}=require('./warehousePlan.mjs')
const {assertStockCustodyMatchesBook}=require('./stockOpeningPlan.mjs')
const {canonicalSignature}=require('./operationRules.mjs')
const {salesDate}=require('./salesRules.mjs')
module.exports=function warehouseOperations(db,api,store){
 function actor(value){const account=api.getUsers().find(row=>row.id===value?.userId);if(!account||!['owner','staff'].includes(value?.role)||account.role!==value.role||account.username!==value.username)throw Error('權限不足');return {userId:account.id,username:account.username,role:account.role}}
 const context=()=>({storeId:api.getSetting('sharedStoreId')||'',epoch:db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value||'',now:new Date().toISOString()})
 function current(){const state=store.read();if(state.projection){if(!store.matchesEpoch(state)||state.entries[0].input.storeId!==context().storeId)throw warehouseError('HISTORY');assertStockCustodyMatchesBook(state.projection.custody,api.getProducts(),api.getRestaurantState().entries,state.projection.warehousing)}return state}
 const result=(input,receipt)=>({success:true,command:structuredClone(input),receipt:structuredClone(receipt)})
 api.getWarehouseState=value=>db.transaction(()=>{const who=actor(value);return warehouseState(current(),api.getProducts(),context(),{showCosts:who.role==='owner'})})()
 api.applyWarehouseOperation=(raw,value)=>{
  let checked=false,existing=false
  try{return db.transaction(()=>{
   const who=actor(value),input=warehouseCommand(raw);checked=true
   const saved=store.lookup(input,who,WAREHOUSE_METHOD);existing=!!saved
   if(saved)return result(input,saved)
   const state=current(),scope=context()
   if(!state.projection)throw warehouseError('INACTIVE')
   if(input.storeId!==scope.storeId||input.epoch!==scope.epoch||input.expectedStateDigest!==state.stateDigest||Math.abs(Date.now()-Date.parse(input.time))>300000)throw warehouseError('STALE')
   const evidence=warehouseProductEvidence(state.projection,api.getProducts(),input),date=salesDate(new Date(input.time)),planned=planWarehouse(state.projection,{input,evidence,beforeDigest:state.stateDigest,date,actor:who})
   return store.scope(()=>{
    for(const product of evidence.products)db.prepare('UPDATE products SET stock=? WHERE id=?').run(warehouseLocationUnits(planned.custody,'main',product.id,product.unit)/1000,product.id)
    require('./databaseFeatureFence.cjs').installWarehouseFence(db)
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(WAREHOUSE_SETTING,'1')
    const receipt=store.append(input,who,{time:new Date().toISOString(),date},WAREHOUSE_METHOD,evidence)
    current();return result(input,receipt)
   })
  })()}catch(error){return {success:false,committed:!checked||existing||error.code==='WAREHOUSE_HISTORY'||error.code==='STOCK_LEDGER_HISTORY'?null:false,error:error.message,errorCode:error.code||null}}
 }
}
