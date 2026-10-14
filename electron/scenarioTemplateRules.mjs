import registry from './scenario-templates.json' with { type: 'json' }

export const scenarioTemplates = registry.templates
export function prepareScenarioTemplate(input) {
  if(!input || typeof input.operationId!=='string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.operationId))throw Error('請保留有效的套用編號')
  const template=scenarioTemplates.find(t=>t.id===input.templateId)
  if(!template || !input.items || typeof input.items!=='object' || Array.isArray(input.items))throw Error('情境模板不存在或設定不正確')
  if(Object.keys(input.items).sort().join(',')!==template.products.map(p=>p.key).sort().join(','))throw Error('請填寫這個模板的全部品項')
  const products=template.products.map(p=>{
    const values=input.items[p.key]
    if(!values || typeof values!=='object')throw Error('請核對餐點設定')
    for(const key of ['price','cost','stock'])if(typeof values[key]!=='number'||!Number.isFinite(values[key])||values[key]<0||values[key]>1000000)throw Error(p.name+'的售價、成本與可售數量需為有效數字')
    if(values.price<=0 || !Number.isInteger(values.stock) || Math.abs(values.price*100-Math.round(values.price*100))>0.000001 || Math.abs(values.cost*100-Math.round(values.cost*100))>0.000001)throw Error(p.name+'需有正確售價，金額最多兩位小數，可售數量需為整數')
    return {id:p.id,name:p.name,category:p.category,unit:p.unit,price:values.price,cost:values.cost,stock:values.stock,barcode:'',noBarcode:true,imageUrl:'',expiryDate:'',supplierId:'',reorderLevel:0}
  })
  return {template,products,signature:JSON.stringify({templateId:template.id,products})}
}
export function makeTemplateReceipt(prepared,input) {
  return {success:true,templateId:prepared.template.id,operationId:input.operationId,signature:prepared.signature,productIds:prepared.products.map(p=>p.id),name:prepared.template.name}
}
