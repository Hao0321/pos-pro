import {privateDraftDigest} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {projectOpeningSourcePlan} from './openingSourcePlan.mjs'
import {assertMasterOwner,previewMasterMigration} from './masterMigration.mjs'
import {appendBrowserMasterMigration,finishBrowserMasterMigration} from './browserMasterMigration.mjs'
import {openingBootstrap,appendOpeningCostBook,openingStockEvidence} from './openingMigration.mjs'
import {validateStockCostBook} from './stockBackup.mjs'
import {planCustomerLedger,planCustomerOpeningActivation,validateCustomerLedgerRecords} from './customerLedger.mjs'
import {planSupplierOpeningActivation,validateSupplierLedgerRecords} from './supplierLedger.mjs'
import {readOpeningCutoverHistory,openingCutoverAudit,openingCustomerCreateId} from './openingCutoverHistory.mjs'
import {openingCutoverPlanInput,openingCutoverMasterRequest,readOpeningCutoverInput} from './openingCutoverSource.mjs'
import {openingCutoverSourceDigest,openingActivationRequest,OPENING_CUTOVER_FENCE,OPENING_CUTOVER_HEAD,cutoverError} from './openingCutoverRules.mjs'
import {makeOpeningCutoverReceipt,cutoverOpeningRows,assertOpeningCutoverResult} from './openingCutoverReceipt.mjs'
import {OPENING_RAW_CUTOVER_RECEIPT} from './openingCutoverRules.mjs'
import {FINANCIAL_FILES_FENCE} from './financialFileDraft.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),bad=message=>{throw message?Error(message):cutoverError()}
const profileKeys=['id','name','contact','phone','email','address','note']
export function cutoverLedgerData(book,scope,context){return {storeId:scope.storeId,epoch:scope.epoch,products:book.products||[],documents:book.salesDocuments||[],salesOperations:book.salesOperations||[],customerEntries:book.customerEntries||[],customerOperations:book.customerOperations||[],supplierEntries:book.supplierEntries||[],supplierOperations:book.supplierOperations||[],suppliers:book.suppliers||[],purchases:book.purchases||[],inventoryAudits:book.auditLog||[],cashLogs:book.cashLog||[],ownerIds:(book.users||[]).filter(row=>row.role==='owner').map(row=>row.id),openShift:null,openingBalanceContext:context}}
export function cutoverViews(book,scope,context){const data=cutoverLedgerData(book,scope,context);return {customer:validateCustomerLedgerRecords(data.customerEntries,data.customerOperations,data),supplier:validateSupplierLedgerRecords(data.supplierEntries,data.supplierOperations,data)}}
export function cutoverEconomicDigest(book,scope,context,plan,masterReceipt=null){
 const views=cutoverViews(book,scope,context),stock=validateStockCostBook(book)
 const economic={masters:masterReceipt?.rows.map(({targetId,entity,applied})=>({targetId,entity,applied}))||[],stock:stock.valuation||null,stockRows:plan.stockRows.map(row=>{const actual=book.products.find(p=>p.id===row.productId);if(!actual)bad();return {id:actual.id,unit:actual.unit,stock:actual.stock}}),customers:views.customer.customers.map(row=>({...Object.fromEntries(profileKeys.map(key=>[key,row[key]??''])),available:row.available,revision:row.revision})),customerRevision:views.customer.revision,customerClaims:views.customer.openingClaims||[],customerFunds:views.customer.receipts,supplierRevision:views.supplier.revision,supplierClaims:views.supplier.openingClaims||[],supplierFunds:views.supplier.payments}
 return {digest:privateDraftDigest(economic),economic,views,stock}
}
export function withCutoverSettings(book,receipt){const values={agentMasterMigrationVersionFence:'1',agentTabularMigrationVersionFence:'1',agentWorkbookMigrationVersionFence:'1',stockOpeningMigrationVersionFence:'1',[OPENING_CUTOVER_FENCE]:'1',[OPENING_CUTOVER_HEAD]:JSON.stringify(receipt.hash),...(receipt.protocol===OPENING_RAW_CUTOVER_RECEIPT?{[FINANCIAL_FILES_FENCE]:'1'}:{})};return {...book,settings:[...(book.settings||[]).filter(row=>!Object.hasOwn(values,row.key)),...Object.entries(values).map(([key,value])=>({key,value}))]}}
export function cutoverCustomerRequest(input,row,revision,time){return {id:openingCustomerCreateId(input.id,row.sourceKey),kind:'customer-ledger',action:'customer-create',storeId:input.scope.storeId,epoch:input.scope.epoch,expectedRevision:revision,time,date:input.cutoffDate,customer:structuredClone(row.values)}}

