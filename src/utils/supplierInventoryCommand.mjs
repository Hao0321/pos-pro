import {canonicalSignature} from '../../electron/operationRules.mjs'
// The source draft/quote time is not the time its owner confirms an order.
// Reopening an existing draft must reuse the exact original command metadata.
const material=request=>{const {time,supplierContext,...body}=request;return body}
export function supplierInventoryCommand(kind,input,identity,state,{controlled=true,now=new Date()}={}){
 const current={...(controlled?{supplierContext:{storeId:state.storeId,epoch:state.epoch,revision:state.supplierLedger.revision}}:{}),...input,kind}
 if(kind!=='purchase-create'||!identity)return {input:current,identity}
 const original=state.supplierLedger.entries.find(event=>event.action==='purchase-register'&&event.id===identity.id)?.input||state.creationRequests?.find(request=>request.id===identity.id)
 if(original){
  if(canonicalSignature(material(original))!==canonicalSignature(material({...current,id:identity.id})))throw Error('原操作編號已存在且內容不同，請核對已建立單據；新單請重新整理草稿')
  const {id,time,...saved}=original;return {input:saved,identity:{id,time}}
 }
 return {input:current,identity:{id:identity.id,time:now.toISOString()}}
}
