import {it,expect} from 'vitest'
import {costPricing,convertedQuantity,tryCostPricing,assertProductPricingUnchanged} from '../../electron/costPricing.mjs'
import {validateCostDraft,costDraftKey,readCostDraft,writeCostDraft} from '../../src/utils/costPricingDraft'
const line=(extra={})=>({id:'rice',label:'米',packagePrice:'200',packCount:'1',packageQuantity:'2',packageUnit:'kg',portionQuantity:'200',portionUnit:'g',usablePercent:'100',...extra})
const input=(extra={})=>({protocol:'pos-cost-pricing/v1',currency:'TWD',outputUnit:'碗',lines:[line()],otherCost:'0',targetMargin:'30',feePercent:'0',orderFee:'0',portionsPerOrder:'1',roundTo:'1',...extra})
it('2 kg bought for 200, 200 g per bowl costs 20; 30% margin needs 29, not 26',()=>{
 const result=costPricing(input());expect(result.referenceCostCents).toBe('2000');expect(result.suggestedPriceCents).toBe('2900');expect(result.lines[0].portions).toEqual({numerator:'10',denominator:'1'})
})
it('whole-case total, usable yield, packaging and per-order fees convert without manual arithmetic',()=>{
 const result=costPricing(input({lines:[line({packagePrice:'1200',packCount:'6',packageQuantity:'1',usablePercent:'80'}),line({id:'box',label:'盒子',packagePrice:'100',packageQuantity:'50',packageUnit:'piece',portionQuantity:'1',portionUnit:'piece'})],otherCost:'3',targetMargin:'25',feePercent:'10',orderFee:'20',portionsPerOrder:'2',roundTo:'5'}))
 expect(result.referenceCostCents).toBe('5500');expect(result.fixedFeePerPortionCents).toEqual({numerator:'1000',denominator:'1'});expect(result.suggestedPriceCents).toBe('10000');expect(result.variableFeeCents).toBe('1000')
})
it('retains repeating fractions until the combined cost is rounded, rather than rounding every ingredient',()=>{
 const rows=Array.from({length:3},(_,index)=>line({id:String(index),packagePrice:'0.01',packageQuantity:'3',packageUnit:'piece',portionQuantity:'1',portionUnit:'piece'})),result=costPricing(input({lines:rows,targetMargin:'0',roundTo:'0.01'}))
 expect(result.lines[0].costCents).toEqual({numerator:'1',denominator:'3'});expect(result.totalCostCents).toEqual({numerator:'1',denominator:'1'});expect(result.referenceCostCents).toBe('1');expect(result.suggestedPriceCents).toBe('1')
})
it('subcent total rounds once upwards and the price target uses that same cost reference',()=>{
 const result=costPricing(input({lines:[line({packagePrice:'0.01',packageQuantity:'3',packageUnit:'piece',portionQuantity:'1',portionUnit:'piece'})],targetMargin:'50',roundTo:'0.01'}))
 expect(result.referenceCostCents).toBe('1');expect(result.referenceCostRounded).toBe(true);expect(result.suggestedPriceCents).toBe('2');expect(result.margin).toEqual({numerator:'1',denominator:'2'})
})
it('cent-rounded fees can require an extra price cent; verifies all lower steps with an independent cent enumeration',()=>{
 // Enumerate integer money and rational basis points, independent of the
 // production closed bound. Fee rounding makes some adjacent prices nonmonotone.
 for(const cost of [1,7,23,51,113])for(const fee of [0,1,1250,3333,8750])for(const margin of [0,100,1000]){
  if(fee+margin>=10000)continue
  const result=costPricing(input({lines:[line({packagePrice:(cost/100).toFixed(2),packageQuantity:'1',packageUnit:'piece',portionQuantity:'1',portionUnit:'piece'})],targetMargin:(margin/100).toFixed(2),feePercent:(fee/100).toFixed(2),roundTo:'0.01'}))
  const price=Number(result.suggestedPriceCents),check=p=>(p-Math.ceil(p*fee/10000)-cost)*10000>=p*margin
  expect(check(price)).toBe(true);expect(Array.from({length:price-1},(_,index)=>index+1).some(check)).toBe(false)
 }
})
it('supports exact measured units, and never treats a jin, liquid density or package size as implicit',()=>{
 expect(convertedQuantity('1','twJin','g')).toEqual({numerator:'600',denominator:'1'});expect(convertedQuantity('1','cnJin','g')).toEqual({numerator:'500',denominator:'1'});expect(convertedQuantity('0.001','L','mL')).toEqual({numerator:'1',denominator:'1'})
 for(const [from,to]of [['斤','g'],['mL','g'],['piece','kg'],['box','piece']])expect(()=>convertedQuantity('1',from,to)).toThrow(/單位/)
})
it('empty is unknown, explicit zero is permitted, and malformed or overflowing inputs cannot become numeric zero',()=>{
 expect(costPricing(input({lines:[line({packagePrice:'0'})]})).referenceCostCents).toBe('0')
 for(const value of ['', ' ', '-1','1e3','Infinity','NaN','1+1','1.001','100000000001'])expect(tryCostPricing(input({lines:[line({packagePrice:value})]})).ok).toBe(false)
 for(const extra of [{packageQuantity:'0'},{packCount:'0'},{portionQuantity:'0'},{usablePercent:'0'},{usablePercent:'100.01'},{packageUnit:'mL'}])expect(tryCostPricing(input({lines:[line(extra)]})).ok).toBe(false)
 for(const extra of [{targetMargin:'100'},{targetMargin:'60',feePercent:'40'},{orderFee:''},{otherCost:''},{roundTo:'0'},{portionsPerOrder:'0'},{currency:'USD'},{outputUnit:''}])expect(tryCostPricing(input(extra)).ok).toBe(false)
})
it('near-boundary prices and large quantities retain exact decimal cents',()=>{
 const result=costPricing(input({lines:[line({packagePrice:'999999999.99',packageQuantity:'1',portionQuantity:'1',packageUnit:'piece',portionUnit:'piece'})],targetMargin:'0',roundTo:'0.01'}));expect(result.referenceCostCents).toBe('99999999999');expect(result.suggestedPriceCents).toBe('99999999999')
 expect(tryCostPricing(input({lines:[line({packagePrice:'999999999.99'})],targetMargin:'99.99'})).ok).toBe(false)
 expect(costPricing(input({lines:[line({packagePrice:'0.01',packageQuantity:'1',portionQuantity:'1',packageUnit:'piece',portionUnit:'piece'})],targetMargin:'99.9999',roundTo:'0.01'})).suggestedPriceCents).toBe('1000000')
})
it('drafts are bounded input only, scoped to store/user/product, never preserve confirmation or a result as authority',()=>{
 const storage=new Map(),adapter={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},session={userId:'a',role:'owner'},key=costDraftKey({storeId:'store'},session,'rice')
 writeCostDraft(adapter,key,input());expect(readCostDraft(adapter,key,'碗')).toEqual(input());expect(costDraftKey({storeId:'other'},session,'rice')).not.toBe(key);expect(costDraftKey({storeId:'store'},{...session,userId:'b'},'rice')).not.toBe(key)
 expect(()=>validateCostDraft({...input(),confirmed:true})).toThrow();expect(()=>validateCostDraft({...input(),lines:[{...line(),actor:session}]})).toThrow();expect(()=>writeCostDraft(adapter,null,input())).toThrow();storage.set(key,'corrupt');expect(()=>readCostDraft(adapter,key,'碗')).toThrow()
})
it('a pricing edit cannot overwrite a changed price, cost or unit from another device',()=>{
 const old={price:100,cost:20,unit:'碗'};expect(()=>assertProductPricingUnchanged({...old,stock:9},old)).not.toThrow()
 for(const changed of [{price:101},{cost:21},{unit:'份'}])expect(()=>assertProductPricingUnchanged({...old,...changed},old)).toThrow(/已更新/)
 expect(()=>assertProductPricingUnchanged(old,{...old,stock:10})).toThrow();expect(()=>assertProductPricingUnchanged(old,null)).toThrow()
})
