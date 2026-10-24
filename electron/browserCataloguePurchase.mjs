import {canonicalSignature} from './operationRules.mjs'
import {planBrowserStockBusiness,browserBusinessSource} from './browserStockPlan.mjs'
export function appendBrowserCataloguePurchase(before,after,state,command,runtime){
 const {request,actor,timestamp}=command||{}
 if(request?.kind!=='purchase-create'||!request.sourceCatalogue||!Number.isFinite(Date.parse(timestamp))||Math.abs(Date.now()-Date.parse(timestamp))>300000||browserBusinessSource(before,'applyInventoryOperation',request))throw Error('請重新核對目錄採購，原資料仍保留。')
 const planned=planBrowserStockBusiness(before,{...runtime,state,timestamp},'applyInventoryOperation',request,actor)
 if(canonicalSignature(after)!==canonicalSignature(planned.book))throw Error('目錄採購保存內容與核對結果不同。')
 return planned.book
}
