import {test,expect} from 'vitest'
import {planRestaurant} from '../../electron/restaurantRules.mjs'
import {appendKitchenRestaurant,validateKitchenRecords,planKitchenAction,claimKitchenJob,finishKitchenJob} from '../../electron/kitchenPrint.mjs'
import {kitchenPreparationReview} from '../../electron/fundedKitchenPrint.mjs'
import {kitchenTicketDigest} from '../../electron/kitchenTicketBytes.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
const actor={userId:'owner',username:'Owner',role:'owner'},time='2026-10-17T12:00:00+08:00',format={version:1,locale:'en',columns:32},destination={type:'network',ip:'127.0.0.1',port:9100}
function fixture(){
 let data={storeId:'store',epoch:'epoch',costMode:'reference',date:'2026-10-17',now:Date.parse(time),products:[{id:'p',name:'Meal',price:80,cost:30,stock:10}],entries:[],operations:[],orders:[],waste:[],cashLogs:[],shifts:[{id:'shift',status:'open'}],config:{enabled:true,fundsEnabled:true,dailyCapacity:30,slotCapacity:20,recipes:{}}},printing={jobs:[],operations:[]}
 const context=()=>({entries:data.entries,restaurantOperations:data.operations})
 function business(id,action,fields={},enabled=true){
  const entry=data.entries.find(row=>row.id===(fields.entryId||'booking'))
  const request={id,kind:'restaurant',action,time,storeId:data.storeId,epoch:data.epoch,...(action==='create'?{channel:'walkin',day:data.date,slot:'12:00',customer:'Guest',contact:'',note:'',items:[{id:'p',qty:3,price:80}]}:{entryId:entry.id,expectedVersion:entry.version}),...fields},plan=planRestaurant(request,data,actor,{}),next={...plan.next,operations:[...data.operations,plan.receipt]}
  const printed=appendKitchenRestaurant(printing,{entries:next.entries,restaurantOperations:next.operations},request,actor,data.epoch,enabled)
  validateKitchenRecords(printed.state.jobs,printed.state.operations,{entries:next.entries,restaurantOperations:next.operations});data=next;printing=printed.state;return plan
 }
 function manual(id,action,job,fields={}){
  const request={id,kind:'kitchen-print',action,time,entryId:job?.entryId||fields.entryId,operatorId:actor.userId,operatorRole:actor.role,...(job?{jobId:job.id,expectedVersion:job.version}:{}),...fields},plan=planKitchenAction(request,printing,context(),actor,{epoch:data.epoch,now:data.now})
  validateKitchenRecords(plan.state.jobs,plan.state.operations,context());printing=plan.state;return plan
 }
 business('booking','create');const job=printing.jobs[0]
 printing=claimKitchenJob(printing,context(),{id:'claim',action:'claim',time,jobId:job.id,expectedVersion:job.version,destination,format,contentSha256:kitchenTicketDigest(job.ticket,format)},{epoch:data.epoch,session:'worker',enabled:true}).state
 printing=finishKitchenJob(printing,{id:'finish',action:'finish',time,jobId:job.id,attemptId:'claim',submitted:false,error:'unknown transport'},{epoch:data.epoch}).state
 business('cook','advance',{status:'cooking'})
 return {business,manual,context,get data(){return data},get printing(){return printing},original:()=>printing.jobs.find(row=>row.id===job.id)}
}
test('an unrelated user print ID cannot prevent the authoritative cancellation or overwrite its own original',()=>{
 const h=fixture();h.manual('kp-auto-cancel','confirm',h.original());const original=structuredClone(h.printing.operations.find(row=>row.id==='kp-auto-cancel'))
 expect(()=>h.business('cancel','cancel-part',{quantities:[{id:'p',qty:1}],reason:'one fewer'})).not.toThrow()
 expect(h.printing.operations.find(row=>row.id===original.id)).toEqual(original);expect(h.printing.jobs.filter(row=>row.kind==='cancel')).toHaveLength(1)
})
test('all supported queued copies can be cancelled atomically without exceeding a single print-operation envelope or losing its tail',()=>{
 const h=fixture()
 for(let index=0;index<201;index++)h.manual('copy-'+index,'reprint',h.original(),{acknowledgeDuplicateRisk:true})
 expect(()=>h.business('cancel-many','cancel-part',{quantities:[{id:'p',qty:1}],reason:'many pending copies'})).not.toThrow()
 expect(h.printing.jobs.filter(row=>row.kind==='prepare'&&row.state==='queued')).toHaveLength(0);expect(h.printing.jobs.filter(row=>row.kind==='cancel')).toHaveLength(1)
 const parts=h.printing.operations.filter(row=>JSON.parse(row.signature).sourceId==='cancel-many');expect(parts).toHaveLength(2);expect(parts.every(row=>row.changes.length<=200)).toBe(true)
 const lost=structuredClone(h.printing);lost.operations.pop();const projected=new Map();for(const operation of lost.operations)for(const change of operation.changes)projected.set(change.id,change.job);lost.jobs=[...projected.values()]
 expect(()=>validateKitchenRecords(lost.jobs,lost.operations,h.context())).toThrow()
},20000)
test('an unrelated manually requested job ID cannot replace or block a financial cancellation notice',()=>{
 const h=fixture();h.business('other','create',{items:[{id:'p',qty:1,price:80}]},false);const other=h.data.entries.find(row=>row.id==='other')
 h.manual('cancel-job','request',null,{entryId:other.id,review:kitchenPreparationReview(other)})
 const old=structuredClone(h.printing.jobs.find(row=>row.id==='kp-cancel-job'))
 expect(()=>h.business('cancel-job','cancel-part',{quantities:[{id:'p',qty:1}],reason:'safe automatic ID'})).not.toThrow()
 expect(h.printing.jobs.find(row=>row.id===old.id)).toEqual(old);expect(h.printing.jobs.filter(row=>row.entryId==='booking'&&row.kind==='cancel')).toHaveLength(1)
})

test('historical automatic receipts remain readable and replay preserves their original signature and identity',()=>{
 const h=fixture(),legacy=structuredClone(h.printing)
 for(const operation of legacy.operations)if(operation.internal&&JSON.parse(operation.signature).sourceId){const request=JSON.parse(operation.signature);delete request.parts;delete request.part;operation.signature=canonicalSignature(request)}
 expect(()=>validateKitchenRecords(legacy.jobs,legacy.operations,h.context())).not.toThrow()
 const replay=appendKitchenRestaurant(legacy,h.context(),JSON.parse(h.data.operations.find(row=>row.id==='booking').signature),actor,h.data.epoch,true)
 expect(replay.state).toBe(legacy);expect(replay.receipt).toEqual(legacy.operations[0])
})

test.each(['wrong-source','wrong-actor','invalid-parts'])('a declared automatic group with %s fails source reconciliation',kind=>{
 const h=fixture(),changed=structuredClone(h.printing),operation=changed.operations[0],request=JSON.parse(operation.signature)
 if(kind==='wrong-source')request.sourceId='cook'
 if(kind==='wrong-actor')operation.actor={userId:'someone-else',username:'Other',role:'staff'}
 if(kind==='invalid-parts')request.parts=0
 operation.signature=canonicalSignature(request)
 expect(()=>validateKitchenRecords(changed.jobs,changed.operations,h.context())).toThrow()
})
