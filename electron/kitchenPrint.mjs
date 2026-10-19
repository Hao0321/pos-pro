import {canonicalSignature,operationHeader,moneyValue} from './operationRules.mjs'
import {validateKitchenPrintFormat,kitchenTicketDigest} from './kitchenTicketBytes.mjs'
import {fundedKitchenTicketDetails,isCurrentKitchenPreparation,assertKitchenPreparationReview} from './fundedKitchenPrint.mjs'

export const KITCHEN_PRINT_FEATURE='kitchen-print-v1'
export const KITCHEN_PRINT_PROTOCOL='pos-kitchen-print/v1'
const states=['queued','sending','submitted','uncertain','confirmed','voided']
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const fail=()=>Error('廚房列印紀錄需要核對，請保留原單')
const text=(v,max)=>typeof v==='string'&&v.length<=max
const identifier=v=>typeof v==='string'&&/^[-A-Za-z0-9_:]{1,220}$/.test(v)
const integer=(v,min=1)=>Number.isSafeInteger(v)&&v>=min
const timestamp=v=>text(v,40)&&Number.isFinite(Date.parse(v))
const actorValid=(a,internal=false)=>a&&text(a.userId,128)&&!!a.userId&&text(a.username,100)&&['owner','staff',...(internal?['system']:[])].includes(a.role)
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...names].sort().join(',')
function unusedId(rows,base){
 if(!identifier(base))throw fail()
 const used=new Set(rows.map(row=>row.id));if(!used.has(base))return base
 for(let index=1;index<=used.size+1;index++){const suffix='-'+index,id=base.slice(0,220-suffix.length)+suffix;if(!used.has(id))return id}
 throw fail()
}
const jobKeys=['id','entryId','sourceOperationId','sourceSignature','kind','copy','parentId','epoch','dispatch','ticket','createdAt','createdBy','version','state','attempt','paper']
const ticketKeys=['protocol','entryId','sourceOrderId','tableNum','pickupNumber','day','slot','channel','customer','contact','note','cancelReason','items','total','kind','copy']
const immutable=j=>Object.fromEntries(jobKeys.filter(k=>!['version','state','attempt','paper','dispatch'].includes(k)).map(k=>[k,j[k]]))

