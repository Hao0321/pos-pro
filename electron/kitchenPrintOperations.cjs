const {randomUUID}=require('node:crypto'),{canonicalSignature}=require('./operationRules.mjs'),{normalizeKitchenPrinting,kitchenDestination,appendKitchenRestaurant,planKitchenAction,claimKitchenJob,finishKitchenJob,kitchenJobView,kitchenPrintReceipt}=require('./kitchenPrint.mjs')
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),defaultPolicy=()=>({version:1,enabled:false,destination:null,format:null})
module.exports=function installKitchenPrint(db,api,storage){
 let workerSession='',activeAttempts=new Set(),deferDepth=0,queuedWake=false;const listeners=new Set()
 const epoch=()=>db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch').value
 const runtime=()=>({epoch:epoch(),session:workerSession,activeAttempts:[...activeAttempts]})
 const actorCheck=(actor,owner=false)=>{if(!actor||!['owner',...(owner?[]:['staff'])].includes(actor.role)||!api.getUsers().some(u=>u.id===actor.userId&&u.username===actor.username&&u.role===actor.role))throw Error('請先登入以處理廚房列印');return actor}
 const policy=state=>state.data.config.kitchenPrinting||defaultPolicy()
 function binding(state){const value=policy(state);try{const current=kitchenDestination(api.getAllSettings());if(!value.destination||!same(current,value.destination)||Number(api.getAllSettings().receiptWidth||32)!==value.format?.columns)throw Error('印表機設定已變更，請重新確認測試紙張');const row=db.prepare('SELECT value FROM kitchen_print_runtime WHERE id=?').get('binding'),proof=row?JSON.parse(row.value):null;if(!proof||proof.epoch!==epoch()||!same(proof.destination,value.destination)||!same(proof.format,value.format))throw Error('請先確認這台電腦的測試紙張');return {ready:true,destination:current,format:value.format}}catch(error){return {ready:false,error:error.message}}}
 function wake(){if(deferDepth){queuedWake=true;return}for(const fn of listeners)try{fn()}catch{}}
 function receipt(request,state){return kitchenPrintReceipt(request,state)}
 const originalRestaurant=api.applyRestaurantOperation
 api.applyRestaurantOperation=function(request,actor){
  // Preserve the existing authorization rejection at IPC/HTTPS boundaries.
  if(!actor||!['owner','staff'].includes(actor.role)||request?.action==='configure'&&actor.role!=='owner')throw Error('權限不足')
  let existing=false,checked=false;try{const result=db.transaction(()=>{
  const before=storage.read();existing=before.data.restaurantOperations.some(o=>o.id===request?.id);checked=true;let paperBinding=null
  if(!existing&&request?.action==='configure'&&Object.hasOwn(request.config||{},'kitchenPrinting')){
   actorCheck(actor,true);const next=normalizeKitchenPrinting(request.config.kitchenPrinting),previous=policy(before),changed=!same({destination:previous.destination,format:previous.format},{destination:next.destination,format:next.format})||!previous.enabled&&next.enabled
   if(Object.hasOwn(request,'operatorId')&&(request.operatorId!==actor.userId||request.operatorRole!==actor.role))throw Error('列印帳號已變更，請保留原編號核對')
   if((changed||request.kitchenPaperAcknowledged===true)&&next.destination){if(request.kitchenPaperAcknowledged!==true)throw Error('請先確認測試紙張正確');const current=kitchenDestination(api.getAllSettings());if(!same(current,next.destination)||Number(api.getAllSettings().receiptWidth||32)!==next.format.columns)throw Error('印表機設定已變更，請重新確認測試紙張');paperBinding={epoch:epoch(),destination:next.destination,format:next.format,confirmedBy:actor.userId,time:request.time}}
  }
  const result=originalRestaurant.call(this,request,actor);if(result?.success!==true)return result
  if(!existing&&request?.action==='configure'&&Object.hasOwn(request.config||{},'kitchenPrinting')&&!api.getSetting('sharedStoreId'))api.setSetting('sharedStoreId',randomUUID())
  // Local hardware proof belongs to printing, outside the protected financial
  // runtime. It still commits in this same outer restaurant transaction.
  if(paperBinding)db.prepare('INSERT INTO kitchen_print_runtime (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run('binding',JSON.stringify(paperBinding))
  if(!existing){const after=storage.read(),next=appendKitchenRestaurant(before,after.data,request,actor,epoch(),policy(after).enabled);if(next.receipt)storage.save(next.state,before)}
  storage.enforce();return result
 })();if(result?.success===true&&!existing)wake();return result}catch(error){return {success:false,committed:error.historyUncertain||!checked||existing?null:false,error:error.message,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{})}}}
 for(const method of ['setSetting','setSettings']){const original=api[method];api[method]=function(...args){const values=method==='setSetting'?{[args[0]]:args[1]}:args[0];if(Object.hasOwn(values||{},'restaurantConfig')){const previous=storage.read().data.config.kitchenPrinting??null,raw=values.restaurantConfig,next=typeof raw==='string'?JSON.parse(raw):raw;if(!same(previous,next?.kitchenPrinting??null))throw Error('請從廚房列印設定確認印表機')}return original.apply(this,args)}}
 api.getKitchenPrintState=actor=>{actorCheck(actor);let storeId=api.getSetting('sharedStoreId');if(!storeId){storeId=randomUUID();api.setSetting('sharedStoreId',storeId)}const state=storage.read(),bound=binding(state);let setup=null;if(actor.role==='owner')try{setup={destination:kitchenDestination(api.getAllSettings()),columns:Number(api.getAllSettings().receiptWidth||32)}}catch{}return {protocol:'pos-kitchen-print-state/v1',storeId,actor:{userId:actor.userId,username:actor.username,role:actor.role},now:new Date().toISOString(),policy:policy(state),binding:bound,setup,jobs:state.jobs.map(job=>kitchenJobView(job,runtime()))}}
 api.applyKitchenPrintOperation=(request,actor)=>{actorCheck(actor);let checked=false,existing=false;try{const result=db.transaction(()=>{
  const state=storage.read();existing=state.operations.some(o=>o.id===request?.id);checked=true
  if(!existing){if(db.prepare("SELECT 1 FROM recovery_original_ids WHERE method='applyKitchenPrintOperation' AND operation_id=? LIMIT 1").get(request.id))throw Object.assign(Error('原列印操作在保護副本，請先核對原紀錄'),{historyUncertain:true});if(['request','send','reprint'].includes(request.action)){const bound=binding(state);if(!bound.ready)throw Error(bound.error)}}
  const next=planKitchenAction(request,state,state.data,actor,runtime());if(next.receipt&&!existing)storage.save(next.state,state)
  return receipt(request,next.state)
 })();wake();return result}catch(error){return {success:false,committed:error.historyUncertain||!checked||existing?null:false,error:error.message,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{})}}}
 // These callbacks and worker methods are native-only; no IPC or shared RPC exposes them.
 api.onKitchenPrintChanged=fn=>{listeners.add(fn);return()=>listeners.delete(fn)}
 api.setKitchenPrintWorkerSession=id=>{if(workerSession&&workerSession!==id&&activeAttempts.size)throw Error('還有列印工作正在送出');workerSession=id;activeAttempts=new Set()}
 api.setKitchenPrintActiveAttempt=(id,active)=>{active?activeAttempts.add(id):activeAttempts.delete(id)}
 api.readKitchenPrintWork=()=>{const state=storage.read(),bound=binding(state);return {state,policy:policy(state),binding:bound,...runtime()}}
 api.applyKitchenPrintClaim=request=>db.transaction(()=>{const state=storage.read(),bound=binding(state);if(!bound.ready||!same(request.destination,bound.destination)||!same(request.format,bound.format))return {success:false,committed:false,error:bound.error||'印表機設定已變更'};const next=claimKitchenJob(state,state.data,request,{...runtime(),enabled:policy(state).enabled});if(!next.receipt)return {success:true,claimed:false};storage.save(next.state,state);return {success:true,claimed:true,job:next.state.jobs.find(j=>j.id===request.jobId),receipt:next.receipt}})()
 api.applyKitchenPrintFinish=request=>db.transaction(()=>{const state=storage.read(),next=finishKitchenJob(state,request,runtime());if(!next.receipt)return {success:true,saved:false};storage.save(next.state,state);return {success:true,saved:true,receipt:next.receipt}})()
 storage.enforce()
 return {deferWake(consume){if(db.inTransaction||typeof consume!=='function')throw Error('請從原訂位流程保存餐點');const previous=queuedWake;deferDepth++;let result;try{result=consume();if(result?.success!==true)queuedWake=previous;return result}catch(error){queuedWake=previous;throw error}finally{deferDepth--;if(!deferDepth&&queuedWake){queuedWake=false;wake()}}}}
}
