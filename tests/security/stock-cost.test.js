import {test,expect} from 'vitest'
import {STOCK_COST_ERRORS,STOCK_COST_STATES,costSource,costSegmentValue,stockCostSummary,splitCostSegment,takeFifoSegments,restoreCostSegments,priceUnvaluedCostSource,assertCostPartition} from '../../electron/stockCost.mjs'
import {tr} from '../../public/i18n/core.mjs'
const source=(id,quantityUnits,valueCents,extra={})=>({id,productId:'rice',unit:'袋',currency:'TWD',quantityUnits,valueCents,...extra})
const row=(sourceId,quantityUnits,queueOrder=1,offsetUnits=0)=>({sourceId,offsetUnits,quantityUnits,queueOrder})
const take=(sources,rows,quantityUnits)=>takeFifoSegments(sources,rows,{productId:'rice',unit:'袋',quantityUnits})
const positions=patch=>({...Object.fromEntries(STOCK_COST_STATES.map(state=>[state,[]])),...patch})
function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value)}return value}
function code(fn,name){expect(fn).toThrow();try{fn()}catch(error){expect(error.code).toBe('STOCK_COST_'+name)}}

test('the real native baseline fixture has an exact FIFO cost path across sale and unpaid prepared cancellation',()=>{
 const sources=[source('opening',10000,20000),source('purchase',10000,30000)],available=frozen([row('purchase',10000,2),row('opening',10000,1)]),sold=take(sources,available,11000),held=take(sources,sold.remaining,1000)
 expect(sold.cost.valueCents).toBe(23000);expect(held.cost.valueCents).toBe(3000)
 const book=assertCostPartition(sources,positions({available:held.remaining,consumed:sold.allocations,wasted:held.allocations}))
 expect(book).toMatchObject({complete:true,ownedValueCents:24000,totalSourceValueCents:50000});expect(held.remaining).toEqual([row('purchase',8000,2,2000)])
 expect(available).toEqual([row('purchase',10000,2),row('opening',10000,1)])
})

test('one cent across three smallest units allocates the cumulative rounded difference and closes exactly',()=>{
 const origin=source('fraction',3,1),values=[0,1,2].map(offset=>costSegmentValue(origin,offset,1))
 expect(values).toEqual([0,1,0]);expect(values.reduce((a,b)=>a+b,0)).toBe(1);expect(costSegmentValue(origin,0,3)).toBe(1)
})

test('maximum accepted integer multiplication remains exact beyond floating-point integer precision',()=>{
 const origin=source('large',1000000000000,Number.MAX_SAFE_INTEGER),parts=[333333333333,333333333334,333333333333];let offset=0,total=0n
 for(const units of parts){const value=costSegmentValue(origin,offset,units),numerator=BigInt(origin.valueCents)*BigInt(offset+units),denominator=BigInt(origin.quantityUnits),before=BigInt(origin.valueCents)*BigInt(offset);const round=n=>n/denominator+(2n*(n%denominator)>=denominator?1n:0n);expect(BigInt(value)).toBe(round(numerator)-round(before));total+=BigInt(value);offset+=units}
 expect(total).toBe(BigInt(Number.MAX_SAFE_INTEGER))
})

test('the frozen large-amount negative control detects a one-cent error from ordinary floating-point multiplication',()=>{
 const origin=source('precision-control',1000000000000,9007199254740987),part=333333333337
 expect(Math.round(origin.valueCents*part/origin.quantityUnits)).toBe(3002399751613356)
 expect(costSegmentValue(origin,0,part)).toBe(3002399751613355)
})

test('unknown cost is distinct from confirmed zero, including an unknown source whose available stock is empty',()=>{
 const sources=[source('unknown',3,null),source('free',2,0)],result=take(sources,[row('unknown',3),row('free',2,2)],5)
 expect(result.cost).toMatchObject({complete:false,knownValueCents:0,valueCents:null,unvalued:[{sourceId:'unknown',productId:'rice',unit:'袋',quantityUnits:3}]})
 expect(stockCostSummary(sources,result.remaining)).toMatchObject({complete:true,valueCents:0})
 expect(assertCostPartition(sources,positions({consumed:result.allocations}))).toMatchObject({complete:false,ownedValueCents:0,totalSourceValueCents:null})
})

