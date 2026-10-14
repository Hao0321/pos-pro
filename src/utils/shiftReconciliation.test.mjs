import {describe,it,expect} from 'vitest'
import {summarizeShift} from '../../electron/shiftReconciliation.mjs'
const shift={id:'today',openCash:200},sale=(id,total,extra={})=>({id,total,shiftId:'today',payMethod:'cash',status:'completed',...extra})
describe('drawer reconciliation shared by native and browser',()=>{
  it('keeps each partial refund when the original later becomes fully refunded',()=>{
    const orders=[sale('original',100,{status:'refunded'}),sale('partial',-40,{refundOf:'original'}),sale('last',-60,{refundOf:'original',fullRefund:true})]
    expect(summarizeShift(shift,orders,[])).toEqual({orderCount:1,refundCount:2,refundAmt:100,cash:0,card:0,cashIn:0,cashOut:0,cashTopups:0,cardTopups:0,expected:200})
  })
  it('counts a later-shift refund without removing the previous-shift sale',()=>{
    const rows=[sale('original',100,{shiftId:'yesterday',status:'refunded'}),sale('return',-100,{refundOf:'original',fullRefund:true})]
    expect(summarizeShift(shift,rows,[]).expected).toBe(100)
    expect(summarizeShift({id:'yesterday',openCash:200},rows,[]).expected).toBe(300)
  })
  it('splits signed mixed receipts and includes only the current drawer logs',()=>{
    const rows=[sale('sale',100,{payMethod:'mixed',payments:[{method:'cash',amount:60},{method:'card',amount:40}]}),sale('refund',-50,{refundOf:'sale',payMethod:'mixed',payments:'[{"method":"cash","amount":-30},{"method":"card","amount":-20}]'})]
    const log=[{shiftId:'today',type:'in',amount:100},{shiftId:'today',type:'out',amount:20},{shiftId:'elsewhere',type:'in',amount:999}]
    expect(summarizeShift(shift,rows,log)).toMatchObject({cash:30,card:20,expected:310})
  })
  it('excludes uncollected customer requests and unsettled rows',()=>{
    const rows=[sale('customer',999,{source:'customer'}),sale('pending',999,{payMethod:'pending'}),sale('unsettled',999,{status:'accepted'}),sale('paid',10)]
    expect(summarizeShift(shift,rows,[])).toMatchObject({orderCount:1,cash:10,expected:210})
  })
  it('rejects a corrupt mixed payment instead of inventing a card total',()=>{
    for(const payments of ['bad',[{method:'cash',amount:1}],[{method:'cash',amount:60},{method:'cash',amount:40}],[{method:'cash',amount:-60},{method:'card',amount:160}]])expect(()=>summarizeShift(shift,[sale('bad',100,{payMethod:'mixed',payments})],[])).toThrow(/付款/)
  })
  it('adds currency as integer cents and rejects invalid cash ledger values',()=>{
    expect(summarizeShift({id:'today',openCash:0},[sale('a',.1),sale('b',.2)],[]).expected).toBe(.3)
    for(const amount of [NaN,Infinity,-1])expect(()=>summarizeShift(shift,[],[{shiftId:'today',type:'in',amount}])).toThrow()
  })
})
