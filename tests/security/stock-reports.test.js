import {it,expect} from 'vitest'
import {splitReportCents,captureRestaurantCostBasis,restaurantCostShares} from '../../electron/stockReportBasis.mjs'
import {salesRevenuePostings,salesReportPeriods,productCostPerformance} from '../../electron/stockSalesReports.mjs'

it('distributes signed cents with conserved tails well beyond safe Number totals',()=>{
 const weights=[{weight:'1'},{weight:'1'},{weight:'1'}]
 expect(splitReportCents('1',weights).map(row=>row.amountCents)).toEqual(['0','1','0'])
 for(const value of ['-1','18014398509481983','-18014398509481983'])expect(splitReportCents(value,weights).reduce((n,row)=>n+BigInt(row.amountCents),0n).toString()).toBe(value)
 expect(()=>splitReportCents(1,[{weight:'-1'},{weight:'3'}])).toThrow();expect(()=>splitReportCents(1,[{weight:'0'}])).toThrow()
})
it('captures original recipe use and rejects a mismatched material allocation',()=>{
 const entry={items:[{id:'a',qty:2},{id:'b',qty:1}],allocations:[{id:'r',qty:.004}]},config={recipes:{a:[{id:'r',qty:.001}],b:[{id:'r',qty:.002}]}}
 const basis=captureRestaurantCostBasis(entry,config);config.recipes.a[0].qty=99
 expect(restaurantCostShares(entry,basis,'r',3).map(row=>row.amountCents)).toEqual(['2','1'])
 expect(()=>captureRestaurantCostBasis(entry,config)).toThrow(/核對/)
})
it('does not invent a recipe for old multiple-menu entries and can assign a single output',()=>{
 expect(restaurantCostShares({items:[{id:'a'},{id:'b'}]},null,'raw',123)).toEqual([{productId:null,amountCents:'123',pendingTargets:['a','b']}])
 expect(restaurantCostShares({items:[{id:'a'}]},null,'raw',-123)).toEqual([{productId:'a',amountCents:'-123'}])
})
it('uses saved discounted revenue, signed refund dates and thousandth quantities',()=>{
 const sale={id:'o',time:'2026-10-15T12:00:00+08:00',status:'refunded',total:.01,items:[{id:'a',price:1,qty:.001},{id:'b',price:1,qty:.001}]},refund={...sale,id:'r',refundOf:'o',time:'2026-10-16T12:00:00+08:00',total:-.01,items:sale.items.map(row=>({...row,qty:-row.qty}))}
 const rows=salesRevenuePostings([sale,refund]);expect(rows.map(row=>row.amountCents)).toEqual(['1','0','-1','0']);expect(rows.map(row=>row.quantityUnits)).toEqual(['1','1','-1','-1']);expect(rows[2].date).toBe('2026-10-16')
})
it('preserves a nonzero unallocated adjustment when all original line prices are zero',()=>{
 const rows=salesRevenuePostings([{time:'2026-10-16T12:00:00+08:00',total:1,items:[{id:'a',qty:1,price:0}]}]);expect(rows.reduce((n,row)=>n+BigInt(row.amountCents),0n)).toBe(100n);expect(rows.at(-1).productId).toBeNull()
})
it('uses inclusive local calendar periods across month and year boundaries',()=>{
 expect(salesReportPeriods('2027-01-01')).toMatchObject({today:['2027-01-01','2027-01-01'],month:['2027-01-01','2027-01-01'],week:['2026-12-26','2027-01-01'],last30:['2026-12-03','2027-01-01']})
})
it('keeps sold-out unknown costs pending until the chosen as-of date, without rewriting past cost',()=>{
 const products=[{id:'p',stock:0}],revenue=[{date:'2026-10-15',productId:'p',name:'Original',quantityUnits:'1000',amountCents:'10000'}],costs=[{date:'2026-10-15',productId:'p',amountCents:'0',unknownUntil:'2026-10-16'},{date:'2026-10-16',productId:'p',amountCents:'2001'}]
 let r=productCostPerformance(products,revenue,costs,'2026-10-15','2026-10-15');expect(r.highMargin).toEqual([]);expect(r.pendingProducts[0].profitCents).toBeNull()
 r=productCostPerformance(products,revenue,costs,'2026-10-15','2026-10-16');expect(r.highMargin[0].profitCents).toBe('7999');expect(r.pendingProducts).toEqual([])
 r=productCostPerformance(products,revenue,costs,'2026-10-15','2026-10-15');expect(r.enriched[0].knownCostCents).toBe('0')
})
it('preserves archived products and explicit unallocated old recipe costs',()=>{
 const r=productCostPerformance([],[{date:'2026-10-16',productId:'a',name:'已封存原文',quantityUnits:'500',amountCents:'10000'}],[{date:'2026-10-16',productId:null,amountCents:'1001',pendingTargets:['a']}],'2026-10-01','2026-10-16');expect(r.enriched[0].name).toBe('已封存原文');expect(r.enriched[0].totalSold).toBe(.5);expect(r.unallocatedCostCents).toBe('1001');expect(r.enriched[0].profitCents).toBeNull()
})
