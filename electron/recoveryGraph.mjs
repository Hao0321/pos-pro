import {canonicalSignature} from './operationRules.mjs'
import {operationRecords,RECOVERY_PROTOCOL,pendingOperation} from './recoveryRules.mjs'
import {stockLedgerDigest} from './stockLedgerModel.mjs'
import {recoveryBook,recoveryDataError} from './recoveryBook.mjs'

const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw recoveryDataError()}
const text=value=>{if(typeof value!=='string'||!value)throw recoveryDataError();return value}
const sorted=rows=>[...rows].sort((a,b)=>canonicalSignature(a).localeCompare(canonicalSignature(b)))
export const emptyRecoveryGraph=(version=1)=>({version,books:[],snapshots:[],originalIds:[],events:[]})
export function validateRecoveryGraph(graph,storage,options={}){
 try{return inspectRecoveryGraph(graph,storage,options)}catch{throw recoveryDataError()}
}
function inspectRecoveryGraph(graph,storage,{digest=stockLedgerDigest}={}){
 if(!['sqlite','browser'].includes(storage))throw recoveryDataError()
 object(graph,['version','books','snapshots','originalIds','events'])
 if(![1,2,3,4,5].includes(graph.version)||['books','snapshots','originalIds','events'].some(key=>!Array.isArray(graph[key])))throw recoveryDataError()
 const books=new Map(),snapshots=new Map(),features=new Set(),used=new Set()
 if(graph.version>=2)features.add('cross-storage-v1')
 if(graph.version>=3)features.add('record-shapes-v1')
 if(graph.version>=4)features.add('restaurant-intake-v1')
 if(graph.version>=5)features.add('kitchen-print-v1')
 for(const row of graph.books){
  object(row,graph.version>=2?['id','data','contentSignature','storage']:['id','data','contentSignature']);text(row.data);text(row.contentSignature)
  const origin=graph.version>=2?row.storage:storage
  if(!['sqlite','browser'].includes(origin)||row.id!==digest({storage:origin,data:row.data,contentSignature:row.contentSignature})||books.has(row.id))throw recoveryDataError()
  const data=JSON.parse(row.data)
  if(row.contentSignature!==(origin==='sqlite'?digest(row.data).slice(7):canonicalSignature(data)))throw recoveryDataError()
  const checked=recoveryBook(data,origin,{digest});checked.features.forEach(value=>features.add(value));books.set(row.id,{...row,...checked,storage:origin,dataObject:data})
 }
 for(const row of graph.snapshots){
  object(row,['id','createdAt','actorId','storeId','bookId','afterMaterial','operationId']);text(row.id);text(row.actorId);text(row.afterMaterial)
  if(row.operationId!==null&&(typeof row.operationId!=='string'||!row.operationId))throw recoveryDataError()
  if(typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||typeof row.storeId!=='string'||snapshots.has(row.id)||!books.has(row.bookId))throw recoveryDataError()
  const source=books.get(row.bookId)
  if(source.storage==='sqlite'&&(row.operationId===null||!/^[a-f0-9]{64}$/.test(row.afterMaterial))||source.storeId!==row.storeId)throw recoveryDataError();used.add(row.bookId);snapshots.set(row.id,{...row,source})
 }
 if(used.size!==books.size)throw recoveryDataError()
 const expected=new Set(),actual=new Set()
 for(const row of snapshots.values())for(const record of operationRecords(row.source.book)){const key=canonicalSignature([record.method,record.id,row.id]);if(expected.has(key))throw recoveryDataError();expected.add(key)}
 for(const row of graph.originalIds){if(!Array.isArray(row)||row.length!==3||row.some(value=>typeof value!=='string'||!value))throw recoveryDataError();const key=canonicalSignature(row);if(actual.has(key)||!expected.has(key))throw recoveryDataError();actual.add(key)}
 if(actual.size!==expected.size)throw recoveryDataError()
 const eventIds=new Set(),acknowledged=new Set()
 for(const row of graph.events){
  object(row,['id','actorId','signature','receipt']);text(row.id);text(row.actorId);text(row.signature);text(row.receipt)
  if(eventIds.has(row.id))throw recoveryDataError();eventIds.add(row.id)
  const request=JSON.parse(row.signature),receipt=JSON.parse(row.receipt)
  if(canonicalSignature(request)!==row.signature||receipt?.protocol!==RECOVERY_PROTOCOL||receipt.success!==true||receipt.id!==row.id||typeof receipt.revision!=='string'||typeof receipt.storeId!=='string'||!snapshots.has(receipt.sourceId)||snapshots.get(receipt.sourceId).operationId!==row.id||snapshots.get(receipt.sourceId).actorId!==row.actorId||acknowledged.has(receipt.sourceId))throw recoveryDataError()
  acknowledged.add(receipt.sourceId)
  if(request.kind==='restore-preview'){if(request.previewId!==row.id)throw recoveryDataError()}
  else if(request.kind==='import'){if(request.id!==row.id||typeof request.hash!=='string')throw recoveryDataError()}
  else{
   if(request.id!==row.id||request.sourceId!==receipt.restoredSourceId||!snapshots.has(receipt.restoredSourceId))throw recoveryDataError()
   const pending=pendingOperation(request.pending)
   if(receipt.originalOperationId!==pending.id||!operationRecords(snapshots.get(receipt.restoredSourceId).source.book).some(record=>record.method===pending.method&&record.id===pending.id))throw recoveryDataError()
  }
 }
 if([...snapshots.values()].some(row=>row.operationId!==null&&!acknowledged.has(row.id)))throw recoveryDataError()
 return {graph,books,snapshots,features:[...features].sort()}
}

