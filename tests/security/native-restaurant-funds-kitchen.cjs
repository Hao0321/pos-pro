const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),Database=require('better-sqlite3')
const init=require('../../electron/database.js'),legacy=require('../fixtures/table-kitchen-v1.json'),{canonicalSignature}=require('../../electron/operationRules.mjs'),{salesDate}=require('../../electron/salesRules.mjs')
const {kitchenTicketBytes,kitchenTicketDigest}=require('../../electron/kitchenTicketBytes.mjs'),{validateStockCostBook}=require('../../electron/stockBackup.mjs'),transport=require('../../electron/printerTransport.cjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated funds kitchen root required')
const out=process.env.POS_CUSTOMERS_EVIDENCE||root;fs.mkdirSync(out,{recursive:true})
const owner=legacy.owner,format={version:1,locale:'en',columns:32},fixtures=[],received=[],checks=[],now=()=>new Date().toISOString(),ok=result=>{assert.equal(result.success,true,result.error);return result};let receiver,target
const pass=label=>{checks.push(label);console.log('PASS '+label)}
function fixture(name,active=false){
 const file=path.join(root,name+'.db'),f={file,db:init(file)};fixtures.push(f)
 for(const user of legacy.before.users)f.db.addUser(user)
 f.db.setSetting('sharedStoreId','funds-kitchen-'+name)
 for(const product of [{id:'ready',name:'Ready meal',price:80,cost:30,stock:4,unit:'份'},{id:'bowl',name:'Rice bowl',price:100,cost:0,stock:0,unit:'份'},{id:'rice',name:'Rice',price:2,cost:2,stock:5,unit:'kg'}])f.db.addProduct(product)
 f.db.openShift({id:'shift',cashier:owner.username,openCash:200});f.db.setSettings({printerType:'network',printerIP:target.ip,printerPort:String(target.port),receiptWidth:'32'})
 const config=f.db.getRestaurantState().config
 ok(f.db.applyRestaurantOperation({id:'configure',kind:'restaurant',action:'configure',time:now(),expectedConfig:canonicalSignature(config),kitchenPaperAcknowledged:true,config:{...config,enabled:true,fundsEnabled:true,dailyCapacity:30,slotCapacity:10,recipes:{bowl:[{id:'rice',qty:1.25}]},kitchenPrinting:{version:1,enabled:true,destination:target,format}}},owner))
 if(active){const state=f.db.getSalesState(owner);ok(f.db.applyStockCostOperation({id:'opening',protocol:'pos-stock-cost/v1',action:'open',time:now(),storeId:state.storeId,epoch:state.epoch,reviewed:true,snapshotDigest:f.db.getStockCostPreview(owner).snapshotDigest,overrides:[]},owner))}
 f.book=()=>f.db.exportData();f.entry=()=>f.db.getRestaurantState().entries[0];f.jobs=()=>f.db.getKitchenPrintState(owner).jobs
 f.request=(id,action,extra={})=>{const state=f.db.getRestaurantState(),entry=state.entries[0];return {id,kind:'restaurant',action,time:now(),storeId:state.storeId,epoch:state.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:state.costMode,...(action==='create'?{channel:'walkin',day:salesDate(new Date()),slot:'12:00',customer:'Guest',contact:'',note:'',items:[{id:'ready',qty:2,price:80},{id:'bowl',qty:1,price:100}]}:{entryId:entry.id,expectedVersion:entry.version}),...extra}}
 f.act=(id,action,extra={})=>f.db.applyRestaurantOperation(f.request(id,action,extra),owner)
 f.op=(id,action,job,extra={})=>f.db.applyKitchenPrintOperation({id,kind:'kitchen-print',action,time:now(),entryId:f.entry().id,operatorId:owner.userId,operatorRole:owner.role,...(job?{jobId:job.id,expectedVersion:job.version}:{}),...extra},owner)
 f.create=()=>ok(f.act('booking','create'))
 f.verify=()=>{const book=f.book();if(active)validateStockCostBook(book);return f.db.exportFullBackup(owner)}
 f.print=async(job,submitted=true)=>{
  const id='attempt-'+randomUUID(),session='worker-'+name,request={id,action:'claim',time:now(),jobId:job.id,expectedVersion:job.version,destination:target,format,contentSha256:kitchenTicketDigest(job.ticket,format)}
  f.db.setKitchenPrintWorkerSession(session);f.db.setKitchenPrintActiveAttempt(id,true)
  try{
   const claimed=ok(f.db.applyKitchenPrintClaim(request));assert.equal(claimed.claimed,true)
   const bytes=Buffer.from(kitchenTicketBytes(claimed.job.ticket,format)),count=received.length
   assert.equal((await transport.sendToPrinter({printerType:'network',printerIP:target.ip,printerPort:target.port},[bytes])).success,true)
   const deadline=Date.now()+2000;while(received.length===count&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10))
   assert.equal(received.length,count+1);assert.deepEqual(received.at(-1),bytes)
   assert.equal(ok(f.db.applyKitchenPrintFinish({id:'finish-'+randomUUID(),action:'finish',time:now(),jobId:job.id,attemptId:id,submitted,error:submitted?'':'fixture lost result after real loopback transport'})).saved,true)
   return f.jobs().find(row=>row.id===job.id)
  }finally{f.db.setKitchenPrintActiveAttempt(id,false)}
 }
 return f
}
;(async()=>{try{
 receiver=net.createServer(socket=>{const chunks=[];socket.on('data',chunk=>chunks.push(chunk));socket.on('end',()=>received.push(Buffer.concat(chunks)))})
 await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));target={type:'network',ip:'127.0.0.1',port:receiver.address().port}
 for(const active of [false,true]){
  const f=fixture('unsent-'+active,active);f.create();const original=f.book().kitchenPrintJobs[0]
  ok(f.act('deposit','funds-receive',{amount:50,paid:50,payMethod:'cash',shiftId:'shift'}))
  const input=f.request('cancel-one','cancel-part',{quantities:[{id:'ready',qty:1}],reason:'one fewer'}),partial=ok(f.db.applyRestaurantOperation(input,owner))
  const jobs=f.book().kitchenPrintJobs;assert.deepEqual(jobs.find(row=>row.id===original.id).ticket,original.ticket);assert.equal(jobs.find(row=>row.id===original.id).state,'voided')
  const replacement=jobs.find(row=>row.state==='queued');assert.equal(replacement.kind,'prepare');assert.deepEqual(replacement.ticket.items,[{id:'ready',name:'Ready meal',qty:1},{id:'bowl',name:'Rice bowl',qty:1}]);assert.equal(replacement.ticket.total,180);assert.equal(jobs.some(row=>row.kind==='cancel'),false)
  const once=f.book();ok(f.db.applyRestaurantOperation(input,owner));assert.deepEqual(f.book(),once);if(active)assert.ok(partial.costReceipt)
  ok(f.act('cancel-bowl','cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'another fewer'}));assert.deepEqual(f.jobs().find(row=>row.state==='queued').ticket.items,[{id:'ready',name:'Ready meal',qty:1}]);assert.equal(f.jobs().filter(row=>row.kind==='prepare'&&row.copy===0).length,3)
  ok(f.act('cancel-rest','cancel',{reason:'rest',shiftId:'shift'}));assert.equal(f.jobs().every(row=>row.state==='voided'),true);assert.equal(f.jobs().some(row=>row.kind==='cancel'),false);assert.equal(f.verify().protection.version,6)
  const saved=f.book();f.db.close();f.db=init(f.file);assert.deepEqual(f.book(),saved);f.verify()
  pass('actual '+(active?'cost-active':'reference-cost')+' SQLite selected and full cancellations replace only unsent portions, preserve original bytes and reopen the complete format6 book')
 }
 const f=fixture('attempted',true);f.create();ok(f.act('collect','funds-receive',{amount:260,paid:300,payMethod:'cash',shiftId:'shift'}));const original=f.jobs()[0],uncertain=await f.print(original,false);assert.equal(uncertain.state,'uncertain');ok(f.act('cook','advance',{status:'cooking'}))
 const old=structuredClone(f.book().kitchenPrintJobs.find(row=>row.id===original.id))
 ok(f.act('cancel-selected','cancel-part',{quantities:[{id:'ready',qty:1}],reason:'selected prepared',shiftId:'shift'}))
 assert.deepEqual(f.book().kitchenPrintJobs.find(row=>row.id===original.id),old)
 let notice=f.jobs().find(row=>row.kind==='cancel');assert.deepEqual(notice.ticket.items,[{id:'ready',name:'Ready meal',qty:1}]);assert.equal(notice.ticket.total,80);assert.equal(f.jobs().filter(row=>row.kind==='prepare'&&row.state==='queued').length,0)
 notice=await f.print(notice);ok(f.op('confirm-partial','confirm',notice));f.verify()
 pass('a real possibly printed original keeps its attempt and bytes; its selected cancellation notice sends through controlled TCP while the remaining order stays active')
 const beforeOldCopy=f.book(),wrongCopy=f.op('old-prep-copy','reprint',f.jobs().find(row=>row.id===original.id),{acknowledgeDuplicateRisk:true});assert.equal(wrongCopy.success,false);assert.deepEqual(f.book(),beforeOldCopy)
 assert.equal(f.op('current-without-review','request',null,{expectedEntryVersion:f.entry().version}).success,false)
 const currentEntry=f.entry(),review={protocol:'pos-kitchen-preparation-review/v1',entryId:currentEntry.id,entryVersion:currentEntry.version,items:currentEntry.items.map(({id,name,qty})=>({id,name,qty})),total:currentEntry.total}
 const beforeStale=f.book();assert.equal(f.op('stale-preparation','request',null,{review:{...review,entryVersion:review.entryVersion-1},acknowledgeDuplicateRisk:true}).success,false);assert.deepEqual(f.book(),beforeStale)
 const current=ok(f.op('current-preparation','request',null,{review,acknowledgeDuplicateRisk:true})).jobs.find(row=>row.kind==='prepare')
 assert.deepEqual(current.ticket.items,[{id:'ready',name:'Ready meal',qty:1},{id:'bowl',name:'Rice bowl',qty:1}]);assert.equal(current.dispatch,'manual')
 pass('an obsolete preparation cannot be reprinted with cancelled portions; an explicit reviewed request prints only the current remaining meals')
 const raw=new Database(f.file);require('../../electron/databaseFeatureFence.cjs').register(raw)
 raw.exec("CREATE TRIGGER funded_kitchen_late_failure BEFORE INSERT ON kitchen_print_operations WHEN NEW.id='kp-auto-cancel-late' BEGIN SELECT RAISE(ABORT,'fixture late kitchen cancellation'); END")
 const prior=f.book(),late=f.act('cancel-late','cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'late rollback',shiftId:'shift'})
 assert.equal(late.success,false);assert.deepEqual(f.book(),prior);raw.exec('DROP TRIGGER funded_kitchen_late_failure');raw.close()
 ok(f.act('cancel-bowl','cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'bowl cancelled',shiftId:'shift'}));ok(f.act('cancel-rest','cancel',{reason:'remaining cancelled',shiftId:'shift'}))
 const notices=f.jobs().filter(row=>row.kind==='cancel');assert.equal(notices.length,3);assert.deepEqual(notices.flatMap(row=>row.ticket.items).map(row=>[row.id,row.qty]).sort(),[['bowl',1],['ready',1],['ready',1]])
 assert.equal(notices.every(row=>row.ticket.items.length>0),true);assert.equal(f.jobs().find(row=>row.id===current.id).state,'voided');f.verify()
 pass('late kitchen failure rolls back funds, cost and printing together; repeated selected cancellations preserve distinct nonempty source notices and void an obsolete unsent copy')
 const last=notices.find(row=>row.sourceOperationId==='cancel-rest'),copy=ok(f.op('copy-last-notice','reprint',last,{acknowledgeDuplicateRisk:true})).jobs.find(row=>row.parentId===last.id)
 assert.deepEqual(copy.ticket.items,last.ticket.items);assert.equal(copy.sourceOperationId,last.sourceOperationId);assert.equal(copy.copy,1)
 const count=received.length;await f.print(copy);assert.equal(received.length,count+1);const saved=f.book();f.db.close();f.db=init(f.file);assert.deepEqual(f.book(),saved);f.verify()
 pass('an explicit cancellation reprint retains its own source lineage after full cancellation and a real SQLite restart')
 for(const kind of ['wrong-selected-count','wrong-copy-parent']){
  const changed=structuredClone(f.book()),id=kind==='wrong-selected-count'?last.id:copy.id
  const mutate=job=>{if(job.id===id){if(kind==='wrong-selected-count')job.ticket.items[0].qty++;else job.parentId=notices.find(row=>row.id!==last.id).id}}
  changed.kitchenPrintJobs.forEach(mutate);for(const operation of changed.kitchenPrintOperations)for(const change of operation.changes)mutate(change.job)
  const before=f.book();assert.throws(()=>f.db.previewRestore({kind:'import',data:changed},owner));assert.deepEqual(f.book(),before)
 }
 pass('actual restore validation rejects a wrong selected portion and a copy attached to another cancellation source without changing any book')
 const completed=fixture('after-fulfilment',true);completed.create();ok(completed.act('collect','funds-receive',{amount:260,paid:260,payMethod:'card',shiftId:'shift'}));await completed.print(completed.jobs()[0]);ok(completed.act('cook','advance',{status:'cooking'}));ok(completed.act('ready','advance',{status:'ready'}));ok(completed.act('complete','advance',{status:'completed'}))
 ok(completed.act('cancel-selected','cancel-part',{quantities:[{id:'bowl',qty:1}],reason:'after fulfilment',shiftId:'shift'}));const returned=completed.jobs().find(row=>row.kind==='cancel');assert.deepEqual(returned.ticket.items,[{id:'bowl',name:'Rice bowl',qty:1}]);await completed.print(returned);completed.verify()
 pass('a fulfilled original also keeps its original preparation and emits only the selected returned meal while revenue, funds and actual costs remain source-valid')
 {
 const many=fixture('many-copies-and-collisions',true);many.create();ok(many.act('collect','funds-receive',{amount:260,paid:260,payMethod:'cash',shiftId:'shift'}));await many.print(many.jobs()[0],false);ok(many.act('cook','advance',{status:'cooking'}))
 ok(many.op('kp-auto-cancel-many','confirm',many.jobs()[0]));const originalId=many.jobs()[0].id
 for(let index=0;index<201;index++)ok(many.op('many-copy-'+index,'reprint',many.jobs().find(row=>row.id===originalId),{acknowledgeDuplicateRisk:true}))
 assert.equal(many.jobs().filter(row=>row.state==='queued').length,201)
 const printingConfig=many.db.getRestaurantState().config
 ok(many.act('disable-auto','configure',{expectedConfig:canonicalSignature(printingConfig),kitchenPaperAcknowledged:true,config:{...printingConfig,kitchenPrinting:{...printingConfig.kitchenPrinting,enabled:false}}}))
 ok(many.act('other','create',{items:[{id:'ready',qty:1,price:80}]}));const other=many.db.getRestaurantState().entries.find(row=>row.id==='other')
 const otherReview=require('../../electron/fundedKitchenPrint.mjs').kitchenPreparationReview(other)
 ok(many.op('cancel-many','request',null,{entryId:other.id,review:otherReview}))
 const unrelatedJob=structuredClone(many.jobs().find(row=>row.id==='kp-cancel-many')),unrelatedReceipt=structuredClone(many.book().kitchenPrintOperations.find(row=>row.id==='kp-auto-cancel-many')),booking=many.db.getRestaurantState().entries.find(row=>row.id==='booking')
 const cancelMany=many.request('cancel-many','cancel-part',{entryId:booking.id,expectedVersion:booking.version,quantities:[{id:'ready',qty:1}],reason:'201 queued copies',shiftId:'shift'}),beforeMany=many.book(),rawMany=new Database(many.file);require('../../electron/databaseFeatureFence.cjs').register(rawMany)
 rawMany.exec("CREATE TRIGGER funded_kitchen_second_part_failure BEFORE INSERT ON kitchen_print_operations WHEN json_extract(json_extract(NEW.data,'$.signature'),'$.sourceId')='cancel-many' AND json_extract(json_extract(NEW.data,'$.signature'),'$.part')=1 BEGIN SELECT RAISE(ABORT,'fixture second kitchen part'); END")
 assert.equal(many.db.applyRestaurantOperation(cancelMany,owner).success,false);assert.deepEqual(many.book(),beforeMany);rawMany.exec('DROP TRIGGER funded_kitchen_second_part_failure');rawMany.close()
 pass('failure while saving the second bounded kitchen part rolls back the actual SQLite funds, refunds, FIFO cost, all jobs and both printing parts')
 ok(many.db.applyRestaurantOperation(cancelMany,owner));const afterMany=many.book(),parts=afterMany.kitchenPrintOperations.filter(row=>JSON.parse(row.signature).sourceId==='cancel-many')
 assert.equal(parts.length,2);assert.deepEqual(parts.sort((a,b)=>a.sequence-b.sequence).map(row=>row.changes.length),[200,2]);assert.equal(many.jobs().filter(row=>row.entryId==='booking'&&row.kind==='prepare'&&row.state==='queued').length,0)
 assert.deepEqual(many.jobs().find(row=>row.id===unrelatedJob.id),unrelatedJob);assert.deepEqual(afterMany.kitchenPrintOperations.find(row=>row.id===unrelatedReceipt.id),unrelatedReceipt)
 const notice=many.jobs().filter(row=>row.entryId==='booking'&&row.kind==='cancel');assert.equal(notice.length,1);assert.notEqual(notice[0].id,unrelatedJob.id);assert.deepEqual(notice[0].ticket.items,[{id:'ready',name:'Ready meal',qty:1}])
 const originalBefore=beforeMany.kitchenPrintJobs.find(row=>row.id===originalId);assert.deepEqual(afterMany.kitchenPrintJobs.find(row=>row.id===originalId),originalBefore);ok(many.db.applyRestaurantOperation(cancelMany,owner));assert.deepEqual(many.book(),afterMany);many.verify()
 pass('201 queued copies cancel once despite both generated-operation and job-ID collisions, preserving the unrelated originals and immutable attempted preparation')
 assert.ok(many.db.previewRestore({kind:'import',data:afterMany},owner))
 const missingPart=structuredClone(afterMany),lastPart=parts[1].id;missingPart.kitchenPrintOperations=missingPart.kitchenPrintOperations.filter(row=>row.id!==lastPart)
 const projected=new Map();for(const operation of [...missingPart.kitchenPrintOperations].sort((a,b)=>a.sequence-b.sequence))for(const change of operation.changes)projected.set(change.id,change.job);missingPart.kitchenPrintJobs=[...projected.values()]
 assert.throws(()=>many.db.previewRestore({kind:'import',data:missingPart},owner));assert.deepEqual(many.book(),afterMany);many.db.close();many.db=init(many.file);assert.deepEqual(many.book(),afterMany);many.verify()
 pass('actual restore rejects a missing declared tail even with a self-consistent reconstructed job list, while a complete two-part source survives SQLite restart')
 }
 fs.writeFileSync(path.join(out,'funds-kitchen-observations.json'),JSON.stringify({schemaVersion:1,checks,receivedTransmissions:received.length,realSQLite:true,controlledLoopbackTcp:true,physicalPrinter:false,realMerchantData:false},null,2))
 console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_FUNDS_KITCHEN_PASS',tests:checks.length,physicalPrinter:false}))
}catch(error){console.error(error.stack);process.exitCode=1}finally{for(const f of fixtures)try{f.db.close()}catch{}await new Promise(resolve=>receiver?receiver.close(resolve):resolve())}})()