// Complete in-memory postimage of the same operations the native transaction
// performs. Persisting this projection still requires the actual storage guard.
export function projectOpeningCutoverBook(input,plan,book,scope,actor,time,{trial=false}={}){
 if(new Date(time).toISOString()!==time||Math.abs(Date.now()-Date.parse(time))>300000)bad('保存時間已過期，請重新核對。')
 readOpeningCutoverInput(input);const history=readOpeningCutoverHistory(book),priorContext=history.context
 let next=structuredClone(book),pendingMaster=null,masterId=null,stockReceipt=null,bootstrapId=null
 const child=openingCutoverMasterRequest(input)
 // The guarded browser writer recomputes this postimage. Bind the internal
 // child review to the same transaction time so the proof is deterministic.
 if(child){const view=previewMasterMigration(child,next,scope,actor),request={...child,review:{...view.review,createdAt:Date.parse(time)}},saved=appendBrowserMasterMigration(next,request,scope,actor,time,{deferOpeningReceipt:true});next=saved.book;masterId=saved.receipt.id;pendingMaster={request,receipt:saved.receipt}}
 const supplierCreates=[],customerCreates=[]
 for(const row of plan.parties.creations.filter(row=>row.side==='payable')){if(next.suppliers.some(item=>item.id===row.values.id))bad();next.suppliers.push({contact:'',phone:'',payTerms:'',note:'',catalog:[],...structuredClone(row.values)});supplierCreates.push({sourceKey:row.sourceKey,supplierId:row.values.id,values:structuredClone(row.values)})}
 for(const row of plan.parties.creations.filter(row=>row.side==='receivable')){const request=cutoverCustomerRequest(input,row,next.customerEntries.length,time),saved=planCustomerLedger(request,cutoverLedgerData(next,scope,priorContext),actor);next.customerEntries.push(saved.event);next.customerOperations.push(saved.receipt);customerCreates.push({sourceKey:row.sourceKey,customerId:row.values.id,operationId:request.id,revision:saved.event.revision,profile:structuredClone(saved.event.customer)})}
 if(plan.stockRows.length){
  let state=validateStockCostBook(next);const bootstrap=openingBootstrap(next,scope,input,time)
  if(bootstrap){const added=appendOpeningCostBook(next,state,bootstrap.input,actor,time,input.cutoffDate,null,bootstrap.material);next=added.book;bootstrapId=bootstrap.input.id;state=validateStockCostBook(next)}
  const evidence=openingStockEvidence({opening:cutoverOpeningRows(plan)},next),posted=appendOpeningCostBook(next,state,input,actor,time,input.cutoffDate,evidence);next=posted.book;stockReceipt=posted.receipt
 }
 const before=cutoverLedgerData(next,scope,priorContext),customerView=validateCustomerLedgerRecords(before.customerEntries,before.customerOperations,before),supplierView=validateSupplierLedgerRecords(before.supplierEntries,before.supplierOperations,before)
 const receipt=makeOpeningCutoverReceipt(input,plan,history,actor,time,{masterId,stockReceipt,bootstrapId,customerCreates,supplierCreates,customerRevision:next.customerEntries.length+1,supplierRevision:next.supplierEntries.length+1,priorCustomerDigest:customerView.openingDigest||null,priorSupplierDigest:supplierView.openingDigest||null})
 const ar=planCustomerOpeningActivation(openingActivationRequest(receipt,'receivable',scope),before,actor,receipt),ap=planSupplierOpeningActivation(openingActivationRequest(receipt,'payable',scope),before,actor,receipt)
 next.customerEntries.push(ar.event);next.customerOperations.push(ar.receipt);next.supplierEntries.push(ap.event);next.supplierOperations.push(ap.receipt)
 if(pendingMaster)next=finishBrowserMasterMigration(next,pendingMaster.request,pendingMaster.receipt)
 next.auditLog.push(openingCutoverAudit(receipt));next=withCutoverSettings(next,receipt)
 const saved=readOpeningCutoverHistory(next),economic=cutoverEconomicDigest(next,scope,saved.context,plan,pendingMaster?.receipt)
 if(!trial&&economic.digest!==input.review?.trialDigest)bad('保存後的主檔、庫存或帳款與核對結果不同，整批尚未保存。')
 return {book:next,receipt,context:saved.context,economicDigest:economic.digest,economic:economic.economic,views:economic.views,stock:economic.stock,masterReceipt:pendingMaster?.receipt||null}
}
export function previewOpeningCutover(input,book,scope,actor,now=Date.now()){
 readOpeningCutoverInput(input);assertMasterOwner(book,actor)
 if(scope.storeId!==input.scope.storeId)bad('店面已變更，請保留原輸入核對。')
 const history=readOpeningCutoverHistory(book),prior=history.byId.get(input.id)
 if(prior){if(!same({...JSON.parse(prior.signature),review:undefined},{...input,review:undefined}))bad('同一搬家編號的內容不同，請保留原資料核對。');return {protocol:'pos-opening-cutover-preview/v1',id:input.id,ready:false,saved:prior}}
 assertMasterOwner(book,actor,input.scope);if(!same(scope,input.scope))bad('店面或帳號已變更，請保留原輸入核對。')
 const plan=projectOpeningSourcePlan(openingCutoverPlanInput(input),{...book,...(history.context?{openingBalanceContext:history.context}:{})},scope,actor,now),preview={protocol:'pos-opening-cutover-preview/v1',id:input.id,ready:false,plan}
 if(!plan.factsReady)return preview
 const review={protocol:'pos-opening-cutover-review/v1',createdAt:now,scope:structuredClone(scope),inputDigest:openingCutoverSourceDigest(input),dataDigest:privateDraftDigest(book),planDigest:plan.review.planDigest,trialDigest:'0'.repeat(64)}
 try{const projected=projectOpeningCutoverBook({...input,review},plan,book,scope,actor,new Date(now).toISOString(),{trial:true});review.trialDigest=projected.economicDigest;return {...preview,ready:true,review,trial:{status:'projected-not-posted',stock:projected.stock.valuation||null,customerClaims:projected.views.customer.openingClaims||[],supplierClaims:projected.views.supplier.openingClaims||[],sourceControls:plan.trial.accounts}}}catch(error){return {...preview,trial:{status:'blocked',error:error.message}}}
}
export function verifyOpeningCutover(input,book,scope,actor,now=Date.now()){
 const preview=previewOpeningCutover(input,book,scope,actor,now)
 if(preview.saved){assertOpeningCutoverResult(input,{success:true,receipt:preview.saved});return {preview,receipt:preview.saved}}
 const review=input.review;if(!preview.ready||!review||!Number.isFinite(review.createdAt)||review.createdAt>now+5000||now-review.createdAt>900000||!same(review,{...preview.review,createdAt:review.createdAt}))bad('整批搬家資料已更新或仍有待核對項目，請重新看結果。')
 return {preview,receipt:null}
}
