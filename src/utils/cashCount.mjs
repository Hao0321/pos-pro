import {moneyValue} from '../../electron/operationRules.mjs'

// NT$ denominations: https://www.cbc.gov.tw/en/cp-503-944-F6444-2.html
export const CASH_DENOMINATIONS=Object.freeze([
 ...[1000,500,100,50,10,5,1].map(amount=>Object.freeze({amount,cents:amount*100,extra:false})),
 ...[2000,200,20,0.5].map(amount=>Object.freeze({amount,cents:amount*100,extra:true}))
])
const maximumCents=100_000_000_000,known=new Set(CASH_DENOMINATIONS.map(row=>String(row.amount))),text=value=>typeof value==='string'?value.normalize('NFKC').trim():null
export const emptyCashCount=()=>({mode:'manual',manual:'',counts:{}})
const invalid=reason=>({valid:false,reason})
function amountCents(value){
 const raw=text(value);if(raw===null||raw.length>64)return invalid('amount');if(!raw)return invalid('empty')
 if(!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2}|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)$/.test(raw))return invalid('amount')
 const [whole,fraction='']=raw.replaceAll(',','').split('.'),cents=Number(whole||'0')*100+Number(fraction.padEnd(2,'0'))
 return Number.isSafeInteger(cents)&&cents<=maximumCents?{valid:true,cents}:invalid('amount')
}
export function cashQuantity(value){
 const raw=text(value);if(raw===null||raw.length>64||!/^\d*$/.test(raw))return null
 const quantity=Number(raw||'0');return Number.isSafeInteger(quantity)&&quantity<=1e9?quantity:null
}
export function countedCash(state){
 if(!state||!['manual','count'].includes(state.mode))return invalid('amount')
 let result
 if(state.mode==='manual')result=amountCents(state.manual)
 else{
  if(!state.counts||typeof state.counts!=='object'||Array.isArray(state.counts)||Object.keys(state.counts).some(key=>!known.has(key)))return invalid('quantity')
  let cents=0,entered=false
  for(const row of CASH_DENOMINATIONS){const raw=state.counts[row.amount]??'',quantity=cashQuantity(raw);if(quantity===null)return invalid('quantity');if(text(raw)!=='')entered=true;cents+=quantity*row.cents;if(!Number.isSafeInteger(cents)||cents>maximumCents)return invalid('amount')}
  result=entered?{valid:true,cents}:invalid('empty')
 }
 if(!result.valid)return result
 try{return {...result,amount:moneyValue(result.cents/100,'實際現金')}}catch{return invalid('amount')}
}
export function countedDifference(state,expected){
 const actual=countedCash(state),expectedCents=Math.round(expected*100)
 if(!actual.valid||typeof expected!=='number'||!Number.isFinite(expected)||!Number.isSafeInteger(expectedCents)||!Number.isSafeInteger(actual.cents-expectedCents))return null
 return actual.cents-expectedCents
}
