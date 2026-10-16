const memory=new Map(),PREFIX='pos_stock_setup_draft_v1:'
export const stockSetupDraftKey=(context,actor,mode)=>PREFIX+JSON.stringify([context.storeId,actor.userId,actor.role,mode])
function valid(value){
  if(value?.protocol!=='pos-stock-setup-draft/v1'||typeof value.reviewId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(value.reviewId)||typeof value.useReferences!=='boolean'||typeof value.selectedKey!=='string'||typeof value.agentText!=='string'||new TextEncoder().encode(value.agentText).length>32768||!value.choices||typeof value.choices!=='object'||Array.isArray(value.choices)||Object.keys(value.choices).length>10000)throw Error('成本草稿需要核對，請先下載保留')
  for(const row of Object.values(value.choices))if(!row||!['reference','unknown','free','unit','total'].includes(row.mode)||typeof row.raw!=='string'||row.raw.length>32)throw Error('成本草稿需要核對，請先下載保留')
  return value
}
export function readStockSetupDraft(storage,key){
  if(memory.has(key))return {value:memory.get(key),notSaved:true,raw:storage.getItem(key)}
  const raw=storage.getItem(key);if(raw===null)return {value:null,raw:null}
  try{if(raw.length>2*1024*1024)throw Error();return {value:valid(JSON.parse(raw)),raw}}
  catch{throw Object.assign(Error('成本草稿需要核對，請先下載保留'),{originalRaw:raw})}
}
export function writeStockSetupDraft(storage,key,value){
  const validated=valid(value),raw=JSON.stringify(validated);if(new TextEncoder().encode(raw).length>2*1024*1024)throw Error('成本草稿太大，請下載保留')
  try{storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error();memory.delete(key);return raw}
  catch{memory.set(key,structuredClone(validated));throw Error('草稿暫時存不下，請先不要關閉頁面')}
}
export function clearStockSetupDraft(storage,key,expectedRaw,command){
  if(!key||storage.getItem(key)!==expectedRaw)return null
  if(command?.action==='price'&&expectedRaw){
    const value=valid(JSON.parse(expectedRaw)),choices={...value.choices}
    for(const row of command.review.selection.entries)delete choices[row.key]
    const next={...value,choices,selectedKey:''};writeStockSetupDraft(storage,key,next);return next
  }
  storage.removeItem(key);memory.delete(key);return null
}
