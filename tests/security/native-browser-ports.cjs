const h=require('./tableKitchenHarness.cjs'),{BrowserWindow,session}=require('electron'),https=require('node:https'),http=require('node:http'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash,X509Certificate}=require('node:crypto'),{isBrowserHttpPort}=require('../../electron/browserServerPort.cjs')
let checks=0,oldShared,temporaryOrder,controlWindow,httpWindow;const observations=[],pass=label=>{checks++;console.log('PASS '+label)},hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function forceBlockedFirst(module){
 const original=module.createServer,created=[]
 module.createServer=function(...args){const server=original.apply(this,args),listen=server.listen,record={forced:false,closed:false,actualPort:null};created.push(record);server.once('close',()=>record.closed=true);server.once('listening',()=>record.actualPort=server.address().port);server.listen=function(...input){if(input[0]===0&&created.length===1){input[0]=6566;record.forced=true}return listen.apply(this,input)};return server}
 return {created,restore(){module.createServer=original}}
}
async function main(){
 await h.setup({sharedAuthority:true})
 const copy=JSON.parse(fs.readFileSync(path.resolve('.rd/opening-migration-20261018/source-copy-final.json')));for(const row of copy.manifest)assert.equal(hash(path.join(copy.destination,row.path)),row.sha256)
 oldShared=require(path.join(copy.destination,'electron/sharedStoreServer.cjs'))({db:h.db,distRoot:path.resolve('dist'),certificateRoot:path.join(h.root,'old-port-cert'),allowLoopback:true})
 let forced=forceBlockedFirst(https)
 try{
  const status=await oldShared.start({host:'127.0.0.1',port:0});assert.equal(status.port,6566)
  const ss=session.fromPartition('browser-bad-port-control');ss.setCertificateVerifyProc((request,done)=>{let match=false;try{match=request.hostname==='127.0.0.1'&&new X509Certificate(request.certificate.data).fingerprint256===status.fingerprint}catch{}done(match?0:-2)})
  controlWindow=new BrowserWindow({show:false,width:360,height:850,webPreferences:{session:ss,sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}})
  let failure;try{await controlWindow.loadURL(oldShared.pair().url)}catch(error){failure=error}
  assert.match(failure?.message||'',/ERR_UNSAFE_PORT/);observations.push({control:'physical preceding server',port:status.port,browserError:'ERR_UNSAFE_PORT',sourceCopySha256:hash('.rd/opening-migration-20261018/source-copy-final.json')})
 }finally{forced.restore();controlWindow?.destroy();controlWindow=null;await oldShared.stop();oldShared=null}
 pass('the physical preceding HTTPS server advertises forced OS port6566 and actual Chromium refuses that pairing URL')
 forced=forceBlockedFirst(https)
 try{
  const phone=await h.paired(h.owner),status=h.shared.status();assert(isBrowserHttpPort(status.port));assert.notEqual(status.port,6566);assert.equal(forced.created[0].actualPort,6566);assert.equal(forced.created[0].closed,true);assert(forced.created.length>=2)
  assert((await h.js(phone,'window.electronAPI.db.getProducts().then(rows=>rows.length)'))>0);observations.push({candidate:'actual authenticated paired browser',port:status.port,firstClosed:forced.created[0].closed,attempts:forced.created.length})
 }finally{forced.restore()}
 pass('the current HTTPS authority closes the blocked first allocation and opens a real authenticated360px paired browser on a usable port')
 await h.shared.stop();await assert.rejects(h.shared.start({host:'127.0.0.1',port:6566}),/無法用瀏覽器/);assert.equal(h.shared.status().running,false);assert.equal(h.shared.status().url,null)
 pass('an explicitly configured blocked HTTPS port fails before an inaccessible pairing link can be advertised')
 forced=forceBlockedFirst(http)
 try{
  temporaryOrder=require('../../electron/orderServer.cjs')(0,h.db,()=>null,{host:'127.0.0.1',disableTunnel:true});assert.equal(temporaryOrder.isRunning(),false);await temporaryOrder.ready;const port=temporaryOrder.getActualPort();assert(isBrowserHttpPort(port));assert.equal(forced.created[0].actualPort,6566);assert.equal(forced.created[0].closed,true);assert(forced.created.length>=2)
  httpWindow=new BrowserWindow({show:false,width:360,height:850,webPreferences:{session:session.fromPartition('browser-safe-order-port'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});await httpWindow.loadURL('http://127.0.0.1:'+port+'/api/info');assert.match(await httpWindow.webContents.executeJavaScript('document.body.innerText'),/storeId/);observations.push({candidate:'actual ordering HTTP browser',port,firstClosed:forced.created[0].closed,attempts:forced.created.length})
 }finally{forced.restore();httpWindow?.destroy();httpWindow=null;await temporaryOrder?.close();temporaryOrder=null}
 pass('the current ordering server also replaces a blocked OS allocation and serves a real Chromium HTTP page without a port-policy override')
 assert.throws(()=>require('../../electron/orderServer.cjs')(6566,h.db,()=>null,{disableTunnel:true}),/無法用瀏覽器/)
 fs.writeFileSync(path.join(h.out,'browser-port-observations.json'),JSON.stringify({observations,certificatePinning:true,unsafePortOverride:false,merchantData:false},null,2),{flag:'wx'})
 pass('an explicit blocked ordering port is rejected before creating a listener and browser security remains enabled')
 console.log(JSON.stringify({success:true,marker:'POS_BROWSER_PORTS_NATIVE_PASS',tests:checks,genuinePrecedingNegative:true,forcedRealPort:6566,realBrowser:true,unsafePortOverride:false,realMerchantData:false}));await h.finish();h.app.exit(0)
}
h.app.whenReady().then(main).catch(async error=>{console.error(error.stack);try{controlWindow?.destroy();httpWindow?.destroy();await oldShared?.stop();await temporaryOrder?.close();await h.finish()}catch{}h.app.exit(1)})
