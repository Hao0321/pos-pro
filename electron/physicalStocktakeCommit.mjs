import {canonicalSignature} from './operationRules.mjs'
import {planInventory,INVENTORY_ACTION,INVENTORY_PREFIX} from './inventoryOperations.mjs'
import {PHYSICAL_STOCKTAKE} from './physicalStocktake.mjs'
import {projectStockLedger,stockLedgerDigest,stockLedgerAcknowledgement} from './stockLedgerModel.mjs'
import {salesDate} from './salesRules.mjs'
import {STOCK_COMPAT_SETTING} from './stockCompatibility.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const fail=()=>{throw Error('盤點保存內容需要核對，原資料已保留')}
// This constructs and verifies one complete transition. There is no generic
// flag that grants callers permission to bypass the browser cost-write guard.
export function appendPhysicalStocktakeBook(before,after,state,command,data){
 const {request,actor}=command||{}
 if(request?.protocol!==PHYSICAL_STOCKTAKE||request.kind!=='stocktake'||!actor||!['owner','staff'].includes(actor.role)||!before.users.some(row=>row.id===actor.userId&&row.username===actor.username&&row.role===actor.role))fail()
 const plan=planInventory(request,{...data,products:before.products,purchases:before.purchases,suppliers:before.suppliers,cashLogs:before.cashLog},actor)
 const id=INVENTORY_PREFIX+request.id,audit=after.auditLog.find(row=>row.id===id)
 if(before.auditLog.some(row=>row.id===id)||!audit||!Number.isFinite(Date.parse(audit.timestamp))||Math.abs(Date.now()-Date.parse(audit.timestamp))>300000)fail()
 const expected={...before,products:before.products.map(p=>plan.products.find(row=>row.id===p.id)||p),auditLog:[{id,action:INVENTORY_ACTION,detail:plan.receipt,timestamp:audit.timestamp,userId:actor.userId,username:actor.username,role:actor.role},...before.auditLog]}
 if(!same(after,expected))fail()
 if(!state.projection)return {...expected,settings:expected.settings.some(row=>row.key===STOCK_COMPAT_SETTING)?expected.settings:[...expected.settings,{key:STOCK_COMPAT_SETTING,value:'1'}]}
 const evidence={products:plan.products.map(product=>{const original=before.products.find(row=>row.id===product.id);return {id:product.id,unit:product.unit,beforeUnits:Math.round(original.stock*1000),afterUnits:Math.round(product.stock*1000),referenceUnitCostCents:Math.round(original.cost*100)}}).sort((a,b)=>a.id.localeCompare(b.id)),stocktake:plan.receipt.stocktake}
 const body={id:'stock-'+crypto.randomUUID(),sequence:state.entries.length+1,previousHash:state.head,beforeDigest:state.stateDigest,input:structuredClone(request),actor:{userId:actor.userId,username:actor.username,role:actor.role},time:new Date().toISOString(),date:salesDate(new Date(request.time)),openingMaterial:null,method:'applyInventoryOperation',evidence}
 const projection=projectStockLedger(state.projection,body);body.afterDigest=stockLedgerDigest(projection)
 const hash=stockLedgerDigest(body),receipt=stockLedgerAcknowledgement(body,hash,projection),operation={id:canonicalSignature(['applyInventoryOperation',request.id]),method:'applyInventoryOperation',operationId:request.id,actorId:actor.userId,signature:canonicalSignature(request),receipt}
 if(before.stockCostOperations.some(row=>row.id===operation.id))fail()
 return {...expected,stockCostEntries:[...before.stockCostEntries,{...body,hash}],stockCostOperations:[...before.stockCostOperations,operation]}
}
