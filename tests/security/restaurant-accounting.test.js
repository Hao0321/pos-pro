import {test,expect} from 'vitest'
import {orderToJournalEntries,buildPnL} from '../../src/utils/accounting'
import * as accounting from '../../src/utils/accounting'
test('mixed receipts place each real tender in its own cash or bank account',()=>{
  const entries=orderToJournalEntries({id:'sale',total:95,payMethod:'mixed',payments:[{method:'cash',amount:50},{method:'card',amount:45}],items:[],time:'2026-10-14T01:00:00Z'},[])
  expect(entries[0].lines.find(l=>l.account==='1101')?.debit).toBe(50);expect(entries[0].lines.find(l=>l.account==='1103')?.debit).toBe(45)
})
test('a cancelled cooked order keeps the actual ingredient loss after sales and COGS reverse',()=>{
  const products=[{id:'bowl',cost:40}],sale={id:'sale',total:95,payMethod:'cash',items:[{id:'bowl',qty:1}],itemCosts:{bowl:43.5},time:'2026-10-14T01:00:00Z'}
  const refund={...sale,id:'refund',total:-95,items:[{id:'bowl',qty:-1}]},losses=[{id:'rice',qty:90,cost:.05,time:sale.time},{id:'meat',qty:120,cost:.3,time:sale.time},{id:'box',qty:1,cost:3,time:sale.time}]
  const entries=[...orderToJournalEntries(sale,products),...orderToJournalEntries(refund,products),...losses.flatMap(accounting.wasteToJournalEntries)]
  expect(entries.filter(e=>e.type==='auto_waste').reduce((n,e)=>n+e.lines[0].debit,0)).toBe(43.5)
  const pnl=buildPnL(entries,'2026-10-14','2026-10-14');expect(pnl.netIncome).toBe(-43.5)
})
test('nighttime transactions use the local store calendar date consistently',()=>{
  const time=new Date(2026,9,14,1,30).toISOString(),entries=orderToJournalEntries({id:'night',total:50,payMethod:'cash',items:[],time},[])
  expect(entries[0].date).toBe('2026-10-14')
})
test('malformed mixed tender cannot silently become a bank-only journal',()=>{expect(()=>orderToJournalEntries({id:'bad',total:95,payMethod:'mixed',payments:[{method:'cash',amount:50}],items:[],time:'2026-10-14T01:00:00Z'},[])).toThrow(/付款流水/)})
