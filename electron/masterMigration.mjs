import {readMigrationDraft} from './migrationSource.mjs'
import {draftObject,privateDraftDigest,assertPrivateDraftContext} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {decimalUnits} from './decimalUnits.mjs'

export const MASTER_MIGRATION_METHOD='applyMasterMigration'
export const MASTER_MIGRATION_ACTION='AGENT_MASTER_MIGRATION'
export const MASTER_MIGRATION_FEATURE='agent-master-migration-v1'
export const MASTER_MIGRATION_FENCE='agentMasterMigrationVersionFence'
export const MASTER_MIGRATION_HEAD='agentMasterMigrationHead'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const fail=(message='搬家紀錄需要核對，原資料仍保留。')=>{throw Error(message)}
const digest=privateDraftDigest
const collection={products:'products',suppliers:'suppliers',customers:'members'}
const aliases={
  name:['name','商品名稱','品名','item name','item_name','supplier name','供應商名稱','供應商','customer name','客戶名稱','姓名','客戶'],
  barcode:['barcode','條碼','ean'],unit:['unit','單位','uom','stock uom','基本單位'],
  price:['price','售價','selling price','standard price'],cost:['cost','成本','valuation rate','參考成本'],
  stock:['stock','庫存','quantity','qty','opening stock','期初庫存'],
  category:['category','分類'],supplier:['supplier id','supplier_id','供應商編號'],
  phone:['phone','電話','手機','mobile'],contact:['contact','聯絡人'],payTerms:['payment terms','payterms','付款條件'],
  note:['note','notes','備註'],birthday:['birthday','生日'],
  balance:['balance','儲值','儲值餘額','credit','outstanding','欠款','未收款','未付款'],
  points:['points','點數'],totalSpent:['totalspent','total spent','累計消費'],currency:['currency','幣別','currency code','貨幣']
}
const fields={products:['name','barcode','unit','price','cost','category','supplierId'],suppliers:['name','contact','phone','payTerms','note'],customers:['name','phone','birthday','note']}
const emptyCounts=()=>({create:0,update:0,keep:0,unchanged:0,blocked:0})
export const masterSourceKey=(source,entity,externalId)=>canonicalSignature([source.system,source.company,entity,externalId])
export const masterMigrationId=(source,scope)=>'migration-'+digest([scope.storeId,source.source.system,source.source.company,source.id]).slice(0,48)
export function assertMasterOwner(book,actor,scope=null){
  const user=book.users.find(row=>row.id===actor?.userId)
  if(actor?.role!=='owner'||user?.role!=='owner'||user.username!==actor.username)fail('只有目前店主能確認搬入資料。')
  if(scope){assertPrivateDraftContext(scope);if(scope.role!=='owner'||scope.userId!==actor.userId)fail('店面或帳號已變更，請保留原輸入核對。')}
}
function setting(book,key){return (book.settings||[]).find(row=>row.key===key)?.value??null}
export function readMasterMigrationHistory(book){try{return inspectMasterMigrationHistory(book)}catch{fail()}}
function inspectMasterMigrationHistory(book){
  const audits=(book.auditLog||[]).filter(row=>row.action===MASTER_MIGRATION_ACTION||String(row.id).startsWith('master-migration:'))
  const receipts=audits.map(audit=>{
    const receipt=typeof audit.detail==='string'?JSON.parse(audit.detail):audit.detail
    if(audit.action!==MASTER_MIGRATION_ACTION||audit.id!=='master-migration:'+receipt?.id||audit.userId!==receipt.actor?.userId||audit.role!=='owner'||audit.username!==receipt.actor.username)fail()
    const {hash,...body}=receipt
    if(hash!==digest(body)||body.protocol!=='pos-master-migration-receipt/v1'||body.success!==true||!Number.isSafeInteger(body.sequence)||body.sequence<1||!Array.isArray(body.rows)||!Number.isFinite(Date.parse(body.time)))fail()
    const request=JSON.parse(body.signature),source=readMasterMigrationInput(request).source
    if(body.signature!==canonicalSignature(request)||request.id!==body.id||request.scope.userId!==body.actor.userId||!same(body.source,source.source)||body.rows.length!==source.tables.reduce((n,t)=>n+t.rows.length,0))fail()
    let position=0;const counts=emptyCounts(),keys=new Set()
    for(const [ti,table]of source.tables.entries())for(const [ri,row]of table.rows.entries()){
      const item=body.rows[position++]
      if(item.table!==ti||item.row!==ri||item.entity!==table.entity||item.externalId!==row.externalId||item.key!==masterSourceKey(source.source,table.entity,row.externalId)||item.sourceDigest!==digest([table.columns,row])||!collection[item.entity]||typeof item.targetId!=='string'||!item.targetId||!['create','update','keep','unchanged'].includes(item.action)||!item.applied||!item.sourceValues||[item.applied,item.sourceValues].some(value=>Object.keys(value).some(key=>!fields[item.entity].includes(key)))||keys.has(item.key))fail()
      keys.add(item.key);counts[item.action]++
    }
    if(!same(counts,receipt.counts)||!same(receipt.counts,request.review?.counts)||request.review.protocol!=='pos-master-migration-review/v1')fail()
    return receipt
  }).sort((a,b)=>a.sequence-b.sequence)
  let head=null;const byId=new Map(),mappings=new Map()
  for(const [index,receipt]of receipts.entries()){
    if(receipt.sequence!==index+1||receipt.previousHash!==head||byId.has(receipt.id))fail()
    byId.set(receipt.id,receipt);head=receipt.hash
    for(const row of receipt.rows)mappings.set(row.key,row)
  }
  const rawHead=setting(book,MASTER_MIGRATION_HEAD),savedHead=rawHead===null?null:JSON.parse(rawHead)
  if(savedHead!==null&&(typeof savedHead!=='string'||!/^[a-f0-9]{64}$/.test(savedHead))||head!==savedHead||receipts.length&&setting(book,MASTER_MIGRATION_FENCE)!=='1')fail()
  return {receipts,byId,mappings,head}
}
export function readMasterMigrationInput(input){
  draftObject(input,['protocol','id','sourceText','choices','scope','review'],['protocol','id','sourceText','choices','scope'])
  if(input.protocol!=='pos-master-migration/v1'||typeof input.sourceText!=='string'||!Array.isArray(input.choices)||input.choices.length>5000)fail()
  assertPrivateDraftContext(input.scope)
  const source=readMigrationDraft(input.sourceText)
  if(input.id!==masterMigrationId(source,input.scope))fail()
  const seen=new Set()
  for(const choice of input.choices){
    draftObject(choice,['table','row','targetId','resolution'],['table','row','targetId'])
    const table=source.tables[choice.table],row=table?.rows[choice.row],key=choice.table+':'+choice.row
    if(!Number.isSafeInteger(choice.table)||!Number.isSafeInteger(choice.row)||!row||typeof choice.targetId!=='string'||choice.targetId.length>128||choice.resolution!==undefined&&!['keep','source'].includes(choice.resolution)||seen.has(key))fail()
    seen.add(key)
  }
  return {input:structuredClone(input),source}
}
export function makeMasterMigrationInput(sourceText,scope,choices=[]){
  const source=readMigrationDraft(sourceText)
  return {protocol:'pos-master-migration/v1',id:masterMigrationId(source,scope),sourceText,choices:structuredClone(choices),scope:structuredClone(scope)}
}
function columnsFor(table){
  return Object.fromEntries(Object.entries(aliases).flatMap(([field,names])=>{
    const indices=table.columns.flatMap((name,index)=>names.includes(name.trim().toLowerCase())?[index]:[])
    return indices.length?[[field,indices]]:[]
  }))
}
function sourceRows(source){return source.tables.flatMap((table,ti)=>table.rows.map((row,ri)=>({table:ti,row:ri,entity:table.entity,externalId:row.externalId,key:masterSourceKey(source.source,table.entity,row.externalId),sourceDigest:digest([table.columns,row]),columns:columnsFor(table),sourceRow:row,headers:table.columns})))}
function extractRow(row){
  const values={},issues=[],unused=[]
  const used=new Set()
  for(const [field,indices]of Object.entries(row.columns)){
    indices.forEach(i=>used.add(i))
    if(indices.length!==1){issues.push('ambiguous-column');continue}
    const raw=row.sourceRow.values[indices[0]]
    if(['stock','balance','points','totalSpent'].includes(field)){
      try{if(decimalUnits(raw,field==='stock'?3:2,1e12,'invalid')!==0)issues.push('needs-ledger-mapping')}catch{issues.push('needs-ledger-mapping')}
    }else if(field==='currency'){
      // Current operational prices are TWD. A currency label never supplies an exchange rate.
      if(raw!=='TWD')issues.push('needs-currency')
    }else if(['price','cost'].includes(field)){
      if(row.entity==='products')try{values[field]=decimalUnits(raw,2,1e11,'invalid')/100}catch{issues.push('invalid-'+field)}
      else if(raw.trim())issues.push('needs-ledger-mapping')
    }else if(fields[row.entity]?.includes(field)||field==='supplier'&&row.entity==='products'){
      if(raw.length>(field==='note'?2048:256)||raw.includes('\u0000'))issues.push('invalid-text')
      else values[field]=raw
    }else if(raw.trim())unused.push(row.headers[indices[0]])
  }
  row.headers.forEach((name,i)=>{if(!used.has(i))unused.push(name)})
  if(!values.name?.trim())issues.push('missing-name')
  if(row.entity==='products'){
    if(!values.unit?.trim())issues.push('missing-unit')
    if(values.price===undefined)issues.push('missing-price')
  }
  if(values.birthday){const date=new Date(values.birthday+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(values.birthday)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==values.birthday)issues.push('invalid-birthday')}
  return {values,issues:[...new Set(issues)],unused}
}
function targetFields(entity,target,keys=fields[entity]){return Object.fromEntries(keys.filter(key=>Object.hasOwn(target,key)).map(key=>[key,target[key]]))}
function candidatesFor(book,row,values){
  return (book[collection[row.entity]]||[]).filter(target=>target.name===values.name||row.entity==='products'&&values.barcode&&target.barcode===values.barcode||row.entity==='customers'&&values.phone&&target.phone?.replace(/[\s()-]/g,'')===values.phone.replace(/[\s()-]/g,''))
}
function chooseRow(book,row,history,choice,source,scope){
  const parsed=extractRow(row),values=parsed.values,prior=history.mappings.get(row.key),candidates=candidatesFor(book,row,values),items=book[collection[row.entity]]||[]
  let targetId=prior?.targetId||choice?.targetId||'',target=items.find(item=>item.id===targetId),issues=[...parsed.issues]
  if(!collection[row.entity])issues.push('needs-ledger-mapping')
  if(!row.externalId.trim())issues.push('missing-source-id')
  if(prior&&choice?.targetId&&choice.targetId!==prior.targetId)issues.push('source-target-changed')
  if(prior&&!target)issues.push('missing-target')
  if(!prior&&!targetId){
    if(candidates.length&&!choice)issues.push('choose-target')
    else targetId='migr-'+row.entity[0]+'-'+digest([scope.storeId,row.key]).slice(0,40)
  }else if(!prior&&targetId&&!target)issues.push('missing-target')
  target=items.find(item=>item.id===targetId)
  if(!prior&&target&&!candidates.some(item=>item.id===targetId))issues.push('invalid-target-choice')
  return {...row,sourceRow:undefined,columns:undefined,headers:undefined,sourceDigest:row.sourceDigest,values,unused:parsed.unused,issues:[...new Set(issues)],targetId,action:target?'update':'create',resolution:choice?.resolution||null,candidates:candidates.map(item=>({id:item.id,name:item.name,phone:item.phone||'',barcode:item.barcode||''})),before:target?targetFields(row.entity,target):null,prior:prior||null}
}
function mergeSourceValues(row){
  row.sourceValues=structuredClone(row.values)
  if(!row.before)return
  if(row.prior?.sourceDigest===row.sourceDigest){row.action='unchanged';row.values={};return}
  if(row.resolution==='keep'){row.action='keep';row.values={};return}
  if(!row.prior&&row.resolution!=='source'){row.issues.push('local-change');return}
  if(row.prior&&row.resolution!=='source')for(const [key,value]of Object.entries(row.sourceValues)){
    const baseline=row.prior.sourceValues,local=row.before[key]
    if(Object.hasOwn(baseline,key)){
      if(same(value,baseline[key]))delete row.values[key]
      else if(!same(local,baseline[key])&&!same(local,value))row.issues.push('local-change')
    }else if(local!==undefined&&local!==''&&!same(local,value))row.issues.push('local-change')
  }
  if(Object.entries(row.values).every(([key,value])=>same(row.before[key],value)))row.action='unchanged'
  if(row.entity==='products'&&row.sourceValues.unit!==row.before.unit&&row.action==='update')row.issues.push('unit-change')
}
export function previewMasterMigration(input,book,scope,actor){
  const {source}=readMasterMigrationInput(input);assertMasterOwner(book,actor,input.scope)
  if(!same(input.scope,scope))fail('店面或帳號已變更，請保留原輸入核對。')
  const history=readMasterMigrationHistory(book),prior=history.byId.get(input.id)
  if(prior){if(prior.signature!==canonicalSignature(input)&&prior.signature!==canonicalSignature({...input,review:JSON.parse(prior.signature).review}))fail('同一搬家編號的內容不同，請保留原資料核對。');return {protocol:'pos-master-migration-preview/v1',id:input.id,saved:prior,ready:false,rows:[],counts:prior.counts,source:source.source}}
  const rows=sourceRows(source).map(row=>chooseRow(book,row,history,input.choices.find(item=>item.table===row.table&&item.row===row.row),source,scope)),seen=new Set(),targets=new Set(),barcodes=new Set()
  for(const row of rows){
    if(seen.has(row.key))row.issues.push('duplicate-source-id');seen.add(row.key)
    const key=row.entity+':'+row.targetId;if(row.targetId&&targets.has(key))row.issues.push('duplicate-target');targets.add(key)
    if(row.entity==='products'&&row.values.supplier){
      const key=masterSourceKey(source.source,'suppliers',row.values.supplier),parent=rows.find(item=>item.key===key),mapped=history.mappings.get(key),targetId=parent?.targetId||mapped?.targetId
      if(!targetId||!parent&&!book.suppliers.some(item=>item.id===targetId))row.issues.push('missing-supplier')
      else{row.values.supplierId=targetId;row.supplierLabel=parent?.values.name||book.suppliers.find(item=>item.id===targetId)?.name||targetId}
    }
    delete row.values.supplier
    if(row.entity==='products'&&row.before?.supplierId)row.beforeSupplierLabel=book.suppliers.find(item=>item.id===row.before.supplierId)?.name||row.before.supplierId
    mergeSourceValues(row)
    if(row.entity==='products'&&row.values.barcode){
      if(barcodes.has(row.values.barcode)||book.products.some(item=>item.id!==row.targetId&&item.barcode===row.values.barcode))row.issues.push('duplicate-barcode')
      barcodes.add(row.values.barcode)
    }
    row.issues=[...new Set(row.issues)];row.action=row.issues.length?'blocked':row.action
  }
  const counts=emptyCounts();for(const row of rows)counts[row.action]++
  const review={protocol:'pos-master-migration-review/v1',createdAt:Date.now(),scope:structuredClone(scope),dataDigest:digest(book),inputDigest:digest({...input,review:undefined}),rowsDigest:digest(rows),counts}
  return {protocol:'pos-master-migration-preview/v1',id:input.id,source:source.source,rows,counts,ready:counts.blocked===0,review}
}
export function verifyMasterMigration(input,book,scope,actor){
  const preview=previewMasterMigration(input,book,scope,actor)
  if(preview.saved)return {preview,receipt:preview.saved}
  if(!preview.ready||!input.review||!Number.isFinite(input.review.createdAt)||Date.now()-input.review.createdAt>15*60*1000||input.review.createdAt>Date.now()+5000||!same(input.review,{...preview.review,createdAt:input.review.createdAt}))fail('資料已變更或還有待確認項目，請重新看核對結果。')
  return {preview,receipt:null}
}
export function masterMigrationReceipt(input,preview,history,actor,time,actual){
  const rows=preview.rows.map(row=>{
    const target=actual[collection[row.entity]].find(item=>item.id===row.targetId)
    if(!target)fail('搬入筆數尚未核對，原資料仍保留。')
    if(['create','update'].includes(row.action)&&Object.entries(row.values).some(([key,value])=>!same(target[key],value)))fail('搬入內容尚未核對，原資料仍保留。')
    // Keep the latest known SOURCE values separately from actual local values.
    // Omitted columns retain their last source baseline; an explicit Keep never
    // turns the retained local data into a claimed source value.
    const sourceValues={...(row.prior?.sourceValues||{}),...row.sourceValues},applied=targetFields(row.entity,target)
    return {table:row.table,row:row.row,entity:row.entity,externalId:row.externalId,key:row.key,sourceDigest:row.sourceDigest,targetId:row.targetId,action:row.action,applied,sourceValues}
  })
  const body={protocol:'pos-master-migration-receipt/v1',success:true,id:input.id,signature:canonicalSignature(input),sequence:history.receipts.length+1,previousHash:history.head,source:preview.source,counts:preview.counts,rows,actor:{userId:actor.userId,username:actor.username,role:actor.role},time}
  return {...body,hash:digest(body)}
}
export function masterMigrationAudit(receipt){return {id:'master-migration:'+receipt.id,action:MASTER_MIGRATION_ACTION,level:'info',label:'Agent 主檔搬入',userId:receipt.actor.userId,username:receipt.actor.username,role:receipt.actor.role,timestamp:receipt.time,detail:JSON.stringify(receipt)}}
export function assertMasterMigrationResult(input,result){
  const receipt=result?.receipt
  if(result?.success!==true||receipt?.success!==true||receipt.id!==input.id||receipt.signature!==canonicalSignature(input)||receipt.hash!==digest(Object.fromEntries(Object.entries(receipt).filter(([key])=>key!=='hash')))||receipt.counts.blocked!==0)fail('搬入結果尚未確認，請保留原編號再核對。')
  return result
}
