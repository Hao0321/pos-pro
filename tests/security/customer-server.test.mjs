import { beforeEach, afterEach, test, expect } from 'vitest'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
const require=createRequire(import.meta.url),start=require('../../electron/orderServer.cjs')
let server,base,orders,notifications,settings
beforeEach(async()=>{
  orders=new Map();notifications=[];settings=new Map()
  const db={getProducts:()=>[{id:'p',name:'商品',price:12,stock:5,cost:3,supplierId:'private',barcode:'private',unit:'個',category:'餐點'}],getSetting:k=>settings.get(k),setSetting:(k,v)=>settings.set(k,v),getOrder:id=>orders.get(id),addOrder:o=>{orders.set(o.id,o);return {success:true}}}
  server=start(0,db,()=>({isDestroyed:()=>false,webContents:{send:(...args)=>notifications.push(args)}}),{host:'127.0.0.1',disableTunnel:true})
  await server.ready;base='http://127.0.0.1:'+server.getActualPort()
})
afterEach(async()=>{await server.close()})
const body=()=>({requestId:randomUUID(),items:[{id:'p',qty:2}],customerName:'顧客'})
const post=(data,headers={})=>fetch(base+'/api/order',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(data)})
test('public menu exposes only display fields and no wildcard cross-origin grants',async()=>{
  const r=await fetch(base+'/api/menu'),data=await r.json();expect(data.products[0].cost).toBeUndefined();expect(data.products[0].supplierId).toBeUndefined();expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull()
  expect(server.getTunnelUrl()).toBeNull();expect(server.broadcast).toBeUndefined()
})
test('same request ID deduplicates notifications and persists authoritative pricing',async()=>{
  const request=body();request.items[0].price=0.01
  const first=await (await post(request)).json(),second=await (await post(request)).json()
  expect(first).toMatchObject({success:true,total:24});expect(second).toEqual(first);expect(orders.size).toBe(1);expect(notifications).toHaveLength(1)
  expect((await post({...request,items:[{id:'p',qty:1}]})).status).toBe(409)
})
test('only the bearer capability can read its own minimal order status',async()=>{
  const result=await (await post(body())).json(),url=base+'/api/order/'+result.orderId
  expect((await fetch(url)).status).toBe(404);expect((await fetch(url,{headers:{Authorization:'Bearer wrong'}})).status).toBe(404)
  const r=await fetch(url,{headers:{Authorization:'Bearer '+result.trackingToken}}),data=await r.json()
  expect(Object.keys(data.order).sort()).toEqual(['id','status','total']);expect(JSON.stringify([...orders.values()])).not.toContain(result.trackingToken)
})
test.each([-1,0,6,'1',1.5,null])('invalid quantity %s never persists an order',async qty=>{
  const request=body();request.items[0].qty=qty;expect((await post(request)).status).toBe(400);expect(orders.size).toBe(0)
})
test('duplicate items, oversized payloads, cross-site and missing origins are rejected',async()=>{
  const request=body();request.items.push({...request.items[0]});expect((await post(request)).status).toBe(400)
  expect((await post(body(),{Origin:'https://attacker.invalid'})).status).toBe(403)
  expect((await post(body(),{Origin:''})).status).toBe(403)
  expect((await post(body(),{'Content-Type':'text/plain'})).status).toBe(415)
  expect((await post({...body(),note:'x'.repeat(40000)})).status).toBe(413);expect(orders.size).toBe(0)
})
test('rate limiting applies before order parsing',async()=>{
  for(let i=0;i<30;i++)await post({})
  expect((await post(body())).status).toBe(429);expect(orders.size).toBe(0)
})

test('a bind failure is rejected and never advertised as a running ordering server',async()=>{
  expect(server.isRunning()).toBe(true)
  const blocked=start(server.getActualPort(),{},()=>null,{host:'127.0.0.1',disableTunnel:true})
  await expect(blocked.ready).rejects.toMatchObject({code:'EADDRINUSE'})
  expect(blocked.isRunning()).toBe(false);expect(blocked.getActualPort()).toBeNull()
  await blocked.close()
})
