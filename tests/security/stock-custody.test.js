import {test,expect} from 'vitest'
import {createCostCustody,costCustodySummary,planCostCustody} from '../../electron/stockCustody.mjs'
const owner=(stage='available',referenceId='',locationId='main')=>({stage,referenceId,locationId})
const source=(id,quantityUnits,valueCents)=>({id,productId:'rice',unit:'袋',currency:'TWD',quantityUnits,valueCents})
const row=(sourceId,quantityUnits,queueOrder=1,offsetUnits=0)=>({sourceId,quantityUnits,queueOrder,offsetUnits})
const initial=(value=20000)=>createCostCustody([source('opening',10000,value)],[{owner:owner(),segments:[row('opening',10000)]}])
const movement=(from,to,quantityUnits)=>({kind:'move',from,to,productId:'rice',unit:'袋',quantityUnits})
const apply=(state,...steps)=>planCostCustody(state,{expectedSequence:state.sequence,steps})
function frozen(input){if(input&&typeof input==='object'){Object.values(input).forEach(frozen);Object.freeze(input)}return input}

test('acquisition, sale, unpaid reservation and preparation loss match the complete native baseline quantities under FIFO',()=>{
 const opening=frozen(initial()),received=apply(opening,{kind:'acquire',sources:[source('purchase',10000,30000)],to:owner()}),sold=apply(received.state,movement(owner(),owner('consumed','sale'),11000)),reserved=apply(sold.state,movement(owner(),owner('reserved','preorder'),1000))
 expect(sold.effects[0].cost.valueCents).toBe(23000);expect(reserved.valuation.ownedValueCents).toBe(27000);expect(reserved.valuation.categories.reserved.valueCents).toBe(3000)
 const cancelled=apply(reserved.state,movement(owner('reserved','preorder'),owner('wasted','unpaid-prepared-cancellation'),1000))
 expect(cancelled.valuation.ownedValueCents).toBe(24000);expect(cancelled.valuation.categories.wasted.valueCents).toBe(3000);expect(cancelled.state.positions.find(row=>row.owner.stage==='available').segments).toEqual([row('purchase',8000,2,2000)])
 expect(costCustodySummary(opening).ownedValueCents).toBe(20000)
})

test('a cancelled unused reservation restores its original cost priority and payment consumes held value without another available-stock deduction',()=>{
 const acquired=apply(initial(),{kind:'acquire',sources:[source('purchase',10000,30000)],to:owner()}).state,held=apply(acquired,movement(owner(),owner('reserved','reservation'),12000)).state
 const released=apply(held,movement(owner('reserved','reservation'),owner(),12000)),nextSale=apply(released.state,movement(owner(),owner('consumed','sale'),1000));expect(nextSale.effects[0].cost.valueCents).toBe(2000)
 const availableBefore=held.positions.find(row=>row.owner.stage==='available'),paid=apply(held,movement(owner('reserved','reservation'),owner('consumed','paid-order'),12000))
 expect(paid.state.positions.find(row=>row.owner.stage==='available')).toEqual(availableBefore);expect(paid.effects[0].cost.valueCents).toBe(26000);expect(paid.valuation.ownedValueCents).toBe(24000)
})

test('partial original sale returns restore their actual old cost, arrive after newer stock and cannot exceed the original remaining consumption',()=>{
 const received=apply(initial(),{kind:'acquire',sources:[source('purchase',10000,30000)],to:owner()}).state,sold=apply(received,movement(owner(),owner('consumed','sale'),11000)).state,returned=apply(sold,movement(owner('consumed','sale'),owner(),2000))
 expect(returned.effects[0].cost.valueCents).toBe(4000);expect(returned.valuation.categories.consumed.valueCents).toBe(19000)
 expect(apply(returned.state,movement(owner(),owner('consumed','next-sale'),1000)).effects[0].cost.valueCents).toBe(3000)
 expect(()=>apply(returned.state,movement(owner('consumed','sale'),owner(),10000))).toThrow()
})

