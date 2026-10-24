import {AGENT_PROTOCOL,validateAgentDraft,agentCommand} from './agentDraftRules.mjs'
import {BUSINESS_PROTOCOL,businessDocumentDraftId,prepareBusinessDocumentSync} from './businessDocument.mjs'
import {QUOTE_PROTOCOL,validateQuote,validateQuotedPurchase,only,text} from './businessExchange.mjs'
import {quoteDocumentDraftId,catalogueOrderDraftId} from './quoteImport.mjs'
import {CATALOGUE_ORDER_PROTOCOL,readCatalogueOrder,assertCatalogueOriginal} from './catalogueOrder.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {procurementLineCents} from './procurementAmounts.mjs'

const different=()=>Error('原編號已用於不同內容，請保留原單核對。')
export const isPurchaseImport=document=>document?.protocol===AGENT_PROTOCOL&&document.kind==='purchase'||document?.protocol===BUSINESS_PROTOCOL&&document.intent==='purchase'||document?.protocol===QUOTE_PROTOCOL||document?.protocol===CATALOGUE_ORDER_PROTOCOL
export function purchaseImportId(document,storeId){
 if(!isPurchaseImport(document)||new TextEncoder().encode(JSON.stringify(document)).length>32768)throw different()
 if(document.protocol===CATALOGUE_ORDER_PROTOCOL){readCatalogueOrder(document,{recipientStoreId:storeId});return 'agent-'+catalogueOrderDraftId(document)}
 if(document.protocol===QUOTE_PROTOCOL){validateQuote(document,{recipientStoreId:storeId});return 'agent-'+quoteDocumentDraftId(document)}
 if(document.protocol===BUSINESS_PROTOCOL){
  only(document,['protocol','id','createdAt','sender','recipientStoreId','intent','currency','items','total','fulfilment','note'],'交換單據');only(document.sender,['id','name'],'來源公司')
  if(document.recipientStoreId&&document.recipientStoreId!==storeId)throw Error('這份草稿屬於另一間店，沒有建立任何單據')
  return 'agent-'+businessDocumentDraftId(text(document.sender.id,128,'來源公司代碼'),text(document.id,128,'外部單號'))
 }
 only(document,['protocol','id','issuedAt','storeId','catalogueRevision','kind','items','supplierId','date','channel','day','slot','customer','contact','note'],'草稿')
 if(document.storeId!==storeId)throw Error('這份草稿屬於另一間店，沒有建立任何單據')
 if(!/^[A-Za-z0-9_-]{8,80}$/.test(document.id||''))throw different()
 return 'agent-'+document.id
}
// This compares immutable business terms. Older purchase receipts did not save
// the raw Agent catalogue revision or the external company's original SKU map.
// They cannot establish byte-for-byte source equality; a preserved quote can.
export function assertImportedPurchaseSource(document,request){
 const storeId=request?.supplierContext?.storeId,purchase=request?.purchase
 if(!storeId||request.kind!=='purchase-create'||purchaseImportId(document,storeId)!==request.id||purchase?.id!=='PO-'+request.id)throw different()
 if(document.protocol===CATALOGUE_ORDER_PROTOCOL){if(request.sourceQuote!==undefined)throw different();assertCatalogueOriginal(document,request);return 'stored-catalogue-order'}
 if(document.protocol===QUOTE_PROTOCOL){
  if(canonicalSignature(document)!==canonicalSignature(request.sourceQuote?.document))throw different()
  validateQuotedPurchase({...purchase,total:purchase.items.reduce((n,row)=>n+procurementLineCents(row.qty,row.unitCost),0)/100},request.sourceQuote,{recipientStoreId:storeId})
  return 'stored-quote-document'
 }
 if(request.sourceQuote!==undefined||request.sourceCatalogue!==undefined)throw different()
 // Source draft time was not saved by older purchase writers. It is only a
 // syntax clock here; current expiry must still guard every new purchase.
 const now=Date.parse(document.protocol===AGENT_PROTOCOL?document.issuedAt:document.createdAt)
 const context={storeId,kinds:['purchase'],catalogueRevision:document.protocol===AGENT_PROTOCOL?document.catalogueRevision:'historical-purchase-terms',products:purchase.items.map(row=>({id:row.productId,name:row.name,unit:row.unit,unitCost:row.unitCost,price:0,stock:0})),suppliers:[{id:purchase.supplierId}],restaurantEnabled:false}
 let draft=document
 if(document.protocol===BUSINESS_PROTOCOL){
  if(!Array.isArray(document.items)||document.items.length!==purchase.items.length)throw different()
  const overrides={}
  document.items.forEach((row,index)=>{if(!row||typeof row!=='object')throw different();const key=row.sku?'sku:'+row.sku:row.barcode?'barcode:'+row.barcode:'name:'+row.name;if(Object.hasOwn(overrides,key))throw different();overrides[key]=purchase.items[index].productId})
  draft=prepareBusinessDocumentSync(document,context,overrides,{now}).draft
 }else if(typeof document.catalogueRevision!=='string'||!document.catalogueRevision||document.catalogueRevision.length>128)throw different()
 const command=agentCommand(validateAgentDraft(draft,context,now))
 if(command.kind!=='purchase-create'||canonicalSignature(command.input.purchase)!==canonicalSignature(purchase))throw different()
 return 'stored-purchase-terms'
}
