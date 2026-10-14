import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {DATA_KEYS,RECORD_KEY,readRecords} from './browserStorage'
import {closeShift} from './dataAccess'
let saved,deny
beforeEach(()=>{
  saved=new Map();deny=false
  vi.stubGlobal('localStorage',{getItem:k=>saved.get(k)??null,setItem:(k,v)=>{if(deny&&k===RECORD_KEY)throw Error('fixture quota');saved.set(k,String(v))},removeItem:k=>saved.delete(k)})
  vi.stubGlobal('navigator',{locks:{request:async(_name,fn)=>fn()}})
  const data=Object.fromEntries(DATA_KEYS.map(k=>[k,[]]))
  data.pos2_shifts=[{id:'s',openCash:200,status:'open'}]
  const sale=(id,total,extra={})=>({id,total,payMethod:'cash',shiftId:'s',status:'completed',...extra})
  data.pos2_orders=[sale('sale',100,{status:'refunded'}),sale('r1',-40,{refundOf:'sale'}),sale('r2',-60,{refundOf:'sale',fullRefund:true})]
  saved.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
})
afterEach(()=>vi.unstubAllGlobals())
test('browser close calculates and persists the same drawer fields as native close',async()=>{
  expect(await closeShift('s',{closeCash:200,expectedCash:99999,note:'fixture'})).toEqual({success:true,expected:200,diff:0})
  expect(readRecords().data.pos2_shifts[0]).toMatchObject({status:'closed',expectedCash:200,diff:0,cashSales:0,cardSales:0,refundCount:2,refundAmount:100,orderCount:1})
})
test('browser close replay after re-reading storage is exactly once and rejects changed content',async()=>{
  await closeShift('s',{closeCash:200,note:'fixture'});const before=saved.get(RECORD_KEY)
  expect(await closeShift('s',{closeCash:200,note:'fixture'})).toEqual({success:true,expected:200,diff:0})
  await expect(closeShift('s',{closeCash:201,note:'fixture'})).rejects.toThrow(/內容不同/)
  expect(saved.get(RECORD_KEY)).toBe(before)
})
test('quota failure leaves all fourteen collections and the open drawer intact',async()=>{
  const before=saved.get(RECORD_KEY);deny=true
  await expect(closeShift('s',{closeCash:200,note:''})).rejects.toThrow(/quota/)
  expect(saved.get(RECORD_KEY)).toBe(before);expect(readRecords().data.pos2_shifts[0].status).toBe('open')
})
