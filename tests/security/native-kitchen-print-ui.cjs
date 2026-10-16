const h=require('./tableKitchenHarness.cjs'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{kitchenTicketDigest}=require('../../electron/kitchenTicketBytes.mjs')
let worker,receiver,guest,checks=0,stage='setup';const received=[],errors=[],observations=[],pass=label=>{checks++;console.log('PASS '+label)}
const panel='[data-kitchen-print-panel]',journal=w=>h.js(w,'localStorage.getItem("pos_pending_kitchen_print_v1")')
async function opened(w){await h.wait(w,'!!document.querySelector('+h.q(panel)+')','print panel');if(!await h.js(w,'document.querySelector('+h.q(panel)+').open'))await h.tap(w,panel+' > summary')}
const card=id=>'article[data-restaurant-id='+h.q(id)+']'
async function receivedDigest(digest){const end=Date.now()+3000;while(Date.now()<end){if(received.some(b=>require('node:crypto').createHash('sha256').update(b).digest('hex')===digest))return;await new Promise(resolve=>setTimeout(resolve,10))}throw Error('The controlled receiver did not finish the submitted ticket')}
h.app.whenReady().then(async()=>{try{
 const {db,pc}=await h.setup(),context=await h.createCodes()
 receiver=net.createServer(socket=>{const chunks=[];socket.on('data',b=>chunks.push(b));socket.on('end',()=>received.push(Buffer.concat(chunks)))});await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve))
 db.setSettings({printerType:'network',printerIP:'127.0.0.1',printerPort:String(receiver.address().port),receiptWidth:'32'})
 worker=require('../../electron/kitchenPrintWorker.cjs')({db,pollMs:25,onError:e=>errors.push(e.message)});worker.start()
 let index=0
 for(const locale of ['zh-TW','en','ja','zh-CN'])for(const style of ['simple','poster']){
  stage=locale+'/'+style;await h.nativePrefs(locale,style);await opened(pc)
  if(!await h.js(pc,'document.querySelector("[data-print-auto]").checked'))await h.tap(pc,'[data-print-auto]')
  await h.select(pc,'[data-print-locale]',locale)
  if(await h.js(pc,'!!document.querySelector("[data-print-paper]")')){assert.equal(await h.js(pc,'document.querySelector("[data-print-save]").disabled'),true);await h.tap(pc,'[data-print-paper]')}
  if(index===0)h.loseKitchenConfiguration()
  await h.tap(pc,'[data-print-save]')
  if(index===0){await h.wait(pc,'!!localStorage.getItem("pos_pending_kitchen_print_v1")&&!document.querySelector("[data-print-retry]").disabled','uncertain configuration original');assert.equal(await h.js(pc,'localStorage.getItem("pos_pending_financial_v1")'),null)}
  else await h.wait(pc,'document.querySelector('+h.q(panel+' [role=status]')+')?.textContent==='+h.q(h.t('已保存廚房列印設定',locale))+'&&localStorage.getItem("pos_pending_kitchen_print_v1")===null&&!document.querySelector("[data-print-save]").disabled','saved configuration')
  assert.equal(db.getKitchenPrintState(h.owner).binding.ready,true);assert.equal(db.getRestaurantState().config.kitchenPrinting.format.locale,locale)
  guest=await h.guest(context,{locale,style,name:'kitchen-print-guest-'+index});await h.fillGuest(guest);await h.submitGuest(guest);const orderId=(await h.confirmedGuest(guest)).ack.orderId;guest.destroy();guest=null
  const intake='[data-customer-order='+h.q(orderId)+']';await h.wait(pc,'!!document.querySelector('+h.q(intake)+')','incoming customer');await h.tap(pc,intake+' [data-intake-accept]')
  await h.wait(pc,'!document.querySelector('+h.q(intake)+')&&localStorage.getItem("pos_pending_financial_v1")===null','accepted original')
  const entry=db.getRestaurantState().entries.find(e=>e.customerOrderId===orderId),selector=card(entry.id)
  await h.wait(pc,'document.querySelector('+h.q(selector+' [data-print-state]')+')?.dataset.printState==="submitted"','real automatic TCP submitted')
  const job=db.getKitchenPrintState(h.owner).jobs.find(j=>j.entryId===entry.id);assert.equal(job.paper,null);assert.equal(kitchenTicketDigest(job.ticket,job.attempt.format),job.attempt.contentSha256);await receivedDigest(job.attempt.contentSha256)
  assert.equal(await h.js(pc,'document.querySelector('+h.q(selector+' [data-print-state]')+').textContent.includes('+h.q(h.t('已送印，請確認紙張',locale))+')'),true)
  if(index===0){
   const raw=await journal(pc);assert.equal(await h.js(pc,'document.querySelector('+h.q(panel)+').innerText.includes("fixture")'),false);await h.tap(pc,selector+' [data-kitchen-pay]');await h.button(pc,h.t('保存此單收款',locale));await h.wait(pc,'!document.querySelector('+h.q('[aria-label='+h.q(h.t('預訂實收',locale))+']')+')&&localStorage.getItem("pos_pending_financial_v1")===null','cash acknowledgement while print config uncertain');assert.ok(db.getRestaurantState().entries.find(e=>e.id===entry.id).saleId);assert.equal(await journal(pc),raw)
   await opened(pc);await h.tap(pc,'[data-print-retry]');await h.wait(pc,'localStorage.getItem("pos_pending_kitchen_print_v1")===null','original configuration replay');pass('real owner configuration reply loss retains a separate original; customer acceptance and actual cashier payment continue, then the same configuration ID resolves')
  }
  if(index===1){
   h.loseKitchen();await h.tap(pc,selector+' [data-print-confirm]');await h.wait(pc,'!!localStorage.getItem("pos_pending_kitchen_print_v1")&&!document.querySelector("[data-print-retry]").disabled','paper reply lost');const original=JSON.parse(await journal(pc)),count=db.exportData().kitchenPrintOperations.length,sent=received.length
   pc.webContents.reload();await h.wait(pc,'!!document.querySelector(".easy-home")','reopened desktop');await h.nav(pc,'restaurant',locale);await opened(pc);await h.tap(pc,'[data-print-retry]');await h.wait(pc,'localStorage.getItem("pos_pending_kitchen_print_v1")===null','reopened paper original resolved');assert.equal(db.exportData().kitchenPrintOperations.length,count);assert.equal(received.length,sent);assert.equal(db.exportData().kitchenPrintOperations.find(o=>o.id===original.request.id).action,'confirm');pass('actual IPC paper confirmation survives a lost reply and renderer restart, preserves the original ID and sends no second TCP ticket')
  }else{await h.tap(pc,selector+' [data-print-confirm]');await h.wait(pc,'document.querySelector('+h.q(selector+' [data-print-state]')+')?.dataset.printState==="confirmed"&&localStorage.getItem("pos_pending_kitchen_print_v1")===null','paper confirmed')}
  assert.equal(await h.js(pc,'document.documentElement.scrollWidth<=innerWidth+1'),true)
  const heights=await h.js(pc,'[...document.querySelectorAll('+h.q(panel+' button, '+selector+' [data-print-confirm]')+')].filter(b=>b.getClientRects().length).map(b=>b.getBoundingClientRect().height)');assert.ok(heights.every(n=>n>=47))
  await h.capture(pc,h.out,'kitchen-print-'+locale+'-'+style);observations.push({locale,style,width:360,entryId:entry.id,jobId:job.id,state:db.getKitchenPrintState(h.owner).jobs.find(j=>j.id===job.id).state,automaticTicket:true,paperAcknowledgement:'synthetic human action; no physical paper'})
  index++
 }
 pass('all four locales and both styles use actual 360px pointer flows, automatic TCP dispatch, explicit paper acknowledgement, large buttons and preserved original customer orders')
 const first=db.getRestaurantState().entries[0],selector=card(first.id);await h.tap(pc,selector+' [data-kitchen-cancel]');await h.input(pc,'input[aria-label='+h.q(h.t('預訂取消原因','zh-CN'))+']','Guest changed mind');await h.button(pc,h.t('保存取消','zh-CN')+(first.saleId?h.t('與退款','zh-CN'):''));await h.wait(pc,'localStorage.getItem("pos_pending_financial_v1")===null&&!document.querySelector('+h.q(selector)+')','cancelled order hidden')
 await opened(pc);const notice=db.getKitchenPrintState(h.owner).jobs.find(j=>j.entryId===first.id&&j.kind==='cancel');assert.ok(notice);await h.tap(pc,panel+' details > summary');await h.wait(pc,'document.querySelector('+h.q(panel+' [data-kitchen-print-entry='+h.q(first.id)+'] [data-print-state]')+')?.dataset.printState==="submitted"','cancel notice visible independently of active kitchen card');pass('a cancellation notice remains visible in the print panel after the cancelled kitchen card leaves the active list')
 assert.deepEqual(errors,[]);assert.deepEqual(h.errors,[]);fs.writeFileSync(path.join(h.out,'kitchen-ui-observations.json'),JSON.stringify({observations,checks,received:received.length,physicalPrinter:false,humanAcceptance:false},null,2));console.log(JSON.stringify({success:true,marker:'POS_KITCHEN_PRINT_UI_PASS',tests:checks,physicalPrinter:false}))
 await worker.stop();await h.finish();await new Promise(resolve=>receiver.close(resolve));h.app.quit()
}catch(error){console.error('STAGE '+stage+'\n'+error.stack);try{if(h.pc&&!h.pc.isDestroyed()){await h.capture(h.pc,h.out,'kitchen-print-failure');fs.writeFileSync(path.join(h.out,'kitchen-print-failure.txt'),await h.js(h.pc,'document.body.innerText'))}guest?.destroy();await worker?.stop();await h.finish();if(receiver)await new Promise(resolve=>receiver.close(resolve))}catch{}h.app.exit(1)}})
