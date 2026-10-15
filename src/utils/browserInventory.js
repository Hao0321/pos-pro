import {readRecords,writeRecords,withSalesLock} from './browserStorage'
import {planInventory,inventoryReceipt,INVENTORY_PREFIX,INVENTORY_ACTION} from '../../electron/inventoryOperations.mjs'
export function commitBrowserInventory(request,actor){
  if(!actor||!['owner','staff'].includes(actor.role)||request.kind!=='stocktake'&&actor.role!=='owner')throw Error('權限不足')
  return withSalesLock(()=>{
    let replay=false,historyChecked=false
    try{
      const saved=readRecords(),r=saved.data,key=INVENTORY_PREFIX+request.id
      const data={products:r.pos2_products,purchases:r.pos_purchases,suppliers:r.pos_suppliers,openShift:r.pos2_shifts.find(s=>s.status==='open'),cashLogs:r.pos2_cash_log}
      const old=r.pos_audit_log.find(l=>l.id===key)
      replay=!!old;historyChecked=true
      if(old){if(old.action!==INVENTORY_ACTION)throw Error('庫存回執需要核對');return inventoryReceipt(request,typeof old.detail==='string'?JSON.parse(old.detail):old.detail,data)}
      const plan=planInventory(request,data,actor)
      const products=[...r.pos2_products.map(p=>plan.products.find(n=>n.id===p.id)||p),...plan.products.filter(p=>plan.created.includes(p.id))]
      const purchases=plan.createPurchase?[plan.purchase,...r.pos_purchases]:r.pos_purchases.map(p=>p.id===plan.purchase?.id?plan.purchase:p),suppliers=r.pos_suppliers.map(s=>s.id===plan.supplier?.id?plan.supplier:s),cashLogs=plan.cashLog?[plan.cashLog,...r.pos2_cash_log]:r.pos2_cash_log
      writeRecords({pos2_products:products,pos_purchases:purchases,pos_suppliers:suppliers,pos2_cash_log:cashLogs,pos_audit_log:[{id:key,action:INVENTORY_ACTION,detail:plan.receipt,timestamp:new Date().toISOString(),userId:actor.userId||'',username:actor.username||'',role:actor.role},...r.pos_audit_log]},saved.revision)
      return inventoryReceipt(request,plan.receipt,{products,purchases,suppliers,cashLogs})
    }catch(error){return {success:false,committed:error.operationConflict===true||historyChecked&&!replay?false:null,error:error.message}}
  })
}
