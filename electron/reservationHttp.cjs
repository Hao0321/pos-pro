const express=require('express'),path=require('node:path')
module.exports=function(app,db,admitCustomer,getMainWindow){
 const limits=new Map(),token=req=>req.get('authorization')?.replace(/^Bearer /,''),knownCodes=new Set(['RESERVATION_CONFIG','RESERVATION_HISTORY','RESERVATION_STALE','RESERVATION_FULL','RESERVATION_RECOVERY','RESERVATION_TIME','RESERVATION_STATUS','RESERVATION_ACCESS'])
 app.use('/reserve',express.static(path.join(__dirname,'../public/reserve')))
 app.use('/api/reservations',(req,res,next)=>{
  const now=Date.now(),key=req.socket.remoteAddress
  for(const [id,value]of limits)if(now-value.start>=60000)limits.delete(id)
  if(!limits.has(key)&&limits.size>=1000)return res.sendStatus(429)
  const value=limits.get(key)||{start:now,count:0};limits.set(key,value)
  if(++value.count>180)return res.status(429).json({success:false,committed:false,error:'請稍後再試。'})
  if(typeof db.getPublicReservationContext!=='function')return res.status(503).json({success:false,error:'訂位網站尚未開放。'})
  next()
 })
 function reply(res,work,{privateReceipt=false,write=false}={}){try{res.json(work())}catch(error){const code=knownCodes.has(error.code)?error.code:'RESERVATION_HISTORY';res.status(privateReceipt?404:write?409:400).json({success:false,...(write?{committed:Object.hasOwn(error,'committed')?error.committed:null}:{}),code,error:privateReceipt?'找不到訂位，請使用自己的訂位連結。':knownCodes.has(error.code)?error.message:'訂位暫時無法確認，請保留原編號並聯絡店家。'})}}
 app.get('/api/reservations/context',(_req,res)=>reply(res,()=>db.getPublicReservationContext()))
 app.get('/api/reservations/availability',(req,res)=>reply(res,()=>{if(Object.keys(req.query).some(key=>!['date','partySize','bookingId'].includes(key))||typeof req.query.partySize!=='string'||!/^\d{1,3}$/.test(req.query.partySize))throw Error();return db.getPublicReservationAvailability({date:req.query.date,partySize:Number(req.query.partySize),...(req.query.bookingId?{bookingId:req.query.bookingId}:{})},token(req))}))
 app.get('/api/reservations/:id',(req,res)=>reply(res,()=>db.getPublicReservation(req.params.id,token(req)),{privateReceipt:true}))
 app.post('/api/reservations/operation',admitCustomer,express.json({limit:'8kb',strict:true}),(req,res)=>reply(res,()=>{
  const result=db.applyPublicReservation(req.body,token(req))
  try{const window=getMainWindow();if(window&&!window.isDestroyed())window.webContents.send('reservation:changed')}catch{}
  return result
 },{write:true}))
}
