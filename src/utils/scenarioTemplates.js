import {prepareScenarioTemplate,makeTemplateReceipt,scenarioTemplates} from '../../electron/scenarioTemplateRules.mjs'
import {readRecords,writeRecords,withSalesLock} from './browserStorage'
import {isElectron} from './dataAccess'
export {scenarioTemplates}
export async function loadScenarioTemplateReceipt(templateId,actor){
  if(isElectron)return window.electronAPI.db.getScenarioTemplateReceipt(templateId)
  if(actor?.role!=='owner')throw Error('只有管理員可以查看情境模板紀錄')
  const products=readRecords().data.pos2_products,prior=products.map(p=>p.scenarioTemplateReceipt).find(r=>r?.templateId===templateId)
  if(prior?.productIds?.some(id=>!products.some(p=>p.id===id)))throw Error('模板紀錄與目前品項不一致，請先核對備份與庫存')
  return prior||null
}

export function applyBrowserTemplate(input,actor){
  if(actor?.role!=='owner')throw Error('只有管理員可以套用情境模板')
  const prepared=prepareScenarioTemplate(input),current=readRecords(),existing=current.data.pos2_products
  const prior=existing.map(p=>p.scenarioTemplateReceipt).find(r=>r?.templateId===prepared.template.id)
  if(prior){
    if(!Array.isArray(prior.productIds)||prior.productIds.some(id=>!existing.some(p=>p.id===id)))throw Error('模板紀錄與目前品項不一致，請先核對備份與庫存')
    if(prior.operationId===input.operationId&&prior.signature===prepared.signature)return prior
    throw Error('這個模板已套用，請到庫存管理調整餐點')
  }
  if(prepared.products.some(p=>existing.some(old=>old.id===p.id)))throw Error('模板品項編號已存在，原資料未變更')
  const receipt=makeTemplateReceipt(prepared,input)
  const audit={id:'scenario-template:'+prepared.template.id,timestamp:new Date().toISOString(),action:'SCENARIO_TEMPLATE_APPLY',level:'info',label:'套用情境模板',userId:actor.userId||'',username:actor.username||'',role:actor.role,detail:JSON.stringify(receipt)}
  writeRecords({pos2_products:[...existing,...prepared.products.map(p=>({...p,scenarioTemplateReceipt:receipt}))],pos_audit_log:[audit,...current.data.pos_audit_log]},current.revision)
  return receipt
}
export async function applyScenarioTemplate(input,actor){
  if(isElectron)return window.electronAPI.db.applyScenarioTemplate(input)
  return withSalesLock(()=>applyBrowserTemplate(input,actor))
}
