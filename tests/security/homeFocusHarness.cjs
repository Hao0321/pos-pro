const h=require('./tableKitchenHarness.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),q=JSON.stringify;
const sha=value=>createHash('sha256').update(value).digest('hex');
const ownerTasks=['sale','quick','restaurant','reservations','purchase','exchange','shifts','inventory','warehouse','lots','stockhistory','readiness','devices','members','refunds','reports','accounting','stocktake','waste','promotions','orders','settings','recovery','scenarios','sales','customers','suppliers'];
async function home(w){
 if(await h.js(w,'document.querySelector("main")?.dataset.view==="dashboard"&&!!document.querySelector(".easy-home")'))return;
 if(await h.js(w,'!!document.querySelector(".workspace-mobile-bar")'))await h.button(w,h.t('回首頁',await h.js(w,'document.documentElement.lang')));
 else await h.tap(w,'[data-nav=dashboard]');
 await h.wait(w,'document.querySelector("main")?.dataset.view==="dashboard"&&!!document.querySelector("[data-home-primary]")','focused home');
}
async function finder(w){if(!await h.js(w,'document.querySelector("[data-home-more]").open'))await h.tap(w,'[data-home-more]>summary');await h.wait(w,'document.querySelector("[data-home-more]").open','actual other-work disclosure')}
async function pref(w,locale,style){
 if(await h.js(w,'!!document.querySelector(".workspace-mobile-bar")'))return h.prefs(w,locale,style);
 if(!await h.js(w,'document.querySelector(".display-preferences-compact").open'))await h.tap(w,'.display-preferences-compact>summary');
 await h.select(w,'[data-display-locale]',locale);await h.select(w,'select[data-display-style]',style);await h.tap(w,'.display-preferences-compact>summary');
}
async function key(w,value){
 const debug=w.webContents.debugger;if(!debug.isAttached())debug.attach('1.3');
 await debug.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
 const code=value==='Enter'?13:value==='Escape'?27:9;
 await debug.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:value,windowsVirtualKeyCode:code,text:value==='Enter'?'\r':''});
 await debug.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:value,windowsVirtualKeyCode:code});
}
async function metrics(w){return h.js(w,'(()=>{const home=document.querySelector(".easy-home"),visible=e=>e.checkVisibility()&&e.getClientRects().length>0,controls=[...home.querySelectorAll("button,summary,input,select,a")].filter(visible),primary=home.querySelector("[data-home-primary]");return {locale:document.documentElement.lang,style:document.documentElement.dataset.uiStyle,width:innerWidth,height:innerHeight,chars:home.innerText.replace(/\\s/g,"").length,controls:controls.map(e=>({label:e.textContent.trim()||e.getAttribute("aria-label"),height:e.getBoundingClientRect().height})),controlCount:controls.length,primary:primary?.getBoundingClientRect().toJSON(),primaryKind:primary?.dataset.homePrimary,scroll:home.scrollWidth,client:home.clientWidth,scrollTop:home.scrollTop,finder:home.querySelector("[data-home-more]").open,tasks:[...home.querySelectorAll("[data-home-task]")].map(e=>e.dataset.homeTask)}})()')}
async function picture(w,name,{finderOpen=false}={}){
 w.webContents.startPainting();await h.js(w,finderOpen?'document.querySelector("[data-home-more]>summary").scrollIntoView({block:"start"})':'document.querySelector(".easy-home").scrollTop=0');
 for(let i=0;i<2;i++){await h.js(w,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('home compositor paint missing')),5000);w.webContents.once('paint',()=>{clearTimeout(timer);resolve()});w.webContents.invalidate()})}
 const result={...await metrics(w),compositorFrames:2};await h.capture(w,h.out,name);fs.writeFileSync(path.join(h.out,name+'-frame.json'),JSON.stringify(result,null,2));
 assert(result.scroll<=result.client);assert(result.controls.every(row=>row.height>=48));if(!finderOpen){assert(result.controlCount<=5);assert(result.primary.top>=0&&result.primary.bottom<=result.height)}return {...result,image:name+'.png'};
}
const bookHash=()=>sha(JSON.stringify(h.db.exportData()));
module.exports={...h,home,finder,pref,key,metrics,picture,bookHash,ownerTasks,sha,get pc(){return h.pc},get db(){return h.db}};
