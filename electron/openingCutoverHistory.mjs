import {canonicalSignature} from './operationRules.mjs'
import {privateDraftDigest,draftObject} from './privateDrafts.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {readMasterMigrationHistory,masterSourceKey} from './masterMigration.mjs'
import {readOpeningCutoverInput,openingCutoverMasterRequest} from './openingCutoverSource.mjs'
import {OPENING_CUTOVER_ACTION,OPENING_RAW_CUTOVER_RECEIPT,isOpeningCutoverMaster,isOpeningCutoverProtocol,OPENING_CUTOVER_FENCE,OPENING_CUTOVER_HEAD,OPENING_ACTIVATION,readOpeningCutoverProof,openingActivationRequest,cutoverError} from './openingCutoverRules.mjs'
import {openingBalanceContextFromCutovers} from './openingBalanceLedger.mjs'
import {openingBalanceSourceProfile,openingFinancialCustomerId,openingFinancialSupplierId} from './openingBalanceParties.mjs'

const bad=()=>{throw cutoverError()},same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const setting=(book,key)=>{const rows=(book.settings||[]).filter(row=>row.key===key);if(rows.length>1)bad();return rows[0]?.value}
export const openingCustomerCreateId=(parentId,key)=>'opening-profile-'+privateDraftDigest([parentId,key]).slice(0,48)
const profile=value=>({id:value.id,name:value.name,...Object.fromEntries(['contact','phone','email','address','note'].map(key=>[key,value[key]??'']))})
function assertRecordReceipt(event,operations,receivable){
 const matches=(operations||[]).filter(row=>row.id===event.id),expected={id:event.id,kind:receivable?'customer-ledger':'supplier-ledger',action:event.action,...(receivable?{customerId:event.customerId}:{supplierId:event.supplierId||null}),revision:event.revision,signature:canonicalSignature(event.input),event:canonicalSignature(event),cashLogId:event.cashLogId||null,...(receivable?{}:{internal:false})}
 if(matches.length!==1||!same(matches[0],expected))bad()
}
function profilesAt(entries,revision){const rows=new Map();for(const event of [...entries].sort((a,b)=>a.revision-b.revision)){if(event.revision>revision)break;if(['customer-create','customer-update'].includes(event.action))rows.set(event.customerId,event.customer)}return rows}
export function readOpeningCutoverHistory(book,masterHistory=null){
 try{return inspect(book,masterHistory)}catch{bad()}
}
function inspect(book,masterHistory){
 const audits=(book.auditLog||[]).filter(row=>row.action===OPENING_CUTOVER_ACTION||String(row.id).startsWith('opening-cutover:')),receipts=audits.map(audit=>{
  const receipt=typeof audit.detail==='string'?JSON.parse(audit.detail):structuredClone(audit.detail)
  if(audit.action!==OPENING_CUTOVER_ACTION||audit.id!=='opening-cutover:'+receipt.id||audit.timestamp!==receipt.time||audit.userId!==receipt.actor?.userId||audit.username!==receipt.actor?.username||audit.role!=='owner')bad()
  return receipt
 }).sort((a,b)=>a.sequence-b.sequence),byId=new Map(),byProduct=new Map(),byRow=new Map(),children=new Set(),barriers=new Set(),partyTargets=new Map(),storeId=readExchangeTextSetting(book.settings||[],'sharedStoreId')
 const flag=setting(book,OPENING_CUTOVER_FENCE),rawFlag=setting(book,'financialFileMigrationVersionFence');if(flag!==undefined&&flag!=='1'||rawFlag!==undefined&&rawFlag!=='1'||receipts.some(row=>row.protocol===OPENING_RAW_CUTOVER_RECEIPT)&&rawFlag!=='1')bad()
 const masters=masterHistory||readMasterMigrationHistory(book);let head=null
 const oldProducts=new Set(),oldRows=new Set()
 for(const audit of book.auditLog||[])if(audit.action==='AGENT_OPENING_MIGRATION'){const saved=typeof audit.detail==='string'?JSON.parse(audit.detail):audit.detail;for(const row of saved.rows||[]){oldProducts.add(row.sourceProductKey);oldRows.add(row.sourceRowKey)}}
 for(const [index,r]of receipts.entries()){
  const proof=readOpeningCutoverProof(r,storeId),{input,parsed:finance}=proof,{stock,work}=readOpeningCutoverInput(input)
  if(r.sequence!==index+1||r.previousHash!==head||byId.has(r.id)||flag!=='1'||r.totalValueCents!==stock.totalValueCents)bad()
  const expectedCustody=finance.source.tables.flatMap((table,tableIndex)=>table.rows.map((row,rowIndex)=>({table:tableIndex,row:rowIndex,entity:table.entity,externalId:row.externalId,role:table.entity==='customers'&&finance.parties.some(p=>p.side==='receivable'&&p.externalId===row.externalId)?'financial-customer':['products','customers','suppliers'].includes(table.entity)?'master':table.entity==='opening-stock'?'stock':'financial-document'})))
  if(r.custodyDigest!==privateDraftDigest(expectedCustody))bad()
  const request=openingCutoverMasterRequest(input),child=request?masters.byId.get(r.masterId):null
  if(request){if(!child||children.has(child.id)||!same({...JSON.parse(child.signature),review:undefined},request)||!same(child.actor,r.actor))bad();children.add(child.id)}else if(r.masterId!==null)bad()
  const financialProfiles=profilesAt(book.customerEntries||[],r.customerRevision),mappings=new Map(r.partyMappings.map(row=>[row.key,row])),creates=new Map()
  for(const item of r.customerCreates){
   draftObject(item,['sourceKey','customerId','operationId','revision','profile'])
   draftObject(item.profile,['id','name','contact','phone','email','address','note'],['id','name'])
   const party=finance.parties.find(p=>p.key===item.sourceKey&&p.side==='receivable'),source=party&&openingBalanceSourceProfile(finance,party),mapped=mappings.get(item.sourceKey),event=(book.customerEntries||[]).find(row=>row.id===item.operationId)
   if(!party||source.issues.length||creates.has(item.sourceKey)||item.customerId!==openingFinancialCustomerId(storeId,party.key)||item.operationId!==openingCustomerCreateId(r.id,party.key)||mapped.targetId!==item.customerId||!event||event.action!=='customer-create'||event.customerId!==item.customerId||event.revision!==item.revision||item.revision>=r.customerRevision||event.time!==r.time||event.date!==r.cutoffDate||!same(event.actor,r.actor)||!same(profile(item.profile),profile({id:item.customerId,...source.values}))||!same(event.customer,profile(item.profile)))bad()
   assertRecordReceipt(event,book.customerOperations,true);creates.set(item.sourceKey,item)
  }
  const suppliers=new Map()
  for(const item of r.supplierCreates){
   draftObject(item,['sourceKey','supplierId','values']);const party=finance.parties.find(p=>p.key===item.sourceKey&&p.side==='payable'),source=party&&openingBalanceSourceProfile(finance,party),mapped=mappings.get(item.sourceKey)
   if(!party||source.issues.length||suppliers.has(item.sourceKey)||item.supplierId!==openingFinancialSupplierId(storeId,finance.source.source,party.externalId)||mapped.targetId!==item.supplierId||!same(item.values,{id:item.supplierId,name:party.name})||child?.rows.some(row=>row.entity==='suppliers'&&row.externalId===party.externalId)||!(book.suppliers||[]).some(row=>row.id===item.supplierId))bad()
   suppliers.set(item.sourceKey,item)
  }
  for(const party of finance.parties){
   const mapped=mappings.get(party.key),prior=partyTargets.get(party.key),choice=input.partyChoices.find(row=>row.key===party.key),source=openingBalanceSourceProfile(finance,party)
   if(source.issues.length||prior&&prior!==mapped.targetId)bad()
   if(party.side==='receivable'){
    const current=financialProfiles.get(mapped.targetId);if(!current||current.name!==mapped.targetName)bad()
    if(!prior){if(choice?.action==='existing'){if(choice.targetId!==mapped.targetId||choice.expectedName!==mapped.targetName||creates.has(party.key))bad()}else if(!creates.has(party.key))bad()}
   }else{
    const master=child?.rows.find(row=>row.entity==='suppliers'&&row.externalId===party.externalId)
    if(!(book.suppliers||[]).some(row=>row.id===mapped.targetId)||master&&(master.targetId!==mapped.targetId||master.applied.name!==mapped.targetName))bad()
    if(!prior&&!master){if(choice?.action==='existing'){if(choice.targetId!==mapped.targetId||choice.expectedName!==mapped.targetName||suppliers.has(party.key))bad()}else if(!suppliers.has(party.key))bad()}
   }
   partyTargets.set(party.key,mapped.targetId)
  }
  for(const side of ['receivable','payable']){
   const receivable=side==='receivable',id=receivable?r.customerBarrierId:r.supplierBarrierId,entries=receivable?book.customerEntries:book.supplierEntries,revision=receivable?r.customerRevision:r.supplierRevision,event=(entries||[]).find(row=>row.id===id),expected=openingActivationRequest(r,side,input.scope)
   if(barriers.has(id)||!event||event.action!==OPENING_ACTIVATION||event.revision!==revision||event.openingBatchId!==r.id||event.sourceDigest!==r.sourceDigest||!same(event.actor,r.actor)||!same(event.input,expected))bad()
   assertRecordReceipt(event,receivable?book.customerOperations:book.supplierOperations,receivable);barriers.add(id)
  }
  const event=(book.stockCostEntries||[]).find(row=>row.method==='applyOpeningMigration'&&row.input.id===r.id),operation=(book.stockCostOperations||[]).find(row=>row.method==='applyOpeningMigration'&&row.operationId===r.id)
  if(stock.opening.length){
   if(!event||!operation||!same(event.input,input)||!same(event.actor,r.actor)||!same(event.evidence?.opening,r.rows)||!same(operation.receipt,r.stockReceipt)||r.rows.length!==stock.opening.length)bad()
   for(const [position,row]of r.rows.entries()){
    draftObject(row,['fact','productId','sourceProductKey','sourceRowKey']);const fact=stock.opening[position],productKey=masterSourceKey(finance.source.source,'products',fact.productExternalId),rowKey=masterSourceKey(finance.source.source,'opening-stock',fact.externalId),target=masters.mappings.get(productKey)
    if(!same(row.fact,fact)||row.sourceProductKey!==productKey||row.sourceRowKey!==rowKey||target?.targetId!==row.productId||byProduct.has(productKey)||byRow.has(rowKey)||oldProducts.has(productKey)||oldRows.has(rowKey))bad();byProduct.set(productKey,{receiptId:r.id,...row});byRow.set(rowKey,{receiptId:r.id,...row})
   }
  }else if(event||operation||r.stockReceipt!==null||r.bootstrapId!==null||r.rows.length)bad()
  if(r.bootstrapId!==null&&!(book.stockCostOperations||[]).some(row=>row.method==='applyStockCostOperation'&&row.operationId===r.bootstrapId))bad()
  if(work.source.tables.length!==0&&!child)bad()
  byId.set(r.id,r);head=r.hash
 }
 const stored=setting(book,OPENING_CUTOVER_HEAD);if((stored===undefined?null:JSON.parse(stored))!==head)bad()
 for(const child of masters.receipts)if(isOpeningCutoverMaster(JSON.parse(child.signature).protocol)&&!children.has(child.id))bad()
 for(const entry of [...(book.customerEntries||[]),...(book.supplierEntries||[])])if(entry.action===OPENING_ACTIVATION&&!barriers.has(entry.id))bad()
 for(const entry of book.stockCostEntries||[])if(entry.method==='applyOpeningMigration'&&isOpeningCutoverProtocol(entry.input?.protocol)&&!byId.has(entry.input.id))bad()
 const context=openingBalanceContextFromCutovers(storeId,receipts)
 return {receipts,byId,byProduct,byRow,head,context}
}
export function openingCutoverAudit(r){return {id:'opening-cutover:'+r.id,action:OPENING_CUTOVER_ACTION,level:'info',label:'Agent 原帳款與庫存搬入',userId:r.actor.userId,username:r.actor.username,role:r.actor.role,timestamp:r.time,detail:JSON.stringify(r)}}
