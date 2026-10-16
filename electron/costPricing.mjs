// Planning only. Never writes inventory, actual cost history or catalogue prices.
const LIMIT=100000000000n, MAX=9007199254740991n
const gcd=(a,b)=>b?gcd(b,a%b):a
const rational=(n,d=1n)=>{const common=gcd(n,d);return {n:n/common,d:d/common}}
const add=(a,b)=>rational(a.n*b.d+b.n*a.d,a.d*b.d)
const mul=(a,b)=>rational(a.n*b.n,a.d*b.d)
const div=(a,b)=>{if(b.n<=0n)throw Error('數量必須大於零');return rational(a.n*b.d,a.d*b.n)}
const ceil=a=>(a.n+a.d-1n)/a.d
const encode=a=>({numerator:a.n.toString(),denominator:a.d.toString()})
function decimal(value,places,positive=false){
 if(typeof value!=='string'||!new RegExp('^(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,'+places+'})?$').test(value))throw Error('請填完整數字，不要留白或輸入算式')
 const [whole,fraction='']=value.split('.'),amount=rational(BigInt(whole+fraction),10n**BigInt(fraction.length))
 if(amount.n>LIMIT*amount.d||positive&&amount.n===0n)throw Error(positive?'數量必須大於零':'金額超過可核對範圍')
 return amount
}
const money=value=>mul(decimal(value,2),rational(100n))
const units={kg:['mass',1000000n],g:['mass',1000n],mg:['mass',1n],twJin:['mass',600000n],cnJin:['mass',500000n],L:['volume',1000n],mL:['volume',1n],piece:['count',1n]}
export function convertedQuantity(value,from,to){
 if(!units[from]||!units[to]||units[from][0]!==units[to][0])throw Error('單位不能直接換算，請確認重量、容量或件數')
 return encode(mul(decimal(value,6,true),rational(units[from][1],units[to][1])))
}
function readPurchases(input){
 if(input?.protocol!=='pos-cost-pricing/v1'||input.currency!=='TWD'||typeof input.outputUnit!=='string'||!input.outputUnit.trim()||input.outputUnit.length>40||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)throw Error('請先填商品單位與成本項目')
 const ids=new Set()
 return input.lines.map(row=>{
  if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.label!=='string'||!row.label.trim()||row.label.length>100)throw Error('請填每個食材或包材的名稱');ids.add(row.id)
  const price=money(row.packagePrice),packs=decimal(row.packCount,6,true),quantity=decimal(row.packageQuantity,6,true),yieldRate=div(decimal(row.usablePercent,4,true),rational(100n))
  if(yieldRate.n>yieldRate.d)throw Error('可使用比例必須大於 0 且不超過 100%')
  if(!units[row.packageUnit])throw Error('單位不能直接換算，請確認重量、容量或件數')
  return {row,price,available:mul(mul(quantity,packs),yieldRate)}
 })
}
function portionCalculation(input){
 const lines=readPurchases(input).map(({row,price,available})=>{
  const converted=convertedQuantity(row.portionQuantity,row.portionUnit,row.packageUnit),used=rational(BigInt(converted.numerator),BigInt(converted.denominator)),cost=mul(price,div(used,available))
  return {id:row.id,label:row.label,costCents:encode(cost),convertedUsage:converted,availableQuantity:encode(available),portions:encode(div(available,used))}
 })
 const ingredientCost=lines.reduce((sum,row)=>add(sum,rational(BigInt(row.costCents.numerator),BigInt(row.costCents.denominator))),rational(0n)),otherCost=money(input.otherCost),cost=add(ingredientCost,otherCost),costCents=ceil(cost)
 if(costCents>LIMIT)throw Error('金額超過可核對範圍')
 return {lines,ingredientCost,cost,costCents}
}
export function validateCostStep(input,step){
 try{const rows=readPurchases(input);if(step>=1)for(const {row}of rows)convertedQuantity(row.portionQuantity,row.portionUnit,row.packageUnit);return {ok:true}}catch(error){return {ok:false,error:error.message}}
}
export function previewPortionCost(input){
 try{const result=portionCalculation(input);return {ok:true,result:{referenceCostCents:result.costCents.toString(),lines:result.lines}}}catch(error){return {ok:false,error:error.message}}
}
export function costPricing(input){
 const {lines,ingredientCost,cost,costCents}=portionCalculation(input)
 const margin=div(decimal(input.targetMargin,4),rational(100n)),fee=div(decimal(input.feePercent,4),rational(100n)),fixed=div(money(input.orderFee),decimal(input.portionsPerOrder,6,true)),step=money(input.roundTo)
 if(margin.n>=margin.d||fee.n>=fee.d||margin.n*fee.d+fee.n*margin.d>=margin.d*fee.d)throw Error('毛利目標加抽成必須小於 100%')
 if(step.n<=0n||step.d!==1n)throw Error('售價級距至少是 0.01 元')
 if(costCents>LIMIT||ceil(fixed)>LIMIT)throw Error('金額超過可核對範圍')
 // Cent-rounded fees can make a plain division underprice. Use the exact
 // predicate and a bounded search over cent multiples of the step.
 // Compare profit / selling price >= the user-supplied margin without rounding.
 const planningCost=rational(costCents)
 const valid=p=>{
  const variable=ceil(mul(rational(p),fee)),remaining=add(planningCost,fixed)
  return ((p-variable)*remaining.d-remaining.n)*margin.d>=p*margin.n*remaining.d
 }
 const maxSteps=LIMIT/step.n
 if(!maxSteps)throw Error('依這組成本與費率，售價超過可核對範圍')
 // valid(p) is not monotone at every cent when percentage fees round up.
 // A conservative closed bound is within one fee cent / retained rate.
 const denominator=rational(fee.d*margin.d-fee.n*margin.d-margin.n*fee.d,fee.d*margin.d),base=div(add(planningCost,fixed),denominator),minimum=ceil(div(base,rational(step.n)))
 const upper=ceil(div(div(add(add(planningCost,fixed),rational(1n)),denominator),rational(step.n)))
 if(minimum>maxSteps)throw Error('依這組成本與費率，售價超過可核對範圍')
 let chosen=minimum>0n&&valid(minimum*step.n)?minimum*step.n:null
 if(chosen===null){
  if(upper-minimum>100000n)throw Error('費率太接近 100%，請降低毛利目標或抽成後再試')
  for(let multiple=minimum;multiple<=upper&&multiple<=maxSteps;multiple++){const candidate=multiple*step.n;if(candidate>0n&&valid(candidate)){chosen=candidate;break}}
 }
 if(chosen===null)throw Error('依這組成本與費率，售價超過可核對範圍')
 const variable=ceil(mul(rational(chosen),fee)),allCosts=add(add(planningCost,fixed),rational(variable)),profit=rational(chosen*allCosts.d-allCosts.n,allCosts.d)
 if([costCents,chosen,variable].some(value=>value>MAX))throw Error('金額超過可核對範圍')
 return {protocol:input.protocol,currency:'TWD',outputUnit:input.outputUnit,lines,ingredientCostCents:encode(ingredientCost),totalCostCents:encode(cost),referenceCostCents:costCents.toString(),referenceCostRounded:cost.d!==1n,suggestedPriceCents:chosen.toString(),variableFeeCents:variable.toString(),fixedFeePerPortionCents:encode(fixed),profitCents:encode(profit),margin:encode(div(profit,rational(chosen))),targetMargin:input.targetMargin,roundTo:input.roundTo,feeRounding:'ceil-cent',basis:'user-entered-planning-costs'}
}
export function tryCostPricing(input){try{return {ok:true,result:costPricing(input)}}catch(error){return {ok:false,error:error.message}}}
export function assertProductPricingUnchanged(product,expected){
 if(expected===undefined)return
 if(!product||!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).sort().join(',')!=='cost,price,unit'||['price','cost','unit'].some(key=>product[key]!==expected[key]))throw Error('商品售價、成本或單位已更新，請保留試算並重新開啟商品核對')
}
export function rationalDecimal(value,places=4){
 const n=BigInt(value.numerator),d=BigInt(value.denominator),factor=10n**BigInt(places),rounded=(n*factor+d/2n)/d
 return {text:(rounded/factor).toString()+(places?'.'+(rounded%factor).toString().padStart(places,'0'):''),approximate:n*factor%d!==0n}
}
