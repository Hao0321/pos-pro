import {canonicalSignature} from './operationRules.mjs'
import {privateDraftDigest,draftObject} from './privateDrafts.mjs'
import {readMasterMigrationHistory,masterSourceKey} from './masterMigration.mjs'
import {readOpeningMigrationInput,openingMasterRequest,OPENING_MASTER_PROTOCOL,OPENING_MIGRATION_ACTION,OPENING_MIGRATION_METHOD,OPENING_MIGRATION_FENCE,OPENING_MIGRATION_HEAD,OPENING_CLEARING_ACCOUNT} from './openingMigrationSource.mjs'
import {readOpeningCutoverHistory} from './openingCutoverHistory.mjs'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),bad=()=>{throw Error('期初搬家回執需要核對，請保留原編號與原資料。')}
const setting=(book,key)=>{const rows=(book.settings||[]).filter(r=>r.key===key);if(rows.length>1)bad();return rows[0]?.value}
export const openingSourceProductKey=(source,id)=>masterSourceKey(source,'products',id)
export const openingSourceRowKey=(source,id)=>masterSourceKey(source,'opening-stock',id)
export function readOpeningMigrationHistory(book){
 try{
  const receipts=(book.auditLog||[]).filter(r=>r.action===OPENING_MIGRATION_ACTION).map(audit=>{const r=typeof audit.detail==='string'?JSON.parse(audit.detail):structuredClone(audit.detail);if(audit.id!=='opening-migration:'+r.id||audit.userId!==r.actor?.userId||audit.role!=='owner'||audit.timestamp!==r.time)bad();return r}).sort((a,b)=>a.sequence-b.sequence),byId=new Map(),byProduct=new Map(),byRow=new Map();let head=null
  const masters=readMasterMigrationHistory(book),children=new Set()
  for(const r of receipts){
   draftObject(r,['protocol','success','id','signature','sequence','previousHash','source','cutoffDate','rows','totalValueCents','clearingAccount','stockReceipt','masterId','bootstrapId','actor','time','hash'])
   const {source,opening,totalValueCents,masterSource,input}=readOpeningMigrationInput(JSON.parse(r.signature)),{hash,...body}=r
   if(r.protocol!=='pos-opening-migration-receipt/v1'||r.success!==true||r.id!==input.id||byId.has(r.id)||r.sequence!==receipts.indexOf(r)+1||r.previousHash!==head||hash!==privateDraftDigest(body)||input.review?.protocol!=='pos-opening-migration-review/v1'||r.actor?.role!=='owner'||r.actor.userId!==input.scope.userId||!same(r.source,source.source)||r.cutoffDate!==input.cutoffDate||r.totalValueCents!==totalValueCents||r.clearingAccount!==OPENING_CLEARING_ACCOUNT||!Array.isArray(r.rows)||r.rows.length!==opening.length||new Date(r.time).toISOString()!==r.time)bad()
   if(masterSource){const child=masters.byId.get(r.masterId),request=child&&JSON.parse(child.signature);if(!child||children.has(child.id)||!same({...request,review:undefined},openingMasterRequest(input,masterSource))||!same(child.actor,r.actor))bad();children.add(child.id)}else if(r.masterId!==null)bad()
   const event=(book.stockCostEntries||[]).find(e=>e.method===OPENING_MIGRATION_METHOD&&e.input.id===r.id),operation=(book.stockCostOperations||[]).find(e=>e.method===OPENING_MIGRATION_METHOD&&e.operationId===r.id)
   if(!event||canonicalSignature(event.input)!==r.signature||!same(event.evidence?.opening,r.rows)||!same(event.actor,r.actor)||!operation||!same(operation.receipt,r.stockReceipt)||!same(event.evidence?.products.map(p=>p.id),r.rows.map(row=>row.productId)))bad()
   r.rows.forEach((row,index)=>{draftObject(row,['fact','productId','sourceProductKey','sourceRowKey']);const fact=opening[index],productKey=openingSourceProductKey(source.source,fact.productExternalId),rowKey=openingSourceRowKey(source.source,fact.externalId),master=masters.mappings.get(productKey);if(!same(row.fact,fact)||row.sourceProductKey!==productKey||row.sourceRowKey!==rowKey||!master||master.targetId!==row.productId||byProduct.has(productKey)||byRow.has(rowKey))bad();byProduct.set(productKey,{receiptId:r.id,...row});byRow.set(rowKey,{receiptId:r.id,...row})})
   if(r.bootstrapId!==null&&!(book.stockCostOperations||[]).some(e=>e.method==='applyStockCostOperation'&&e.operationId===r.bootstrapId))bad()
   byId.set(r.id,r);head=r.hash
  }
  const stored=setting(book,OPENING_MIGRATION_HEAD);if((stored===undefined?null:JSON.parse(stored))!==head||receipts.length&&setting(book,OPENING_MIGRATION_FENCE)!=='1')bad()
  // A surviving cost event is not a substitute for the owner source receipt.
  for(const event of book.stockCostEntries||[])if(event.method===OPENING_MIGRATION_METHOD&&event.input.protocol!=='pos-opening-migration/v2'&&!byId.has(event.input.id))bad()
  for(const child of masters.receipts)if(JSON.parse(child.signature).protocol===OPENING_MASTER_PROTOCOL&&!children.has(child.id))bad()
  const cutovers=readOpeningCutoverHistory(book,masters)
  for(const [key,row]of cutovers.byProduct){if(byProduct.has(key))bad();byProduct.set(key,row)}
  for(const [key,row]of cutovers.byRow){if(byRow.has(key))bad();byRow.set(key,row)}
  return {receipts,byId,byProduct,byRow,head}
 }catch{bad()}
}
export function makeOpeningMigrationReceipt(input,preview,history,actor,time,stockReceipt,masterId,bootstrapId){
 const body={protocol:'pos-opening-migration-receipt/v1',success:true,id:input.id,signature:canonicalSignature(input),sequence:history.receipts.length+1,previousHash:history.head,source:preview.source,cutoffDate:input.cutoffDate,rows:structuredClone(preview.opening),totalValueCents:preview.totalValueCents,clearingAccount:OPENING_CLEARING_ACCOUNT,stockReceipt,masterId,bootstrapId,actor:{userId:actor.userId,username:actor.username,role:actor.role},time};return {...body,hash:privateDraftDigest(body)}
}
export function openingMigrationAudit(r){return {id:'opening-migration:'+r.id,action:OPENING_MIGRATION_ACTION,level:'info',label:'Agent 期初庫存搬入',userId:r.actor.userId,username:r.actor.username,role:r.actor.role,timestamp:r.time,detail:JSON.stringify(r)}}
export function assertOpeningMigrationResult(input,result){const r=result?.receipt;if(result?.success!==true||r?.success!==true||r.id!==input.id||r.signature!==canonicalSignature(input)||r.hash!==privateDraftDigest(Object.fromEntries(Object.entries(r).filter(([key])=>key!=='hash'))))bad();return result}
