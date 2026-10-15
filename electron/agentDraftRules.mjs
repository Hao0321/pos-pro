import {canonicalSignature,moneyValue,quantityValue} from './operationRules.mjs'
import {procurementLineCents} from './procurementRules.mjs'

export const AGENT_PROTOCOL='pos-document-draft/v1'
export function agentBusinessDay(context,now=new Date(),offset=0){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:context.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=type=>parts.find(p=>p.type===type).value;const day=new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);day.setUTCDate(day.getUTCDate()+offset);return day.toISOString().slice(0,10)}
const kinds=['sale','restaurant','purchase']
function only(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error(label+'含不支援的欄位或操作')}
function text(value,max,label){if(typeof value!=='string'||value.length>max)throw Error(label+'格式不正確');return value.trim()}
function id(value,label){if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(value))throw Error(label+'不正確');return value}
export async function makeAgentContext({storeId,products,suppliers=[],restaurantConfig,role,mappings={}}){
  if(!['owner','staff'].includes(role))throw Error('請先登入')
  const catalogue=products.map(p=>({id:p.id,sku:p.id,barcode:p.barcode||'',name:p.name,price:p.price,unit:p.unit||'個',stock:p.stock,...(role==='owner'?{unitCost:p.cost,supplierId:p.supplierId||''}:{})}))
  const vendors=role==='owner'?suppliers.map(s=>({id:s.id,name:s.name})):[]
  const identity={storeId,role,catalogue:catalogue.map(({stock,...p})=>p),suppliers:vendors,restaurantConfig}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalSignature(identity)))
  return {protocol:AGENT_PROTOCOL,storeId,role,catalogueRevision:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),kinds:role==='owner'?kinds:kinds.filter(k=>k!=='purchase'),products:catalogue,suppliers:vendors,mappings,restaurantEnabled:restaurantConfig.enabled,restaurantConfig,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}
}
export function validateAgentDraft(draft,context,now=Date.now(),allowIncomplete=false){
  only(draft,['protocol','id','issuedAt','storeId','catalogueRevision','kind','items','supplierId','date','channel','day','slot','customer','contact','note'],'草稿')
  if(draft.protocol!==AGENT_PROTOCOL||!kinds.includes(draft.kind))throw Error('草稿版本或建單類型不支援')
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(draft.id||'')||!Number.isFinite(Date.parse(draft.issuedAt)))throw Error('草稿編號或時間不正確')
  if(now-Date.parse(draft.issuedAt)>86400000||Date.parse(draft.issuedAt)-now>300000)throw Error('草稿已過期或時間不正確，請重新整理草稿')
  if(draft.storeId!==context.storeId)throw Error('這份草稿屬於另一間店，沒有建立任何單據')
  if(draft.catalogueRevision!==context.catalogueRevision)throw Error('店內品項或價格已更新，請重新整理草稿')
  if(!context.kinds.includes(draft.kind))throw Error('目前帳號沒有建立採購單的權限')
  if(!Array.isArray(draft.items)||!draft.items.length||draft.items.length>100)throw Error('請選擇 1 至 100 個品項')
  const seen=new Set(),items=draft.items.map(item=>{
    only(item,['productId','qty','unitCost'],'品項');id(item.productId,'商品編號')
    const product=context.products.find(p=>p.id===item.productId)
    if(!product||seen.has(product.id))throw Error('草稿有不存在或重複的品項，請核對')
    seen.add(product.id);quantityValue(item.qty,'數量',.001)
    if(draft.kind!=='purchase'&&(!Number.isSafeInteger(item.qty)||item.unitCost!==undefined))throw Error('銷售與預訂須為整數份數，售價由店內資料決定')
    const price=draft.kind==='purchase'?moneyValue(item.unitCost??product.unitCost,'採購單價'):moneyValue(product.price,'售價')
    return {id:product.id,name:product.name,qty:item.qty,price,unit:product.unit,stock:product.stock}
  })
  const note=text(draft.note||'',1000,'備註'),total=items.reduce((n,i)=>n+procurementLineCents(i.qty,i.price),0)/100
  moneyValue(total,'合計')
  if(draft.kind==='purchase'){
    if(!(allowIncomplete&&!draft.supplierId)&&!context.suppliers.some(s=>s.id===draft.supplierId))throw Error('請選擇供應商')
    if(!(allowIncomplete&&!draft.date)&&(!/^\d{4}-\d{2}-\d{2}$/.test(draft.date||'')||new Date(draft.date+'T00:00:00Z').toISOString().slice(0,10)!==draft.date))throw Error('請確認採購日期')
  }
  if(draft.kind==='restaurant'){
    if(!context.restaurantEnabled)throw Error('請先在預訂出餐確認產能與配方並啟用預訂')
    if(!['preorder','walkin','delivery'].includes(draft.channel)||!(allowIncomplete&&!draft.day)&&(!/^\d{4}-\d{2}-\d{2}$/.test(draft.day||'')||new Date(draft.day+'T00:00:00Z').toISOString().slice(0,10)!==draft.day)||!(allowIncomplete&&!draft.slot)&&!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(draft.slot||''))throw Error('請確認取餐日期與時段（每 15 分鐘）')
    text(draft.customer||'',100,'稱呼');text(draft.contact||'',100,'聯絡方式')
    if(!allowIncomplete&&draft.channel!=='walkin'&&!draft.contact?.trim())throw Error('預訂或外送請填聯絡方式')
    if(!allowIncomplete&&draft.channel==='delivery'&&!note)throw Error('外送請在備註填寫地址')
  }
  return {draft:structuredClone(draft),items,total,note}
}
export function agentCommand(preview){
  const d=preview.draft,identity={id:'agent-'+d.id,time:d.issuedAt}
  if(d.kind==='purchase')return {kind:'purchase-create',identity,input:{purchase:{id:'PO-agent-'+d.id,supplierId:d.supplierId,date:d.date,note:preview.note,items:preview.items.map(i=>({productId:i.id,name:i.name,unit:i.unit,qty:i.qty,unitCost:i.price,received:0}))}}}
  if(d.kind==='restaurant')return {kind:'restaurant',identity,input:{action:'create',channel:d.channel,day:d.day,slot:d.slot,customer:d.customer||'',contact:d.contact||'',note:preview.note,items:preview.items.map(i=>({id:i.id,qty:i.qty,price:i.price}))}}
  return {kind:'sale',items:preview.items}
}
const digits={'零':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
function number(value){if(/^\d/.test(value))return Number(value);if(value.includes('十')){const [a,b]=value.split('十');return (a?digits[a]:1)*10+(b?digits[b]:0)}return digits[value]}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
export function draftFromText(input,context,kind='sale',now=new Date()){
  if(typeof input!=='string'||!input.trim()||input.length>4000)throw Error('請輸入品名和數量，或直接點選商品')
  if(/預訂|自取|外送/.test(input)||kind==='sale'&&/明天/.test(input))kind='restaurant'
  else if(/採購|進貨|叫貨/.test(input))kind='purchase'
  const draft={protocol:AGENT_PROTOCOL,id:crypto.randomUUID(),issuedAt:now.toISOString(),storeId:context.storeId,catalogueRevision:context.catalogueRevision,kind,items:[],note:input.trim()}
  const [main,...notes]=input.split(/備註[:：]/)
  if(kind==='restaurant'&&input.includes('外送'))draft.note=notes.join('備註：').trim()
  const clean=value=>{
    let rest=value;for(const s of context.suppliers)rest=rest.replaceAll(s.name,'')
    return rest.replace(/\d{4}-\d{2}-\d{2}|(?:[01]\d|2[0-3]):(?:00|15|30|45)|09\d{8}|(?:上午|下午|晚上)?[一二兩三四五六七八九十\d]{1,3}點(?:半)?|明天|今天|預訂|現場|外送|自取|採購|進貨|叫貨|我要|幫我|請|謝謝|[\s。.!！?？:：]/g,'')
  }
  const pieces=main.trim().split(/[、,，;；\n]+/).map(s=>s.trim()).filter(Boolean)
  for(const piece of pieces){
    const matches=context.products.filter(p=>piece.includes(p.name))
    if(!matches.length&&!clean(piece))continue
    if(matches.length!==1)throw Error('這段品名還不確定：「'+piece+'」。請使用完整品名，或直接點選商品')
    const product=matches[0],name=escape(product.name),numeral='(\\d+(?:\\.\\d{1,3})?|[一二兩三四五六七八九十]{1,3})',unit='(?:公斤|個|碗|份|杯|包|斤|件|組|瓶)?'
    const before=new RegExp(numeral+'\\s*'+unit+'\\s*'+name),after=new RegExp(name+'\\s*[xX×*]?\\s*'+numeral+'\\s*'+unit)
    const match=piece.match(before)||piece.match(after)
    if(!match)throw Error('請補上數量，例如「'+product.name+' 2」')
    if(clean(piece.replace(match[0],'')))throw Error('還有未辨識的內容：「'+piece+'」。商品請分開列，其他需求請加「備註：」')
    if(draft.items.some(i=>i.productId===product.id))throw Error('同一品項請合併數量後再整理')
    draft.items.push({productId:product.id,qty:number(match[1])})
  }
  if(kind==='purchase'){draft.date=agentBusinessDay(context,now);const suppliers=context.suppliers.filter(s=>input.includes(s.name));draft.supplierId=suppliers.length===1?suppliers[0].id:''}
  if(!draft.items.length)throw Error('請輸入商品和數量，或直接點選商品')
  if(kind==='restaurant'){draft.day=input.match(/\d{4}-\d{2}-\d{2}/)?.[0]||agentBusinessDay(context,now,input.includes('明天')?1:0);draft.channel=input.includes('外送')?'delivery':'preorder';draft.slot=input.match(/\b(?:[01]\d|2[0-3]):(?:00|15|30|45)\b/)?.[0]||'';const chinese=input.match(/(上午|下午|晚上)([一二兩三四五六七八九十\d]{1,3})點(半)?/);if(!draft.slot&&chinese){const h=number(chinese[2]);if(h>=1&&h<=11)draft.slot=String(h+(chinese[1]==='上午'?0:12)).padStart(2,'0')+':'+(chinese[3]?'30':'00')}draft.customer='';draft.contact=input.match(/09\d{8}/)?.[0]||''}
  return draft
}
