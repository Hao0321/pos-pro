import {it,expect} from 'vitest'
import {aggregateJournal,formatMoneyCents,centsDecimal} from '../../electron/journalAmounts.mjs'
import {buildPnL,buildBalanceSheet,exportJournalCSV,exportPnLCSV} from '../../electron/accountingCore.mjs'
import {composeStockJournal,stockPeriodDisclosure} from '../../electron/stockAccounting.mjs'
const typed=(id,amount)=>({id,date:'2026-10-16',type:'stock-cost',amountUnit:'cents',lines:[{account:'1211',debitCents:amount,creditCents:0},{account:'3901',debitCents:0,creditCents:amount}]})
it('sums beyond Number safe cents without losing a cent and displays the exact result',()=>{
 const entries=[typed('a',Number.MAX_SAFE_INTEGER),typed('b',Number.MAX_SAFE_INTEGER),typed('c',1)],balance=buildBalanceSheet(entries,'2026-10-16')
 expect(balance.exact.totalAssets).toBe('18014398509481983');expect(balance.balanced).toBe(true);expect(formatMoneyCents(balance.exact.totalAssets,'en')).toBe('180,143,985,094,819.83');expect(centsDecimal(balance.exact.totalAssets)).toBe('180143985094819.83');expect(exportJournalCSV([typed('a',Number.MAX_SAFE_INTEGER)])).toContain('\t90071992547409.91')
})
it('aggregates original subcent legacy values before rounding and visibly marks them for review',()=>{
 const entries=Array.from({length:3},(_,index)=>({id:String(index),date:'2026-10-16',lines:[{account:'5101',debit:.004,credit:0},{account:'1211',debit:0,credit:.004}]})),pnl=buildPnL(entries,'2026-10-16','2026-10-16')
 expect(pnl.knownExact.cogs).toBe('1');expect(pnl.complete).toBe(false);expect(pnl.cogs).toBeNull();expect(pnl.issues.some(row=>row.code==='legacy-subcent')).toBe(true)
})
it('normal floating-point cent residue is recovered without changing historical entries',()=>{
 const entries=[{id:'a',date:'2026-10-16',lines:[{account:'5202',debit:.1+.2,credit:0},{account:'1101',debit:0,credit:.3}]}],before=JSON.stringify(entries),pnl=buildPnL(entries,'2026-10-16','2026-10-16')
 expect(pnl.complete).toBe(true);expect(pnl.exact.netIncome).toBe('-30');expect(JSON.stringify(entries)).toBe(before)
})
it('signed legacy refunds and current typed cost journals compose in exact cents',()=>{
 const entries=[{id:'sale',date:'2026-10-16',lines:[{account:'1101',debit:100,credit:0},{account:'4101',debit:0,credit:100}]},{id:'refund',date:'2026-10-16',lines:[{account:'1101',debit:-25,credit:0},{account:'4101',debit:0,credit:-25}]},{id:'cogs',date:'2026-10-16',amountUnit:'cents',lines:[{account:'5101',debitCents:2001,creditCents:0},{account:'1211',debitCents:0,creditCents:2001}]}],pnl=buildPnL(entries,'2026-10-16','2026-10-16'),balance=buildBalanceSheet(entries,'2026-10-16')
 expect(pnl.exact.grossProfit).toBe('5499');expect(balance.balanced).toBe(true);expect(balance.sections.equity.items.find(row=>row.code==='current-result').amountCents).toBe('5499')
})
it('unknown costs, unbalanced entries and unknown accounts never export a confirmed zero or profit',()=>{
 const entries=[{id:'sale',date:'2026-10-16',lines:[{account:'1101',debit:100,credit:0},{account:'4101',debit:0,credit:100}]}],pnl=buildPnL(entries,'2026-10-16','2026-10-16',{profitComplete:false}),csv=exportPnLCSV(pnl,'2026-10-16','2026-10-16')
 expect(pnl.revenue).toBe(100);expect(pnl.netIncome).toBeNull();expect(csv).toContain('"本期淨利","成本待確認"');expect(csv).toContain('非完整成本');expect(buildBalanceSheet(entries,'2026-10-16',{profitComplete:false}).complete).toBe(false)
 expect(buildPnL([{...entries[0],lines:entries[0].lines.slice(0,1)}],'2026-10-16','2026-10-16').complete).toBe(false)
 expect(buildBalanceSheet([{...entries[0],lines:[{account:'9999',debit:1,credit:1}]}],'2026-10-16').complete).toBe(false)
 expect(()=>aggregateJournal([{...typed('bad',1),amountUnit:'dollars'}])).toThrow(/單位/);expect(()=>aggregateJournal([typed('bad',1.5)])).toThrow(/金額/)
})
it('frozen legacy journal values win, and reference auto COGS does not stack with actual stock COGS',()=>{
 const old={id:'legacy',date:'2026-10-15',type:'manual',lines:[{account:'5202',debit:1,credit:0},{account:'1101',debit:0,credit:1}]},data={manualJournal:[{...old,description:'changed'}],orders:[{id:'new',time:'2026-10-16T12:00:00+08:00',source:'pos',status:'completed',payMethod:'cash',total:100,items:[{id:'p',qty:1}],itemCosts:{p:20}}],products:[{id:'p',cost:999}]},actual={...typed('cost',2300),lines:[{account:'5101',debitCents:2300,creditCents:0},{account:'1211',debitCents:0,creditCents:2300}]},projection={legacyJournals:[old],business:[{replacedJournalIds:['Jnew_cogs'],notes:[]}],journals:[actual]}
 const entries=composeStockJournal(projection,data);expect(entries.find(row=>row.id==='legacy')).toEqual(old);expect(entries.some(row=>row.id==='Jnew_cogs')).toBe(false);expect(buildPnL(entries,'2026-10-16','2026-10-16').cogs).toBe(23)
})
it('cost confirmation affects the chosen as-of date and unknown consumption is not disguised by sold-out stock',()=>{
 const report={status:'active',timeline:{sources:[{sourceId:'s',createdDate:'2026-10-01',unknownAtBirth:true}],moves:[{sourceId:'s',date:'2026-10-01',from:null,to:'available',quantityUnits:1000},{sourceId:'s',date:'2026-10-02',from:'available',to:'consumed',quantityUnits:1000}],confirmations:[{sourceId:'s',date:'2026-10-03'}],legacyReferences:[]}}
 expect(stockPeriodDisclosure(report,'2026-10-01','2026-10-01')).toMatchObject({profitComplete:true,assetsComplete:false})
 expect(stockPeriodDisclosure(report,'2026-10-02','2026-10-02')).toMatchObject({profitComplete:false,assetsComplete:true})
 expect(stockPeriodDisclosure(report,'2026-10-01','2026-10-03')).toMatchObject({profitComplete:true,assetsComplete:true})
 report.timeline.moves[1].date='2026-09-30';expect(stockPeriodDisclosure(report,'2026-09-01','2026-10-03').chronologyReview).toBe(true)
})
