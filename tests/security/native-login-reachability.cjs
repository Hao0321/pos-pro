const h=require('./tableKitchenHarness.cjs'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');let checks=0;const observations=[]
h.app.whenReady().then(async()=>{try{
 const {pc}=await h.setup();await h.js(pc,'window.electronAPI.auth.logout()');pc.webContents.reload();await h.wait(pc,'!!document.querySelector("input[type=password]")','signed out login')
 for(const width of [1100,360])for(const locale of ['zh-TW','en','ja','zh-CN'])for(const style of ['simple','poster']){
  pc.setContentSize(width,680);await h.prefs(pc,locale,style);await h.js(pc,'(()=>{document.querySelector(".login-screen").scrollTop=0;return true})()');assert.ok(await h.js(pc,'document.querySelector(".login-card").getBoundingClientRect().top>=0'),'login card must have a scrollable positive top at '+width+'/'+locale+'/'+style)
  await h.tap(pc,'[data-style-choice='+style+']');await h.tap(pc,'input[type=password]');await h.input(pc,'input[type=password]','table-password');assert.equal(await h.js(pc,'document.querySelector("input[type=password]").value'),'table-password');assert.equal(await h.js(pc,'document.documentElement.scrollWidth<=innerWidth+1'),true)
  observations.push({width,height:680,locale,style,stylePointerReachable:true,passwordPointerReachable:true});if(locale==='zh-TW')await h.capture(pc,h.out,'login-'+width+'-'+style)
 }
 checks++;console.log('PASS actual pointer can reach style choices and password in all four locales and both styles at desktop1100x680 and phone360x680; the oversized card has no unreachable negative top')
 await h.login(pc);checks++;console.log('PASS a real owner can still authenticate after the complete low-height display matrix without losing credentials')
 fs.writeFileSync(path.join(h.out,'login-reachability-observations.json'),JSON.stringify({checks,observations,humanAcceptance:false,physicalPhone:false},null,2));console.log(JSON.stringify({success:true,marker:'POS_LOGIN_REACHABILITY_PASS',tests:checks}));await h.finish();h.app.exit(0)
}catch(error){console.error(error.stack);try{if(h.pc&&!h.pc.isDestroyed())await h.capture(h.pc,h.out,'login-reachability-failure');await h.finish()}catch{}h.app.exit(1)}})