export function packRecoveryGraph({snapshots=[],originalIds=[],events=[]},storage,{digest=stockLedgerDigest,version}={}){
 const bySource=new Map();for(const event of events){const id=JSON.parse(event.receipt).sourceId;if(bySource.has(id))throw recoveryDataError();bySource.set(id,event.id)}
 const graphVersion=Math.max(version??1,snapshots.some(row=>row.storage&&row.storage!==storage)?2:1)
 if(version!==undefined&&![1,2,3,4,5].includes(version))throw recoveryDataError()
 const books=new Map(),rows=snapshots.map(row=>{const {data,contentSignature,storage:origin=storage,...metadata}=row,id=digest({storage:origin,data,contentSignature}),book={id,data,contentSignature,...(graphVersion>=2?{storage:origin}:{})};const existing=books.get(id);if(existing&&!same(existing,book))throw recoveryDataError();books.set(id,book);return {...metadata,operationId:metadata.operationId??bySource.get(metadata.id)??null,bookId:id}})
 const graph={version:graphVersion,books:sorted([...books.values()]),snapshots:sorted(rows),originalIds:sorted(originalIds),events:sorted(events)};validateRecoveryGraph(graph,storage,{digest});return graph
}
export function unpackRecoveryGraph(graph,storage,options){
 const checked=validateRecoveryGraph(graph,storage,options)
 return {snapshots:graph.snapshots.map(({bookId,...row})=>({...row,data:checked.books.get(bookId).data,contentSignature:checked.books.get(bookId).contentSignature,...(graph.version>=2?{storage:checked.books.get(bookId).storage}:{})})),originalIds:structuredClone(graph.originalIds),events:structuredClone(graph.events)}
}
export function portableRecoveryGraph(graph,storage,options){validateRecoveryGraph(graph,storage,options);const version=Math.max(2,graph.version,options?.version??2);if(![2,3,4,5].includes(version))throw recoveryDataError();return {...structuredClone(graph),version,books:graph.books.map(row=>({...row,storage:row.storage??storage}))}}
export function mergeRecoveryGraphs(current,incoming,storage,options){
 validateRecoveryGraph(current,storage,options);validateRecoveryGraph(incoming,storage,options)
 const version=Math.max(current.version,incoming.version)
 if(version>=2){current=portableRecoveryGraph(current,storage,options);incoming=portableRecoveryGraph(incoming,storage,options)}
 const merge=(left,right,key)=>{const values=new Map(left.map(row=>[key(row),row]));for(const row of right){const old=values.get(key(row));if(old&&!same(old,row))throw recoveryDataError();values.set(key(row),row)}return sorted([...values.values()])}
 const graph={version,books:merge(current.books,incoming.books,row=>row.id),snapshots:merge(current.snapshots,incoming.snapshots,row=>row.id),originalIds:merge(current.originalIds,incoming.originalIds,canonicalSignature),events:merge(current.events,incoming.events,row=>row.id)}
 validateRecoveryGraph(graph,storage,options);return graph
}
