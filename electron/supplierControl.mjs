import {canonicalSignature,moneyValue} from './operationRules.mjs'
import {businessId,text} from './businessExchange.mjs'
import {isProcurement,validateProcurement,PROCUREMENT_KINDS} from './procurementRules.mjs'

export const SUPPLIER_MODES=['simple','dual-owner']
export const SUPPLIER_CONTROL_ACTIONS=['policy-set','purchase-enroll','purchase-approve','purchase-reject','purchase-withdraw','payment-propose','payment-approve','payment-reject','payment-withdraw']
export function supplierActor(actor){
  if(actor?.role!=='owner'||typeof actor.userId!=='string'||!actor.userId||actor.userId.length>128||typeof actor.username!=='string'||!actor.username||actor.username.length>100)throw Error('供應商操作缺少已登入的管理員身份')
  return {userId:actor.userId,username:actor.username,role:'owner'}
}
export function emptySupplierControl(){return {policy:{mode:'simple',revision:0,changedAt:'',changedBy:null},purchases:new Map(),proposals:new Map()}}
const reason=request=>text(request.reason,500,'核對理由')
const requireReview=request=>{if(request.reviewed!==true)throw Error('請先核對提案內容再保存')}
function requireOtherActor(actor,submittedBy){if(actor.userId===submittedBy.userId)throw Error('請由另一個管理員帳號核准或退回，不能核准自己的提案')}
function enoughOwners(data,history){if(!history&&new Set(data.ownerIds||[]).size<2)throw Error('請先建立另一個管理員帳號，再使用雙帳號核准')}
export function procurementApprovalMaterial(po){
  validateProcurement(po);if(!isProcurement(po))throw Error('歷史進貨單不能補造採購核准文件')
  return {id:po.id,supplierId:po.supplierId,supplierName:po.supplierName,date:po.date,note:po.note,total:po.total,
    items:po.items.map(row=>({productId:row.productId||null,catalogId:row.catalogId||null,name:row.name,unit:row.unit,qty:row.qty,unitCost:row.unitCost})),sourceQuote:po.procurement.sourceQuote||null}
}
export function purchaseMatchesApproval(po,material){
  const current=procurementApprovalMaterial(po)
  current.items=current.items.map((row,index)=>material.items[index]?.productId===null&&row.catalogId&&row.catalogId===material.items[index].catalogId?{...row,productId:null}:row)
  return canonicalSignature(current)===canonicalSignature(material)
}
function findPurchase(request,data){
  businessId(request.purchaseId)
  const po=data.purchases.find(row=>row.id===request.purchaseId)
  if(!isProcurement(po)||po.procurement.cancel)throw Error('找不到可核對的原採購單')
  validateProcurement(po)
  if(request.expectedPurchaseRevision!==po.procurement.revision)throw Error('採購內容已更新，請重新核對再核准')
  return po
}
export function deriveSupplierControl(action,request,data,actor,control,base,{history=false,registerPurchase=null}={}){
  if(!SUPPLIER_CONTROL_ACTIONS.includes(action)&&action!=='purchase-register')return null
  actor=supplierActor(actor)
  const event={...base,action,actor}
  if(action==='policy-set'){
    requireReview(request)
    if(!SUPPLIER_MODES.includes(request.mode)||request.mode===control.policy.mode)throw Error('請選擇不同的採購核對方式')
    if(request.mode==='dual-owner')enoughOwners(data,history)
    event.mode=request.mode;event.reason=reason(request);return event
  }
  if(action==='purchase-enroll'||action==='purchase-register'){
    const internal=action==='purchase-register'
    if(internal&&(!registerPurchase||!['receive',...PROCUREMENT_KINDS].includes(request.kind)))throw Error('採購核准登記缺少原庫存操作')
    if(!internal)requireReview(request)
    const po=internal?registerPurchase:findPurchase(request,data)
    validateProcurement(po)
    if(!isProcurement(po)||po.procurement.cancel||control.purchases.has(po.id))throw Error('原採購已納入核准或已取消，請查看原紀錄')
    if(internal&&request.kind!=='purchase-create'&&control.policy.mode==='dual-owner')throw Error('這張舊採購請先納入核准，不能直接收貨或付款')
    event.purchaseId=po.id;event.supplierId=po.supplierId;event.supplierName=po.supplierName
    event.material=procurementApprovalMaterial(po);event.requiredApproval=control.policy.mode==='dual-owner';event.policyRevision=control.policy.revision
    event.originRevision=internal?(data.purchases.find(row=>row.id===po.id)?.procurement.revision||1):po.procurement.revision
    event.adopted=!internal||request.kind!=='purchase-create'
    if(internal)event.inventoryOperationId=request.id
    return event
  }
  if(action.startsWith('purchase-')){
    const po=findPurchase(request,data),original=control.purchases.get(po.id)
    if(!original||original.status!=='pending'||!purchaseMatchesApproval(po,original.material))throw Error('找不到仍待核准且內容一致的採購提案')
    if(action==='purchase-withdraw'){
      if(actor.userId!==original.submittedBy.userId)throw Error('只有原送審帳號能撤回採購提案')
    }else requireOtherActor(actor,original.submittedBy)
    requireReview(request)
    event.purchaseId=po.id;event.supplierId=po.supplierId;event.supplierName=po.supplierName;event.registrationId=original.id;event.purchaseRevision=po.procurement.revision
    if(action!=='purchase-approve')event.reason=reason(request)
    return event
  }
  if(action==='payment-propose'){
    requireReview(request);enoughOwners(data,history);businessId(request.supplierId)
    const supplier=data.suppliers.find(row=>row.id===request.supplierId)
    if(!supplier)throw Error('供應商不存在，請先新增或選擇原供應商')
    if(!['cash','bank'].includes(request.method))throw Error('請選現金或銀行付款')
    event.supplierId=supplier.id;event.supplierName=supplier.name;event.amount=moneyValue(request.amount,'預付款金額',.01);event.method=request.method
    event.note=text(request.note??'',1000,'付款說明',false);event.requiredApproval=true;event.policyRevision=control.policy.revision
    if(request.reference!==undefined)event.reference=text(request.reference,100,'付款參考',false)
    return event
  }
  if(action.startsWith('payment-')){
    businessId(request.proposalId)
    const original=control.proposals.get(request.proposalId)
    if(!original||!['pending','approved'].includes(original.status))throw Error('找不到仍可核對的原付款提案')
    if(action==='payment-approve'&&original.status!=='pending')throw Error('這筆付款已核准，請查看原紀錄')
    if(!history&&action==='payment-approve'&&data.suppliers.find(row=>row.id===original.supplierId)?.name!==original.supplierName)throw Error('供應商名稱已更新，請先撤回並重新送審')
    if(action==='payment-withdraw'){
      if(actor.userId!==original.submittedBy.userId)throw Error('只有原送審帳號能撤回付款提案')
    }else requireOtherActor(actor,original.submittedBy)
    requireReview(request)
    event.proposalId=original.id;event.supplierId=original.supplierId;event.supplierName=original.supplierName;event.amount=original.amount;event.method=original.method
    if(action!=='payment-approve')event.reason=reason(request)
    return event
  }
  return null
}
export function projectSupplierControl(control,event){
  if(event.action==='policy-set'){control.policy={mode:event.mode,revision:event.revision,changedAt:event.time,changedBy:event.actor};return true}
  if(['purchase-register','purchase-enroll'].includes(event.action)){
    control.purchases.set(event.purchaseId,{id:event.id,purchaseId:event.purchaseId,supplierId:event.supplierId,material:event.material,originRevision:event.originRevision,adopted:event.adopted,requiredApproval:event.requiredApproval,submittedBy:event.actor,submittedAt:event.time,status:event.requiredApproval?'pending':'approved',approvedBy:null,approvalId:null});return true
  }
  if(['purchase-approve','purchase-reject','purchase-withdraw'].includes(event.action)){
    const original=control.purchases.get(event.purchaseId);if(!original)throw Error('採購核准缺少原提案')
    control.purchases.set(event.purchaseId,{...original,status:{'purchase-approve':'approved','purchase-reject':'rejected','purchase-withdraw':'withdrawn'}[event.action],...(event.action==='purchase-approve'?{approvedBy:event.actor,approvalId:event.id}:{}),lastReviewId:event.id});return true
  }
  if(event.action==='payment-propose'){
    control.proposals.set(event.id,{id:event.id,supplierId:event.supplierId,supplierName:event.supplierName,amount:event.amount,method:event.method,note:event.note,reference:event.reference||'',submittedBy:event.actor,submittedAt:event.time,requiredApproval:true,status:'pending',approvedBy:null,approvalId:null,paymentId:null});return true
  }
  if(['payment-approve','payment-reject','payment-withdraw'].includes(event.action)){
    const original=control.proposals.get(event.proposalId);if(!original)throw Error('付款核准缺少原提案')
    control.proposals.set(event.proposalId,{...original,status:{'payment-approve':'approved','payment-reject':'rejected','payment-withdraw':'withdrawn'}[event.action],...(event.action==='payment-approve'?{approvedBy:event.actor,approvalId:event.id}:{}),lastReviewId:event.id});return true
  }
  return false
}
export function supplierControlView(control){return {policy:control.policy,purchaseApprovals:[...control.purchases.values()],paymentApprovals:[...control.proposals.values()]}}
export function assertProcurementApproval(request,data,control){
  if(!['receive',...PROCUREMENT_KINDS].includes(request.kind)||request.kind==='purchase-create')return
  const po=data.purchases.find(row=>row.id===request.purchaseId),approval=control.purchases.get(request.purchaseId)
  if(approval&&po&&!purchaseMatchesApproval(po,approval.material))throw Error('採購條件與原核准不同，請保留原單核對')
  if(!['receive','purchase-bill','purchase-pay'].includes(request.kind))return
  if(!approval){if(control.policy.mode==='dual-owner')throw Error('這張舊採購請先納入核准，不能直接收貨或付款');return}
  if(approval.status!=='approved')throw Error('這張採購還未核准或已退回，請先完成另一帳號核對')
}
export function validateSupplierPaymentApproval(request,control){
  const proposal=request.proposalId?control.proposals.get(request.proposalId):null
  if(!proposal){if(control.policy.mode==='dual-owner'||request.proposalId)throw Error('請先由另一個管理員帳號核准這筆預付款');return null}
  if(proposal.status!=='approved'||proposal.supplierId!==request.supplierId||proposal.amount!==request.amount||proposal.method!==request.method||request.expectedSupplierName!==undefined&&proposal.supplierName!==request.expectedSupplierName)throw Error('付款提案尚未核准、已使用或內容不同，請核對原提案')
  return proposal
}
export function consumeSupplierPaymentApproval(control,event){
  if(!event.proposalId)return
  const proposal=control.proposals.get(event.proposalId);if(!proposal||proposal.status!=='approved')throw Error('付款提案已使用或未核准')
  control.proposals.set(event.proposalId,{...proposal,status:'paid',paymentId:event.id})
}
