import {test,expect,beforeEach} from 'vitest'
import {CUSTOMER_JOURNAL,readCustomerJournal,beginCustomerRequest,confirmCustomerRequest,clearCustomerRequest,rejectUncommittedRequest,customerQuoteTotal,assertCustomerProgress} from '../../public/menu/orderJournal.mjs'
let rows,storage
const request=()=>({requestId:'22222222-2222-4222-8222-222222222222',items:[{id:'bowl',qty:3}],customerName:'Guest',tableNum:'5',note:''}),quote=()=>[{id:'bowl',name:'Rice bowl',price:.1,qty:3}],ack=()=>({success:true,orderId:'CO'+request().requestId,total:.3,trackingToken:'a'.repeat(64)})
beforeEach(()=>{rows=new Map();storage={getItem:key=>rows.has(key)?rows.get(key):null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)}})
test('request and exact cents survive a new journal reader before any submission',()=>{
 const saved=beginCustomerRequest(storage,'shop',request(),quote());expect(customerQuoteTotal(saved.quote)).toBe(.3);expect(readCustomerJournal(storage)).toEqual(saved);expect(beginCustomerRequest(storage,'shop',request(),quote())).toEqual(saved)
 const raw=storage.getItem(CUSTOMER_JOURNAL);expect(()=>clearCustomerRequest(storage,request().requestId)).toThrow();expect(storage.getItem(CUSTOMER_JOURNAL)).toBe(raw)
})
test('a full original acknowledgement is durable before the confirmed request can be cleared',()=>{
 beginCustomerRequest(storage,'shop',request(),quote());const confirmed=confirmCustomerRequest(storage,request(),ack());expect(confirmed.phase).toBe('confirmed');expect(readCustomerJournal(storage)).toEqual(confirmed);expect(confirmCustomerRequest(storage,request(),ack())).toEqual(confirmed);clearCustomerRequest(storage,request().requestId);expect(readCustomerJournal(storage)).toBeNull()
})
test.each([
 ['wrong original',a=>a.orderId='COother'],['missing token',a=>delete a.trackingToken],['bad token',a=>a.trackingToken='invalid'],['missing amount',a=>delete a.total],['zero amount',a=>a.total=0],['non-number amount',a=>a.total='.3'],['nonfinite amount',a=>a.total=NaN],['fractional cent',a=>a.total=.301],
])('an acknowledgement with%s keeps the exact pending bytes',(_label,change)=>{
 beginCustomerRequest(storage,'shop',request(),quote());const raw=storage.getItem(CUSTOMER_JOURNAL),a=ack();change(a);expect(()=>confirmCustomerRequest(storage,request(),a)).toThrow();expect(storage.getItem(CUSTOMER_JOURNAL)).toBe(raw)
})
test('another shop, changed contents and a second request cannot replace the original',()=>{
 beginCustomerRequest(storage,'shop',request(),quote());const raw=storage.getItem(CUSTOMER_JOURNAL)
 for(const [shop,r]of [['other-shop',request()],['shop',{...request(),note:'changed'}],['shop',{...request(),requestId:'33333333-3333-4333-8333-333333333333'}]])expect(()=>beginCustomerRequest(storage,shop,r,quote())).toThrow()
 expect(storage.getItem(CUSTOMER_JOURNAL)).toBe(raw)
})
test('quota and corruption preserve the original evidence rather than returning a successful write',()=>{
 storage.setItem=()=>{throw Error('quota')};expect(()=>beginCustomerRequest(storage,'shop',request(),quote())).toThrow();expect(rows.size).toBe(0)
 rows.set(CUSTOMER_JOURNAL,'{damaged');expect(()=>readCustomerJournal(storage)).toThrow();expect(()=>beginCustomerRequest(storage,'shop',request(),quote())).toThrow();expect(rows.get(CUSTOMER_JOURNAL)).toBe('{damaged')
})
test('an explicit uncommitted rejection releases only that pending original',()=>{
 beginCustomerRequest(storage,'shop',request(),quote());expect(()=>rejectUncommittedRequest(storage,{...request(),note:'other'})).toThrow();rejectUncommittedRequest(storage,request());expect(readCustomerJournal(storage)).toBeNull()
 beginCustomerRequest(storage,'shop',request(),quote());confirmCustomerRequest(storage,request(),ack());expect(()=>rejectUncommittedRequest(storage,request())).toThrow()
})
test('minimal original progress and a real pickup number are validated before being shown',()=>{
 const order={id:ack().orderId,total:.3,status:'accepted',fulfilmentStatus:'ready',pickupNumber:1};expect(assertCustomerProgress(ack(),{success:true,order})).toEqual(order)
 for(const change of [o=>o.status='completed',o=>o.pickupNumber='1',o=>o.pickupNumber=0,o=>o.total=0,o=>o.id='other',o=>o.fulfilmentStatus='unknown']){const invalid={...order};change(invalid);expect(()=>assertCustomerProgress(ack(),{success:true,order:invalid})).toThrow()}
})
