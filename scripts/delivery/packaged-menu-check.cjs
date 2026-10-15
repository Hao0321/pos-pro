const path=require('node:path'),assert=require('node:assert/strict')
module.exports=async function checkMenu(inspector,payload,profile){
 const port=await require('./runtime-authority.cjs').freePort()
 const code=`(async()=>{const require=globalThis.__posInstallerTestRequire,e=globalThis.__posInstallerTestElectron;
 const db=require(${JSON.stringify(path.join(payload,'resources/app.asar/electron/database.js'))})(${JSON.stringify(path.join(profile,'packaged-menu-display.db'))});
 db.addProduct({id:'locale-fixture',name:'首頁',stock:7,price:95,cost:20});db.setSetting('storeName','Locale fixture');
 const service=require(${JSON.stringify(path.join(payload,'resources/app.asar/electron/orderServer.cjs'))})(${port},db,()=>null,{host:'127.0.0.1',disableTunnel:true});await service.ready;
 const origin='http://127.0.0.1:'+service.getActualPort(),isolated=e.session.fromPartition('pos-delivered-display-fixture');
 const menu=new e.BrowserWindow({show:false,width:360,height:640,webPreferences:{session:isolated,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
 isolated.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>cb({cancel:!d.url.startsWith(origin+'/')}));
 try{await menu.loadURL(origin+'/menu/');let ready=false;for(let i=0;i<150;i++){ready=await menu.webContents.executeJavaScript('!!document.querySelector(".add-btn")');if(ready)break;await new Promise(r=>setTimeout(r,30))}if(!ready)throw Error('delivered menu modules did not load');
 const en=await menu.webContents.executeJavaScript(\`(()=>{const l=document.querySelector('#menu-language');l.value='en';l.dispatchEvent(new Event('change',{bubbles:true}));const s=document.querySelector('#menu-style');s.value='simple';s.dispatchEvent(new Event('change',{bubbles:true}));return {lang:document.documentElement.lang,style:document.documentElement.dataset.uiStyle,button:document.querySelector('.add-btn').textContent,name:document.querySelector('.p-name').textContent}})()\`);
 const ja=await menu.webContents.executeJavaScript(\`(()=>{const l=document.querySelector('#menu-language');l.value='ja';l.dispatchEvent(new Event('change',{bubbles:true}));return {lang:document.documentElement.lang,button:document.querySelector('.add-btn').textContent,name:document.querySelector('.p-name').textContent}})()\`);
 return {en,ja,orders:db.getOrders().length,stock:db.getProducts()[0].stock,tunnel:service.getTunnelUrl()};
 }finally{menu.destroy();await service.close();db.close()}})()`
 const r=await inspector.send('Runtime.evaluate',{expression:code,awaitPromise:true,returnByValue:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));const value=r.result.value
 assert.deepEqual(value.en,{lang:'en',style:'simple',button:'Add to cart',name:'首頁'});assert.deepEqual(value.ja,{lang:'ja',button:'カートに追加',name:'首頁'});assert.equal(value.orders,0);assert.equal(value.stock,7);assert.equal(value.tunnel,null)
 return value
}
