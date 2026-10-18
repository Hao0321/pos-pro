const express = require('express')
const path = require('node:path')
const {randomBytes,randomUUID,createHash,createHmac,timingSafeEqual} = require('node:crypto')
const {readRestaurantConfig}=require('./restaurantRules.mjs')
const {publicOrderingMenu,assertPublicRecipeAvailability,customerOrderView}=require('./tableOrdering.mjs')
const {resolveTable}=require('./tableCapability.cjs')
const trackingProof=require('./customerTrackingProof.cjs')
const {publicRestaurantMenu,CUSTOMER_MENU_PROTOCOL}=require('./restaurantCustomerMenu.mjs')
const publicReview=require('./publicMenuReview.cjs')
const cartContexts=require('./customerCartContext.cjs')
const {PUBLIC_MENU_PROTOCOL}=require('../public/menu/menuProtocol.mjs')
const digest=value=>createHash('sha256').update(value).digest('hex')
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))
function publicProduct(p) { return {id:p.id,name:p.name,category:p.category,price:p.price,stock:p.stock,unit:p.unit} }
function prepareCustomerOrder(body,products) {
  if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length>100 ||
      typeof body.requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId))
    throw new Error('請確認訂單品項與請求編號')
  const seen=new Set()
  const items=body.items.map(i=>{
    const p=products.find(p=>p.id===i?.id)
    if (!p || seen.has(i.id) || !Number.isSafeInteger(i.qty) || i.qty<1 || i.qty>1000000 ||
        !Number.isFinite(p.price) || p.price<=0 || !Number.isFinite(p.stock) || p.stock<i.qty)
      throw new Error('商品或數量無效，請重新確認庫存')
    seen.add(i.id);return {id:p.id,name:p.name,price:p.price,qty:i.qty}
  })
  const text=(value,max)=>{if(value!=null&&(typeof value!=='string'||value.length>max))throw new Error('備註格式錯誤');return value||''}
  const customerName=text(body.customerName,100),note=text(body.note,500),tableNum=text(body.tableNum,40)
  const total=items.reduce((s,i)=>s+Math.round(i.price*100)*i.qty,0)/100
  if (!Number.isFinite(total)||total>1e9) throw new Error('金額超過可處理範圍')
  return {id:'CO'+body.requestId,items,subtotal:total,discount:0,total,payMethod:'pending',paid:0,change:0,
    memberId:null,pointsUsed:0,pointsEarned:0,time:new Date().toISOString(),source:'customer',status:'pending',
    tableNum,note:(customerName?customerName+': ':'')+note}
}
module.exports=function startOrderServer(port,db,getMainWindow,options={}) {
  const app=express(),limits=new Map(),menuQuoteKey=randomBytes(32)
  let closing=false,closeTask=null
  app.disable('x-powered-by')
  const storeIdentity=()=>{let id=db.getSetting('sharedStoreId');if(id==null||id===''){id=randomUUID();db.setSetting('sharedStoreId',id)}if(typeof id!=='string'||!id)throw Error('店面身份需要核對');return id}
  const restaurant=()=>{const products=db.getProducts(),state=typeof db.getRestaurantState==='function'?db.getRestaurantState():null;return {products,config:state?.config||readRestaurantConfig(db.getSetting('restaurantConfig'),products),entries:state?.entries||[]}}
  const withCartContext=consume=>typeof db.withCustomerCartContext==='function'?db.withCustomerCartContext(consume):consume(null)
  const menuSnapshot=(input,consume)=>withCartContext(native=>{
    const state=restaurant(),optionMenu=state.config.menu?publicRestaurantMenu(state.config,state.products):null,products=optionMenu?[]:publicOrderingMenu(state.products,state.config),table=resolveTable(db,state.config,input),storeId=storeIdentity()
    const cartContext=native?cartContexts.context({storeId,epoch:native.epoch,table,key:input.key,menu:optionMenu,products}):undefined
    return consume({state,optionMenu,products,table,storeId,cartContext})
  })
  app.use((req,res,next)=>{
    if(closing)return res.status(503).json({success:false,error:'店面正在關閉，請稍後重試'})
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
    next()
  })
  app.use('/menu',express.static(path.join(__dirname,'../public/menu')))
  app.use('/i18n',express.static(path.join(__dirname,'../public/i18n')))
  app.use('/agent',express.static(path.join(__dirname,'../dist/agent')))
  app.get('/.well-known/pos-agent.json',(_req,res)=>res.sendFile(path.join(__dirname,'../dist/.well-known/pos-agent.json'),{dotfiles:'allow'}))
  app.get('/llms.txt',(_req,res)=>res.sendFile(path.join(__dirname,'../dist/llms.txt')))
  app.get('/.well-known/pos-business-exchange',(_req,res)=>res.json({protocol:'pos-business-exchange-discovery/v1',catalogue:'/api/catalogue',manifest:'/agent/manifest.json',guide:'/llms.txt',humanReviewRequired:true,anonymousWrites:false}))
  app.get('/api/menu',(req,res)=>{try{
    const result=menuSnapshot(req.query,({state,optionMenu,products,table,storeId,cartContext})=>{
    const storeName=db.getSetting('storeName')
    return {success:true,products,categories:[...new Set((optionMenu?.offers||products).map(p=>p.category))],storeId,storeName:storeName||'商店',storeNameIsDefault:!storeName,...(optionMenu?{menu:optionMenu}:{}),...(table?{table}:{}),...(cartContext?{cartContext}:{}),...(state.config.enabled&&state.config.tableOrdering?.enabled?{tableRequired:true}:{})}
    });res.json(result)
  }catch(error){res.status(400).json({success:false,error:error.message})}})
  app.get('/api/catalogue',async(_req,res)=>res.json(await db.getPublicCatalogue()))
  const admitCustomer=(req,res,next)=>{
    try {
      const origin=new URL(req.get('origin'))
      if (!['http:','https:'].includes(origin.protocol)||origin.host!==req.get('host')||req.get('sec-fetch-site')==='cross-site')
        return res.status(403).json({success:false,error:'拒絕跨站請求'})
    } catch {return res.status(403).json({success:false,error:'缺少有效來源'})}
    if (!req.is('application/json')) return res.status(415).json({success:false,error:'請使用 JSON'})
    const now=Date.now(),isQuote=req.path==='/api/menu/quote',key=req.socket.remoteAddress+(isQuote?':quote':':order')
    for (const [ip,state] of limits) if(now-state.start>=60000) limits.delete(ip)
    if (!limits.has(key)&&limits.size>=1000) return res.sendStatus(429)
    const state=limits.get(key)||{start:now,count:0};limits.set(key,state)
    if (++state.count>(isQuote?120:30)) return res.status(429).json({success:false,error:'送單過於頻繁，請稍後再試'})
    next()
  }
  app.post('/api/menu/quote',admitCustomer,express.json({limit:'32kb',strict:true}),(req,res)=>{try{
    if(!req.body||Object.keys(req.body).some(key=>!['items','table','key'].includes(key)))throw Error('選項需要核對')
    const result=menuSnapshot(req.body,({state,table,cartContext})=>{
    if(state.config.enabled&&state.config.tableOrdering?.enabled&&!table)throw Error('桌號需要核對')
    const menuReview=db.withRestaurantMenuQuote({items:req.body.items},preview=>{
      if(!preview.availability.available)throw Error('數量需要核對')
      return publicReview.quote(preview.menuReview,menuQuoteKey)
    })
    return {success:true,menuReview,...(cartContext?{cartContext}:{})}
    });res.json(result)
  }catch{res.status(400).json({success:false,committed:false,error:'餐點選項或可用量已變更，請重新確認。'})}})
  app.post('/api/order',admitCustomer,express.json({limit:'32kb',strict:true}),(req,res)=>{
    try {
      if(closing)return res.status(503).json({success:false,error:'店面正在關閉，請稍後重試'})
      const persist=()=>{
      const signature=digest(JSON.stringify(req.body))
      const old=typeof req.body?.requestId==='string' ? db.getOrder('CO'+req.body.requestId) : null
      let order
      if (old) {
        if(old.requestSignature!==signature)throw Object.assign(Error('請求編號已使用，請先核對原訂單'),{status:409})
        order=old
      } else {
        if(typeof req.body?.requestId==='string')db.assertCustomerOrderAvailable?.('CO'+req.body.requestId)
        const {state,table,products:menu}=menuSnapshot(req.body,snapshot=>{
          cartContexts.assertCurrent(req.get('X-POS-Cart-Scope'),req.get('X-POS-Cart-Revision'),snapshot.cartContext)
          return snapshot
        })
        if(state.config.enabled&&state.config.tableOrdering?.enabled&&!table)throw Error('請掃描桌上的點餐碼')
        if(table&&req.body.tableNum!==undefined&&req.body.tableNum!==table.label)throw Error('桌號與桌碼不符，請重新掃描')
        if(state.config.menu){
          if(req.body.menuProtocol!==PUBLIC_MENU_PROTOCOL)throw Error('請先核對選餐')
          order=db.withRestaurantMenuQuote({items:req.body.items},preview=>{
            const menuReview=publicReview.verify(req.body,preview,menuQuoteKey,Date.now()),items=req.body.menuReview.items,total=req.body.menuReview.totalCents/100
            return {id:'CO'+req.body.requestId,items:structuredClone(items),subtotal:total,discount:0,total,payMethod:'pending',paid:0,change:0,memberId:null,pointsUsed:0,pointsEarned:0,time:new Date().toISOString(),source:'customer',status:'pending',tableNum:table?.label||req.body.tableNum||'',note:(req.body.customerName?req.body.customerName+': ':'')+(req.body.note||''),customerMenu:{protocol:CUSTOMER_MENU_PROTOCOL,menuReview,request:structuredClone(req.body)}}
          })
        }else{
          if(req.body.menuProtocol!==undefined||req.body.menuReview!==undefined)throw Error('菜單已變更')
          order=prepareCustomerOrder({...req.body,...(table?{tableNum:table.label}:{})},menu);assertPublicRecipeAvailability(order.items,state.products,state.config)
        }
        order.requestSignature=signature
        if(table){order.tableId=table.id;order.tableSignature=req.body.key}
      }
      let token=null
      if(old?.trackingProof){try{token=trackingProof.open(db,old)}catch{throw Object.assign(Error('原單追蹤資料需要店家核對，請保留原請求編號'),{status:409})}}
      if(!token){let secret=db.getSetting('orderTrackingSecret');if(!secret){secret=randomBytes(32).toString('hex');db.setSetting('orderTrackingSecret',secret)};token=createHmac('sha256',secret).update(order.id).digest('hex')}
      if(old&&!same(old.trackingTokenHash,digest(token)))throw Object.assign(Error('原單追蹤資料需要店家核對，請保留原請求編號'),{status:409})
      if (!old) {
        order.trackingTokenHash=digest(token);order.trackingProof=trackingProof.seal(db,order,token)
        if (db.addOrder(order)?.success!==true) throw new Error('save failed')
      }
      return {order,created:!old,response:{success:true,orderId:order.id,total:order.total,trackingToken:token}}
      }
      const saved=typeof db.withCustomerOrderTransaction==='function'?db.withCustomerOrderTransaction(persist):persist()
      if(saved.created){
        try{const w=getMainWindow();if(w&&!w.isDestroyed())w.webContents.send('customer-order:new',saved.order)}catch{}
      }
      res.json(saved.response)
    } catch(error){const uncertain=error.status===409||error.historyUncertain;res.status(uncertain?409:400).json({success:false,committed:uncertain?null:false,...(!uncertain&&error.cartContextCode?{code:error.cartContextCode}:{}),error:uncertain?'原訂單需要店家核對，請勿重新下單':error.cartContextCode?error.message:'送單未完成，請確認品項、數量與庫存後重試'})}
  })
  app.get('/api/order/:id',(req,res)=>{
    const order=db.getOrder(req.params.id),token=req.get('authorization')?.replace(/^Bearer /,'')
    if (!order || order.source!=='customer' || !token || !same(order.trackingTokenHash,digest(token)))
      return res.status(404).json({success:false,error:'找不到訂單'})
    const progress=customerOrderView(order,restaurant().entries)
    res.json({success:true,order:{id:order.id,status:progress.status,total:order.total,...(progress.fulfilmentStatus?{fulfilmentStatus:progress.fulfilmentStatus,pickupNumber:progress.pickupNumber}:{})}})
  })
  app.get('/api/info',(_req,res)=>res.json({storeId:storeIdentity(),storeName:db.getSetting('storeName')||'商店',version:require('../package.json').version}))
  app.use((err,_req,res,_next)=>res.status(err.type==='entity.too.large'?413:400).json({success:false,error:'請求格式或大小不符'}))
  let server,stopServer,tunnelUrl=null,tunnelStop=null
  const ready=new Promise((resolve,reject)=>{
    server=app.listen(port,options.host||'0.0.0.0',error=>error?reject(error):resolve(server))
    stopServer=require('./serverShutdown.cjs')(server)
    server.on('error',reject);server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=50
  })
  ready.then(()=>{
    if (closing || db.getSetting('publicOrderingEnabled')!=='true' || options.disableTunnel) return
    try {
      const {bin}=require('cloudflared'),{execFile}=require('node:child_process')
      const child=execFile(bin,['tunnel','--url',`http://localhost:${server.address().port}`,'--no-autoupdate'],{windowsHide:true})
      tunnelStop=()=>new Promise((resolve,reject)=>{
        if(child.exitCode!==null||child.signalCode!==null)return resolve()
        const finish=error=>{clearTimeout(timer);child.removeListener('exit',exited);child.removeListener('error',failed);error?reject(error):resolve()}
        const exited=()=>finish(),failed=error=>finish(error)
        const timer=setTimeout(()=>finish(Error('對外連線尚未停止')),5000)
        child.once('exit',exited);child.once('error',failed)
        try{if(!child.kill())finish(Error('無法停止對外連線'))}catch(error){finish(error)}
      })
      child.stderr?.on('data',data=>{const m=String(data).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(m)tunnelUrl=m[0]})
      child.on('error',()=>{tunnelUrl=null});child.on('exit',()=>{tunnelUrl=null})
    } catch {tunnelUrl=null}
  }).catch(()=>{})
  return {app,ready,isRunning:()=>!closing&&server.listening,getActualPort:()=>!closing?server.address()?.port||null:null,getTunnelUrl:()=>!closing?tunnelUrl:null,
    close(){
      closing=true
      if(!closeTask)closeTask=(async()=>{await ready.catch(()=>{});await Promise.all([stopServer(),tunnelStop?.()]);tunnelUrl=null})().catch(error=>{closeTask=null;throw error})
      return closeTask
    }}
}
module.exports.prepareCustomerOrder=prepareCustomerOrder
module.exports.publicProduct=publicProduct
