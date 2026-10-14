const {prepareScenarioTemplate,makeTemplateReceipt,scenarioTemplates:registry}=require('./scenarioTemplateRules.mjs')

module.exports=function scenarioTemplates(db,stmts){
  function read(templateId,actor){
    if(actor?.role!=='owner')throw Error('只有管理員可以查看情境模板紀錄')
    const template=registry.find(t=>t.id===templateId)
    if(!template)throw Error('情境模板不存在')
    const saved=db.prepare('SELECT action,detail FROM audit_log WHERE id=?').get('scenario-template:'+templateId)
    if(!saved)return null
    const prior=JSON.parse(saved.detail)
    if(saved.action!=='SCENARIO_TEMPLATE_APPLY'||prior.templateId!==templateId||!prior.success||!Array.isArray(prior.productIds)||prior.productIds.length!==template.products.length||template.products.some(p=>!prior.productIds.includes(p.id))||prior.productIds.some(id=>!stmts.getProductById.get(id)))throw Error('模板紀錄與目前品項不一致，請先核對備份與庫存，原資料未變更')
    return prior
  }
  const apply=db.transaction((input,actor)=>{
    if(actor?.role!=='owner')throw Error('只有管理員可以套用情境模板')
    const prepared=prepareScenarioTemplate(input),key='scenario-template:'+prepared.template.id
    const prior=read(prepared.template.id,actor)
    if(prior){
      if(prior.operationId===input.operationId&&prior.signature===prepared.signature)return prior
      throw Error('這個模板已套用，請到庫存管理調整餐點')
    }
    if(prepared.products.some(p=>stmts.getProductById.get(p.id)))throw Error('模板品項編號已存在，請先核對，原資料未變更')
    for(const product of prepared.products)stmts.insertProduct.run({...product,noBarcode:1})
    const receipt=makeTemplateReceipt(prepared,input)
    stmts.insertAuditLog.run({id:key,timestamp:new Date().toISOString(),action:'SCENARIO_TEMPLATE_APPLY',level:'info',label:'套用情境模板',userId:actor.userId||'',username:actor.username||'',role:actor.role,detail:JSON.stringify(receipt)})
    return receipt
  })
  return {applyScenarioTemplate:(input,actor)=>apply(input,actor),getScenarioTemplateReceipt:read}
}
