const {stockCostCommand,stockLedgerError,assertStockCustodyMatchesBook}=require('./stockOpeningPlan.mjs')
const {readStockOpening}=require('./stockOpeningOperations.cjs')
const {salesDate}=require('./salesRules.mjs')
const {createHash}=require('node:crypto')
module.exports=function stockCostOperations(db,api,store){
 const owner=actor=>{const user=actor?.userId&&api.getUsers().find(row=>row.id===actor.userId);if(actor?.role!=='owner'||user?.role!=='owner'||user.username!==actor.username)throw Error('權限不足');return actor}
 function current(){const state=store.read();if(state.projection)assertStockCustodyMatchesBook(state.projection.custody,api.getProducts(),api.getRestaurantState().entries);return state}
 return {
  getStockCostState(actor){owner(actor);return db.transaction(()=>{owner(actor);const state=current();return {status:state.projection?'active':'reference-only-not-activated',sequence:state.entries.length,stateDigest:state.stateDigest,projection:state.projection,valuation:state.valuation}})()},
  applyStockCostOperation(raw,actor){
   owner(actor)
   let checked=false,replay=false
   try{return db.transaction(()=>{
    owner(actor)
    const input=stockCostCommand(raw),saved=store.lookup(input,actor);checked=true;replay=!!saved
    if(saved)return saved
    const state=current(),sales=api.getSalesState(actor)
    if(input.storeId!==sales.storeId||input.epoch!==sales.epoch||Math.abs(Date.now()-Date.parse(input.time))>300000)throw stockLedgerError('STALE')
    let openingMaterial=null
    if(input.action==='open'){
     if(state.projection)throw stockLedgerError('ACTIVE')
     const snapshot=readStockOpening(api,actor,db),hash='sha256:'+createHash('sha256').update(snapshot.material).digest('hex')
     if(hash!==input.snapshotDigest)throw stockLedgerError('STALE')
     openingMaterial=snapshot.material
    }else if(!state.projection)throw stockLedgerError('HISTORY')
    const now=new Date(),receipt=store.append(input,actor,{openingMaterial,time:now.toISOString(),date:salesDate(now)})
    current()
    return receipt
   })()}catch(error){return {success:false,committed:error.code==='STOCK_LEDGER_HISTORY'||!checked||replay?null:false,error:error.message,errorCode:error.code||null}}
  },
 }
}
