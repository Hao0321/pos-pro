import {canonicalSignature} from '../../electron/operationRules.mjs'
import {PURCHASE_UNITS_KIND,PURCHASE_UNITS_PROTOCOL,purchaseUnitFacts,assertPurchaseUnitReview} from '../../electron/purchaseUnitPricing.mjs'
export const purchaseDraftKey=(storeId,userId,role)=>'pos_purchase_units_draft_v1:'+JSON.stringify([storeId,userId,role])
export const purchaseDraftSignature=form=>canonicalSignature({...form,command:null,attempted:false})
export const validPurchaseScope=scope=>scope&&Object.keys(scope).length===4&&['storeId','epoch','userId','role'].every(key=>typeof scope[key]==='string'&&scope[key].length>0&&scope[key].length<=128)&&scope.role==='owner'
export function rawPurchaseItem(row){
 const costBasis={protocol:PURCHASE_UNITS_PROTOCOL,purchasedUnit:row.mode==='base'?row.unit:row.purchasedUnit,purchasedQuantity:row.quantity,baseQuantityPerUnit:row.mode==='base'?'1':row.baseQuantityPerUnit,purchasedUnitPrice:row.unitPrice},facts=purchaseUnitFacts({unit:row.unit,costBasis})
 return {productId:row.productId||null,catalogId:row.catalogId||null,name:row.name,unit:row.unit,qty:facts.baseUnits/1000,costBasis,received:0}
}
export const rawPurchase=form=>({id:form.id,supplierId:form.supplierId,date:form.date,note:form.note,items:form.items.map(rawPurchaseItem)})
function draftSourceSignature(form){const rows=form.items.map(row=>JSON.parse(row.sourceDigest)),supplier=rows[0]?.supplier;if(!supplier||supplier.id!==form.supplierId||rows.some(row=>canonicalSignature(row.supplier)!==canonicalSignature(supplier)||row.items.length!==1))throw Error('source');return canonicalSignature({supplier,items:rows.map(row=>row.items[0])})}
export function validPurchaseDraft(form){
 if(!form||Object.keys(form).length!==9||!['id','supplierId','date','note','agentText'].every(key=>typeof form[key]==='string')||form.note.length>2000||form.agentText.length>250000||form.supplierId.length>128||form.date.length>32||typeof form.attempted!=='boolean'||!Array.isArray(form.items)||form.items.length>1000)return false
 if(form.scope===null&&(form.id||form.supplierId||form.items.length||form.note||form.agentText||form.command||form.attempted))return false
 if(form.scope!==null&&(!validPurchaseScope(form.scope)||!/^PO-[-a-f0-9]{36}$/.test(form.id)))return false
 if(!form.items.every(row=>row&&Object.keys(row).length===11&&['key','productId','catalogId','name','unit','sourceDigest','quantity','unitPrice','purchasedUnit','baseQuantityPerUnit','mode'].every(key=>typeof row[key]==='string')&&row.key.length<=300&&row.name.length<=200&&row.sourceDigest.length<=4000&&['quantity','unitPrice','purchasedUnit','baseQuantityPerUnit','unit'].every(key=>row[key].length<=32)&&['base','pack'].includes(row.mode)))return false
 if(form.command!==null)try{const c=form.command;assertPurchaseUnitReview(c.input);if(Object.keys(c).length!==3||Object.keys(c.identity).length!==2||Object.keys(c.input).length!==4||Object.keys(c.input.supplierContext).length!==3||!Number.isSafeInteger(c.input.supplierContext.revision)||c.input.supplierContext.revision<0||!/^unit-order-[-a-f0-9]{36}$/.test(c.identity.id)||new Date(c.identity.time).toISOString()!==c.identity.time||c.input.kind!==PURCHASE_UNITS_KIND||canonicalSignature(c.input.purchase)!==canonicalSignature(rawPurchase(form))||c.input.unitReview.sourceSignature!==draftSourceSignature(form)||c.input.supplierContext.storeId!==form.scope.storeId||c.input.supplierContext.epoch!==form.scope.epoch||c.draftSignature!==purchaseDraftSignature(form))return false}catch{return false}
 return !form.attempted||form.command!==null
}
