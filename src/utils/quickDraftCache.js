const prefix='pos_quick_draft_v1:'
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)
const strings=['protocol','id','issuedAt','storeId','catalogueRevision','kind','supplierId','date','channel','day','slot','customer','contact','note']
function validState(state,scope){
  if(!object(state)||!['sale','restaurant','purchase'].includes(state.kind)||scope.role!=='owner'&&state.kind==='purchase'||typeof state.text!=='string'||state.text.length>32768)return false
  const d=state.draft
  if(d!==null&&(!object(d)||Object.keys(d).some(k=>k!=='items'&&!strings.includes(k))||strings.some(k=>d[k]!==undefined&&typeof d[k]!=='string')||d.storeId!==scope.storeId||d.kind!==state.kind||d.protocol!=='pos-document-draft/v1'||!Array.isArray(d.items)||d.items.length>100||d.items.some(i=>!object(i)||Object.keys(i).some(k=>!['productId','qty','unitCost'].includes(k))||typeof i.productId!=='string'||!Number.isFinite(i.qty)||i.unitCost!==undefined&&!Number.isFinite(i.unitCost))))return false
  if(state.external!==null&&(!object(state.external)||!object(state.external.document)||state.external.document.protocol!=='business-document/v1'||!object(state.external.overrides)||Object.entries(state.external.overrides).some(([k,v])=>k.length>300||typeof v!=='string'||v.length>128)))return false
  return true
}
export function quickDraftScope(context,session){
  if(!context?.storeId||!session?.userId||!['owner','staff'].includes(session.role))return null
  const scope={storeId:context.storeId,userId:session.userId,role:session.role}
  return {...scope,key:prefix+[scope.storeId,scope.userId,scope.role].map(encodeURIComponent).join(':')}
}
export function readQuickDraft(storage,scope){
  try{
    const raw=storage.getItem(scope.key);if(raw===null)return null
    if(new TextEncoder().encode(raw).length>131072)throw Error()
    const value=JSON.parse(raw)
    if(value.version!==1||!object(value.scope)||['storeId','userId','role'].some(k=>value.scope[k]!==scope[k])||!validState(value.state,scope))throw Error()
    return value.state
  }catch{throw Error('這個裝置的未完成草稿讀不到。請重新貼上原單；已保存的交易不會改動。')}
}
export function writeQuickDraft(storage,scope,state){
  if(!state.text.trim()&&!state.draft&&!state.external){storage.removeItem(scope.key);return}
  if(!validState(state,scope))throw Error('草稿目前無法保留，請先不要離開這個畫面。')
  const raw=JSON.stringify({version:1,scope:{storeId:scope.storeId,userId:scope.userId,role:scope.role},state})
  if(new TextEncoder().encode(raw).length>131072)throw Error('草稿內容太多，請分成幾張單；目前內容仍在畫面上。')
  storage.setItem(scope.key,raw)
}
