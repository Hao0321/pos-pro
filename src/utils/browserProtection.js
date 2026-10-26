import {canonicalSignature} from '../../electron/operationRules.mjs'
import {packRecoveryGraph,unpackRecoveryGraph} from '../../electron/recoveryGraph.mjs'
import {stockLedgerDigest} from '../../electron/stockLedgerModel.mjs'

let validatedSignature=null,cachedGraphSignature=null,cachedGraph=null
export function browserProtectionGraph(record){
 const meta=record.recovery??{version:1,snapshots:[],originalIds:[],events:[]}
 if(![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].includes(meta.version))throw Error('備份保護紀錄不完整或內容不同，請保留原檔核對')
 if(meta.version===1&&meta.snapshots.some(row=>Object.hasOwn(row,'storage')))throw Error('備份保護紀錄不完整或內容不同，請保留原檔核對')
 const signature=canonicalSignature(meta)
 if(signature===cachedGraphSignature)return structuredClone(cachedGraph)
 const graph=packRecoveryGraph({snapshots:meta.snapshots.map(row=>({id:row.id,createdAt:row.createdAt,actorId:row.actorId,storeId:row.storeId,data:row.storage==='sqlite'?row.data:JSON.stringify(row.data),contentSignature:row.contentSignature,afterMaterial:row.afterMaterial,...(Object.hasOwn(row,'operationId')?{operationId:row.operationId}:{}),...(row.storage?{storage:row.storage}:{})})),originalIds:meta.originalIds,events:meta.events.map(row=>({...row,receipt:JSON.stringify(row.receipt)}))},'browser',{version:meta.version})
 cachedGraphSignature=signature;cachedGraph=graph
 return structuredClone(graph)
}
export function browserProtectionMetadata(graph){const rows=unpackRecoveryGraph(graph,'browser');return {version:graph.version,snapshots:rows.snapshots.map(row=>({...row,data:row.storage==='sqlite'?row.data:JSON.parse(row.data)})),originalIds:rows.originalIds,events:rows.events.map(row=>({...row,receipt:JSON.parse(row.receipt)}))}}
export function validateBrowserProtection(record){if(!record.recovery)return;const signature=canonicalSignature(record.recovery);if(signature!==validatedSignature){browserProtectionGraph(record);validatedSignature=signature}}
export const browserProtectionRevision=record=>stockLedgerDigest(browserProtectionGraph(record))
