const {makeStockSetupState,previewStockSetup}=require('./stockSetup.mjs'),{stockCostCommand,assertStockCustodyMatchesBook}=require('./stockOpeningPlan.mjs'),{assertStockSetupResult}=require('./stockSetupReview.mjs')
module.exports=function installStockSetup(db,api,store){
  const owner=actor=>{const user=api.getUsers().find(row=>row.id===actor?.userId);if(actor?.role!=='owner'||!user||user.role!==actor.role||user.username!==actor.username)throw Error('只有目前店主能核對庫存成本')}
  const data=actor=>{
    owner(actor);const sales=api.getSalesState(actor),state=store.read(),products=api.getProducts()
    if(state.projection){if(!store.matchesEpoch(state))throw Error('庫存成本回執需要核對，請保留原編號與資料');assertStockCustodyMatchesBook(state.projection.custody,products,api.getRestaurantState().entries)}
    return {storeId:sales.storeId,epoch:sales.epoch,state,products,preview:state.projection?null:api.getStockCostPreview(actor)}
  }
  const result=(request,receipt)=>assertStockSetupResult(request,{success:true,command:structuredClone(request),receipt})
  api.getStockSetupState=actor=>db.transaction(()=>makeStockSetupState(data(actor)))()
  api.previewStockSetup=(raw,actor)=>db.transaction(()=>previewStockSetup(raw,data(actor)))()
  api.applyStockSetupOperation=(raw,actor,{allowNew=false}={})=>{
    let checked=false,existing=false
    try{return db.transaction(()=>{
      owner(actor);const input=stockCostCommand(raw);if(!input.review)throw Error('請先看成本結果，再確認保存')
      const saved=store.lookup(input,actor);existing=!!saved;checked=true
      if(saved)return result(input,saved)
      if(!allowNew)return {success:false,committed:null,errorCode:'RECOVERY_REQUIRED',error:'成本設定尚未開放新保存，請保留原編號核對'}
      const receipt=api.applyStockCostOperation(input,actor)
      return receipt.success===false?receipt:result(input,receipt)
    })()}catch(error){return {success:false,committed:checked&&!existing?false:null,error:error.message,errorCode:error.code||null}}
  }
}
