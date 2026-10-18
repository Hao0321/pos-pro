import {canonicalSignature,operationHeader} from './operationRules.mjs'
import {normalizeStockBusinessInput,browserStockActor,browserBusinessNeedsCost,browserBusinessSource,planBrowserStockBusiness,browserStockEvidence} from './browserStockPlan.mjs'
import {projectStockLedger,stockLedgerDigest,stockLedgerAcknowledgement} from './stockLedgerModel.mjs'
import {salesDate} from './salesRules.mjs'
import {withStockBookHead} from './stockBookAnchor.mjs'
import {materializeLotProducts} from './lotBusinessPolicy.mjs'

export function appendBrowserStockBusiness(before,after,state,command,runtime){
  if(!state.projection)throw Error('這份成本帳尚未開帳')
  const {method,request,actor,timestamp}=command||{}
  browserStockActor(before,actor,method,request)
  if(!Number.isFinite(Date.parse(timestamp))||Math.abs(Date.now()-Date.parse(timestamp))>300000)throw Error('保存時間已過期，請重新核對')
  const input=normalizeStockBusinessInput(method,request)
  if(browserBusinessSource(before,method,input))throw Error('原編號已存在，請先核對原單')
  const cost=browserBusinessNeedsCost(method,input)
  if(cost&&method!=='addProduct'){operationHeader(input);if(Math.abs(Date.now()-Date.parse(input.time))>300000)throw Error('操作時間已過期，請重新核對')}
  const planned=planBrowserStockBusiness(before,{...runtime,state,timestamp},method,request,actor)
  if(canonicalSignature(after)!==canonicalSignature(planned.book))throw Error('保存內容與原操作不符，原資料已保留')
  if(!cost)return planned.book
  const body={id:'stock-'+crypto.randomUUID(),sequence:state.entries.length+1,previousHash:state.head,beforeDigest:state.stateDigest,input,actor:{userId:actor.userId,username:actor.username,role:actor.role},time:timestamp,date:method==='applySalesOperation'?input.date:salesDate(new Date(input.time||timestamp)),openingMaterial:null,method,evidence:browserStockEvidence(before,planned.book,method,input,planned.result)}
  const projection=projectStockLedger(state.projection,body);body.afterDigest=stockLedgerDigest(projection)
  const hash=stockLedgerDigest(body),receipt=stockLedgerAcknowledgement(body,hash,projection)
  const operation={id:canonicalSignature([method,input.id]),method,operationId:input.id,actorId:actor.userId,signature:canonicalSignature(input),receipt}
  if(before.stockCostOperations.some(row=>row.id===operation.id))throw Error('成本原編號已存在')
  return withStockBookHead({...planned.book,products:materializeLotProducts(planned.book.products,projection,body.evidence.products),stockCostEntries:[...before.stockCostEntries,{...body,hash}],stockCostOperations:[...before.stockCostOperations,operation]},hash)
}
