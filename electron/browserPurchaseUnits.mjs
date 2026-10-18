import {canonicalSignature} from './operationRules.mjs'
import {browserStockActor,planBrowserStockBusiness} from './browserStockPlan.mjs'
import {PURCHASE_UNITS_KIND} from './purchaseUnitPricing.mjs'

// PU3: prove the complete transition, including original prices and registration.
export function appendBrowserPurchaseUnits(before,after,state,command,runtime){
 const {request,actor,timestamp}=command||{}
 if(state.projection||request?.kind!==PURCHASE_UNITS_KIND||!Number.isFinite(Date.parse(timestamp))||Math.abs(Date.now()-Date.parse(timestamp))>300000)throw Error('包裝採購保存資料需要重新核對')
 browserStockActor(before,actor,'applyInventoryOperation',request)
 const planned=planBrowserStockBusiness(before,{...runtime,state,timestamp},'applyInventoryOperation',request,actor)
 if(canonicalSignature(after)!==canonicalSignature(planned.book))throw Error('包裝採購保存內容與原單不符，原輸入仍保留')
 return planned.book
}
