import {test,expect,beforeEach,afterEach} from 'vitest'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {assertCartContext,cartContextHeaders} from '../../public/menu/cartContext.mjs'
import {beginCustomerRequest,confirmCustomerRequest,readCustomerJournal,CUSTOMER_JOURNAL} from '../../public/menu/orderJournal.mjs'
import {restaurantMenuFixture} from '../fixtures/restaurant-menu-v1.mjs'
const require=createRequire(import.meta.url),cartContexts=require('../../electron/customerCartContext.cjs'),start=require('../../electron/orderServer.cjs')
let db,server,base,products,config,epoch,settings,orders,commits
const plain=()=>({requestId:randomUUID(),items:[{id:'bowl',qty:1}],customerName:'Guest',tableNum:'',note:''})
const post=(body,headers={})=>fetch(base+'/api/order',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)})
const menu=async()=>await(await fetch(base+'/api/menu')).json()
beforeEach(async()=>{
 const seed=restaurantMenuFixture();products=seed.products;config={enabled:true,dailyCapacity:100,slotCapacity:100,recipes:seed.config.recipes};epoch='actual-test-epoch';settings=new Map([['sharedStoreId','test-store']]);orders=new Map();commits=0
 let transaction=0
 db={getProducts:()=>products,getRestaurantState:()=>({config,entries:[]}),getSetting:key=>settings.get(key),setSetting:(key,value)=>settings.set(key,value),getOrder:id=>orders.get(id),addOrder:order=>{expect(transaction).toBeGreaterThan(0);orders.set(order.id,structuredClone(order));commits++;return {success:true}},withCustomerOrderTransaction:fn=>{transaction++;try{return fn()}finally{transaction--}},withCustomerCartContext:fn=>fn({epoch})}
 // The OS can assign a port forbidden by Fetch. Pick another isolated port;
 // retain the real Fetch client and never bypass its browser safety rules.
 for(let attempt=0;attempt<4;attempt++){
  server=start(0,db,()=>null,{host:'127.0.0.1',disableTunnel:true});await server.ready;base='http://127.0.0.1:'+server.getActualPort()
  try{await fetch(base+'/api/menu');break}catch(error){await server.close();if(error.cause?.message!=='bad port'||attempt===3)throw error}
 }
})
afterEach(async()=>{await server.close()})

