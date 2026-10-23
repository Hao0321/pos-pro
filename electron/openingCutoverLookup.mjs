import {parseAgentDocument} from './agentHandoff.mjs'
import {readCanonicalMigrationDraft} from './migrationDraftSource.mjs'
import {draftObject,assertPrivateDraftContext,privateDraftDigest} from './privateDrafts.mjs'
import {canonicalSignature} from './operationRules.mjs'
import {assertMasterOwner} from './masterMigration.mjs'
import {openingCutoverId,readOpeningCutoverProof} from './openingCutoverRules.mjs'
import {readOpeningCutoverHistory} from './openingCutoverHistory.mjs'

export const OPENING_CUTOVER_LOOKUP='pos-opening-migration-lookup/v1'
const RESULT='pos-opening-migration-original/v1',same=(a,b)=>canonicalSignature(a)===canonicalSignature(b),fail=()=>{throw Error('原搬家紀錄需要核對，原輸入仍保留。')}
function source(text){const value=readCanonicalMigrationDraft(parseAgentDocument(text,{maxBytes:250000}));if(!value.tables.some(row=>['opening-receivables','opening-payables'].includes(row.entity)))fail();return value}
export function readOpeningCutoverLookup(input){draftObject(input,['protocol','id','sourceText','scope']);assertPrivateDraftContext(input.scope);if(input.protocol!==OPENING_CUTOVER_LOOKUP||input.scope.role!=='owner'||input.id!==openingCutoverId(source(input.sourceText),input.scope))fail();return input}
export function makeOpeningCutoverLookup(sourceText,scope){const input={protocol:OPENING_CUTOVER_LOOKUP,id:openingCutoverId(source(sourceText),scope),sourceText,scope:structuredClone(scope)};return readOpeningCutoverLookup(input)}
export function assertOpeningCutoverLookup(input,value){
 readOpeningCutoverLookup(input);draftObject(value,['protocol','id','scope','sourceTextHash','found','receipt'],['protocol','id','scope','sourceTextHash','found'])
 if(value.protocol!==RESULT||value.id!==input.id||!same(value.scope,input.scope)||value.sourceTextHash!==privateDraftDigest(input.sourceText)||typeof value.found!=='boolean')fail()
 if(!value.found){if(Object.hasOwn(value,'receipt'))fail();return value}
 const original=readOpeningCutoverProof(value.receipt,input.scope.storeId).input
 if(value.receipt.id!==input.id||original.sourceText!==input.sourceText)fail()
 return value
}
// Owner-only immutable history read. This request is never accepted by an
// apply operation and contains none of the optional facts needed for a write.
export function lookupOpeningCutover(input,book,scope,actor,{knownOriginal=false}={}){
 assertMasterOwner(book,actor);readOpeningCutoverLookup(input);assertMasterOwner(book,actor,input.scope);if(!same(scope,input.scope))fail()
 const receipt=readOpeningCutoverHistory(book).byId.get(input.id)
 if(!receipt&&knownOriginal)throw Error('原搬家編號曾經保存，請使用復原引導核對，勿重新搬入。')
 const value={protocol:RESULT,id:input.id,scope:structuredClone(scope),sourceTextHash:privateDraftDigest(input.sourceText),found:!!receipt,...(receipt?{receipt:structuredClone(receipt)}:{})}
 return assertOpeningCutoverLookup(input,value)
}
