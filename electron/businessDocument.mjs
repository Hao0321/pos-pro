import {AGENT_PROTOCOL,validateAgentDraft} from './agentDraftRules.mjs'
import {canonicalSignature,moneyValue,quantityValue} from './operationRules.mjs'
import {procurementLineCents} from './procurementRules.mjs'
import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'
export const BUSINESS_PROTOCOL='business-document/v1'
const object=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+'格式不正確')}
const only=(v,keys,label)=>{object(v,label);if(Object.keys(v).some(k=>!keys.includes(k)))throw Error(label+'含不支援的欄位')}
const text=(v,label,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'不正確');return v.trim()}
const own=(obj,key)=>Object.hasOwn(obj||{},key)?obj[key]:undefined
export function readAgentMappings(raw){const value=raw==null?{}:typeof raw==='string'?JSON.parse(raw):raw;object(value,'品項對照');if(Object.keys(value).length>1000)throw Error('合作公司對照超過上限');for(const [sender,rows] of Object.entries(value)){text(sender,'公司代碼',128);object(rows,'公司品項對照');if(Object.keys(rows).length>1000)throw Error('品項對照超過上限');for(const [key,id] of Object.entries(rows)){text(key,'對方品項代碼',300);text(id,'本店商品編號',128)}}return value}
export function mergeAgentMappings(old,input,products,actor){
  if(actor?.role!=='owner')throw Error('只有管理員能記住公司品項對照')
  only(input,['senderId','entries'],'品項對照');const sender=text(input.senderId,'公司代碼',128);object(input.entries,'品項對照')
  for(const [key,id] of Object.entries(input.entries)){text(key,'對方品項代碼',300);if(!products.some(p=>p.id===id))throw Error('對照商品不存在')}
  return readAgentMappings({...readAgentMappings(old),[sender]:{...own(readAgentMappings(old),sender),...input.entries}})
}
const sourceKey=row=>row.sku?'sku:'+row.sku:row.barcode?'barcode:'+row.barcode:'name:'+row.name
export function businessDocumentDraftId(senderId,externalId){return 'b-'+bytesToHex(sha256(new TextEncoder().encode(canonicalSignature([BUSINESS_PROTOCOL,senderId,externalId])))).slice(0,48)}
export async function prepareBusinessDocument(...args){return prepareBusinessDocumentSync(...args)}
export function prepareBusinessDocumentSync(doc,context,overrides={},{skuIsLocal=true,now=Date.now()}={}){
  only(doc,['protocol','id','createdAt','sender','recipientStoreId','intent','currency','items','total','fulfilment','note'],'交換單據')
  if(doc.protocol!==BUSINESS_PROTOCOL||!['sale','restaurant','purchase'].includes(doc.intent))throw Error('交換協議版本或單據用途不支援')
  const externalId=text(doc.id,'外部單號',128);only(doc.sender,['id','name'],'來源公司');const senderId=text(doc.sender.id,'來源公司代碼',128)
  if(doc.sender.name!==undefined)text(doc.sender.name,'來源公司名稱',100)
  if(doc.recipientStoreId&&doc.recipientStoreId!==context.storeId)throw Error('此交換單據指定另一間店，沒有建立任何單據')
  if(doc.currency!=='TWD')throw Error('目前此流程僅接受 TWD，沒有自動換匯')
  if(!Number.isFinite(Date.parse(doc.createdAt)))throw Error('交換單據產生時間不正確')
  if(!Array.isArray(doc.items)||!doc.items.length||doc.items.length>100)throw Error('交換單據品項不正確')
  const mappings=own(readAgentMappings(context.mappings),senderId)||{},unresolved=[],items=[],chosen={},seen=new Set()
  for(const [index,row] of doc.items.entries()){
    only(row,['sku','barcode','name','qty','unit','unitPrice'],'交換品項')
    if(!row.sku&&!row.barcode&&!row.name)throw Error('交換品項須有代碼、條碼或名稱')
    for(const key of ['sku','barcode','name'])if(row[key]!==undefined)text(row[key],'對方品項'+key,200)
    quantityValue(row.qty,'交換數量',.001);const unit=text(row.unit,'品項單位',30),key=sourceKey(row),override=own(overrides,key),remembered=own(mappings,key)
    let product=(override||remembered)?context.products.find(p=>p.id===(override||remembered)):null
    const identified=context.products.filter(p=>skuIsLocal&&row.sku&&(p.id===row.sku||p.sku===row.sku)||row.barcode&&p.barcode===row.barcode)
    if(identified.length>1||product&&identified.some(p=>p.id!==product.id))throw Error('品項代碼、條碼或已記住的對照互相矛盾，請先核對')
    if(!product){const matches=identified;if(matches.length===1)product=matches[0];else if(!matches.length&&row.name){const names=context.products.filter(p=>p.name===row.name);if(names.length===1)product=names[0]}}
    if(!product){unresolved.push({index,key,name:row.name||row.sku||row.barcode,unit,qty:row.qty});continue}
    if(unit!==product.unit)throw Error('品項「'+(row.name||row.sku)+'」單位為 '+unit+'，本店為 '+product.unit+'；請先核對，系統不會自動換算')
    if(seen.has(product.id))throw Error('多個外部品項對到同一商品，請合併數量或修正對照')
    seen.add(product.id);chosen[key]=product.id
    if(row.unitPrice!==undefined){moneyValue(row.unitPrice,'交換單價');if(doc.intent!=='purchase'&&row.unitPrice!==product.price)throw Error('品項「'+product.name+'」單價與本店不同，請先確認價格')}
    items.push({productId:product.id,qty:row.qty,...(doc.intent==='purchase'&&row.unitPrice!==undefined?{unitCost:row.unitPrice}:{})})
  }
  if(unresolved.length)return {unresolved,chosen,draft:null,senderId}
  const id=businessDocumentDraftId(senderId,externalId)
  const fulfilment=doc.fulfilment||{};only(fulfilment,['supplierId','date','channel','day','slot','customer','contact'],'交付資料')
  const source='來源 '+(doc.sender.name||senderId)+' / '+externalId
  const note=doc.note?text(doc.note,'備註',800):''
  const draft={protocol:AGENT_PROTOCOL,id,issuedAt:doc.createdAt,storeId:context.storeId,catalogueRevision:context.catalogueRevision,kind:doc.intent,items,...fulfilment,note:doc.intent==='restaurant'&&fulfilment.channel==='delivery'&&!note?'':source+(note?'；'+note:'')}
  const preview=validateAgentDraft(draft,context,now,true)
  if(doc.total!==undefined){moneyValue(doc.total,'交換合計');if(Math.round(doc.total*100)!==Math.round(preview.total*100))throw Error('外部單據合計與明細不同，請先核對；沒有建立任何單據')}
  return {draft,unresolved:[],chosen,senderId,source,preview}
}