test('pricing an unknown source preserves its original input and conserves values across held, used and remaining intervals',()=>{
 const original=frozen(source('pending',3,null)),priced=priceUnvaluedCostSource(original,1),book=assertCostPartition([priced],positions({consumed:[row('pending',1)],reserved:[row('pending',1,1,1)],available:[row('pending',1,1,2)]}))
 expect(original.valueCents).toBeNull();expect(book).toMatchObject({complete:true,totalSourceValueCents:1,ownedValueCents:1});expect(book.categories.consumed.valueCents).toBe(0)
 expect(priceUnvaluedCostSource(original,0).valueCents).toBe(0);code(()=>priceUnvaluedCostSource(priced,2),'PRICED')
})

test('releasing an unused reservation restores its original FIFO priority while a customer return receives a new arrival order',()=>{
 const sources=[source('older',5,500),source('later',5,1000)],issued=take(sources,[row('older',5,1),row('later',5,2)],5)
 const released=restoreCostSegments(sources,issued.remaining,issued.allocations,{kind:'release-reservation'}),returned=restoreCostSegments(sources,issued.remaining,issued.allocations,{kind:'customer-return',queueOrder:3})
 expect(take(sources,released,1).cost.valueCents).toBe(100);expect(take(sources,returned,1).cost.valueCents).toBe(200)
 code(()=>restoreCostSegments(sources,issued.remaining,issued.allocations,{kind:'customer-return',queueOrder:2}),'QUEUE')
 code(()=>restoreCostSegments(sources,issued.remaining,issued.allocations,{kind:'release-reservation',queueOrder:3}),'QUEUE')
})

test('partial returns keep the original cost interval and can rejoin only when their queue priority is identical',()=>{
 const original=source('receipt',9,14),first=splitCostSegment(original,row('receipt',4,7,2),1),second=splitCostSegment(original,first.remainder,2)
 const pieces=[first.taken,second.taken,second.remainder]
 expect(stockCostSummary([original],pieces).valueCents).toBe(costSegmentValue(original,2,4))
 expect(restoreCostSegments([original],[second.taken,second.remainder],[first.taken],{kind:'release-reservation'})).toEqual([row('receipt',4,7,2)])
})

test('a multi-source customer return preserves original issued order inside its new arrival and refuses queue overflow',()=>{
 const sources=[source('z-older',1,100),source('a-newer',1,200)],returned=restoreCostSegments(sources,[],[row('a-newer',1,2),row('z-older',1,1)],{kind:'customer-return',queueOrder:3})
 expect(returned).toEqual([row('z-older',1,3),row('a-newer',1,4)]);expect(take(sources,returned,1).cost.valueCents).toBe(100)
 code(()=>restoreCostSegments(sources,[],[row('a-newer',1,2),row('z-older',1,1)],{kind:'customer-return',queueOrder:Number.MAX_SAFE_INTEGER}),'QUEUE')
})

test('duplicate restoration, overlapping custody, missing intervals and wrong source totals are rejected without changing inputs',()=>{
 const sources=frozen([source('a',10,10)]),available=frozen([row('a',10)]),before=JSON.stringify({sources,available})
 code(()=>restoreCostSegments(sources,available,[row('a',1)],{kind:'customer-return',queueOrder:2}),'OVERLAP')
 code(()=>assertCostPartition(sources,positions({available,consumed:[row('a',1)]})),'OVERLAP')
 code(()=>assertCostPartition(sources,positions({available:[row('a',9)]})),'PARTITION')
 code(()=>assertCostPartition(sources,positions({available:[row('a',9,1,1)]})),'PARTITION')
 expect(JSON.stringify({sources,available})).toBe(before)
})

test('an issued product or unit cannot be replaced with another available source and insufficient quantities fail before any change',()=>{
 const sources=[source('a',10,10),source('b',10,20,{productId:'other'}),source('c',10,20,{unit:'公斤'})]
 code(()=>take(sources,[row('a',10),row('b',10,2)],1),'SCOPE');code(()=>take(sources,[row('a',10),row('c',10,2)],1),'SCOPE')
 const available=frozen([row('a',10)]);code(()=>take(sources,available,11),'INSUFFICIENT');expect(available).toEqual([row('a',10)])
})

