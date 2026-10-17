import {WAREHOUSE_METHOD,WAREHOUSE_SETTING,warehouseCommand,warehouseError} from './warehouseRules.mjs'
import {warehouseProductEvidence,planWarehouse,warehouseLocationUnits} from './warehousePlan.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {projectStockLedger,stockLedgerDigest,stockLedgerAcknowledgement} from './stockLedgerModel.mjs'
import {withStockBookHead} from './stockBookAnchor.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {salesDate} from './salesRules.mjs'
export function warehouseActor(book,value){const user=book.users.find(row=>row.id===value?.userId);if(!user||!['owner','staff'].includes(value?.role)||user.role!==value.role||user.username!==value.username)throw Error('權限不足');return {userId:user.id,username:user.username,role:user.role}}
export function warehouseSavedResult(book,input,actor){
 const who=warehouseActor(book,actor),saved=book.stockCostOperations.find(row=>row.id===canonicalSignature([WAREHOUSE_METHOD,input.id]))
 if(!saved)return null
 if(saved.signature!==canonicalSignature(input)||saved.actorId!==who.userId&&who.role!=='owner')throw warehouseError('HISTORY')
 return {success:true,command:structuredClone(input),receipt:structuredClone(saved.receipt)}
}
export function appendBrowserWarehouse(before,after,state,command,runtime){
 const {request,actor,timestamp}=command||{},input=warehouseCommand(request),who=warehouseActor(before,actor)
 if(canonicalSignature(before)!==canonicalSignature(after)||warehouseSavedResult(before,input,who))throw warehouseError('HISTORY')
 if(!state.projection)throw warehouseError('INACTIVE')
 if(readExchangeTextSetting(before.settings,'sharedStoreId')!==input.storeId||runtime.epoch!==input.epoch||!Number.isFinite(Date.parse(timestamp))||Math.abs(Date.now()-Date.parse(timestamp))>300000||Math.abs(Date.now()-Date.parse(input.time))>300000)throw warehouseError('STALE')
 const evidence=warehouseProductEvidence(state.projection,before.products,input),date=salesDate(new Date(input.time)),body={id:'stock-'+crypto.randomUUID(),sequence:state.entries.length+1,previousHash:state.head,beforeDigest:state.stateDigest,input,actor:who,time:timestamp,date,openingMaterial:null,method:WAREHOUSE_METHOD,evidence}
 const projection=projectStockLedger(state.projection,body);body.afterDigest=stockLedgerDigest(projection)
 const hash=stockLedgerDigest(body),receipt=stockLedgerAcknowledgement(body,hash,projection),operation={id:canonicalSignature([WAREHOUSE_METHOD,input.id]),method:WAREHOUSE_METHOD,operationId:input.id,actorId:who.userId,signature:canonicalSignature(input),receipt}
 const products=before.products.map(product=>evidence.products.some(row=>row.id===product.id)?{...product,stock:warehouseLocationUnits(projection.custody,'main',product.id,product.unit)/1000}:product)
 const settings=[...before.settings.filter(row=>row.key!==WAREHOUSE_SETTING),{key:WAREHOUSE_SETTING,value:'1'}]
 return withStockBookHead({...before,products,settings,stockCostEntries:[...before.stockCostEntries,{...body,hash}],stockCostOperations:[...before.stockCostOperations,operation]},hash)
}
export function assertWarehouseResult(request,result){
 const receipt=result?.receipt
 if(result?.success!==true||canonicalSignature(result.command)!==canonicalSignature(request)||receipt?.protocol!=='pos-stock-cost/v1'||receipt.success!==true||receipt.id!==request.id||receipt.sourceMethod!==WAREHOUSE_METHOD||!Number.isSafeInteger(receipt.sequence)||receipt.sequence<2||typeof receipt.eventId!=='string'||!receipt.eventId||['eventHash','stateDigest'].some(key=>!/^sha256:[a-f0-9]{64}$/.test(receipt[key])))throw warehouseError('HISTORY')
 return result
}
