import {canonicalSignature} from './operationRules.mjs'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const fail=()=>{throw Error('這份成本帳的交易請回到店面電腦；原資料與輸入已保留')}

// Business writers participate through their exact verified transition. Every
// other write must leave the protected stock/business history intact. Paired
// phones use the native authority and do not take this path.
export function guardUnintegratedStockWrite(before,after,state){
 if(!state.projection)return
 for(const key of ['orders','purchases','wasteLog','restaurantOrders','restaurantOperations','salesDocuments','salesOperations','stockCostEntries','stockCostOperations'])if(!same(before[key],after[key]))fail()
 const quantities=book=>(book.products||[]).map(row=>({id:row.id,unit:row.unit,stock:row.stock})).sort((a,b)=>a.id.localeCompare(b.id))
 if(!same(quantities(before),quantities(after)))fail()
 for(const key of ['sharedStoreId','restaurantConfig'])if(!same(before.settings.find(row=>row.key===key)||null,after.settings.find(row=>row.key===key)||null))fail()
 const audits=book=>book.auditLog.filter(row=>row.action==='INVENTORY_OPERATION').sort((a,b)=>a.id.localeCompare(b.id))
 if(!same(audits(before),audits(after)))fail()
 for(const frozen of state.projection.legacyJournals.filter(row=>row.type==='manual'))if(!same(before.manualJournal.find(row=>row.id===frozen.id)||null,after.manualJournal.find(row=>row.id===frozen.id)||null))fail()
 for(const entry of after.manualJournal){if(same(entry,before.manualJournal.find(row=>row.id===entry.id)||null))continue;if(entry.lines.some(row=>['1211','2291'].includes(row.account)))fail()}
}
