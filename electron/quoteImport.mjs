import {BUSINESS_PROTOCOL,prepareBusinessDocument} from './businessDocument.mjs'
import {validateAgentDraft} from './agentDraftRules.mjs'
import {QUOTE_PROTOCOL,CATALOGUE_PROTOCOL,validateQuote} from './businessExchange.mjs'
import {canonicalSignature} from './operationRules.mjs'

const sourceNote=quote=>'Quote '+quote.id+' / revision '+quote.revision+' · '+quote.sender.name+(quote.note?'；'+quote.note:'')
export async function prepareExternalDocument(document,context,overrides={}){
  if(document.protocol===CATALOGUE_PROTOCOL)throw Error('這是價目目錄，請讓 Agent 加上數量整理成叫貨單，或取得對方報價')
  if(document.protocol!==QUOTE_PROTOCOL)return prepareBusinessDocument(document,context,overrides)
  validateQuote(document,{now:Date.now(),recipientStoreId:context.storeId})
  // The family key is independent of the revision: accepting a revised quote
  // must never create a second purchase under a newly derived operation ID.
  const family=canonicalSignature([QUOTE_PROTOCOL,document.sender.id,document.id,document.recipient.id])
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(family))
  const id='q-'+[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,48)
  // A supplier's SKU is scoped to that supplier. An identical local ID is
  // not a global product identity; use the partner mapping or review by name.
  const result=await prepareBusinessDocument({protocol:BUSINESS_PROTOCOL,id,createdAt:new Date().toISOString(),sender:document.sender,recipientStoreId:document.recipient.id,intent:'purchase',currency:document.currency,items:document.items,total:document.total},context,overrides,{skuIsLocal:false})
  if(result.draft){result.draft.issuedAt=document.createdAt;result.draft.note=sourceNote(document);result.preview=validateExternalDraft(result.draft,context,document,Date.now(),true)}
  return {...result,quoted:true}
}
export function validateExternalDraft(draft,context,document,now=Date.now(),allowIncomplete=false){
  if(document?.protocol!==QUOTE_PROTOCOL)return validateAgentDraft(draft,context,now,allowIncomplete)
  validateQuote(document,{now,recipientStoreId:context.storeId})
  if(draft.kind!=='purchase'||draft.issuedAt!==document.createdAt||draft.note!==sourceNote(document))throw Error('報價來源已改變，請重新匯入原報價')
  // Quote validity replaces the short-lived local draft limit. The original
  // creation time remains in the final command and its replay signature.
  const preview=validateAgentDraft({...draft,issuedAt:new Date(now).toISOString()},context,now,allowIncomplete)
  return {...preview,draft:structuredClone(draft)}
}
export function quotePurchaseSource(document,chosen){
  return {document:structuredClone(document),products:document.items.map(row=>({sku:row.sku,productId:chosen['sku:'+row.sku]}))}
}
