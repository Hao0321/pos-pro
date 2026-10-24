const {privateDraftContext,assertDraftLookup,privateDraftOriginal,privateQuickOriginal,privateDraftDigest}=require('./privateDrafts.mjs')
const {assertImportedPurchaseSource}=require('./quickPurchaseOriginal.mjs')
module.exports=(db,stmts)=>({
 getPrivateDraftContext(actor){return db.transaction(()=>{
  const users=db.prepare('SELECT id,username,role FROM users').all(),current=users.find(row=>row.id===actor?.userId)
  if(!actor||!['owner','staff'].includes(actor.role)||!current||current.username!==actor.username||current.role!==actor.role)throw Error('請先登入，或重新驗證身份')
  let storeId=this.getSetting('sharedStoreId');if(!storeId){storeId=require('node:crypto').randomUUID();stmts.setSetting.run('sharedStoreId',storeId)}
  const epoch=db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value
  return privateDraftContext(storeId,epoch,actor,users)
 })()},
 lookupPrivateDraftOriginal(input,actor){return db.transaction(()=>{
  const context=this.getPrivateDraftContext(actor);assertDraftLookup(input,context)
  if(input.family){
   const imported=input.family==='quick-purchase-import',purchase=imported||input.family==='quick-purchase'
   if(purchase)this.getSupplierState(actor);else this.getRestaurantState()
   const row=purchase?db.prepare('SELECT * FROM audit_log WHERE id=?').get('stock-operation:'+input.id):db.prepare('SELECT data FROM restaurant_operations WHERE id=?').get(input.id)
   const receipt=row?(purchase?JSON.parse(row.detail):JSON.parse(row.data)):null,sourceActor=purchase?row:receipt?.actor
   const lookup=imported&&receipt?{context:input.context,id:input.id,family:'quick-purchase',digest:privateDraftDigest(JSON.parse(receipt.signature))}:input
   const original=privateQuickOriginal(lookup,receipt,sourceActor,actor)
   if(original.status==='missing')return original
   const request=JSON.parse(receipt.signature),sourceMatch=imported?assertImportedPurchaseSource(input.document,request):null,result=purchase?this.applyInventoryOperation(request,actor):this.applyRestaurantOperation(request,actor)
   if(result?.success!==true||result.receipt?.signature!==receipt.signature)throw Error('保存結果尚未確認，請保留原編號核對。')
   return {...original,...(sourceMatch?{sourceMatch}:{}),result}
  }
  this.getRestaurantState()
  const row=db.prepare('SELECT data FROM restaurant_operations WHERE id=?').get(input.id)
  const receipt=row?JSON.parse(row.data):null,original=privateDraftOriginal(input,receipt,actor)
  if(original.status!=='matched'||original.action!=='configure'&&!JSON.parse(receipt.signature).reservationDining)return original
  const result=this.applyRestaurantOperation(JSON.parse(receipt.signature),actor)
  if(result?.success!==true||result.receipt?.signature!==receipt.signature)throw Error('保存結果尚未確認，請保留原編號核對。')
  return {...original,result}
 })()}
})
