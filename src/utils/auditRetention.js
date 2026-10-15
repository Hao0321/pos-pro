// Display retention must never discard authoritative operation receipts.
// Keep their original ordering while bounding ordinary activity entries.
export function retainAuditLogs(logs,limit){
  let ordinary=0
  return logs.filter(row=>{
    const id=String(row?.id||'')
    const receipt=id.startsWith('stock-operation:')||row?.action==='INVENTORY_OPERATION'||id.startsWith('scenario-template:')||row?.action==='SCENARIO_TEMPLATE_APPLY'||id.startsWith('exchange:')||row?.action==='business-quote'
    return receipt||ordinary++<limit
  })
}
