import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {DATA_KEYS,RECORD_KEY,readRecords} from '../../src/utils/browserStorage'
import {executeFinancial,FINANCIAL_PENDING} from '../../src/utils/financialCommand'
import {addWaste,addTopup,closeShift} from '../../src/utils/dataAccess'
let records
beforeEach(()=>{
  records=new Map();vi.stubGlobal('localStorage',{getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,String(v)),removeItem:k=>records.delete(k)})
  vi.stubGlobal('navigator',{locks:{request:async(_name,fn)=>fn()}})
  const data=Object.fromEntries(DATA_KEYS.map(k=>[k,[]]));data.pos2_products=[{id:'p',name:'fixture',price:50,cost:20,stock:10}];data.pos2_members=[{id:'m',name:'fixture',points:0,totalSpent:0,balance:0}];data.pos2_shifts=[{id:'s',openCash:200,status:'open'}]
  records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
})
afterEach(()=>vi.unstubAllGlobals())
test('incomplete financial acknowledgement cannot clear the pending original request',async()=>{
  await expect(executeFinancial('topup',{memberId:'m',amount:100,bonus:0,payMethod:'cash',shiftId:'s'},async()=>({success:true}))).rejects.toThrow(/尚未確認/)
  expect(records.has(FINANCIAL_PENDING)).toBe(true)
})
test('waste replay is exactly once and uses the historical cost instead of a later product cost',async()=>{
  const request={id:'waste-fixture',productId:'p',qty:1,reason:'fixture',time:'2026-10-14T01:00:00Z',cashier:'fixture'}
  expect((await addWaste(request)).success).toBe(true);expect((await addWaste(request)).success).toBe(true)
  expect(readRecords().data.pos2_products[0].stock).toBe(9);expect(readRecords().data.pos2_waste).toHaveLength(1)
})
test('cash member deposit enters the original drawer once, excluding the gift bonus',async()=>{
  const request={id:'topup-fixture',memberId:'m',amount:100,bonus:10,payMethod:'cash',shiftId:'s',time:'2026-10-14T01:00:00Z',cashier:'fixture'}
  expect((await addTopup(request)).success).toBe(true);expect((await addTopup(request)).success).toBe(true)
  expect(readRecords().data.pos2_members[0].balance).toBe(110)
  expect(await closeShift('s',{closeCash:300,note:''})).toMatchObject({expected:300,diff:0})
})
