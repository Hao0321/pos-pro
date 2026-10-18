import {readMasterMigrationHistory,verifyMasterMigration,masterMigrationReceipt,masterMigrationAudit,MASTER_MIGRATION_HEAD,MASTER_MIGRATION_FENCE} from './masterMigration.mjs'
import {planBrowserStockBusiness} from './browserStockPlan.mjs'
import {appendBrowserStockBusiness} from './browserStockCommit.mjs'
import {validateStockCostBook} from './stockBackup.mjs'
import {privateDraftDigest} from './privateDrafts.mjs'
import {TABULAR_MIGRATION_PROTOCOL,TABULAR_MIGRATION_FENCE} from './tabularMigration.mjs'
import {readMigrationDraft} from './migrationSource.mjs'

export function appendBrowserMasterMigration(book,input,scope,actor,time){
  const {preview,receipt}=verifyMasterMigration(input,book,scope,actor)
  if(receipt)return {book,receipt}
  const history=readMasterMigrationHistory(book);let next=structuredClone(book)
  for(const entity of ['suppliers','products','customers'])for(const row of preview.rows.filter(row=>row.entity===entity&&['create','update'].includes(row.action))){
    const value={...row.values,id:row.targetId},create=row.action==='create'
    if(entity==='products'){
      const state=validateStockCostBook(next),method=create?'addProduct':'updateProduct',request=create?{...value,stock:0}:{id:row.targetId,data:row.values},runtime={epoch:scope.epoch,state,timestamp:time,eventId:'stock-migration-'+privateDraftDigest([input.id,row.key]).slice(0,40)}
      if(!create&&!state.projection)next.products=next.products.map(item=>item.id===row.targetId?{...item,...row.values}:item)
      else{
        const planned=planBrowserStockBusiness(next,runtime,method,request,actor).book
        next=state.projection?appendBrowserStockBusiness(next,planned,state,{method,request,actor,timestamp:time},runtime):planned
      }
    }else{
      const key=entity==='suppliers'?'suppliers':'members'
      if(create){
        const defaults=entity==='suppliers'?{name:'',contact:'',phone:'',payTerms:'',note:'',catalog:[]}:{name:'',phone:'',points:0,tier:'normal',totalSpent:0,joinDate:time.slice(0,10),balance:0,birthday:'',lastBirthdayBonus:'',note:''}
        next[key].push({...defaults,...value})
      }else next[key]=next[key].map(item=>item.id===row.targetId?{...item,...row.values}:item)
    }
  }
  const saved=masterMigrationReceipt(input,preview,history,actor,time,next)
  next.auditLog.push(masterMigrationAudit(saved))
  next.settings=[...next.settings.filter(row=>![MASTER_MIGRATION_FENCE,MASTER_MIGRATION_HEAD].includes(row.key)),{key:MASTER_MIGRATION_FENCE,value:'1'},{key:MASTER_MIGRATION_HEAD,value:JSON.stringify(saved.hash)}]
  if(readMigrationDraft(input.sourceText).protocol===TABULAR_MIGRATION_PROTOCOL)next.settings=[...next.settings.filter(row=>row.key!==TABULAR_MIGRATION_FENCE),{key:TABULAR_MIGRATION_FENCE,value:'1'}]
  readMasterMigrationHistory(next)
  return {book:next,receipt:saved}
}
