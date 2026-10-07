const express = require('express')
const path = require('node:path')
const {randomBytes,createHash,createHmac,timingSafeEqual} = require('node:crypto')
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
  const app=express(),limits=new Map()
  app.disable('x-powered-by')
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
    next()
  })
  app.use('/menu',express.static(path.join(__dirname,'../public/menu')))
  app.get('/api/menu',(_req,res)=>{
    const products=db.getProducts().filter(p=>p.stock>0&&p.price>0).map(publicProduct)
    res.json({success:true,products,categories:[...new Set(products.map(p=>p.category))],storeName:db.getSetting('storeName')||'商店'})
  })
  app.post('/api/order',(req,res,next)=>{
    try {
      const origin=new URL(req.get('origin'))
      if (!['http:','https:'].includes(origin.protocol)||origin.host!==req.get('host')||req.get('sec-fetch-site')==='cross-site')
        return res.status(403).json({success:false,error:'拒絕跨站請求'})
    } catch {return res.status(403).json({success:false,error:'缺少有效來源'})}
    if (!req.is('application/json')) return res.status(415).json({success:false,error:'請使用 JSON'})
    const now=Date.now(),key=req.socket.remoteAddress
    for (const [ip,state] of limits) if(now-state.start>=60000) limits.delete(ip)
    if (!limits.has(key)&&limits.size>=1000) return res.sendStatus(429)
    const state=limits.get(key)||{start:now,count:0};limits.set(key,state)
    if (++state.count>30) return res.status(429).json({success:false,error:'送單過於頻繁，請稍後再試'})
    next()
  },express.json({limit:'32kb',strict:true}),(req,res)=>{
    try {
      const signature=digest(JSON.stringify(req.body))
      const old=typeof req.body?.requestId==='string' ? db.getOrder('CO'+req.body.requestId) : null
      let order
      if (old) {
        if(old.requestSignature!==signature) return res.status(409).json({success:false,error:'請求編號已使用，請先核對原訂單'})
        order=old
      } else {order=prepareCustomerOrder(req.body,db.getProducts());order.requestSignature=signature}
      let secret=db.getSetting('orderTrackingSecret')
      if (!secret) {secret=randomBytes(32).toString('hex');db.setSetting('orderTrackingSecret',secret)}
      const token=createHmac('sha256',secret).update(order.id).digest('hex')
      if (!old) {
        order.trackingTokenHash=digest(token)
        if (db.addOrder(order)?.success!==true) throw new Error('save failed')
        const w=getMainWindow()
        if (w&&!w.isDestroyed()) w.webContents.send('customer-order:new',order)
      }
      res.json({success:true,orderId:order.id,total:order.total,trackingToken:token})
    } catch {res.status(400).json({success:false,error:'送單未完成，請確認品項、數量與庫存後重試'})}
  })
  app.get('/api/order/:id',(req,res)=>{
    const order=db.getOrder(req.params.id),token=req.get('authorization')?.replace(/^Bearer /,'')
    if (!order || order.source!=='customer' || !token || !same(order.trackingTokenHash,digest(token)))
      return res.status(404).json({success:false,error:'找不到訂單'})
    res.json({success:true,order:{id:order.id,status:order.status,total:order.total}})
  })
  app.get('/api/info',(_req,res)=>res.json({storeName:db.getSetting('storeName')||'商店',version:require('../package.json').version}))
  app.use((err,_req,res,_next)=>res.status(err.type==='entity.too.large'?413:400).json({success:false,error:'請求格式或大小不符'}))
  let server,tunnelUrl=null,tunnelStop=null
  const ready=new Promise((resolve,reject)=>{
    server=app.listen(port,options.host||'0.0.0.0',error=>error?reject(error):resolve(server))
    server.on('error',reject);server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=50
  })
  ready.then(()=>{
    if (db.getSetting('publicOrderingEnabled')!=='true' || options.disableTunnel) return
    try {
      const {bin}=require('cloudflared'),{execFile}=require('node:child_process')
      const child=execFile(bin,['tunnel','--url',`http://localhost:${server.address().port}`,'--no-autoupdate'],{windowsHide:true})
      tunnelStop=()=>child.kill()
      child.stderr?.on('data',data=>{const m=String(data).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(m)tunnelUrl=m[0]})
      child.on('error',()=>{tunnelUrl=null});child.on('exit',()=>{tunnelUrl=null})
    } catch {tunnelUrl=null}
  }).catch(()=>{})
  return {app,ready,isRunning:()=>server.listening,getActualPort:()=>server.address()?.port||null,getTunnelUrl:()=>tunnelUrl,
    close:async()=>{tunnelStop?.();await new Promise(resolve=>server.close(resolve))}}
}
module.exports.prepareCustomerOrder=prepareCustomerOrder
module.exports.publicProduct=publicProduct
