import {beforeEach,afterEach,test,expect} from 'vitest'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {restaurantMenuFixture,bowl,choose} from '../fixtures/restaurant-menu-v1.mjs'
import legacy from '../fixtures/table-kitchen-v1.json'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {planRestaurant} from '../../electron/restaurantRules.mjs'
import {restaurantMenuAuthorityPreview} from '../../electron/restaurantMenuOriginal.mjs'
import {validateCustomerMenuOrder} from '../../electron/restaurantCustomerMenu.mjs'
import {assertPublicMenuQuote,PUBLIC_MENU_PROTOCOL} from '../../public/menu/menuProtocol.mjs'
import {cartContextHeaders} from '../../public/menu/cartContext.mjs'
const require=createRequire(import.meta.url),start=require('../../electron/orderServer.cjs')
let server,base,seed,config,operations,settings,orders,notifications,db,configId
const cart=()=>[bowl(),bowl(1,{selections:[choose('extras','egg')]}),{offerId:'bowl-set',qty:2}]
const state=()=>({...seed,config,entries:[],operations,orders:[...orders.values()],users:legacy.before.users,menuConfigurationId:configId,now:Date.now(),shifts:[],waste:[],cashLogs:[],settings:{}})
function configure(next){const data=state(),request={id:'public-config-'+randomUUID(),kind:'restaurant',action:'configure',time:new Date().toISOString(),expectedConfig:canonicalSignature(config),config:next},plan=planRestaurant(request,data,legacy.owner,{});config=plan.config;configId=request.id;operations.push(plan.receipt)}
async function listen(){server=start(0,db,()=>({isDestroyed:()=>false,webContents:{send:(...args)=>notifications.push(args)}}),{host:'127.0.0.1',disableTunnel:true});await server.ready;base='http://127.0.0.1:'+server.getActualPort()}
const post=(route,body,origin=base)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)})
async function review(items=cart()){const result=await(await post('/api/menu/quote',{items})).json();expect(result.success,result.error).toBe(true);assertPublicMenuQuote(result.menuReview);return result.menuReview}
const request=q=>({requestId:randomUUID(),menuProtocol:PUBLIC_MENU_PROTOCOL,items:q.input,menuReview:q,customerName:'Guest',tableNum:'',note:'less salt'})
beforeEach(async()=>{seed=restaurantMenuFixture();config={enabled:false,dailyCapacity:100,slotCapacity:100,recipes:{}};operations=[];orders=new Map();settings=new Map();notifications=[];configure({...config,enabled:true,fundsEnabled:true,recipes:seed.config.recipes,menu:seed.menu})
 db={getProducts:()=>seed.products,getRestaurantState:()=>({config,entries:[]}),getSetting:key=>settings.get(key),setSetting:(key,value)=>settings.set(key,value),getOrder:id=>orders.get(id),addOrder:order=>{validateCustomerMenuOrder(order);orders.set(order.id,structuredClone(order));return {success:true}},withCustomerOrderTransaction:fn=>fn(),withRestaurantMenuQuote:(input,consume)=>consume(restaurantMenuAuthorityPreview(input,state()))}
 await listen()
})
afterEach(async()=>{await server.close()})

