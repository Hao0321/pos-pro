module.exports=function(db,api){
 const model=require('./heldCart.mjs'),settings=require('./databaseSettings.cjs')(db),add=api.addHeldOrder,remove=api.deleteHeldOrder,lookup=api.lookupPrivateDraftOriginal,setOne=api.setSetting,setMany=api.setSettings,checkout=api.checkout
 const journal=()=>model.readHeldJournal(api.getSetting(model.HELD_CART_JOURNAL))
 const managed=id=>journal().entries.some(row=>row.incoming?.id===id||row.outgoing?.id===id)
 api.setSetting=function(key,value){if(key===model.HELD_CART_JOURNAL)throw Error('掛單保存紀錄由正式保存與完整備份流程管理。');return setOne.call(this,key,value)}
 api.setSettings=function(values){if(Object.hasOwn(values,model.HELD_CART_JOURNAL))throw Error('掛單保存紀錄由正式保存與完整備份流程管理。');return setMany.call(this,values)}
 api.addHeldOrder=function(input,actor){
  if(input?.protocol!==model.HELD_CART_PROTOCOL){if(managed(input?.id))throw Error('請透過掛單列表核對原單。');return add.call(this,input)}
  try{return db.transaction(()=>{
   const context=this.getPrivateDraftContext(actor),history=journal(),plan=model.planHeldCommand(input,context,{heldOrders:this.getHeldOrders(),products:this.getProducts(),members:this.getMembers()},history,actor)
   if(!plan.alreadySaved){if(plan.receipt.outgoing)add.call(this,plan.receipt.outgoing);if(plan.receipt.incoming)remove.call(this,plan.receipt.incoming.id);settings.setSetting.run(model.HELD_CART_JOURNAL,JSON.stringify({version:1,entries:[...history.entries,plan.receipt]}))}
   return model.heldResult(plan.receipt,this.getHeldOrders(),plan.alreadySaved)
  })()}catch(error){return {protocol:model.HELD_CART_PROTOCOL,success:false,committed:false,operationId:input.id,digest:require('./privateDrafts.mjs').privateDraftDigest(input),error:error.message}}
 }
 api.deleteHeldOrder=function(id){if(managed(id))throw Error('請透過掛單列表核對原單。');return remove.call(this,id)}
 api.lookupPrivateDraftOriginal=function(input,actor){if(input?.family!=='held-cart')return lookup.call(this,input,actor);return db.transaction(()=>model.heldOriginal(input,this.getPrivateDraftContext(actor),journal(),this.getHeldOrders()))()}
 api.checkout=function(order,updates,member,actor,binding){if(binding==null)return checkout.call(this,order,updates,member,actor);try{return db.transaction(()=>{model.assertCheckoutCart(binding,order,this.getPrivateDraftContext(actor),this.getProducts(),!!db.prepare('SELECT 1 FROM orders WHERE id=?').get(order.id));return checkout.call(this,order,updates,member,actor)})()}catch(error){return {protocol:'pos-checkout-v5',success:false,committed:null,orderId:order.id,error:error.message}}}
}
