const fs=require('node:fs'),path=require('node:path')
const REQUIRED_IDS=['ux.tasks','ux.all-workflows','ux.human-acceptance','agent.handoff','agent.interoperability','pos.transactions','restaurant.fulfilment','restaurant.deposits-modifiers','sales.orders-receivables','crm.customers','procurement.core','procurement.returns','procurement.approvals-advances','inventory.movements-costing','inventory.warehouses-lots','inventory.units-counting','accounting.ledger','accounting.close-tax','finance.reconciliation-assets','manufacturing.mrp','people.payroll','projects.services','organization.multi-entity','integration.commerce','security.authority','recovery.backup','delivery.devices','delivery.installation','update.client-check','update.release-channel','operations.scale','migration.switching']
function validateCapabilities(ledger,{root,version,completion=false}={}){
  const errors=[],open=[]
  if(ledger.schemaVersion!==1||ledger.productVersion!==version||ledger.completionScope!=='public'||ledger.allFeaturesFree!==true)errors.push('invalid contract, version or free-access policy')
  for(const [label,ids] of [['requiredIds',ledger.requiredIds],['capabilities',ledger.capabilities?.map(c=>c.id)]])if(!Array.isArray(ids)||ids.length!==REQUIRED_IDS.length||new Set(ids).size!==ids.length||REQUIRED_IDS.some(id=>!ids.includes(id)))errors.push(label+' must preserve the complete requirement floor')
  for(const item of ledger.capabilities||[]){
    if(!item.name||!item.implementation||!item.nextExperiment||!['verified','planned','unmeasured','blocked_external'].includes(item.status))errors.push('incomplete capability '+item.id)
    if(item.status!=='verified')open.push(item.id)
    if(item.status==='blocked_external'&&(!item.blocker?.owner||!item.blocker.condition||!item.blocker.nextAction))errors.push('incomplete external blocker '+item.id)
    if(item.status==='verified'){
      const v=item.verification
      if(!v||v.version!==version||!/^([a-f0-9]{64})$/.test(v.productionSourceSha256||'')||!v.evidence?.length)errors.push('missing or stale verification '+item.id)
      for(const evidence of v?.evidence||[]){
        const p=evidence.path
        if(typeof p!=='string'||!p||path.isAbsolute(p)||p.includes('\\')||p.split('/').some(s=>s==='..'||s.startsWith('.'))||/^[A-Za-z]:/.test(p)||!evidence.command||!evidence.sha256||!root){errors.push('invalid or private evidence path '+item.id);continue}
        const file=path.resolve(root,p)
        if(!fs.existsSync(file)||!fs.statSync(file).isFile()||require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==evidence.sha256)errors.push('missing or changed evidence '+item.id)
      }
    }
  }
  if(completion&&open.length)errors.push('full ERP completion remains unproven')
  return {valid:errors.length===0,complete:errors.length===0&&open.length===0,open,errors}
}
module.exports={REQUIRED_IDS,validateCapabilities}
if(require.main===module){const root=path.resolve(__dirname,'..'),ledger=JSON.parse(fs.readFileSync(path.join(root,'product-capabilities.json'),'utf8')),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,result=validateCapabilities(ledger,{root,version,completion:process.argv.includes('--completion')});console.log(JSON.stringify(result));process.exitCode=result.valid?0:1}
