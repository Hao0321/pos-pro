const assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http'),https=require('node:https'),net=require('node:net')
const {X509Certificate,pbkdf2Sync}=require('node:crypto'),{performance}=require('node:perf_hooks')
const init=require('../../electron/database.js'),sharedFactory=require('../../electron/sharedStoreServer.cjs'),orderFactory=require('../../electron/orderServer.cjs'),shutdown=require('../../electron/shutdown.cjs'),{prepareCheckout}=require('../../electron/checkoutSafety.cjs')
const root=process.env.POS_SECURITY_FIXTURE_ROOT;if(!root)throw Error('isolated fixture required')
const file=path.join(root,'shutdown.db'),tick=()=>new Promise(resolve=>setImmediate(resolve))
let db=init(file),shared,order,tests=0,toDrop=null,owned=[],ca,origin,device,committed
const pass=name=>{tests++;console.log('PASS '+name)}
function capture(module,fn){const original=module.createServer;module.createServer=function(...args){const server=original.apply(this,args);owned.push(server);return server};try{return fn()}finally{module.createServer=original}}
function request(endpoint,input={},who={}){
  let req
  const promise=new Promise(resolve=>{
    const body=JSON.stringify(input)
    req=https.request(new URL('/api/'+endpoint,origin),{method:'POST',ca,checkServerIdentity:(_host,cert)=>require('node:tls').checkServerIdentity('127.0.0.1',cert),headers:{'Content-Type':'application/json',Origin:origin,'X-POS-CSRF':who.csrf||'',Cookie:who.cookie||''}},res=>{
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode,value:JSON.parse(data),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]})}catch(error){resolve({error:error.message})}});res.on('error',error=>resolve({error:error.message}))
    });req.on('error',error=>resolve({error:error.message}));req.end(body)
  });return {req,promise}
}
const rpc=(method,...args)=>request('rpc',{method,args},device).promise
function refused(port){return new Promise((resolve,reject)=>{const socket=net.connect(port,'127.0.0.1',()=>{socket.destroy();reject(Error('closed port still accepts connections'))});socket.setTimeout(2000,()=>{socket.destroy();reject(Error('closed port probe timed out'))});socket.on('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error))})}
function raw(port){return new Promise((resolve,reject)=>{const socket=net.connect(port,'127.0.0.1',()=>resolve(socket));socket.once('error',reject);socket.on('error',()=>{})})}
function accepted(server,event='connection'){return new Promise(resolve=>server.once(event,resolve))}
;(async()=>{try{
  const password=JSON.stringify({salt:Array(32).fill(1),iter:1000,hash:[...pbkdf2Sync('fixture-password',Buffer.alloc(32,1),1000,32,'sha256')]})
  db.addUser({id:'owner',username:'fixture',password,role:'owner'});db.addProduct({id:'p',name:'保留原單號',price:50,cost:20,stock:2});db.openShift({id:'shift',openCash:0,cashier:'fixture'})
  shared=sharedFactory({db,distRoot:path.resolve(__dirname,'../../dist'),certificateRoot:path.join(root,'cert'),allowLoopback:true,onChanged:()=>{if(toDrop&&db.getOrder('lost-on-close')){toDrop.destroy();toDrop=null;committed?.()}}})
  const starting=capture(https,()=>shared.start({host:'127.0.0.1',port:0})),stopping=shared.stop()
  await assert.rejects(starting,/取消/);await stopping;assert.equal(shared.status().running,false);assert.ok(owned.every(s=>!s.listening));await refused(shared.status().port)
  pass('stop waits for a starting HTTPS service and leaves no owned listener')
  const first=capture(https,()=>shared.start({host:'127.0.0.1',port:0}));assert.equal(shared.start({host:'127.0.0.1',port:0}),first);await first
  assert.equal(owned.filter(s=>s.listening).length,1);pass('concurrent starts share one listener; a stopped store can start again')
  const blocked=sharedFactory({db,distRoot:root,certificateRoot:path.join(root,'blocked-cert'),allowLoopback:true})
  await assert.rejects(capture(https,()=>blocked.start({host:'127.0.0.1',port:shared.status().port})),{code:'EADDRINUSE'});await blocked.stop();assert.equal(owned.filter(s=>s.listening).length,1)
  pass('bind failure does not leak a service or disturb the existing store')
  const stoppingAgain=shared.stop();await assert.rejects(shared.start({host:'127.0.0.1',port:0}),/正在停止/);assert.throws(()=>shared.pair(),/啟動/);await stoppingAgain
  await capture(https,()=>shared.start({host:'127.0.0.1',port:0}));pass('stop rejects overlapping start and pairing, then permits an explicit restart')
  origin='https://127.0.0.1:'+shared.status().port;ca=new X509Certificate(Buffer.from(shared.certificate(),'base64')).toString()
  const pairing=request('pair',{token:new URLSearchParams(new URL(shared.pair().url).hash.slice(1)).get('pair')});const paired=await pairing.promise;assert.equal(paired.status,200);device={cookie:paired.cookie,csrf:paired.value.csrf}
  const login=await rpc('auth:login',{username:'fixture',password:'fixture-password'});assert.equal(login.value.result.role,'owner')
  pass('actual trusted HTTPS pairing and owner authentication work after stop/start')
  order=capture(http,()=>orderFactory(0,db,()=>null,{host:'127.0.0.1',disableTunnel:true}));await order.ready
  const orderServer=owned.at(-1),arriving=accepted(orderServer,'request'),upload=await raw(order.getActualPort())
  upload.write(`POST /api/order HTTP/1.1\r\nHost: 127.0.0.1:${order.getActualPort()}\r\nOrigin: http://127.0.0.1:${order.getActualPort()}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);await arriving
  const beforeIncomplete=db.exportData(),orderPort=order.getActualPort(),orderAt=performance.now(),orderStop=order.close();assert.equal(order.close(),orderStop);await orderStop
  assert.ok(performance.now()-orderAt<3500);assert.deepEqual(db.exportData(),beforeIncomplete);await refused(orderPort);upload.destroy()
  pass('an incomplete public order upload is bounded and cannot write during shutdown')
  const sale=prepareCheckout({id:'lost-on-close',now:new Date(),cart:[{id:'p',qty:1,price:50}],products:db.getProducts(),members:[],openShift:db.getOpenShift(),pointsRule:{earn:10,redeem:1},birthdayBonus:100,payMethod:'cash',paid:50,opts:{}}).order
  const saved=new Promise(resolve=>{committed=resolve}),lost=request('rpc',{method:'db:checkout',args:[sale]},device);toDrop=lost.req;await saved;const response=await lost.promise;assert.ok(response.error);assert.equal(db.getOrders().length,1);assert.equal(db.getProducts()[0].stock,1)
  pass('a real committed checkout loses its HTTPS reply without losing or duplicating the sale')
  const tlsServer=owned.find(s=>s.listening),arrived=accepted(tlsServer),slowTls=await raw(shared.status().port);await arrived
  const payload=JSON.stringify({method:'db:checkout',args:[{...sale,id:'completed-after-stop'}]}),entering=accepted(tlsServer,'request')
  let late
  const lateResponse=new Promise((resolve,reject)=>{
    late=https.request(new URL('/api/rpc',origin),{method:'POST',ca,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),Origin:origin,'X-POS-CSRF':device.csrf,Cookie:device.cookie}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});late.on('error',reject);late.write(payload.slice(0,1))
  });await entering
  const beforeStop=db.exportData(),sequence=[],port=shared.status().port,stop=shutdown({stopServices:()=>[async()=>{await shared.stop();sequence.push('shared')},async()=>{await order.close();sequence.push('orders')}],closeDatabase:()=>{assert.ok(owned.every(s=>!s.listening));assert.deepEqual(db.exportData(),beforeStop);sequence.push('database');db.close();db=null}})
  const at=performance.now(),closing=stop();assert.equal(stop(),closing);await tick();late.end(payload.slice(1));assert.equal(await lateResponse,503)
  pass('a valid checkout body completed after stop is rejected before any database change')
  await closing;await stop();slowTls.destroy();await refused(port)
  assert.ok(performance.now()-at<3500);assert.equal(sequence.at(-1),'database');assert.equal(sequence.filter(x=>x==='database').length,1)
  pass('an unfinished TLS handshake drains before SQLite closes once, including duplicate quit')
  db=init(file);assert.equal(db.getOrders().length,1);assert.equal(db.getProducts()[0].stock,1);assert.equal(db.getOrder(sale.id).total,50);assert.equal(db.getOrder(sale.id).itemCosts.p,20)
  const persisted=db.exportData();assert.equal(db.checkout(sale).success,true);assert.deepEqual(db.exportData(),persisted)
  pass('restart retains checkout, frozen cost, shift and stock; original-ID replay changes nothing')
  assert.equal(db.checkout({...sale,total:49}).success,false);assert.deepEqual(db.exportData(),persisted)
  pass('changed payload with the committed ID is rejected after restart without changing money or stock')
  console.log(JSON.stringify({success:true,marker:'POS_SHUTDOWN_PASS',tests,electron:process.versions.electron,scope:'isolated real SQLite and loopback HTTP/HTTPS; no GUI or physical phone'}))
}catch(error){console.error(error.stack);process.exitCode=1}finally{toDrop=null;await shared?.stop();await order?.close();for(const server of owned)if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});db?.close()}})()
