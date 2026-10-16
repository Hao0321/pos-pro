const {makeRefundPreview,verifyRefundReview}=require('./refundReview.mjs')
module.exports=function installRefundReview(db,api,stockStore){
  const owner=actor=>{const user=api.getUsers().find(row=>row.id===actor?.userId);if(!user||actor.role!=='owner'||user.role!==actor.role||user.username!==actor.username)throw Error('只有目前店主能核對退款');return {userId:user.id,username:user.username,role:user.role}}
  const data=actor=>{owner(actor);const context=api.getSalesState(actor);return {storeId:context.storeId,epoch:context.epoch,costMode:stockStore.read().projection?'active':'reference',orders:api.getOrders(),members:api.getMembers(),products:api.getProducts(),shifts:api.getShifts(),restaurantEntries:api.getRestaurantState().entries}}
  api.getRefundContext=actor=>db.transaction(()=>{const user=owner(actor),context=api.getSalesState(user),shift=api.getOpenShift();return {storeId:context.storeId,epoch:context.epoch,now:new Date().toISOString(),actor:user,openShift:shift?{id:shift.id,status:shift.status,openTime:shift.openTime}:null,restaurantSaleIds:api.getRestaurantState().entries.map(row=>row.saleId).filter(Boolean)}})()
  api.previewRefund=(input,actor)=>db.transaction(()=>{owner(actor);if(input?.cashier!==actor.username)throw Error('退款帳號已更新，請重新登入');return makeRefundPreview(input,data(actor))})()
  const original=api.refundOrder
  api.refundOrder=function(origId,request,actor){
    if(request?.review===undefined)return original.call(api,origId,request,actor)
    let existing=false,checked=false
    try{return db.transaction(()=>{owner(actor);existing=!!api.getOrder(request.id);checked=true;if(existing)return original.call(api,origId,request,actor);if(request.cashier!==actor.username)throw Error('退款帳號已更新，請重新登入');verifyRefundReview(request,data(actor));return original.call(api,origId,request,actor)})()}
    catch(error){return {success:false,committed:checked&&!existing?false:null,error:error.message}}
  }
}
