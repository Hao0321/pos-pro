import {BUSINESS_PROTOCOL,prepareBusinessDocument,businessDocumentDraftId} from './businessDocument.mjs'
import {validateAgentDraft,agentBusinessDay} from './agentDraftRules.mjs'
import {CATALOGUE_ORDER_PROTOCOL,readCatalogueOrder,catalogueOrderItems,catalogueBusinessId,catalogueOrderNote} from './catalogueOrder.mjs'
import {QUOTE_PROTOCOL,CATALOGUE_PROTOCOL,validateQuote} from './businessExchange.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex} from '@noble/hashes/utils.js'

const sourceNote=quote=>'Quote '+quote.id+' / revision '+quote.revision+' · '+quote.sender.name+(quote.note?'；'+quote.note:'')
const quoteFamilyId=document=>'q-'+bytesToHex(sha256(new TextEncoder().encode(canonicalSignature([QUOTE_PROTOCOL,document.sender.id,document.id,document.recipient.id])))).slice(0,48)
export const quoteDocumentDraftId=document=>businessDocumentDraftId(document.sender.id,quoteFamilyId(document))
export const catalogueOrderDraftId=document=>businessDocumentDraftId(document.catalogue.sender.id,catalogueBusinessId(document))
export async function prepareExternalDocument(document,context,overrides={}){
  if(document.protocol===CATALOGUE_ORDER_PROTOCOL){
    readCatalogueOrder(document,{recipientStoreId:context.storeId});if(context.role!=='owner')throw Error('請用店主帳號依目錄準備採購。')
    const result=await prepareBusinessDocument({protocol:BUSINESS_PROTOCOL,id:catalogueBusinessId(document),createdAt:document.createdAt,sender:document.catalogue.sender,recipientStoreId:document.recipientStoreId,intent:'purchase',currency:'TWD',items:catalogueOrderItems(document),note:catalogueOrderNote(document),fulfilment:{date:agentBusinessDay(context,new Date(document.createdAt))}},context,overrides,{skuIsLocal:false,unitMax:40,now:Date.parse(document.createdAt)})
    if(result.draft){result.draft.note=catalogueOrderNote(document);result.preview=validateExternalDraft(result.draft,context,document,Date.now(),true)}
    return {...result,catalogue:true}
  }
  if(document.protocol===CATALOGUE_PROTOCOL)throw Error('這是價目目錄，請先選品項與數量，再核對採購。')
  if(document.protocol!==QUOTE_PROTOCOL)return prepareBusinessDocument(document,context,overrides)
  validateQuote(document,{now:Date.now(),recipientStoreId:context.storeId})
  // The family key is independent of the revision: accepting a revised quote
  // must never create a second purchase under a newly derived operation ID.
  const id=quoteFamilyId(document)
  // A supplier's SKU is scoped to that supplier. An identical local ID is
  // not a global product identity; use the partner mapping or review by name.
  const result=await prepareBusinessDocument({protocol:BUSINESS_PROTOCOL,id,createdAt:new Date().toISOString(),sender:document.sender,recipientStoreId:document.recipient.id,intent:'purchase',currency:document.currency,items:document.items,total:document.total},context,overrides,{skuIsLocal:false})
  if(result.draft){result.draft.issuedAt=document.createdAt;result.draft.note=sourceNote(document);result.preview=validateExternalDraft(result.draft,context,document,Date.now(),true)}
  return {...result,quoted:true}
}
export function validateExternalDraft(draft,context,document,now=Date.now(),allowIncomplete=false){
  if(document?.protocol===CATALOGUE_ORDER_PROTOCOL){readCatalogueOrder(document,{recipientStoreId:context.storeId});if(draft.kind!=='purchase'||draft.id!==catalogueOrderDraftId(document)||draft.issuedAt!==document.createdAt||draft.note!==catalogueOrderNote(document))throw Error('目錄採購來源已變更，請重新核對。');const preview=validateAgentDraft({...draft,issuedAt:new Date(now).toISOString()},context,now,allowIncomplete);return {...preview,draft:structuredClone(draft)}}
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