export function normalizeKitchenPrinting(value){
 if(!keys(value,['version','enabled','destination','format'])||value.version!==1||typeof value.enabled!=='boolean'||value.enabled&&(value.destination===null||value.format===null)||(value.destination===null)!==(value.format===null))throw Error('廚房列印設定需要核對')
 return {version:1,enabled:value.enabled,destination:value.destination===null?null:structuredClone(validateKitchenDestination(value.destination)),format:value.format===null?null:structuredClone(validateKitchenPrintFormat(value.format))}
}
export const usesKitchenPrinting=(config,jobs=[],operations=[])=>Object.hasOwn(config||{},'kitchenPrinting')||jobs.length>0||operations.length>0
export function kitchenTicket(entry,kind='prepare',copy=0,source=null,operations=[]){
 const details=entry.funds?fundedKitchenTicketDetails(entry,kind,source,operations):{cancelReason:kind==='cancel'?entry.cancelReason||'':'',items:entry.items.map(i=>({id:i.id,name:i.name,qty:i.qty})),total:entry.total}
 return {protocol:entry.reservationDining?'pos-kitchen-ticket/v2':'pos-kitchen-ticket/v1',entryId:entry.id,sourceOrderId:entry.customerOrderId||'',tableNum:entry.tableNum||'',pickupNumber:entry.pickupNumber,day:entry.day,slot:entry.slot,channel:entry.channel,customer:entry.customer,contact:entry.contact,note:entry.note,...details,kind,copy}
}
function validateTicket(t){
 if(!keys(t,ticketKeys)||!['pos-kitchen-ticket/v1','pos-kitchen-ticket/v2'].includes(t.protocol)||!identifier(t.entryId)||!text(t.sourceOrderId,128)||!text(t.tableNum,t.protocol==='pos-kitchen-ticket/v2'?600:40)||!integer(t.pickupNumber)||!text(t.day,10)||!/^\d{4}-\d{2}-\d{2}$/.test(t.day)||!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(t.slot)||!['preorder','walkin','delivery'].includes(t.channel)||!text(t.customer,100)||!text(t.contact,100)||!text(t.note,1000)||!text(t.cancelReason,1000)||!['prepare','cancel'].includes(t.kind)||!integer(t.copy,0)||!Array.isArray(t.items)||!t.items.length||t.items.length>100)throw fail()
 const seen=new Set();for(const i of t.items){if(!keys(i,['id','name','qty'])||!identifier(i.id)||!text(i.name,500)||!i.name||!integer(i.qty)||i.qty>1000000||seen.has(i.id))throw fail();seen.add(i.id)}
 moneyValue(t.total,'訂單金額')
}
export function validateKitchenDestination(d){
 if(d?.type==='windows'&&keys(d,['type','name'])&&text(d.name,256)&&d.name.trim()&&!/[\x00-\x1f\x7f]/.test(d.name))return d
 let host=false;if(text(d?.ip,253)&&d.ip){if(d.ip.includes(':'))try{host=new URL('http://['+d.ip+']/').hostname.startsWith('[')}catch{}else if(/^\d+(\.\d+){3}$/.test(d.ip))host=d.ip.split('.').every(v=>String(Number(v))===v&&Number(v)<=255);else host=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(d.ip)}
 if(d?.type==='network'&&keys(d,['type','ip','port'])&&host&&integer(d.port)&&d.port<=65535)return d
 throw Error('請先設定實際使用的印表機')
}
export function kitchenDestination(settings){
 if(settings.printerType==='windows')return validateKitchenDestination({type:'windows',name:settings.printerName})
 if(settings.printerType==='network')return validateKitchenDestination({type:'network',ip:settings.printerIP,port:Number(settings.printerPort)})
 throw Error('請先設定實際使用的印表機')
}
function validateJob(job){
 if(!keys(job,jobKeys)||!identifier(job.id)||!identifier(job.entryId)||!identifier(job.sourceOperationId)||typeof job.sourceSignature!=='string'||!job.sourceSignature||!['prepare','cancel'].includes(job.kind)||!integer(job.copy,0)||!text(job.parentId,220)||!text(job.epoch,128)||!job.epoch||!['auto','manual'].includes(job.dispatch)||!actorValid(job.createdBy)||!timestamp(job.createdAt)||!integer(job.version)||!states.includes(job.state))throw fail()
 validateTicket(job.ticket)
 if(job.ticket.entryId!==job.entryId||job.ticket.kind!==job.kind||job.ticket.copy!==job.copy||job.copy===0&&job.parentId||job.copy>0&&!identifier(job.parentId))throw fail()
 if(job.attempt!==null){const a=job.attempt;if(!keys(a,['id','session','startedAt','destination','format','contentSha256','endedAt','outcome','error'])||!identifier(a.id)||!identifier(a.session)||!timestamp(a.startedAt)||!/^[a-f0-9]{64}$/.test(a.contentSha256)||!text(a.endedAt,40)||a.endedAt&&!timestamp(a.endedAt)||!['','submitted','unknown'].includes(a.outcome)||!text(a.error,1000))throw fail();validateKitchenDestination(a.destination);validateKitchenPrintFormat(a.format);if(a.contentSha256!==kitchenTicketDigest(job.ticket,a.format))throw fail()}
 if(['queued','voided'].includes(job.state)&&job.attempt||['sending','submitted','uncertain','confirmed'].includes(job.state)&&!job.attempt||job.state==='sending'&&(job.attempt.endedAt||job.attempt.outcome)||job.state==='submitted'&&job.attempt.outcome!=='submitted'||job.state==='uncertain'&&job.attempt.outcome!=='unknown')throw fail()
 if(job.paper!==null&&(!keys(job.paper,['time','actor'])||!timestamp(job.paper.time)||!actorValid(job.paper.actor)))throw fail()
 if((job.state==='confirmed')!==(job.paper!==null))throw fail()
}
export {validateJob as validateKitchenJob}
function sourceFor(job,data){
 const entry=data.entries.find(e=>e.id===job.entryId),source=data.restaurantOperations.find(o=>o.id===job.sourceOperationId)
 if(!entry||!source||source.entityId!==entry.id||!entry.funds&&source.action!==(job.kind==='prepare'?'create':'cancel')||source.signature!==job.sourceSignature||!same(job.ticket,kitchenTicket(entry,job.kind,job.copy,source,data.restaurantOperations)))throw fail()
 return entry
}
export function validateKitchenRecords(jobs=[],operations=[],data={entries:[],restaurantOperations:[]}){
 if(!Array.isArray(jobs)||!Array.isArray(operations))throw fail()
 const reconstructed=new Map(),ids=new Set(),automaticGroups=new Map()
 for(const [index,op]of [...operations].sort((a,b)=>a.sequence-b.sequence).entries()){
  if(!keys(op,['id','kind','action','signature','internal','time','actor','sequence','changes'])||!identifier(op.id)||ids.has(op.id)||op.kind!=='kitchen-print'||!['enqueue','cancel-order','complete-order','request','send','confirm','reprint','claim','finish'].includes(op.action)||typeof op.internal!=='boolean'||!actorValid(op.actor,op.internal)||op.sequence!==index+1||!timestamp(op.time)||!Array.isArray(op.changes)||!op.changes.length||op.changes.length>200)throw fail()
  const request=JSON.parse(op.signature);if(request.id!==op.id||request.time!==op.time||request.action!==op.action||canonicalSignature(request)!==op.signature)throw fail();ids.add(op.id)
  if(Object.hasOwn(request,'parts')||Object.hasOwn(request,'part')){
   if(!op.internal||!keys(request,['id','action','time','sourceId','parts','part'])||!identifier(request.sourceId)||!integer(request.parts)||request.parts>operations.length||!integer(request.part,0)||request.part>=request.parts||request.part<request.parts-1&&op.changes.length!==200)throw fail()
   const source=data.restaurantOperations.find(row=>row.id===request.sourceId),sourceRequest=source&&JSON.parse(source.signature)
   if(!source||source.time!==op.time||!same(source.actor,op.actor)||op.changes.some(change=>change.job?.entryId!==source.entityId)||!(op.action==='enqueue'&&source.action==='create'||op.action==='cancel-order'&&['cancel','cancel-part'].includes(source.action)||op.action==='complete-order'&&source.action==='advance'&&sourceRequest.status==='completed'))throw fail()
   let group=automaticGroups.get(request.sourceId)
   if(!group){group={parts:request.parts,count:0,sequence:op.sequence,action:op.action,time:op.time,actor:op.actor};automaticGroups.set(request.sourceId,group)}
   if(group.parts!==request.parts||group.count!==request.part||op.sequence!==group.sequence+request.part||group.action!==op.action||group.time!==op.time||!same(group.actor,op.actor))throw fail()
   group.count++
  }
  const touched=new Set();for(const c of op.changes){if(!keys(c,['id','beforeVersion','job'])||c.id!==c.job?.id||touched.has(c.id)||!integer(c.beforeVersion,0))throw fail();touched.add(c.id);validateJob(c.job);const old=reconstructed.get(c.id);if((old?.version||0)!==c.beforeVersion||c.job.version!==c.beforeVersion+1)throw fail()
   if(old){if(!same(immutable(old),immutable(c.job)))throw fail();const allowed={queued:['queued','sending','voided'],sending:['submitted','uncertain','confirmed'],submitted:['confirmed'],uncertain:['confirmed'],confirmed:[],voided:[]};if(!allowed[old.state].includes(c.job.state)&&!(op.action==='reprint'&&c.job.state===old.state&&op.changes.some(change=>change.job.parentId===old.id)))throw fail();if(old.attempt&&(!c.job.attempt||!same({...old.attempt,endedAt:'',outcome:'',error:''},{...c.job.attempt,endedAt:'',outcome:'',error:''})))throw fail()}
   else if(c.job.state!=='queued'||c.job.copy>0&&(!reconstructed.has(c.job.parentId)||reconstructed.get(c.job.parentId).entryId!==c.job.entryId||reconstructed.get(c.job.parentId).kind!==c.job.kind))throw fail()
   reconstructed.set(c.id,c.job)
  }
 }
 if([...automaticGroups.values()].some(group=>group.count!==group.parts)||reconstructed.size!==jobs.length||new Set(jobs.map(j=>j.id)).size!==jobs.length)throw fail()
 const copies=new Set();for(const job of jobs){validateJob(job);const entry=sourceFor(job,data),copy=job.entryId+'|'+job.kind+'|'+(entry.funds?job.sourceOperationId+'|':'')+job.copy;if(copies.has(copy)||!same(job,reconstructed.get(job.id)))throw fail();copies.add(copy);if(job.copy>0){const parent=reconstructed.get(job.parentId);if(!parent||parent.sourceOperationId!==job.sourceOperationId||parent.sourceSignature!==job.sourceSignature||!same({...parent.ticket,copy:job.copy},job.ticket))throw fail()}}
 return {jobs,operations}
}
const actorCopy=a=>({userId:a.userId,username:a.username,role:a.role})
function append(state,request,actor,internal,changed){
 const original=state.operations.find(o=>o.id===request.id)
 if(original){if(original.signature!==canonicalSignature(request))throw Object.assign(Error('列印原編號內容不同，請重新核對'),{operationConflict:true});return {state,receipt:original}}
 if(!changed.length)return {state,receipt:null}
 const byId=new Map(state.jobs.map(j=>[j.id,j])),changes=changed.map(job=>({id:job.id,beforeVersion:byId.get(job.id)?.version||0,job:structuredClone(job)}))
 const receipt={id:request.id,kind:'kitchen-print',action:request.action,signature:canonicalSignature(request),internal,time:request.time,actor:actorCopy(actor),sequence:state.operations.length+1,changes}
 for(const job of changed)byId.set(job.id,structuredClone(job))
 return {state:{jobs:[...byId.values()],operations:[...state.operations,receipt]},receipt}
}
function newJob(id,entry,source,actor,epoch,time,{kind='prepare',copy=0,parentId='',dispatch='auto',ticket=null,history=[]}={}){
 return {id,entryId:entry.id,sourceOperationId:source.id,sourceSignature:source.signature,kind,copy,parentId,epoch,dispatch,ticket:ticket||kitchenTicket(entry,kind,copy,source,history),createdAt:time,createdBy:actorCopy(actor),version:1,state:'queued',attempt:null,paper:null}
}
function appendAutomatic(state,request,actor,changed){
 // Keep each bounded record inside the caller's one funds/stock/printing transaction.
 // Declared parts make a missing tail detectable when a backup is reconstructed.
 const parts=Math.ceil(changed.length/200);let result={state,receipt:null},original=null
 for(let part=0;part<parts;part++){
  const id=unusedId(result.state.operations,part?request.id+'-part-'+part:request.id)
  result=append(result.state,{...request,id,parts,part},actor,true,changed.slice(part*200,(part+1)*200));original??=result.receipt
 }
 return {state:result.state,receipt:original}
}
export function appendKitchenRestaurant(state,data,request,actor,epoch,enabled){
 const source=data.restaurantOperations.find(r=>r.id===request.id),entry=data.entries.find(e=>e.id===source?.entityId)
 if(!source||!entry||!['create','cancel',...(entry.funds?['cancel-part']:[])].includes(request.action)&&!(request.action==='advance'&&entry.status==='completed'))return {state,receipt:null}
 if(source.signature!==canonicalSignature(request))throw fail()
 const cancellation=['cancel','cancel-part'].includes(request.action),systemRequest={id:'kp-auto-'+request.id,action:request.action==='create'?'enqueue':cancellation?'cancel-order':'complete-order',time:request.time,sourceId:request.id}
 const original=state.operations.find(op=>op.internal&&['enqueue','cancel-order','complete-order'].includes(op.action)&&JSON.parse(op.signature).sourceId===source.id)
 if(original){if(original.action!==systemRequest.action||original.time!==systemRequest.time)throw fail();return {state,receipt:original}}
 const jobId=unusedId(state.jobs,'kp-'+request.id)
 if(request.action==='create')return enabled?appendAutomatic(state,systemRequest,actor,[newJob(jobId,entry,source,actor,epoch,request.time,{history:data.restaurantOperations})]):{state,receipt:null}
 const prior=state.jobs.filter(j=>j.entryId===entry.id&&j.kind==='prepare'),changed=prior.filter(j=>j.state==='queued').map(j=>({...j,version:j.version+1,state:'voided'}))
 const attempted=prior.some(j=>j.attempt),dispatch=prior.some(j=>j.dispatch==='manual')?'manual':'auto'
 if(cancellation&&attempted)changed.push(newJob(jobId,entry,source,actor,epoch,request.time,{kind:'cancel',dispatch,history:data.restaurantOperations}))
 else if(request.action==='cancel-part'&&entry.quantity&&changed.length)changed.push(newJob(jobId,entry,source,actor,epoch,request.time,{dispatch,history:data.restaurantOperations}))
 return appendAutomatic(state,systemRequest,actor,changed)
}
function eligibleEntry(entry,kind){if(!entry||kind==='prepare'&&['completed','cancelled'].includes(entry.status)||kind==='cancel'&&!entry.funds&&entry.status!=='cancelled')throw Error('餐點已結束，請核對正式原單')}
function currentPreparation(entry,job){if(entry.funds&&job.kind==='prepare'&&!isCurrentKitchenPreparation(job,entry))throw Error('餐點份數已變更，請核對目前餐點再列印。')}
const attemptActive=(job,{session='',activeAttempts=[]}={})=>job.attempt?.session===session&&activeAttempts.includes(job.attempt.id)
export function planKitchenAction(request,state,data,actor,{epoch,session='',activeAttempts=[],now=Date.now()}={}){
 operationHeader(request);if(request.kind!=='kitchen-print')throw Error('不支援的廚房列印操作');if(!actorValid(actor))throw Error('請先登入以處理廚房列印')
 const original=state.operations.find(o=>o.id===request.id);if(original)return append(state,request,actor,false,[])
 if(request.operatorId!==actor.userId||request.operatorRole!==actor.role)throw Error('列印帳號已變更，請保留原編號核對')
 if(Math.abs(now-Date.parse(request.time))>300000)throw Error('列印操作時間已過期，請重新核對')
 const entry=data.entries.find(e=>e.id===request.entryId),job=state.jobs.find(j=>j.id===request.jobId)
 if(!entry)throw Error('找不到正式備餐原單')
 if(request.action==='request'){
  const previous=state.jobs.filter(j=>j.entryId===entry.id)
  if(entry.funds){
   assertKitchenPreparationReview(request.review,entry)
   if(previous.some(job=>isCurrentKitchenPreparation(job,entry)))throw Error('這張備餐單已有列印紀錄，請核對紙張')
   if(previous.length&&request.acknowledgeDuplicateRisk!==true)throw Error('請先確認可能已印出的紙張，再建立補印副本')
  }else if(previous.length)throw Error('這張備餐單已有列印紀錄，請核對紙張')
  const actions=entry.funds?['create','cancel-part']:['create']
  eligibleEntry(entry,'prepare');const source=data.restaurantOperations.filter(o=>o.entityId===entry.id&&actions.includes(o.action)).sort((a,b)=>b.entityVersion-a.entityVersion)[0];if(!source)throw fail()
  return append(state,request,actor,false,[newJob(unusedId(state.jobs,'kp-'+request.id),entry,source,actor,epoch,request.time,{dispatch:'manual',history:data.restaurantOperations})])
 }
 if(!job||job.entryId!==entry.id||request.expectedVersion!==job.version)throw Error('列印進度已由其他裝置更新，請重新核對')
 let next
 if(request.action==='send'){
  eligibleEntry(entry,job.kind);currentPreparation(entry,job);if(job.state!=='queued'||job.epoch!==epoch)throw Error('原列印結果需要核對，請明確補印');next={...job,dispatch:'manual',version:job.version+1}
 }else if(request.action==='confirm'){
  if(!['submitted','uncertain'].includes(job.state)&&!(job.state==='sending'&&!attemptActive(job,{session,activeAttempts})))throw Error('請先核對實際紙張，再確認列印')
  next={...job,state:'confirmed',paper:{time:request.time,actor:actorCopy(actor)},version:job.version+1}
 }else if(request.action==='reprint'){
  eligibleEntry(entry,job.kind);currentPreparation(entry,job);if(request.acknowledgeDuplicateRisk!==true||job.state==='sending'&&attemptActive(job,{session,activeAttempts}))throw Error('請先確認可能已印出的紙張，再建立補印副本')
  const copy=Math.max(...state.jobs.filter(j=>j.entryId===entry.id&&j.kind===job.kind&&(!entry.funds||j.sourceOperationId===job.sourceOperationId)).map(j=>j.copy))+1
  if(copy>1000)throw Error('補印次數過多，請先核對印表機')
  const source=data.restaurantOperations.find(o=>o.id===job.sourceOperationId);next=newJob(unusedId(state.jobs,'kp-copy-'+request.id),entry,source,actor,epoch,request.time,{kind:job.kind,copy,parentId:job.id,dispatch:'manual',ticket:{...job.ticket,copy}})
  return append(state,request,actor,false,[{...job,state:job.state==='queued'?'voided':job.state,version:job.version+1},next])
 }else throw Error('不支援的廚房列印操作')
 return append(state,request,actor,false,[next])
}
const systemActor={userId:'kitchen-worker',username:'Kitchen worker',role:'system'}
export function claimKitchenJob(state,data,request,{epoch,session,enabled}={}){
 const job=state.jobs.find(j=>j.id===request.jobId),entry=data.entries.find(e=>e.id===job?.entryId)
 if(!job||job.state!=='queued'||job.version!==request.expectedVersion||job.epoch!==epoch||job.dispatch==='auto'&&!enabled)return {state,receipt:null}
 eligibleEntry(entry,job.kind);currentPreparation(entry,job);validateKitchenDestination(request.destination);validateKitchenPrintFormat(request.format)
 if(!identifier(session)||request.contentSha256!==kitchenTicketDigest(job.ticket,request.format))throw fail()
 const next={...job,state:'sending',version:job.version+1,attempt:{id:request.id,session,startedAt:request.time,destination:request.destination,format:request.format,contentSha256:request.contentSha256,endedAt:'',outcome:'',error:''}}
 return append(state,request,systemActor,true,[next])
}
export function finishKitchenJob(state,request,{epoch}={}){
 const job=state.jobs.find(j=>j.id===request.jobId)
 if(!job||job.state!=='sending'||job.epoch!==epoch||job.attempt.id!==request.attemptId)return {state,receipt:null}
 const next={...job,state:request.submitted===true?'submitted':'uncertain',version:job.version+1,attempt:{...job.attempt,endedAt:request.time,outcome:request.submitted===true?'submitted':'unknown',error:String(request.error||'').slice(0,1000)}}
 return append(state,request,systemActor,true,[next])
}
export function kitchenJobView(job,context={}){return {...job,displayState:job.state==='sending'&&!attemptActive(job,context)?'uncertain':job.state==='queued'&&job.epoch!==context.epoch?'review':job.state}}
export function kitchenPrintReceipt(request,state){const receipt=state.operations.find(o=>o.id===request.id);if(!receipt||receipt.signature!==canonicalSignature(request))throw fail();return {protocol:KITCHEN_PRINT_PROTOCOL,success:true,receipt,jobs:receipt.changes.map(c=>state.jobs.find(j=>j.id===c.id))}}