test('public context is opaque, stable for stock/category changes and independent of product enumeration order',async()=>{
 const first=await menu();expect(Object.keys(assertCartContext(first.cartContext)).sort()).toEqual(['mode','protocol','revision','scopeId']);expect(JSON.stringify(first.cartContext)).not.toContain(epoch)
 products=products.map(product=>({...product,stock:product.stock+1,category:'new category'})).reverse();expect((await menu()).cartContext).toEqual(first.cartContext)
 products.find(product=>product.id==='bowl').name='New name';expect((await menu()).cartContext.revision).not.toBe(first.cartContext.revision)
})
test('new ordinary requests cannot use the previously reviewed amount after repricing',async()=>{
 const before=await menu(),input=plain();products.find(product=>product.id==='bowl').price=120;const unchanged=structuredClone(products)
 const rejected=await post(input,cartContextHeaders(before.cartContext));expect(rejected.status).toBe(400);expect(await rejected.json()).toMatchObject({committed:false,code:'CART_REVIEW_CHANGED'});expect(orders.size).toBe(0)
 const current=await menu(),accepted=await(await post(input,cartContextHeaders(current.cartContext))).json();expect(accepted).toMatchObject({success:true,total:120});expect(orders.get(accepted.orderId).paid).toBe(0);expect(products).toEqual(unchanged);expect(commits).toBe(1)
})
test.each(['scope-only','revision-only','invalid','foreign','old-epoch'])('declared %s context cannot authorize a new order',async kind=>{
 const current=await menu(),headers=cartContextHeaders(current.cartContext)
 if(kind==='scope-only')delete headers['X-POS-Cart-Revision']
 if(kind==='revision-only')delete headers['X-POS-Cart-Scope']
 if(kind==='invalid')headers['X-POS-Cart-Revision']='invalid'
 if(kind==='foreign')headers['X-POS-Cart-Scope']='0'.repeat(64)
 if(kind==='old-epoch')epoch='replacement-epoch'
 const before=structuredClone(products),response=await post(plain(),headers);expect(response.status).toBe(400);expect(await response.json()).toMatchObject({committed:false,code:'CART_CONTEXT_CHANGED'});expect(orders.size).toBe(0);expect(products).toEqual(before)
})
test('an accepted original precedes current generation, prices and even malformed new headers; changed body remains uncertain',async()=>{
 const current=await menu(),input=plain(),first=await(await post(input,cartContextHeaders(current.cartContext))).json();expect(first.success).toBe(true)
 epoch='replacement';products.find(product=>product.id==='bowl').price=999
 expect(await(await post(input,{'X-POS-Cart-Scope':'invalid'})).json()).toEqual(first);expect(commits).toBe(1)
 const changed=await post({...input,note:'different'},cartContextHeaders(current.cartContext));expect(changed.status).toBe(409);expect((await changed.json()).committed).toBe(null);expect(commits).toBe(1)
})
test('legacy omission remains explicit and does not pretend to provide new review guarantees',async()=>{
 await menu();products.find(product=>product.id==='bowl').price=120
 expect(await(await post(plain())).json()).toMatchObject({success:true,total:120})
})
test('table capability, store, restored generation and menu mode change scope while displayed terms only change revision',()=>{
 const input={storeId:'store',epoch:'epoch',table:{id:'one',label:'1'},key:'a'.repeat(64),products:[{id:'bowl',name:'Bowl',price:100,unit:'份'}]},first=cartContexts.context(input)
 for(const next of [{...input,epoch:'other'},{...input,storeId:'other'},{...input,key:'b'.repeat(64)},{...input,table:{id:'two',label:'2'}},{...input,menu:{offers:[]}}])expect(cartContexts.context(next).scopeId).not.toBe(first.scopeId)
 expect(cartContexts.context({...input,products:[{...input.products[0],unit:'碗'}]}).scopeId).toBe(first.scopeId)
 expect(cartContexts.context({...input,products:[{...input.products[0],unit:'碗'}]}).revision).not.toBe(first.revision)
})
test('journal context is immutable on reload and a mismatched ordinary acknowledgement preserves pending original bytes',async()=>{
 const value=(await menu()).cartContext,request=plain(),quote=[{id:'bowl',name:'Bowl',price:100,qty:1}],values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
 beginCustomerRequest(storage,'test-store',request,quote,{cartContext:value});const before=storage.getItem(CUSTOMER_JOURNAL);expect(readCustomerJournal(storage).cartContext).toEqual(value)
 expect(()=>confirmCustomerRequest(storage,request,{success:true,orderId:'CO'+request.requestId,total:120,trackingToken:'a'.repeat(64)})).toThrow();expect(storage.getItem(CUSTOMER_JOURNAL)).toBe(before)
 expect(()=>beginCustomerRequest(storage,'test-store',request,quote,{cartContext:{...value,revision:'0'.repeat(64)}})).toThrow();expect(storage.getItem(CUSTOMER_JOURNAL)).toBe(before)
 confirmCustomerRequest(storage,request,{success:true,orderId:'CO'+request.requestId,total:100,trackingToken:'a'.repeat(64)});expect(readCustomerJournal(storage).phase).toBe('confirmed')
})
test('a malformed or wrong-mode context is retained as invalid rather than silently downgraded to a legacy journal',async()=>{
 const context=(await menu()).cartContext,request=plain(),quote=[{id:'bowl',name:'Bowl',price:100,qty:1}],values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
 expect(()=>beginCustomerRequest(storage,'test-store',request,quote,{cartContext:{...context,mode:'menu'}})).toThrow();expect(storage.getItem(CUSTOMER_JOURNAL)).toBe(null)
 beginCustomerRequest(storage,'test-store',request,quote,{cartContext:context});const bad=JSON.parse(storage.getItem(CUSTOMER_JOURNAL));bad.cartContext.revision='broken';const bytes=JSON.stringify(bad);storage.setItem(CUSTOMER_JOURNAL,bytes);expect(()=>readCustomerJournal(storage)).toThrow();expect(storage.getItem(CUSTOMER_JOURNAL)).toBe(bytes)
})
