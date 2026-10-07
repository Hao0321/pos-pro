import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { browserStorage, readRecords, writeRecords, RECORD_KEY, DATA_KEYS, acquireBrowserEditor } from '../../src/utils/browserStorage'
import { commitBrowserSale, commitBrowserRefund } from '../../src/utils/browserSales'
import { prepareCheckout } from '../../src/utils/checkoutSafety.mjs'
import { executeFinancial, FINANCIAL_PENDING } from '../../src/utils/financialCommand'
import { addTopup, openShift } from '../../src/utils/dataAccess'
import { initAccounts } from '../../src/utils/accountBootstrap'
import { createBackup, restoreBackup, getBackupList } from '../../src/utils/security'
let map, failWrite
const copy=x=>JSON.parse(JSON.stringify(x))
beforeEach(()=>{
  map=new Map();failWrite=false
  vi.stubGlobal('localStorage',{getItem:k=>map.get(k)??null,setItem:(k,v)=>{if(failWrite)throw new Error('quota');map.set(k,String(v))},removeItem:k=>map.delete(k)})
  vi.stubGlobal('navigator',{locks:{request:async(_name,options,callback)=>typeof options==='function'?options({name:_name}):callback({name:_name})}})
  writeRecords({pos2_products:[{id:'p',name:'商品',price:33.33,stock:10}],pos2_members:[{id:'m',name:'會員',points:100,totalSpent:0,balance:100}],pos2_shifts:[{id:'s',status:'open'}]})
})
afterEach(()=>vi.unstubAllGlobals())
function sale(overrides={}){
  const {data}=readRecords()
  return prepareCheckout({cart:[{id:'p',price:33.33,qty:3}],products:data.pos2_products,members:data.pos2_members,activeMember:{id:'m'},
    openShift:data.pos2_shifts[0],pointsRule:{earn:10,redeem:1},birthdayBonus:100,payMethod:'cash',paid:100,pointsUsed:1,
    opts:{balanceUsed:10},now:new Date('2026-10-06T01:00:00Z'),id:'sale-1',...overrides}).order
}
test('one atomic sale survives reopening and identical replay without another stock or balance change',async()=>{
  const request=sale(),first=await commitBrowserSale(request),again=await commitBrowserSale(copy(request))
  expect(first.success).toBe(true);expect(again.success).toBe(true)
  const {data}=readRecords();expect(data.pos2_orders).toHaveLength(1);expect(data.pos2_products[0].stock).toBe(7);expect(data.pos2_members[0].balance).toBe(90)
})
test.each(['stock','member','rules'])('stale %s data cannot commit the displayed sale',async kind=>{
  const request=sale()
  if(kind==='stock')writeRecords({pos2_products:[{id:'p',name:'商品',price:33.33,stock:1}]})
  if(kind==='member')writeRecords({pos2_members:[{id:'m',name:'會員',points:0,totalSpent:0,balance:0}]})
  if(kind==='rules')browserStorage.setItem('pos_settings_pointsEarnRate','100')
  const before=map.get(RECORD_KEY),result=await commitBrowserSale(request)
  expect(result).toMatchObject({success:false,committed:false});expect(map.get(RECORD_KEY)).toBe(before)
})
test('quota failure preserves the entire previous record',async()=>{
  const request=sale(),before=map.get(RECORD_KEY);failWrite=true
  expect(await commitBrowserSale(request)).toMatchObject({success:false,committed:false});expect(map.get(RECORD_KEY)).toBe(before)
})
test('malformed data fails closed and never becomes an empty store',()=>{
  map.set(RECORD_KEY,'broken');expect(()=>readRecords()).toThrow();expect(()=>writeRecords({pos2_orders:[]})).toThrow();expect(map.get(RECORD_KEY)).toBe('broken')
})
test('legacy records migrate without deleting the source or resetting account versions',async()=>{
  map.delete(RECORD_KEY);map.set('pos_users',JSON.stringify([{id:'custom',username:'自己的名字',password:'custom-hash',role:'owner'}]));map.set('pos_users_version','old')
  expect((await initAccounts())[0].id).toBe('custom');expect(map.get('pos_users_version')).toBe('old');expect(map.has('pos_users')).toBe(true)
})
test('all fourteen data collections restore atomically, including shifts, topups, held orders and audit',async()=>{
  writeRecords(Object.fromEntries(DATA_KEYS.map(key=>[key,[{id:key}]])))
  const backup=await createBackup({username:'測試'},'完整備份');expect(await getBackupList()).toHaveLength(1)
  writeRecords(Object.fromEntries(DATA_KEYS.map(key=>[key,[]])));await restoreBackup(backup.id,{username:'測試'})
  for(const key of DATA_KEYS)expect(readRecords().data[key].some(row=>row.id===key)).toBe(true)
})
test('failed backup does not return a fabricated ID or add an empty snapshot',async()=>{
  failWrite=true;await expect(createBackup({username:'測試'})).rejects.toThrow('quota');expect(map.has('pos_backups')).toBe(false)
})
test('three partial refunds exactly return original money, points and prepaid balance',async()=>{
  const request=sale();expect((await commitBrowserSale(request)).success).toBe(true)
  const refunds=[]
  for(let i=0;i<3;i++){
    const r={id:'r'+i,refundOf:request.id,items:[{id:'p',qty:1}],time:'2026-10-06T02:00:00Z',shiftId:'s'}
    const result=await commitBrowserRefund(r);expect(result.success).toBe(true);refunds.push(result.order)
    expect((await commitBrowserRefund(r)).success).toBe(true)
  }
  const {data}=readRecords();expect(data.pos2_products[0].stock).toBe(10);expect(data.pos2_members[0]).toMatchObject({points:100,totalSpent:0,balance:100})
  expect(data.pos2_orders.find(o=>o.id===request.id).status).toBe('refunded')
  expect(Math.round(refunds.reduce((s,o)=>s+o.total,0)*100)).toBe(-Math.round(request.total*100))
  expect((await commitBrowserRefund({id:'too-much',refundOf:request.id,items:[{id:'p',qty:1}],time:request.time})).success).toBe(false)
})
test.each([-1,0,4,'1',NaN,1.0001])('invalid or excessive refund quantity %s cannot alter a record',async qty=>{
  const request=sale();await commitBrowserSale(request);const before=map.get(RECORD_KEY)
  expect((await commitBrowserRefund({id:'bad',refundOf:request.id,items:[{id:'p',qty}],time:request.time})).success).toBe(false)
  expect(map.get(RECORD_KEY)).toBe(before)
})
test('topup updates the member and its accounting record together and deduplicates the same ID',async()=>{
  const command={id:'topup-1',memberId:'m',amount:100,bonus:5,payMethod:'cash',time:'2026-10-06T00:00:00Z',cashier:''}
  expect((await addTopup(command)).success).toBe(true);expect((await addTopup(command)).success).toBe(true)
  expect(readRecords().data.pos2_members[0].balance).toBe(205);expect(readRecords().data.pos2_topups).toHaveLength(1)
  const before=map.get(RECORD_KEY);failWrite=true;expect((await addTopup({...command,id:'another'})).success).toBe(false);expect(map.get(RECORD_KEY)).toBe(before)
})
test('a lost financial acknowledgement retries the original ID after module-level state is gone',async()=>{
  const seen=[],input={memberId:'m',amount:10,bonus:0,payMethod:'cash'}
  await expect(executeFinancial('topup',input,async r=>{seen.push(r.id);throw new Error('reply lost')})).rejects.toThrow('尚未確認')
  expect(map.has(FINANCIAL_PENDING)).toBe(true)
  await expect(executeFinancial('topup',{...input,amount:20},async()=>({success:true}))).rejects.toThrow('尚未確認')
  await executeFinancial('topup',input,async r=>{seen.push(r.id);return {success:true}})
  expect(seen[0]).toBe(seen[1]);expect(map.has(FINANCIAL_PENDING)).toBe(false)
})
test('an unsupported browser or a second editor cannot silently bypass concurrency protection',async()=>{
  vi.stubGlobal('navigator',{});await expect(acquireBrowserEditor()).rejects.toThrow('交易鎖')
  vi.stubGlobal('navigator',{locks:{request:async(_name,_opts,callback)=>callback(null)}});await expect(acquireBrowserEditor()).rejects.toThrow('另一個')
})
test('browser shift opening is persisted rather than only appearing in React state',async()=>{
  writeRecords({pos2_shifts:[]});await openShift({id:'s2',openCash:500});expect(readRecords().data.pos2_shifts.find(s=>s.id==='s2').status).toBe('open')
})
