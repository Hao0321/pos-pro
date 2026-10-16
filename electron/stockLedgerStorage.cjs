const {createHash,randomUUID}=require('node:crypto')
const {canonicalSignature}=require('./operationRules.mjs')
const {costCustodySummary}=require('./stockCustody.mjs')
const {planStockOpening,planOpeningCostPrice,stockCostCommand,stockLedgerError,STOCK_LEDGER_PROTOCOL}=require('./stockOpeningPlan.mjs')
const digest=value=>'sha256:'+createHash('sha256').update(typeof value==='string'?value:canonicalSignature(value)).digest('hex')
const METHOD='applyStockCostOperation'

// Connection-private write scope. No renderer or shared-store route exposes it.
// Unintegrated stock writers fail closed after an internal opening; activation
// will remain absent from the public UI until every business adapter is ready.
module.exports=function stockLedgerStorage(db){
 let depth=0
 db.function('pos_stock_write_allowed',()=>{if(!depth)throw stockLedgerError('FLOW');return 1})
 db.exec('CREATE TABLE IF NOT EXISTS stock_cost_entries (id TEXT PRIMARY KEY,sequence INTEGER UNIQUE NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS stock_cost_operations (id TEXT PRIMARY KEY,data TEXT NOT NULL);')
 const active=()=>!!db.prepare('SELECT 1 FROM stock_cost_entries LIMIT 1').get()
 function scope(work){depth++;try{return work()}finally{depth--}}
 function fence(){
  require('./databaseFeatureFence.cjs').installStockFence(db)
  const tables=['products','orders','order_items','purchases','restaurant_orders','restaurant_operations','waste_log','sales_documents','sales_operations','manual_journal','sales_runtime','stock_cost_entries','stock_cost_operations']
  for(const table of tables)for(const action of ['insert','update','delete'])db.exec(`CREATE TRIGGER IF NOT EXISTS pos_stock_commit_${table}_${action} BEFORE ${action.toUpperCase()} ON ${table} BEGIN SELECT pos_stock_write_allowed(); END;`)
  for(const action of ['insert','update','delete']){
   const row=action==='delete'?'OLD':'NEW'
   db.exec(`CREATE TRIGGER IF NOT EXISTS pos_stock_identity_${action} BEFORE ${action.toUpperCase()} ON settings WHEN ${row}.key IN ('sharedStoreId','restaurantConfig') BEGIN SELECT pos_stock_write_allowed(); END;`)
  }
  for(const table of ['stock_cost_entries','stock_cost_operations'])for(const action of ['update','delete'])db.exec(`CREATE TRIGGER IF NOT EXISTS pos_stock_immutable_${table}_${action} BEFORE ${action.toUpperCase()} ON ${table} BEGIN SELECT RAISE(ABORT,'庫存成本回執需要核對，請保留原編號與資料'); END;`)
 }
 function project(previous,body){
  const input=stockCostCommand(body.input)
  if(input.action==='open'){
   if(previous||typeof body.openingMaterial!=='string'||digest(body.openingMaterial)!==input.snapshotDigest)throw stockLedgerError('HISTORY')
   const material=JSON.parse(body.openingMaterial)
   if(material.profile!=='pos-stock-opening-preview/v1')throw stockLedgerError('HISTORY')
   const plan=planStockOpening(material.preview,input,body.date)
   return {version:1,custody:plan.custody,sourceEvidence:plan.sourceEvidence,legacyJournals:material.legacyJournal,legacyCostReviews:material.preview.legacyCostReviews,journals:[plan.journal]}
  }
  if(!previous||body.openingMaterial!==null)throw stockLedgerError('HISTORY')
  const plan=planOpeningCostPrice(previous,input,body.date)
  return {...previous,custody:plan.state,journals:[...previous.journals,plan.journal]}
 }
 const rows=table=>db.prepare('SELECT * FROM '+table+' ORDER BY id').all().map(row=>{const data=JSON.parse(row.data);if(row.id!==data.id||table==='stock_cost_entries'&&row.sequence!==data.sequence)throw stockLedgerError('HISTORY');return data})
 function read(){
  try{
   const entries=rows('stock_cost_entries').sort((a,b)=>a.sequence-b.sequence),operations=rows('stock_cost_operations')
   let projection=null,previousHash=null
   if(operations.length!==entries.length)throw stockLedgerError('HISTORY')
   const operationMap=new Map(operations.map(row=>[row.id,row]))
   for(let index=0;index<entries.length;index++){
    const {hash,...body}=entries[index]
    if(body.sequence!==index+1||body.previousHash!==previousHash||hash!==digest(body)||body.beforeDigest!==digest(projection)||body.actor?.role!=='owner'||typeof body.actor.userId!=='string'||!body.actor.userId)throw stockLedgerError('HISTORY')
    const next=project(projection,body)
    if(body.afterDigest!==digest(next))throw stockLedgerError('HISTORY')
    const operation=operationMap.get(canonicalSignature([METHOD,body.input.id]))
    const expectedReceipt={protocol:STOCK_LEDGER_PROTOCOL,success:true,id:body.input.id,eventId:body.id,eventHash:hash,stateDigest:body.afterDigest,sequence:body.sequence,valuation:costCustodySummary(next.custody)}
    if(!operation||operation.method!==METHOD||operation.operationId!==body.input.id||operation.actorId!==body.actor.userId||operation.signature!==canonicalSignature(body.input)||canonicalSignature(operation.receipt)!==canonicalSignature(expectedReceipt))throw stockLedgerError('HISTORY')
    projection=next;previousHash=hash
   }
   return {entries,operations,projection,head:previousHash,stateDigest:digest(projection),valuation:projection?costCustodySummary(projection.custody):null}
  }catch(error){if(error.code==='STOCK_LEDGER_HISTORY')throw error;throw stockLedgerError('HISTORY')}
 }
 function lookup(input,actor){
  const saved=db.prepare('SELECT data FROM stock_cost_operations WHERE id=?').get(canonicalSignature([METHOD,input.id]))
  if(!saved)return null
  const current=read(),row=current.operations.find(row=>row.operationId===input.id)
  if(!row||row.actorId!==actor.userId||row.signature!==canonicalSignature(input))throw stockLedgerError('HISTORY')
  return structuredClone(row.receipt)
 }
 function append(input,actor,{openingMaterial=null,time,date}){
  if(!db.inTransaction)throw stockLedgerError('HISTORY')
  const before=read(),body={id:'stock-'+randomUUID(),sequence:before.entries.length+1,previousHash:before.head,beforeDigest:before.stateDigest,input,actor:{userId:actor.userId,username:actor.username,role:actor.role},time,date,openingMaterial}
  const projection=project(before.projection,body);body.afterDigest=digest(projection)
  const hash=digest(body),receipt={protocol:STOCK_LEDGER_PROTOCOL,success:true,id:input.id,eventId:body.id,eventHash:hash,stateDigest:body.afterDigest,sequence:body.sequence,valuation:costCustodySummary(projection.custody)}
  const operation={id:canonicalSignature([METHOD,input.id]),method:METHOD,operationId:input.id,actorId:actor.userId,signature:canonicalSignature(input),receipt}
  scope(()=>{
   fence()
   db.prepare('INSERT INTO stock_cost_entries (id,sequence,data) VALUES (?,?,?)').run(body.id,body.sequence,canonicalSignature({...body,hash}))
   db.prepare('INSERT INTO stock_cost_operations (id,data) VALUES (?,?)').run(operation.id,canonicalSignature(operation))
  })
  read()
  return receipt
 }
 if(active())db.transaction(()=>{fence();read()})()
 return {active,read,lookup,append,scope}
}