test('a used paid cancellation reclassifies expense while a supplier return keeps actual outgoing cost for later credit-variance accounting',()=>{
 const sold=apply(initial(),movement(owner(),owner('consumed','paid-order'),2000)).state,availableBefore=sold.positions.find(row=>row.owner.stage==='available'),cancelled=apply(sold,movement(owner('consumed','paid-order'),owner('wasted','paid-cancel'),2000))
 expect(cancelled.valuation.ownedValueCents).toBe(16000);expect(cancelled.valuation.categories.consumed.valueCents).toBe(0);expect(cancelled.valuation.categories.wasted.valueCents).toBe(4000);expect(cancelled.state.positions.find(row=>row.owner.stage==='available')).toEqual(availableBefore)
 const returned=apply(cancelled.state,movement(owner(),owner('supplierReturned','supplier-return'),1000));expect(returned.effects[0].cost.valueCents).toBe(2000);expect(returned.valuation.ownedValueCents).toBe(14000)
})

test('late cost confirmation apportions the original cent across remaining, reserved, used, wasted and supplier-returned custody without inventing zero',()=>{
 const unpriced=createCostCustody([source('unknown',5,null)],[{owner:owner(),segments:[row('unknown',1,1,0)]},{owner:owner('reserved','r'),segments:[row('unknown',1,1,1)]},{owner:owner('consumed','o'),segments:[row('unknown',1,1,2)]},{owner:owner('wasted','w'),segments:[row('unknown',1,1,3)]},{owner:owner('supplierReturned','s'),segments:[row('unknown',1,1,4)]}]),before=JSON.stringify(unpriced),priced=apply(unpriced,{kind:'price',sourceId:'unknown',valueCents:1})
 expect(priced.effects[0].byState.consumed).toEqual({previousValueCents:null,confirmedValueCents:1});expect(priced.effects[0].byState.available).toEqual({previousValueCents:null,confirmedValueCents:0});expect(priced.valuation).toMatchObject({complete:true,knownSourceValueCents:1,ownedValueCents:0});expect(JSON.stringify(unpriced)).toBe(before)
 expect(()=>apply(priced.state,{kind:'price',sourceId:'unknown',valueCents:2})).toThrow()
})

test('custody transfers preserve the source and total owned cost while assigning arrival priority at the destination',()=>{
 const transferred=apply(initial(),movement(owner(),owner('available','','second'),3000))
 expect(transferred.valuation.ownedValueCents).toBe(20000);expect(transferred.state.sources).toHaveLength(1);expect(transferred.effects[0].cost.valueCents).toBe(6000)
 expect(transferred.state.positions.find(row=>row.owner.locationId==='second').segments).toEqual([row('opening',3000,2)])
 expect(()=>apply(transferred.state,movement(owner(),owner('reserved','r','second'),1000))).toThrow()
})

test('a late invalid batch step and stale sequence leave every original source, quantity and custody unchanged',()=>{
 const original=frozen(initial()),before=JSON.stringify(original)
 expect(()=>apply(original,movement(owner(),owner('reserved','r'),1000),movement(owner(),owner('consumed','too-much'),10000))).toThrow();expect(JSON.stringify(original)).toBe(before)
 expect(()=>planCostCustody(original,{expectedSequence:1,steps:[]})).toThrow();expect(JSON.stringify(original)).toBe(before)
 const noop=apply(original);expect(noop.state.sequence).toBe(1);expect(noop.effects).toEqual([]);expect(noop.valuation).toEqual(costCustodySummary(original))
})

test('owner references are exact tuples and duplicate references cannot hide duplicate custody',()=>{
 const original=initial(),duplicate={...original,positions:[...original.positions,...original.positions]}
 expect(()=>costCustodySummary(duplicate)).toThrow()
 const malformed={...owner('reserved','a'),locationId:'main\u0000other'};expect(()=>apply(original,movement(owner(),malformed,1))).toThrow()
})
