import {privateDraftDigest} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {OPENING_CUTOVER_RECEIPT,openingCutoverSourceDigest,openingBarrierId,readOpeningCutoverProof,cutoverError} from './openingCutoverRules.mjs'

export const cutoverOpeningRows=plan=>plan.stockRows.map(({fact,productId,sourceProductKey,sourceRowKey})=>({fact,productId,sourceProductKey,sourceRowKey}))
export function makeOpeningCutoverReceipt(input,plan,history,actor,time,details){
 const body={protocol:OPENING_CUTOVER_RECEIPT,success:true,id:input.id,signature:canonicalSignature(input),sourceDigest:openingCutoverSourceDigest(input),sequence:history.receipts.length+1,previousHash:history.head,source:structuredClone(plan.source),cutoffDate:input.cutoffDate,rows:structuredClone(cutoverOpeningRows(plan)),totalValueCents:plan.trial.accounts.find(row=>row.account==='1211')?.netCents||0,clearingAccount:'3902',...structuredClone(details),customerBarrierId:openingBarrierId(input.id,'receivable'),supplierBarrierId:openingBarrierId(input.id,'payable'),partyMappings:structuredClone(plan.parties.mappings),custodyDigest:privateDraftDigest(plan.custody),actor:{userId:actor.userId,username:actor.username,role:actor.role},time},receipt={...body,hash:privateDraftDigest(body)}
 readOpeningCutoverProof(receipt,input.scope.storeId);return receipt
}
export function assertOpeningCutoverResult(input,result){const r=result?.receipt;if(result?.success!==true||r?.success!==true||r.id!==input.id||r.signature!==canonicalSignature(input))throw cutoverError();readOpeningCutoverProof(r,input.scope.storeId);return result}
