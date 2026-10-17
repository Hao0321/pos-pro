const {randomBytes,randomUUID}=require('node:crypto')
const {usesRestaurantIntake,customerOrderView,makeCustomerIntake}=require('./tableOrdering.mjs')
const fence=require('./databaseFeatureFence.cjs')
const {usesRestaurantPublicMenu,assertCustomerMenuIntake}=require('./restaurantCustomerMenu.mjs')
module.exports=function tableOrderingOperations(db,api){
 let customerDepth=0
 // Native-only callback scope; no IPC or shared RPC exposes function arguments.
 api.withCustomerOrderTransaction=fn=>db.transaction(()=>{try{api.exportFullBackup()}catch(error){throw Object.assign(error,{historyUncertain:true})}customerDepth++;try{return fn()}finally{customerDepth--}})()
 // Native-only read scope: callers cannot supply an epoch through IPC/settings.
 api.withCustomerCartContext=fn=>db.transaction(()=>fn({epoch:db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch')?.value}))()
 api.assertCustomerOrderAvailable=id=>{if(db.prepare("SELECT 1 FROM recovery_original_ids WHERE method='checkout' AND operation_id=? LIMIT 1").get(id))throw Object.assign(Error('原訂單需要店家核對，請勿重新下單'),{status:409})}
 function enforce(){const state=api.getRestaurantState(),orders=api.getOrders();if(usesRestaurantIntake(state.config,state.entries,orders))fence.installIntakeFence(db);if(usesRestaurantPublicMenu(orders))fence.installPublicMenuFence(db)}
 for(const name of ['setSetting','setSettings','applyRestaurantOperation','addOrder']){
  const original=api[name]
  api[name]=function(...args){if(name==='addOrder'&&Object.hasOwn(args[0]||{},'customerMenu')&&!customerDepth)throw Error('顧客選餐原單只能由正式點餐流程保存');return db.transaction(()=>{const result=original.apply(this,args);if(result?.success!==false)enforce();return result})()}
 }
 const update=api.updateOrderStatus
 api.updateOrderStatus=function(id,status,...args){
  const state=api.getRestaurantState(),order=api.getOrder(id)
  if(state.entries.some(e=>e.customerOrderId===id)||state.config.enabled&&order?.status==='pending'&&status==='accepted')throw Error('請在接單備餐工作單處理這張原單')
  return update.call(this,id,status,...args)
 }
 api.getCustomerOrders=()=>{const state=api.getRestaurantState();return api.getOrders().filter(o=>o.source==='customer').map(o=>customerOrderView(o,state.entries))}
 api.getCustomerIntakeContext=(id,actor)=>{
  if(!['owner','staff'].includes(actor?.role)||!api.getUsers().some(u=>u.id===actor.userId&&u.role===actor.role&&u.username===actor.username))throw Error('權限不足')
  const order=api.getOrder(id),state=api.getRestaurantState(),now=new Date()
  if(!order||order.source!=='customer')throw Error('這張顧客原單已處理，請重新核對')
  const schedule=makeCustomerIntake(order,now)
  const entryId=state.entries.find(e=>e.customerOrderId===id)?.id||'',menuReview=order.customerMenu&&!entryId?api.getRestaurantMenuQuote({items:order.customerMenu.menuReview.quote.input},actor).menuReview:null
  if(menuReview)assertCustomerMenuIntake(order,menuReview)
  return {protocol:'pos-customer-intake-context/v1',order,entryId,now:now.toISOString(),day:schedule.day,slot:schedule.slot,...(menuReview?{menuReview}:{})}
 }
 api.getTableOrderingContext=actor=>{
  if(actor?.role!=='owner'||!api.getUsers().some(u=>u.id===actor.userId&&u.role==='owner'&&u.username===actor.username))throw Error('權限不足')
  return db.transaction(()=>{
   const state=api.getRestaurantState(),ordering=state.config.tableOrdering
   if(!state.config.enabled||!ordering?.enabled)return {enabled:false,tables:[]}
   let storeId=api.getSetting('sharedStoreId'),secret=api.getSetting('orderTrackingSecret')
   if(!storeId){storeId=randomUUID();api.setSetting('sharedStoreId',storeId)}
   if(!secret){secret=randomBytes(32).toString('hex');api.setSetting('orderTrackingSecret',secret)}
   const {signed}=require('./tableCapability.cjs')
   return {enabled:true,tables:ordering.tables.map(table=>({...table,key:signed(secret,storeId,table)}))}
  })()
 }
 enforce()
}
