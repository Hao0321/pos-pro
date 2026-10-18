import {LOT_COUNT_SETTING} from './lotCount.mjs'
import {LOT_METHOD,LOT_SETTING,lotCommand,lotError} from './lotRules.mjs'
import {lotEvidence,LOT_SYSTEM_ACTOR} from './lotPlan.mjs'
import {lotEffectiveDay,splitLotSegments,lotEligibility} from './lotSelection.mjs'
import {warehouseActor} from './browserWarehouse.mjs'
import {warehouseLocationUnits} from './warehousePlan.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {projectStockLedger,stockLedgerDigest,stockLedgerAcknowledgement} from './stockLedgerModel.mjs'
import {withStockBookHead} from './stockBookAnchor.mjs'
import {readExchangeTextSetting} from './businessExchange.mjs'
import {salesDate} from './salesRules.mjs'
export function lotActor(book,actor,action=null){const who=warehouseActor(book,actor);if(action==='expire'||action&&!['dispose','count'].includes(action)&&who.role!=='owner')throw lotError('AUTHORITY');return who}
export function lotSavedResult(book,input,actor){
 const who=lotActor(book,actor,input.action),saved=book.stockCostOperations.find(row=>row.id===canonicalSignature([LOT_METHOD,input.id]))
 if(!saved)return null
 if(saved.signature!==canonicalSignature(input)||saved.actorId!==who.userId&&who.role!=='owner')throw lotError('HISTORY')
 return {success:true,command:structuredClone(input),receipt:structuredClone(saved.receipt)}
}
export function needsLotExpiry(projection,time){
 const registry=projection?.lots;if(!registry)return false
 const day=lotEffectiveDay(registry,time),sources=new Map(projection.custody.sources.map(row=>[row.id,row]))
 return day>registry.observedDay||projection.custody.positions.some(node=>node.owner.stage==='available'&&splitLotSegments(projection.custody,registry,node.segments).some(row=>lotEligibility(registry,sources.get(row.segment.sourceId).productId,row.lot,day)!=='eligible'))
}
export function makeLotExpiryInput(state,{storeId,epoch,now}){const day=lotEffectiveDay(state.projection.lots,now);return {protocol:'pos-stock-lots/v1',id:'lot-expire-'+day+'-'+state.stateDigest.slice(7,31),time:now,storeId,epoch,expectedStateDigest:state.stateDigest,action:'expire',day}}
export function appendBrowserLots(before,after,state,command,runtime){
 const {request,actor,timestamp,system=false}=command||{},input=lotCommand(request),who=system?LOT_SYSTEM_ACTOR:lotActor(before,actor,input.action)
 if(system&&input.action!=='expire'||canonicalSignature(before)!==canonicalSignature(after)||before.stockCostOperations.some(row=>row.id===canonicalSignature([LOT_METHOD,input.id])))throw lotError('HISTORY')
 if(!state.projection||input.storeId!==readExchangeTextSetting(before.settings,'sharedStoreId')||input.epoch!==runtime.epoch||!Number.isFinite(Date.parse(timestamp))||Math.abs(Date.now()-Date.parse(timestamp))>300000||Math.abs(Date.now()-Date.parse(input.time))>300000)throw lotError('STALE')
 const evidence=lotEvidence(state.projection,before.products,input,who,before.restaurantOrders||[]),body={id:'stock-'+crypto.randomUUID(),sequence:state.entries.length+1,previousHash:state.head,beforeDigest:state.stateDigest,input,actor:who,time:timestamp,date:salesDate(new Date(timestamp)),openingMaterial:null,method:LOT_METHOD,evidence}
 const projection=projectStockLedger(state.projection,body);body.afterDigest=stockLedgerDigest(projection)
 const hash=stockLedgerDigest(body),receipt=stockLedgerAcknowledgement(body,hash,projection),operation={id:canonicalSignature([LOT_METHOD,input.id]),method:LOT_METHOD,operationId:input.id,actorId:who.userId,signature:canonicalSignature(input),receipt}
 const products=before.products.map(product=>evidence.products.some(row=>row.id===product.id)?{...product,stock:warehouseLocationUnits(projection.custody,'main',product.id,product.unit)/1000}:product)
 return withStockBookHead({...before,products,settings:[...before.settings.filter(row=>row.key!==LOT_SETTING),{key:LOT_SETTING,value:'1'},...(input.action==='count'&&!before.settings.some(row=>row.key===LOT_COUNT_SETTING)?[{key:LOT_COUNT_SETTING,value:'1'}]:[])],wasteLog:evidence.waste?[...before.wasteLog,evidence.waste]:before.wasteLog,stockCostEntries:[...before.stockCostEntries,{...body,hash}],stockCostOperations:[...before.stockCostOperations,operation]},hash)
}
export function assertLotResult(request,result){const receipt=result?.receipt;if(result?.success!==true||canonicalSignature(result.command)!==canonicalSignature(request)||receipt?.protocol!=='pos-stock-cost/v1'||receipt.success!==true||receipt.id!==request.id||receipt.sourceMethod!==LOT_METHOD||!Number.isSafeInteger(receipt.sequence)||receipt.sequence<2||typeof receipt.eventId!=='string'||!receipt.eventId||['eventHash','stateDigest'].some(key=>!/^sha256:[a-f0-9]{64}$/.test(receipt[key])))throw lotError('HISTORY');return result}
