import {validatePhysicalStocktakeCommand} from '../../electron/physicalStocktake.mjs'
const memory=new Map(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const error=()=>Error('盤點草稿讀不到，請保留原資料核對')
export const stocktakeDraftKey=(context,actor)=>'pos_physical_count_draft_v1:'+ [context.storeId,actor.userId,actor.role].map(encodeURIComponent).join(':')
export const newStocktakeDraft=context=>({version:1,id:'stocktake-'+crypto.randomUUID(),context:structuredClone(context),rows:[],agentText:'',command:null})
export function validateStocktakeDraft(draft,storeId){
 if(!draft||Object.keys(draft).sort().join(',')!=='agentText,command,context,id,rows,version'||draft.version!==1||typeof draft.id!=='string'||!/^stocktake-[A-Za-z0-9_-]{1,100}$/.test(draft.id)||!draft.context||Object.keys(draft.context).sort().join(',')!=='costMode,epoch,storeId'||draft.context.storeId!==storeId||typeof draft.context.epoch!=='string'||!draft.context.epoch||!['active','reference'].includes(draft.context.costMode)||typeof draft.agentText!=='string'||!Array.isArray(draft.rows)||draft.rows.length>10000)throw error()
 const ids=new Set();for(const row of draft.rows){if(!row||Object.keys(row).sort().join(',')!=='id,raw,reference'||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.raw!=='string'||row.raw.length>100||typeof row.reference!=='string'||!/^sha256:[a-f0-9]{64}$/.test(row.reference))throw error();ids.add(row.id)}
 if(draft.command!==null){validatePhysicalStocktakeCommand(draft.command);if(draft.command.id!==draft.id||!same(draft.command.context,draft.context))throw error();if(draft.command.counts.length!==draft.rows.length||draft.command.counts.some(row=>!draft.rows.some(saved=>saved.id===row.id&&Number(saved.raw)===row.quantity&&saved.reference===row.reference)))throw error()}
 return structuredClone(draft)
}
export function readStocktakeDraft(storage,key,context){
 if(memory.has(key))return validateStocktakeDraft(memory.get(key),context.storeId)
 const raw=storage.getItem(key);if(raw===null)return newStocktakeDraft(context)
 if(new TextEncoder().encode(raw).length>2*1024*1024)throw error()
 try{return validateStocktakeDraft(JSON.parse(raw),context.storeId)}catch{throw error()}
}
export function writeStocktakeDraft(storage,key,draft){
 const validated=validateStocktakeDraft(draft,draft.context.storeId),raw=JSON.stringify(validated)
 if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('盤點草稿太大，請保留目前內容並分批盤點')
 try{storage.setItem(key,raw);memory.delete(key)}catch{memory.set(key,validated);throw Error('草稿暫時存不下，請先不要關閉頁面')}
}
export function clearStocktakeDraft(storage,key,id){
 const raw=storage.getItem(key)
 if(raw!==null&&JSON.parse(raw).id!==id)throw Error('另一份盤點草稿已更新，請先核對')
 storage.removeItem(key);memory.delete(key)
}
