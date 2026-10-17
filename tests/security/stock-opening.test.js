import {test,expect} from 'vitest'
import {prepareStockOpening} from '../../electron/stockOpening.mjs'
const product=(id='rice',stock=9,cost=20)=>({id,name:id,unit:'袋',stock,cost})
const data=patch=>({storeId:'store',epoch:'epoch',products:[product()],orders:[],topups:[],wasteLog:[],purchases:[],salesDocuments:[],customerEntries:[],supplierEntries:[],manualJournal:[],restaurantEntries:[],...patch})
const reservation=(patch={})=>({id:'r',version:1,status:'reserved',saleId:'',startedAt:'',allocations:[{id:'rice',name:'Rice original',qty:1,unitCost:30}],...patch})
function freeze(input){if(input&&typeof input==='object'){Object.values(input).forEach(freeze);Object.freeze(input)}return input}

test('opening preview separates available, unpaid held/WIP and already-paid legacy quantities without claiming authoritative valuation',()=>{
 const input=freeze(data({restaurantEntries:[reservation(),reservation({id:'cooking',startedAt:'2026-10-16T00:00:00Z',status:'cooking'}),reservation({id:'paid',saleId:'sale'}),reservation({id:'cancelled',status:'cancelled'})]})),before=JSON.stringify(input),result=prepareStockOpening(input)
 expect(result.preview).toMatchObject({status:'reference-only-not-activated',authoritativeValuation:false,referenceAvailableValueCents:18000,referenceReservedValueCents:6000,referenceOwnedValueCents:24000})
 expect(result.preview.unpaidReservations).toHaveLength(2);expect(result.preview.unpaidReservations[1].prepared).toBe(true);expect(result.preview.paidLegacyReservations).toHaveLength(1)
 expect(result.preview.unpaidReservations[0].allocations[0]).toMatchObject({referenceUnitCostCents:3000,unitEvidence:'current-product-unit-reference'})
 expect(JSON.stringify(input)).toBe(before);expect(Object.hasOwn(result.preview,'material')).toBe(false)
})

test('changing the live reference cost does not reprice previously reserved legacy materials in the preview',()=>{
 const old=prepareStockOpening(data({restaurantEntries:[reservation()]})),changed=prepareStockOpening(data({products:[product('rice',9,99)],restaurantEntries:[reservation()]}))
 expect(changed.preview.referenceAvailableValueCents).toBe(89100);expect(changed.preview.referenceReservedValueCents).toBe(3000);expect(changed.material).not.toBe(old.material)
})

test('the native/UI shared accounting sources expose the original inventory reconciliation difference',()=>{
 const input=data({orders:[{id:'sale',source:'pos',status:'completed',items:[{id:'rice',qty:1}],itemCosts:{rice:20},total:100,payMethod:'cash',time:'2026-10-16T00:00:00Z'}],manualJournal:[{id:'opening',date:'2026-10-15',type:'manual',lines:[{account:'1211',debit:100,credit:0},{account:'3101',debit:0,credit:100}]}]})
 const {preview}=prepareStockOpening(input);expect(preview.referenceInventoryBalanceCents).toBe(8000);expect(preview.referenceOwnedValueCents).toBe(18000);expect(preview.reviewFlags).toContain('inventory-reference-reconciliation-needed')
})

test('missing legacy cost snapshots and deleted old products remain explicit review gaps rather than a confirmed zero cost',()=>{
 const order={id:'old',total:100,payMethod:'cash',items:[{id:'gone',qty:2}],time:'2026-10-16T00:00:00Z'},result=prepareStockOpening(data({orders:[order]})).preview
 expect(result.legacyCostReviews).toEqual([{orderId:'old',productId:'gone',quantityUnits:2000,referenceUnitCostCents:null,basis:'missing-snapshot'}]);expect(result.reviewFlags).toContain('legacy-order-cost-missing')
})

test('positive stock at reference zero is marked for review and a zero-stock product needs no invented opening source',()=>{
 const result=prepareStockOpening(data({products:[product('positive',2,0),product('empty',0,0)]})).preview
 expect(result.products.map(row=>row.zeroCostNeedsReview)).toEqual([true,false]);expect(result.reviewFlags).toContain('opening-zero-cost-needs-review');expect(result.authoritativeValuation).toBe(false)
})

test('large reference values stay out of range instead of becoming zero or a rounded unsafe integer',()=>{
 const result=prepareStockOpening(data({products:[product('large',1000000000,1000000000)]})).preview
 expect(result.products[0].referenceValueCents).toBeNull();expect(result.referenceOwnedValueCents).toBeNull();expect(result.reviewFlags).toContain('reference-value-out-of-range')
})

test('a partial dataset, duplicate product or missing reserved resource cannot masquerade as a complete opening preview',()=>{
 const missing=data();delete missing.supplierEntries
 for(const input of [missing,data({products:[product(),product()]}),data({products:[],restaurantEntries:[reservation()]}),data({products:[{...product(),unit:{guess:'kg'}}]})])expect(()=>prepareStockOpening(input)).toThrow()
})

test('review material covers names, quantities, units and the original accounting source rows',()=>{
 const original=data(),baseline=prepareStockOpening(original).material
 for(const productPatch of [{name:'renamed'},{stock:8},{unit:'公斤'},{cost:21}])expect(prepareStockOpening(data({products:[{...product(),...productPatch}]})).material).not.toBe(baseline)
 expect(prepareStockOpening(data({manualJournal:[{id:'j',date:'2026-10-16',type:'manual',lines:[{account:'1211',debit:1,credit:0},{account:'3101',debit:0,credit:1}]}]})).material).not.toBe(baseline)
})
