const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),h=require('./tableKitchenHarness.cjs')
let mode='failure',release,calls=[],checks=0
const observations=[],pass=message=>{checks++;console.log('PASS '+message)}
async function pos(w,locale='zh-TW'){
 const menu='[aria-label='+h.q(h.t('開啟功能選單',locale))+']'
 if(await h.js(w,'!!document.querySelector('+h.q(menu)+')'))await h.tap(w,menu)
 await h.tap(w,'[data-nav=pos]')
 await h.wait(w,'[...document.querySelectorAll(".pos-card")].some(p=>p.textContent.includes("Receipt control"))','hydrated receipt product')
}
async function display(pc,locale,style,width=360){
 await h.js(pc,'localStorage.setItem("pos_display_preferences_v1",JSON.stringify({...JSON.parse(localStorage.getItem("pos_display_preferences_v1")),locale:'+h.q(locale)+',style:'+h.q(style)+'}))')
 pc.setContentSize(width,850)
 const loaded=new Promise(resolve=>pc.webContents.once('did-finish-load',resolve))
 pc.webContents.reload();await loaded
 await h.wait(pc,'!!document.querySelector(".easy-home")&&document.documentElement.lang==='+h.q(locale)+'&&document.documentElement.dataset.uiStyle==='+h.q(style),'restarted display')
 await pos(pc,locale)
}
async function purchase(w,db,locale='zh-TW'){
 await h.js(w,'[...document.querySelectorAll(".pos-card")].find(p=>p.textContent.includes("Receipt control")).setAttribute("data-receipt-product","")')
 await h.tap(w,'[data-receipt-product]')
 const mobile='[aria-label='+h.q(h.t('開啟購物車',locale))+']'
 await h.wait(w,'!!document.querySelector('+h.q(mobile)+')||[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==='+h.q(h.t('前往結帳 →',locale))+')','rendered cart after product pointer')
 if(await h.js(w,'!!document.querySelector('+h.q(mobile)+')'))await h.tap(w,mobile)
 await h.button(w,h.t('前往結帳 →',locale));await h.input(w,'input[placeholder='+h.q(h.t('輸入金額',locale))+']','100');await h.button(w,h.t('確認收款',locale))
 await h.wait(w,'document.body.innerText.includes('+h.q(h.t('結帳完成',locale))+')','payment completion')
 return db.getOrders().filter(row=>row.items.some(item=>item.id==='receipt-product')).at(0)
}
async function continueCash(w,locale){
 await h.button(w,h.t('繼續收銀',locale))
 const close='[aria-label='+h.q(h.t('關閉購物車',locale))+']'
 if(await h.js(w,'!!document.querySelector('+h.q(close)+')'))await h.tap(w,close)
}
async function find(w,id){
 await h.tap(w,'[data-receipt-find]');await h.input(w,'[data-receipt-search]',id);await h.tap(w,'[data-receipt-open='+h.q(id)+']')
 await h.wait(w,'!!document.querySelector("[data-receipt-original]")','original receipt')
}
h.app.whenReady().then(async()=>{try{
 const {db,pc}=await h.setup()
 require('../../electron/printer.js').printReceipt=async saved=>{
   calls.push(structuredClone(saved))
   if(mode==='delay')return new Promise(resolve=>{release=resolve})
   if(mode==='throw')throw Error('secret-native-path and raw IPC exception')
   if(mode==='unknown')return {success:true,error:'contradictory'}
   return mode==='success'?{success:true}:{success:false,error:'secret-native-path'}
 }
 await h.js(pc,'window.electronAPI.db.addProduct({id:"receipt-product",name:"Receipt control",price:50,cost:20,stock:30})')
 pc.webContents.send('store:changed')
 for(const locale of ['zh-TW','en','ja','zh-CN'])for(const style of ['simple','poster']){
   await display(pc,locale,style);const original=await purchase(pc,db,locale),before=db.exportData(),count=calls.length
   mode='failure';await h.tap(pc,'[data-receipt-print]');await h.wait(pc,'document.querySelector("[data-receipt-print-state]")?.dataset.receiptPrintState==="uncertain"','visible failed print')
   assert.equal(calls.length,count+1);assert.equal(calls.at(-1).id,original.id);assert.deepEqual(db.exportData(),before)
   assert.equal(await h.js(pc,'document.body.innerText.includes("secret-native-path")'),false)
   assert.equal(await h.js(pc,'document.body.innerText.includes('+h.q(h.t('結帳已完成，不需再次收款。',locale))+')'),true)
   const geometry=await h.js(pc,'(()=>{const a=document.querySelector("[data-receipt-print]"),b=document.querySelector("[data-receipt-paper]"),s=document.querySelector("[data-receipt-print-state]");return {width:innerWidth,printHeight:a.getBoundingClientRect().height,paperHeight:b.getBoundingClientRect().height,overflow:s.scrollWidth>s.clientWidth}})()')
   assert.equal(geometry.width,360);assert.ok(geometry.printHeight>=48&&geometry.paperHeight>=48);assert.equal(geometry.overflow,false)
   await h.tap(pc,'[data-receipt-print]');await h.tap(pc,'[data-receipt-cancel]');assert.equal(calls.length,count+1)
   await h.tap(pc,'[data-receipt-paper]');assert.equal(calls.length,count+1)
   await h.capture(pc,h.out,'receipt-'+locale+'-'+style);observations.push({locale,style,originalId:original.id,...geometry})
   await continueCash(pc,locale);await find(pc,original.id);assert.equal(calls.length,count+1)
   await h.tap(pc,'[data-receipt-print]');mode='success';await h.tap(pc,'[data-receipt-confirm]')
   await h.wait(pc,'document.querySelector("[data-receipt-print-state]")?.dataset.receiptPrintState==="sent"','sent requires paper check')
   assert.equal(calls.length,count+2);assert.deepEqual(db.exportData(),before)
   pc.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});pc.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
   await h.wait(pc,'!document.querySelector(".receipt-history")','Escape closes history')
 }
 pass('four locales/two styles at 360px preserve completed payment, visible sanitized failure, 48px controls, explicit paper/reprint choices and unchanged native business records')
 pass('actual receipt search finds the saved original after leaving checkout, requires review before dispatch and keeps every original amount unchanged')
 await display(pc,'zh-TW','simple',1100);const original=await purchase(pc,db),count=calls.length,before=db.exportData()
 mode='delay';await h.tap(pc,'[data-receipt-print]');await h.wait(pc,'document.querySelector("[data-receipt-print]")?.disabled===true','pending print')
 await h.js(pc,'(()=>{document.querySelector("[data-receipt-print]").click();document.querySelector("[data-receipt-print]").click()})()')
 assert.equal(calls.length,count+1);assert.deepEqual(db.exportData(),before)
 await continueCash(pc,'zh-TW');const next=await purchase(pc,db);assert.notEqual(next.id,original.id)
 release({success:true});await h.wait(pc,'document.querySelector("[data-receipt-print-state]")?.dataset.receiptPrintState==="idle"','late old reply ignored')
 assert.equal(db.getOrders().filter(row=>row.items.some(item=>item.id==='receipt-product')).length,10)
 pass('a delayed real IPC print ignores repeated clicks, allows the next checkout and cannot replace the next original state after a late reply')
 for(const failure of ['throw','unknown']){
   mode=failure;const stable=db.exportData();await h.tap(pc,'[data-receipt-print]')
   if(await h.js(pc,'!!document.querySelector("[data-receipt-confirm]")'))await h.tap(pc,'[data-receipt-confirm]')
   await h.wait(pc,'document.querySelector("[data-receipt-print-state]")?.dataset.receiptPrintState==="uncertain"','unknown printer reply')
   assert.deepEqual(db.exportData(),stable);assert.equal(await h.js(pc,'document.body.innerText.includes("secret-native-path")'),false)
 }
 await display(pc,'zh-TW','simple',1100);const restartCount=calls.length;await find(pc,original.id);assert.equal(calls.length,restartCount)
 assert.equal(await h.js(pc,'document.querySelector("[data-receipt-original]").dataset.receiptOriginal'),original.id)
 await h.capture(pc,h.out,'receipt-restarted-original')
 pass('native exceptions and contradictory acknowledgements remain uncertain; renderer restart recovers the saved original without an automatic reprint')
 const phone=await h.paired(h.owner);await pos(phone);const phoneOrder=await purchase(phone,db),phoneCount=calls.length
 await h.wait(phone,'!!document.querySelector("[data-receipt-device-hint]")','paired device guidance')
 assert.equal(await h.js(phone,'!!document.querySelector("[data-receipt-print]")'),false)
 await continueCash(phone,'zh-TW');await find(phone,phoneOrder.id)
 assert.equal(await h.js(phone,'!!document.querySelector("[data-receipt-device-hint]")&&!document.querySelector("[data-receipt-print]")'),true)
 assert.equal(await h.js(phone,'localStorage.getItem("pos_atomic_records_v1")'),null);assert.equal(calls.length,phoneCount)
 await h.capture(phone,h.out,'receipt-paired-phone')
 pass('a pinned HTTPS companion uses the same saved receipt and gives device guidance instead of a nonfunctional native print button, without an offline replica')
 assert.deepEqual(h.errors,[])
 fs.writeFileSync(path.join(h.out,'receipt-print-observations.json'),JSON.stringify({schemaVersion:1,observations,checks,printCalls:calls.length,canonicalOrderIds:calls.map(row=>row.id),realIPC:true,pinnedHTTPS:true,printerTransport:'controlled responses, not physical paper',physicalPhone:false,errors:h.errors},null,2))
 console.log(JSON.stringify({success:true,marker:'POS_RECEIPT_PRINT_UI_PASS',tests:checks,physicalPrinter:false,physicalPhone:false}))
 await h.finish();h.app.exit(0)
}catch(error){console.error(error.stack);try{fs.writeFileSync(path.join(h.out,'failure.txt'),await h.js(h.pc,'document.body.innerText'));await h.capture(h.pc,h.out,'failure')}catch{}try{await h.finish()}catch{}h.app.exit(1)}})
