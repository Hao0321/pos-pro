import {canonicalSignature} from './operationRules.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'
import {readMasterMigrationHistory,previewMasterMigration,assertMasterOwner} from './masterMigration.mjs'
import {appendBrowserMasterMigration,finishBrowserMasterMigration} from './browserMasterMigration.mjs'
import {validateStockCostBook} from './stockBackup.mjs'
import {prepareBrowserStockOpening} from './browserStockSetup.mjs'
import {projectStockLedger,stockLedgerDigest,stockLedgerAcknowledgement} from './stockLedgerModel.mjs'
import {costCustodySummary} from './stockCustody.mjs'
import {withStockBookHead} from './stockBookAnchor.mjs'
import {salesDate} from './salesRules.mjs'
import {readOpeningMigrationInput,openingMasterRequest,OPENING_MIGRATION_METHOD,OPENING_MIGRATION_FENCE,OPENING_MIGRATION_HEAD,OPENING_CLEARING_ACCOUNT} from './openingMigrationSource.mjs'
import {readOpeningMigrationHistory,openingSourceProductKey,openingSourceRowKey,makeOpeningMigrationReceipt,openingMigrationAudit} from './openingMigrationHistory.mjs'
export {makeOpeningMigrationInput} from './openingMigrationSource.mjs'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),bad=message=>{throw Error(message)},set=(book,key,value)=>({...book,settings:[...book.settings.filter(r=>r.key!==key),{key,value}]})
export function openingBootstrap(book,scope,input,time){
 const state=validateStockCostBook(book);if(state.projection)return null
 const {preview,material}=prepareBrowserStockOpening(book,scope.epoch)
 if(preview.products.some(row=>row.availableUnits)||preview.unpaidReservations.some(row=>row.allocations.length)||preview.paidLegacyReservations.some(row=>row.allocations?.length)||preview.legacyCostReviews.length||preview.referenceInventoryBalanceCents!==0)bad('本店已有庫存或成本待核對，請先完成本店成本開帳。')
 return {input:{protocol:'pos-stock-cost/v1',id:'opening-bootstrap-'+privateDraftDigest(input.id).slice(0,40),action:'open',time,storeId:scope.storeId,epoch:scope.epoch,reviewed:true,snapshotDigest:preview.snapshotDigest,overrides:[]},material}
}
export function openingStockEvidence(preview,book){return {opening:structuredClone(preview.opening),products:preview.opening.map(row=>{const product=book.products.find(p=>p.id===row.productId);if(!product||product.unit!==row.fact.unit||product.stock!==0)bad('本店商品或庫存已更新，請重新核對。');return {id:product.id,unit:product.unit,beforeUnits:0,afterUnits:row.fact.quantityUnits,referenceUnitCostCents:Math.round(product.cost*100)}})}}
export function appendOpeningCostBook(book,state,input,actor,time,date,evidence=null,material=null,eventId=null){
 const method=evidence?OPENING_MIGRATION_METHOD:'applyStockCostOperation',body={id:eventId||'stock-opening-'+privateDraftDigest([input.id,method]).slice(0,48),sequence:state.entries.length+1,previousHash:state.head,beforeDigest:state.stateDigest,input:structuredClone(input),actor:{userId:actor.userId,username:actor.username,role:actor.role},time,date,openingMaterial:material,...(evidence?{method,evidence}: {})},projection=projectStockLedger(state.projection,body);body.afterDigest=stockLedgerDigest(projection)
 const hash=stockLedgerDigest(body),receipt=stockLedgerAcknowledgement(body,hash,projection),operation={id:canonicalSignature([method,input.id]),method,operationId:input.id,actorId:actor.userId,signature:canonicalSignature(input),receipt}
 let next={...book,stockCostEntries:[...(book.stockCostEntries||[]),{...body,hash}],stockCostOperations:[...(book.stockCostOperations||[]),operation]}
 if(evidence){const quantities=new Map(evidence.products.map(p=>[p.id,p.afterUnits]));next.products=book.products.map(p=>quantities.has(p.id)?{...p,stock:quantities.get(p.id)/1000}:p)}
 next=withStockBookHead(set(next,'stockCostVersionFence','1'),hash);return {book:next,receipt,projection}
}
export function previewOpeningMigration(input,book,scope,actor,now=Date.now()){
 const parsed=readOpeningMigrationInput(input);assertMasterOwner(book,actor,input.scope);if(!same(input.scope,scope))bad('店面或帳號已變更，請保留原輸入核對。')
 const history=readOpeningMigrationHistory(book),prior=history.byId.get(input.id)
 if(prior){const original=JSON.parse(prior.signature),facts=value=>({...value,review:undefined,declaredValue:undefined});if(!same(facts(original),facts(input)))bad('同一期初搬家編號的內容不同，請保留原資料核對。');return {protocol:'pos-opening-migration-preview/v1',id:input.id,saved:prior,ready:false,rows:[],opening:[],source:parsed.source.source}}
 if(input.cutoffDate>salesDate(new Date(now)))bad('切換日尚未到，請保留草稿並核對日期。')
 let childInput=null,masterPreview=null;const mappings=new Map(readMasterMigrationHistory(book).mappings)
 if(parsed.masterSource){childInput=openingMasterRequest(input,parsed.masterSource);masterPreview=previewMasterMigration(childInput,book,scope,actor);if(masterPreview.saved)bad('主檔子批次已存在，請核對原始期初批次。');for(const row of masterPreview.rows)if(row.targetId)mappings.set(row.key,{targetId:row.targetId,unit:row.values.unit||row.before?.unit,name:row.values.name||row.before?.name})}
 else if(input.choices.length)bad('這份期初資料沒有主檔選擇，請保留原輸入核對。')
 const state=validateStockCostBook(book),opening=[],rows=[]
 for(const fact of parsed.opening){
  const sourceProductKey=openingSourceProductKey(parsed.source.source,fact.productExternalId),sourceRowKey=openingSourceRowKey(parsed.source.source,fact.externalId),mapped=mappings.get(sourceProductKey),product=mapped&&book.products.find(p=>p.id===mapped.targetId),unit=mapped?.unit||product?.unit,issues=[]
  if(!mapped)issues.push('missing-product');if(unit&&unit!==fact.unit)issues.push('unit-mismatch')
  if(history.byProduct.has(sourceProductKey)||history.byRow.has(sourceRowKey))issues.push('opening-already-saved')
  if(product?.stock||state.projection?.custody.sources.some(s=>s.productId===mapped?.targetId))issues.push('existing-stock-history')
  if(state.projection?.lots?.products.some(p=>p.productId===mapped?.targetId&&p.required))issues.push('lot-details-required')
  const row={fact,productId:mapped?.targetId||'',sourceProductKey,sourceRowKey};opening.push(row);rows.push({...row,name:mapped?.name||product?.name||fact.sourceName||fact.productExternalId,beforeUnits:product?Math.round(product.stock*1000):0,afterUnits:fact.quantityUnits,issues})
 }
 if(state.projection?.journals.some(j=>j.date>input.cutoffDate))bad('本店已有切換日之後的成本異動，請先核對開帳日期。')
 const blocked=rows.some(r=>r.issues.length)||masterPreview&&!masterPreview.ready,summary={currency:'TWD',rows:rows.length,totalValueCents:parsed.totalValueCents,clearingAccount:OPENING_CLEARING_ACCOUNT,independentTotalChecked:input.declaredValue!=='',quantityByUnit:Object.fromEntries([...new Set(parsed.opening.map(r=>r.unit))].map(unit=>[unit,parsed.opening.filter(r=>r.unit===unit).reduce((n,r)=>n+r.quantityUnits,0)]))}
 const review={protocol:'pos-opening-migration-review/v1',createdAt:now,scope:structuredClone(scope),dataDigest:privateDraftDigest(book),inputDigest:privateDraftDigest({...input,review:undefined}),rowsDigest:privateDraftDigest([masterPreview?.rows||[],rows]),summaryDigest:privateDraftDigest(summary)}
 const preview={protocol:'pos-opening-migration-preview/v1',id:input.id,ready:!blocked,source:parsed.source.source,cutoffDate:input.cutoffDate,masterRows:masterPreview?.rows||[],rows,opening,totalValueCents:parsed.totalValueCents,summary,review}
 // Exercise the very same master and custody projections before offering the
 // owner confirmation. This is a trial postimage, not a business write.
 if(preview.ready){try{const trial=projectOpeningMigrationBook({...input,review},preview,book,scope,actor,new Date(now).toISOString(),childInput,masterPreview);preview.trial={status:'projected-not-posted',valuation:costCustodySummary(trial.projection.custody),inventoryDeltaCents:parsed.totalValueCents,journalLines:trial.projection.journals.at(-1).lines}}catch(error){preview.ready=false;preview.trial={status:'blocked',error:error.message}}}
 return preview
}
export function verifyOpeningMigration(input,book,scope,actor,now=Date.now()){
 const preview=previewOpeningMigration(input,book,scope,actor,now);if(preview.saved){if(preview.saved.signature!==canonicalSignature(input))bad('請使用原期初請求核對已保存的批次。');return {preview,receipt:preview.saved}}
 if(!preview.ready||!input.review||!Number.isFinite(input.review.createdAt)||now-input.review.createdAt>15*60*1000||input.review.createdAt>now+5000||!same(input.review,{...preview.review,createdAt:input.review.createdAt}))bad('期初資料已變更或還有待確認項目，請重新看核對結果。')
 return {preview,receipt:null}
}
export function projectOpeningMigrationBook(input,preview,book,scope,actor,time,childInput=null,masterPreview=null){
 if(typeof time!=='string'||!Number.isFinite(Date.parse(time))||new Date(time).toISOString()!==time||Math.abs(Date.now()-Date.parse(time))>300000)bad('保存時間已過期，請重新核對。')
 let next=structuredClone(book),masterId=null,pendingMaster=null
 const parsed=readOpeningMigrationInput(input)
 if(parsed.masterSource){const child=childInput||openingMasterRequest(input,parsed.masterSource),view=masterPreview||previewMasterMigration(child,next,scope,actor),request={...child,review:{...view.review,createdAt:Date.parse(time)}},saved=appendBrowserMasterMigration(next,request,scope,actor,time,{deferOpeningReceipt:true});next=saved.book;masterId=saved.receipt.id;pendingMaster={request,receipt:saved.receipt}}
 let state=validateStockCostBook(next),bootstrapId=null;const bootstrap=openingBootstrap(next,scope,input,time)
 if(bootstrap){const added=appendOpeningCostBook(next,state,bootstrap.input,actor,time,input.cutoffDate,null,bootstrap.material);next=added.book;bootstrapId=bootstrap.input.id;state=validateStockCostBook(next)}
 const evidence=openingStockEvidence(preview,next),posted=appendOpeningCostBook(next,state,input,actor,time,input.cutoffDate,evidence);next=posted.book
 const receipt=makeOpeningMigrationReceipt(input,preview,readOpeningMigrationHistory(book),actor,time,posted.receipt,masterId,bootstrapId)
 if(pendingMaster)next=finishBrowserMasterMigration(next,pendingMaster.request,pendingMaster.receipt)
 next.auditLog.push(openingMigrationAudit(receipt));for(const key of ['agentTabularMigrationVersionFence','agentWorkbookMigrationVersionFence',OPENING_MIGRATION_FENCE])next=set(next,key,'1');next=set(next,OPENING_MIGRATION_HEAD,JSON.stringify(receipt.hash));readOpeningMigrationHistory(next);validateStockCostBook(next)
 return {book:next,receipt,projection:posted.projection,evidence,bootstrapId,masterId}
}
