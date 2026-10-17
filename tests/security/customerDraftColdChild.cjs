const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{X509Certificate}=require('node:crypto'),{js,wait,input,tap}=require('./rendererHarness.cjs')
const root=process.env.POS_GUEST_COLD_PROFILE,url=process.env.POS_GUEST_COLD_URL,phase=process.env.POS_GUEST_COLD_PHASE,selected=process.env.POS_GUEST_COLD_MODE==='options',origin=new URL(url).origin
if(!root||!path.isAbsolute(root)||!['write','read'].includes(phase))throw Error('owned profile, exact URL and phase required')
app.setPath('userData',root);app.disableHardwareAcceleration();app.commandLine.appendSwitch('host-resolver-rules','MAP cart.pos.test 127.0.0.1');app.on('window-all-closed',()=>{});let w
const name='  跨程序客人 <保留>  ',note='0900-123-456\n重開仍保留  '
app.whenReady().then(async()=>{try{
 const ss=session.fromPartition('persist:guest-draft-cold');await ss.setProxy({mode:'direct'});if(origin.startsWith('https:'))ss.setCertificateVerifyProc((request,done)=>{let match=false;try{match=new X509Certificate(request.certificate.data).fingerprint256===process.env.POS_GUEST_COLD_FINGERPRINT}catch{}done(match?0:-2)})
 ss.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(request,done)=>done({cancel:!request.url.startsWith(origin+'/')}));w=new BrowserWindow({show:false,width:360,height:850,webPreferences:{session:ss,sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}})
 await w.loadURL(url);await wait(w,'document.body.dataset.guestDraftState==="ready"','cold durable guest')
 if(phase==='write'){
  await tap(w,'.add-btn[data-pid='+(selected?'bowl-offer':'bowl')+']');if(selected){await tap(w,'[data-menu-add]');await wait(w,'!document.querySelector("[data-menu-picker]")','cold selected add')}
  await tap(w,'#cart-fab');await tap(w,'#checkout-btn');await wait(w,'document.querySelector("#order-form-overlay").style.display==="flex"','cold review');await input(w,'#customer-name',name);await input(w,'#order-note',note,'HTMLTextAreaElement')
  if(selected){await tap(w,'[data-action=closeOrderForm]');await tap(w,'.add-btn[data-pid=bowl-set]');await tap(w,'[data-menu-choice=egg][data-menu-choice-action=plus]');await tap(w,'[data-menu-quantity=plus]')}
  await wait(w,'document.body.dataset.guestDraftState==="ready"','cold persisted input')
 }else{
  assert.equal(await js(w,'document.querySelector("#customer-name").value'),name);assert.equal(await js(w,'document.querySelector("#order-note").value'),note);assert.equal(await js(w,'document.querySelectorAll(".cart-item").length'),1)
  if(selected){assert.equal(await js(w,'!!document.querySelector("[data-menu-picker]")'),true);assert.match(await js(w,'document.querySelector(".menu-choice-footer strong").textContent'),/260/)}else assert.equal(await js(w,'document.querySelector("#order-form-overlay").style.display'),'flex')
 }
 assert.equal(await js(w,'localStorage.getItem("pos_customer_order_journal_v1")'),null);await w.loadURL('about:blank');ss.flushStorageData();w.destroy();console.log(JSON.stringify({success:true,marker:'POS_GUEST_COLD_CHILD_PASS',phase,selected,pid:process.pid,actualPersistentProfile:true}));app.quit()
}catch(error){console.error(error.stack);try{w?.destroy()}catch{}app.exit(1)}})
