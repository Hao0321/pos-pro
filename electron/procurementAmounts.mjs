import {moneyValue,quantityValue} from './operationRules.mjs'

export const cents=n=>Math.round(moneyValue(n,'金額')*100)
export const units=n=>Math.round(quantityValue(n,'數量')*1000)
export const amount=n=>moneyValue(n/100,'合計金額')
export const amountUnits=n=>quantityValue(n/1000,'合計數量')
export function procurementLineCents(qty,cost){
  const value=(BigInt(units(qty))*BigInt(cents(cost))+500n)/1000n
  if(value>100000000000n)throw Error('品項金額超過上限')
  return Number(value)
}
// Allocate the remaining recorded value. Taking the final quantity takes every
// remaining cent, including the rounding residue from earlier split documents.
export function allocateCents(qty,availableQty,availableCents){
  const take=units(qty),available=units(availableQty)
  if(take>available||!Number.isSafeInteger(availableCents)||availableCents<0)throw Error('數量或成本餘額不符')
  if(!take)return 0
  return Number((BigInt(availableCents)*BigInt(take)*2n+BigInt(available))/(BigInt(available)*2n))
}
