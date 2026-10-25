import {assertPrivateDraftContext,draftObject,privateDraftDigest} from '../../electron/privateDrafts.mjs'
const prefix='pos_workspace_draft_v1:'
const invalid=()=>Error('這個裝置的草稿讀不到，原內容仍保留。')
export function workspaceScope(context,kind){assertPrivateDraftContext(context);const dining=/^reservation-(?:menu|ordinary)-order:booking-[-A-Za-z0-9_:]{1,100}$/.test(kind),change=/^reservation-change:(?:move|promote|cancelled|no-show):booking-[a-f0-9]{48}$/.test(kind),deposit=/^reservation-deposit:(?:receive|refund):booking-[a-f0-9]{48}$/.test(kind),ownerOnly=['loyalty-settings','menu-setup','restaurant-settings','reservation-settings','reservation-access','reservation-deposit-policy'].includes(kind)||kind.startsWith('reservation-deposit:refund:');if(!dining&&!change&&!deposit&&!['menu-setup','menu-order','ordinary-order','restaurant-settings','quick','product-new','loyalty-settings','product-edit','member-profile','member-topup','waste-entry','working-cart','shift-count','cash-movement','reservation','reservation-settings','reservation-access','reservation-deposit-policy'].includes(kind)||ownerOnly&&context.role!=='owner')throw invalid();return {context:structuredClone(context),kind,key:prefix+[context.storeId,context.epoch,context.userId,context.role,kind].map(encodeURIComponent).join(':')}}
function safe(value,depth=0){
 if(depth>20)throw invalid()
 if(value===null||typeof value==='boolean')return
 if(typeof value==='string'){if(value.length>131072)throw invalid();return}
 if(typeof value==='number'){if(!Number.isFinite(value))throw invalid();return}
 if(Array.isArray(value)){if(value.length>2000||Object.keys(value).length!==value.length)throw invalid();for(const row of value)safe(row,depth+1);return}
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)throw invalid()
 for(const [key,row]of Object.entries(value)){if(key.length>500)throw invalid();safe(row,depth+1)}
}
export function workspaceStateDigest(state){safe(state);return privateDraftDigest(state)}
function original(value,state){if(value===null)return;draftObject(value,['id','digest','stateDigest']);if(typeof value.id!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value.id)||!['digest','stateDigest'].every(key=>typeof value[key]==='string'&&/^[a-f0-9]{64}$/.test(value[key]))||value.stateDigest!==workspaceStateDigest(state))throw invalid()}
function envelope(value,scope,validate){
 draftObject(value,['version','context','kind','documentId','revision','state','original']);assertPrivateDraftContext(value.context)
 if(value.version!==1||privateDraftDigest(value.context)!==privateDraftDigest(scope.context)||value.kind!==scope.kind||typeof value.documentId!=='string'||!/^draft-[-a-f0-9]{36}$/.test(value.documentId)||!Number.isSafeInteger(value.revision)||value.revision<1)throw invalid()
 safe(value.state);if(validate(value.state,scope.context)!==true)throw invalid();original(value.original,value.state);return value
}
export function readWorkspaceDraft(storage,scope,validate){
 const raw=storage.getItem(scope.key);if(raw===null)return {raw:null,value:null}
 try{if(new TextEncoder().encode(raw).length>262144)throw invalid();return {raw,value:envelope(JSON.parse(raw),scope,validate)}}catch{throw invalid()}
}
function current(storage,scope,expected){if(storage.getItem(scope.key)!==expected)throw Error('這張草稿已在另一個視窗變更，原輸入仍保留。')}
export function writeWorkspaceDraft(storage,scope,value,expected,validate){
 current(storage,scope,expected);const previous=expected===null?null:envelope(JSON.parse(expected),scope,validate),next={version:1,context:scope.context,kind:scope.kind,documentId:value.documentId,revision:(previous?.revision||0)+1,state:structuredClone(value.state),original:value.original?structuredClone(value.original):null};envelope(next,scope,validate)
 if(previous&&privateDraftDigest({...previous,revision:0})===privateDraftDigest({...next,revision:0}))return {raw:expected,value:previous}
 const raw=JSON.stringify(next);if(new TextEncoder().encode(raw).length>262144)throw Error('草稿內容太多，目前輸入仍在畫面上，請分開設定。')
 storage.setItem(scope.key,raw);return {raw,value:next}
}
export function clearWorkspaceDraft(storage,scope,expected){current(storage,scope,expected);storage.removeItem(scope.key)}
export function workspaceOriginal(request,state){return {id:request.id,digest:privateDraftDigest(request),stateDigest:workspaceStateDigest(state)}}
