const h=require('./tableKitchenHarness.cjs'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{createHash}=require('node:crypto')
const {canonicalSignature}=require('../../electron/operationRules.mjs'),{salesDate}=require('../../electron/salesRules.mjs'),{validateStockCostBook}=require('../../electron/stockBackup.mjs')
let worker,receiver,phone,stage='setup';const received=[],errors=[],checks=[],observations=[],pass=label=>{checks.push(label);console.log('PASS '+label)},now=()=>new Date().toISOString()
const card=id=>'article[data-restaurant-id='+h.q(id)+']',journal=w=>h.js(w,'localStorage.getItem("pos_pending_kitchen_print_v1")')
async function panel(w){await h.wait(w,'!!document.querySelector("[data-kitchen-print-panel]")','kitchen panel');if(!await h.js(w,'document.querySelector("[data-kitchen-print-panel]").open'))await h.tap(w,'[data-kitchen-print-panel] > summary')}
async function sent(db,id){const end=Date.now()+12000;while(Date.now()<end){const job=db.getKitchenPrintState(h.owner).jobs.find(row=>row.id===id);if(job?.state==='submitted'&&received.some(bytes=>createHash('sha256').update(bytes).digest('hex')===job.attempt.contentSha256))return job;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('missing real submitted ticket '+id)}
const keys=(w,key,modifiers=[])=>{w.webContents.sendInputEvent({type:'keyDown',keyCode:key,modifiers});w.webContents.sendInputEvent({type:'keyUp',keyCode:key,modifiers})}
h.app.whenReady().then(async()=>{try{
 const {db,pc}=await h.setup();db.addProduct({id:'funded-meal',name:'Current meal',price:80,cost:30,stock:50,unit:'份'})
 receiver=net.createServer(socket=>{const chunks=[];socket.on('data',chunk=>chunks.push(chunk));socket.on('end',()=>received.push(Buffer.concat(chunks)))});await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve))
 const destination={type:'network',ip:'127.0.0.1',port:receiver.address().port};db.setSettings({printerType:'network',printerIP:destination.ip,printerPort:String(destination.port),receiptWidth:'32'})
 const configure=locale=>{const config=db.getRestaurantState().config;const result=db.applyRestaurantOperation({id:'funded-ui-config-'+locale+'-'+Date.now(),kind:'restaurant',action:'configure',time:now(),expectedConfig:canonicalSignature(config),kitchenPaperAcknowledged:true,config:{...config,enabled:true,fundsEnabled:true,dailyCapacity:200,slotCapacity:200,kitchenPrinting:{version:1,enabled:true,destination,format:{version:1,locale,columns:32}}}},h.owner);assert.equal(result.success,true,result.error)}
 configure('zh-TW');const scope=db.getSalesState(h.owner),opening=db.applyStockCostOperation({id:'funded-ui-opening',protocol:'pos-stock-cost/v1',action:'open',time:now(),storeId:scope.storeId,epoch:scope.epoch,reviewed:true,snapshotDigest:db.getStockCostPreview(h.owner).snapshotDigest,overrides:[]},h.owner);assert.equal(opening.success,true,opening.error)
 worker=require('../../electron/kitchenPrintWorker.cjs')({db,pollMs:25,onError:error=>errors.push(error.message)});worker.start()
 const act=(id,action,entryId,fields={})=>{const state=db.getRestaurantState(),entry=state.entries.find(row=>row.id===entryId),result=db.applyRestaurantOperation({id,kind:'restaurant',action,time:now(),storeId:state.storeId,epoch:state.epoch,fundsProtocol:'pos-restaurant-funds/v1',costMode:state.costMode,...(action==='create'?{channel:'walkin',day:salesDate(new Date()),slot:'12:00',customer:'UI guest',contact:'',note:''}:{entryId,expectedVersion:entry.version}),...fields},h.owner);assert.equal(result.success,true,result.error);return result}
 let index=0
 for(const locale of ['zh-TW','en','ja','zh-CN'])for(const style of ['simple','poster']){
  stage=locale+'/'+style;configure(locale);const id='funded-ui-'+index,quantity=index===2?3:2,shift=db.getOpenShift().id
  act(id,'create',null,{items:[{id:'funded-meal',qty:quantity,price:80}]});await sent(db,'kp-'+id)
  act('collect-'+index,'funds-receive',id,{amount:quantity*80,paid:quantity*80,payMethod:'cash',shiftId:shift});act('cook-'+index,'advance',id,{status:'cooking'});act('cancel-'+index,'cancel-part',id,{quantities:[{id:'funded-meal',qty:1}],reason:'one fewer',shiftId:shift});await sent(db,'kp-cancel-'+index)
  await h.nativePrefs(locale,style);let device=pc
  if(index===0){phone=await h.paired(h.staff);device=phone}
  const selector=card(id);await h.wait(device,'!!document.querySelector('+h.q(selector+' [data-print-current]')+')','current meal action')
  await h.tap(device,selector+' [data-print-current]');await h.wait(device,'!!document.querySelector("[role=dialog] [data-print-current-items]")','review current portions')
  assert.equal(await h.js(device,'document.querySelector("[data-print-current-items]").textContent'),'Current meal × '+(quantity-1));assert.equal(await h.js(device,'document.querySelector("[data-print-copy]").disabled'),true)
  if(index===0){
   await h.wait(device,'document.activeElement.matches("[data-print-risk]")','review focus');keys(device,'TAB',['shift']);await h.wait(device,'document.activeElement.matches("[data-print-dialog-close]")','backward focus trap');keys(device,'TAB');await h.wait(device,'document.activeElement.matches("[data-print-risk]")','forward focus trap');keys(device,'F3');assert.equal(await h.js(device,'!!document.querySelector("[role=dialog] [data-print-current-items]")'),true)
   pass('the real pinned-HTTPS staff phone reviews only remaining portions, traps keyboard focus and does not trigger cashier shortcuts')
  }
  if(index===2){
   act('cancel-extra-'+index,'cancel-part',id,{quantities:[{id:'funded-meal',qty:1}],reason:'another device changes quantities',shiftId:shift});await sent(db,'kp-cancel-extra-'+index)
   const oldCount=db.exportData().kitchenPrintJobs.filter(row=>row.entryId===id&&row.kind==='prepare').length
   await h.tap(device,'[data-print-risk]');await h.tap(device,'[data-print-copy]');await h.wait(device,'!!document.querySelector("[role=dialog] [role=alert]")&&localStorage.getItem("pos_pending_kitchen_print_v1")===null','stale preview safely rejected')
   assert.equal(db.exportData().kitchenPrintJobs.filter(row=>row.entryId===id&&row.kind==='prepare').length,oldCount);keys(device,'ESCAPE');await h.wait(device,'!document.querySelector("[role=dialog]")','close old preview')
   await h.wait(device,'document.querySelector('+h.q(selector)+')?.innerText.includes("Current meal × 1")||!!document.querySelector('+h.q(selector+' [data-print-current]')+')','updated worklist');await h.tap(device,selector+' [data-print-current]');await h.wait(device,'document.querySelector("[data-print-current-items]")?.textContent==="Current meal × 1"','fresh one-portion review')
   pass('an actual other-device quantity change rejects the stale UI preview before printing, then a fresh review shows the updated one-portion source')
  }
  assert.equal(await h.js(device,'document.documentElement.scrollWidth<=innerWidth+1'),true)
  assert.equal(await h.js(device,'document.querySelector("[role=dialog] [role=alert]")===null'),true,'a fresh review must not inherit a prior attempt error')
  const heights=await h.js(device,'[...document.querySelectorAll("[role=dialog] button,[role=dialog] label")].map(node=>node.getBoundingClientRect().height)');assert.ok(heights.length>=3&&heights.every(value=>value>=47))
  await h.js(device,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.join(h.out,'funded-kitchen-'+locale+'-'+style+'.png'),(await device.webContents.capturePage()).toPNG())
  const before=db.exportData().stockCostEntries.length,initialKitchenOps=db.exportData().kitchenPrintOperations.length
  if(index===1)h.loseKitchen()
  await h.tap(device,'[data-print-risk]');await h.tap(device,'[data-print-copy]')
  if(index===1){
   await h.wait(device,'!!localStorage.getItem("pos_pending_kitchen_print_v1")&&!document.querySelector("[data-print-dialog-close]").disabled','lost current-request reply');const pending=JSON.parse(await journal(device));assert.equal(pending.request.action,'request');assert.equal(pending.request.review.items[0].qty,1)
   const job=db.getKitchenPrintState(h.owner).jobs.find(row=>row.id==='kp-'+pending.request.id);await sent(db,job.id);const count=db.exportData().kitchenPrintOperations.length,sentCount=received.length
   pc.webContents.reload();await h.wait(pc,'!!document.querySelector(".easy-home")','reopen with reviewed pending');await h.nav(pc,'restaurant',locale);await panel(pc);await h.tap(pc,'[data-print-retry]');await h.wait(pc,'localStorage.getItem("pos_pending_kitchen_print_v1")===null','original reviewed request recovered')
   assert.equal(db.exportData().kitchenPrintOperations.length,count);assert.equal(received.length,sentCount)
   pass('actual IPC reply loss and renderer restart retain the exact reviewed current-meal request and recover it without another TCP preparation')
  }else await h.wait(device,'!document.querySelector("[role=dialog]")&&localStorage.getItem("pos_pending_kitchen_print_v1")===null','current request fully acknowledged')
  const jobs=db.getKitchenPrintState(h.owner).jobs.filter(row=>row.entryId===id&&row.kind==='prepare'),current=jobs.find(row=>row.id!=='kp-'+id);assert.ok(current);await sent(db,current.id);assert.deepEqual(current.ticket.items,[{id:'funded-meal',name:'Current meal',qty:1}]);assert.equal(db.exportData().stockCostEntries.length,before);assert.ok(db.exportData().kitchenPrintOperations.length>initialKitchenOps)
  observations.push({locale,style,entryId:id,originalTicketId:'kp-'+id,currentTicketId:current.id,currentItems:current.ticket.items,pairedPhone:index===0,physicalPhone:false,physicalPrinter:false})
  if(phone){phone.destroy();phone=null}
  act('cancel-rest-'+index,'cancel',id,{reason:'end fixture',shiftId:shift});await sent(db,'kp-cancel-rest-'+index)
  pass(locale+'/'+style+' real current-meal UI confirms one frozen portion and sends one explicit preparation without changing the source cost ledger')
  index++
 }
 validateStockCostBook(db.exportData());assert.equal(db.exportFullBackup(h.owner).protection.version,6);assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[])
 fs.writeFileSync(path.join(h.out,'funded-kitchen-ui-observations.json'),JSON.stringify({schemaVersion:1,checks,observations,controlledLoopbackTransmissions:received.length,realIPC:true,pinnedHTTPS:true,phoneSizedChromium:true,physicalPhone:false,physicalPrinter:false,financialProductForms:false},null,2))
 console.log(JSON.stringify({success:true,marker:'POS_RESTAURANT_FUNDS_KITCHEN_UI_PASS',tests:checks.length,physicalPrinter:false,physicalPhone:false,scope:'F9 kitchen current-meal review only; F11 financial dialogs and full ERP acceptance remain open'}))
}catch(error){console.error(stage,error.stack);try{fs.writeFileSync(path.join(h.out,'funded-kitchen-ui-failure.txt'),stage+'\n'+error.stack+'\n'+await h.js(phone||h.pc,'document.body.innerText'));fs.writeFileSync(path.join(h.out,'funded-kitchen-ui-failure.png'),(await (phone||h.pc).webContents.capturePage()).toPNG())}catch{}process.exitCode=1}finally{try{await worker?.stop();phone?.destroy();await new Promise(resolve=>receiver?receiver.close(resolve):resolve());await h.finish()}catch(error){console.error(error.stack);process.exitCode=1}h.app.exit(process.exitCode||0)}})