test('source IDs use exact identity rather than delimiter-concatenated keys or locale-dependent ordering',()=>{
 const sources=[source('a|b',1,10),source('a',1,20),source('É',1,30)],result=take(sources,[row('É',1),row('a|b',1),row('a',1)],3)
 expect(result.allocations.map(item=>item.sourceId)).toEqual(['a','a|b','É']);expect(result.cost.valueCents).toBe(60)
 code(()=>stockCostSummary([...sources,source('a',1,20)],[row('a',1)]),'SOURCE_ID')
 code(()=>stockCostSummary(sources,[row('missing',1)]),'SOURCE_ID')
})

test('unsafe quantities, monetary ranges, non-TWD sources and malformed records never become a cost value',()=>{
 for(const quantityUnits of [0,-1,.5,Infinity,NaN,1000000000001])code(()=>costSource(source('bad',quantityUnits,1)),'QUANTITY')
 for(const valueCents of [-1,.5,Infinity,NaN,undefined,Number.MAX_SAFE_INTEGER+1])code(()=>costSource(source('bad',1,valueCents)),'AMOUNT')
 code(()=>costSource(source('bad',1,1,{currency:'USD'})),'SOURCE');code(()=>costSource({...source('bad',1,1),actor:'owner'}),'SOURCE')
 code(()=>stockCostSummary([source('a',10,10)],[row('a',10,1,1)]),'SEGMENT');code(()=>splitCostSegment(source('a',10,10),row('a',10),0),'QUANTITY')
})

test('a source accessor cannot execute during validation and prototype-shaped input stays rejected',()=>{
 const getter={...source('a',1,1)};delete getter.valueCents;let ran=false;Object.defineProperty(getter,'valueCents',{enumerable:true,get(){ran=true;return 1}})
 code(()=>costSource(getter),'SOURCE');expect(ran).toBe(false)
 code(()=>costSource(Object.assign(Object.create({inherited:true}),source('a',1,1))),'SOURCE')
 const hidden={...source('hidden',1,1)};Object.defineProperty(hidden,'valueCents',{enumerable:false,value:1});code(()=>costSource(hidden),'SOURCE')
 const options={};Object.defineProperty(options,'kind',{enumerable:true,get(){ran=true;return 'release-reservation'}});code(()=>restoreCostSegments([source('a',1,1)],[],[row('a',1)],options),'QUEUE');expect(ran).toBe(false)
})

test('an aggregate outside the safe cents range is rejected even if each source independently fits',()=>{
 const sources=[source('a',1,Number.MAX_SAFE_INTEGER),source('b',1,1)]
 code(()=>stockCostSummary(sources,[row('a',1),row('b',1)]),'AMOUNT')
})

test('custody classification must be complete and unknown classifications cannot hide a loss',()=>{
 const sources=[source('a',1,1)],valid=positions({available:[row('a',1)]})
 expect(assertCostPartition(sources,valid).ownedValueCents).toBe(1);const {wasted,...missing}=valid
 code(()=>assertCostPartition(sources,missing),'STATES');code(()=>assertCostPartition(sources,{...valid,other:[]}),'STATES')
 expect(assertCostPartition([],positions()).totalSourceValueCents).toBe(0)
})

test('seeded independent quotient/remainder checks conserve every cent through many irregular splits',()=>{
 let seed=0x32a910fe;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
 for(let sample=0;sample<500;sample++){
  const quantity=1+random()%100000,value=(random()*1000+random()%1000),origin=source('fuzz',quantity,value);let offset=0,total=0n
  const denominator=BigInt(quantity),rounded=n=>n/denominator+(2n*(n%denominator)>=denominator?1n:0n)
  while(offset<quantity){const count=1+random()%(quantity-offset),part=costSegmentValue(origin,offset,count);expect(BigInt(part)).toBe(rounded(BigInt(value)*BigInt(offset+count))-rounded(BigInt(value)*BigInt(offset)));total+=BigInt(part);offset+=count}
  expect(total).toBe(BigInt(value))
 }
})

test('all cost boundary errors have three non-source UI translations',()=>{
 for(const source of Object.values(STOCK_COST_ERRORS))for(const locale of ['en','ja','zh-CN'])expect(tr(source,{},locale)).not.toBe(source)
})