test('public catalogue and price review expose explicit display fields without private recipes, costs or scope',async()=>{
 const menu=await(await fetch(base+'/api/menu')).json();expect(menu.products).toEqual([]);expect(menu.menu.protocol).toBe(PUBLIC_MENU_PROTOCOL)
 expect(Object.keys(menu.menu.offers[0]).sort()).toEqual(['category','defaultVariantId','groups','id','name','variants'])
 expect(Object.keys(menu.menu.offers[0].variants[0]).sort()).toEqual(['id','name','price']);expect(Object.keys(menu.menu.offers[0].groups[0].choices[0]).sort()).toEqual(['id','max','name','priceDelta'])
 const quoted=await review();expect(quoted.totalCents).toBe(44500);expect(quoted.items).toHaveLength(3)
 const keys=value=>value&&typeof value==='object'?Object.entries(value).flatMap(([key,child])=>[key,...keys(child)]):[]
 expect(keys(quoted).filter(key=>['cost','unitCost','components','recipes','source','scope','epoch','costMode','configurationId','signature'].includes(key))).toEqual([]);expect(orders.size).toBe(0)
})
test('one reviewed selection becomes one source-bound pending original and exact replay after server restart',async()=>{
 const input=request(await review()),first=await(await post('/api/order',input)).json();expect(first).toMatchObject({success:true,total:445});const stored=orders.get(first.orderId);expect(validateCustomerMenuOrder(stored).request).toEqual(input)
 expect(stored.items.map(row=>row.price)).toEqual([100,115,115]);expect(stored.paid).toBe(0)
 await server.close();await listen();const next=structuredClone(config);next.menu.offers[0].variants[0].price=999;configure(next)
 const replay=await(await post('/api/order',input)).json();expect(replay).toEqual(first);expect(orders.size).toBe(1);expect(notifications).toHaveLength(1)
 const status=await(await fetch(base+'/api/order/'+first.orderId,{headers:{Authorization:'Bearer '+first.trackingToken}})).json();expect(Object.keys(status.order).sort()).toEqual(['id','status','total'])
})
test.each(['price','quantity','foreign-token','private-source','unknown-option'])('forged %s cannot become a public original',async kind=>{
 const input=request(await review())
 if(kind==='price'){input.menuReview.items[0].price=1;input.menuReview.totalCents-=9900}
 if(kind==='quantity')input.items[0].qty=2
 if(kind==='foreign-token')input.menuReview.token='0'.repeat(64)
 if(kind==='private-source')input.customerMenu={protocol:'fake'}
 if(kind==='unknown-option'){input.items[0].selections[0].choices=[{id:'not-offered',qty:1}]}
 expect((await post('/api/order',input)).status).toBe(400);expect(orders.size).toBe(0)
})
test('selected repricing invalidates a review but an unselected-offer edit preserves it',async()=>{
 const q=await review([bowl()]),unselected=structuredClone(config);unselected.menu.offers[1].variants[0].price=555;configure(unselected)
 expect(await(await post('/api/order',request(q))).json()).toMatchObject({success:true,total:100})
 const old=await review([bowl()]),selected=structuredClone(config);selected.menu.offers[0].variants[0].price=110;configure(selected)
 expect((await post('/api/order',request(old))).status).toBe(400);expect(orders.size).toBe(1)
})
test('shared ingredients, unsupported plain input and cross-origin quote attempts do not write',async()=>{
 seed.products.find(row=>row.id==='rice').stock=.3
 expect((await post('/api/menu/quote',{items:[bowl(),bowl(1,{selections:[choose('extras','egg')]})]})).status).toBe(400)
 expect((await post('/api/order',{requestId:randomUUID(),items:[{id:'bowl',qty:1}]})).status).toBe(400)
 expect((await post('/api/menu/quote',{items:[bowl()]},'https://untrusted.invalid')).status).toBe(403);expect(orders.size).toBe(0)
})
test('an explicitly free menu meal is reviewed and stored as zero without recording a payment',async()=>{
 const next=structuredClone(config);next.menu.offers[0].variants[0].price=0;configure(next);const q=await review([bowl()]);expect(q.totalCents).toBe(0)
 expect(await(await post('/api/order',request(q))).json()).toMatchObject({success:true,total:0});expect([...orders.values()][0].paid).toBe(0)
})

test('selected quote context binds the current public menu while preserving the exact stored request schema',async()=>{
 db.withCustomerCartContext=fn=>fn({epoch:'current-server-fixture-epoch'})
 const menu=await(await fetch(base+'/api/menu')).json();expect(menu.cartContext.mode).toBe('menu')
 const quoted=await(await post('/api/menu/quote',{items:[bowl()]})).json();expect(quoted.success).toBe(true);expect(quoted.cartContext).toEqual(menu.cartContext)
 const input=request(quoted.menuReview),headers={'Content-Type':'application/json',Origin:base,...cartContextHeaders(quoted.cartContext)}
 const accepted=await(await fetch(base+'/api/order',{method:'POST',headers,body:JSON.stringify(input)})).json();expect(accepted).toMatchObject({success:true,total:100});expect(orders.get(accepted.orderId).customerMenu.request).toEqual(input)
})
