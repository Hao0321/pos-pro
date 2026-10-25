import {draftObject,privateDraftMappingInput,privateDraftDigest} from './privateDrafts.mjs'
import {operationHeader,quantityValue,sameCommand} from './operationRules.mjs'
export const WASTE_REASONS=['過期','破損','腐壞','自用','試吃樣品','盤虧','其他']
export const wasteEntryFields=['id','time','productId','qty','reason','cashier']
export const isWasteEntry=input=>Object.hasOwn(input||{},'wasteBasis')
export const wasteEntryCore=input=>isWasteEntry(input)?Object.fromEntries(wasteEntryFields.map(key=>[key,input[key]])):input
export function wasteEntryQuantity(raw){if(typeof raw!=='string')throw Error('請填正確數量，最多到小數點後三位。');const text=raw.normalize('NFKC').trim();if(!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,3})?|\.\d{1,3})$/.test(text))throw Error('請填正確數量，最多到小數點後三位。');const value=Number(text.replaceAll(',',''));quantityValue(value,'損耗數量',.001);return value}
export function wasteEntryBasis(row){if(!row)throw Error('找不到原商品，請保留這筆損耗核對。');return {id:row.id,name:row.name,unit:row.unit||''}}
export function assertWasteEntryBasis(value){draftObject(value,['id','name','unit']);if(typeof value.id!=='string'||!/^[-A-Za-z0-9_:]{1,128}$/.test(value.id)||['name','unit'].some(key=>typeof value[key]!=='string'||value[key].length>2000))throw Error('商品與單位需要核對。');return value}
export function wasteEntryInput(input,current,actor){
 if(!isWasteEntry(input)||!Object.hasOwn(input,'draftContext'))throw Error('店面或帳號已變更，請保留原輸入核對。')
 const body=privateDraftMappingInput(input,current);draftObject(body,[...wasteEntryFields,'wasteBasis']);assertWasteEntryBasis(body.wasteBasis);operationHeader(body);quantityValue(body.qty,'損耗數量',.001)
 if(!/^waste-entry-[-a-f0-9]{36}$/.test(body.id)||body.productId!==body.wasteBasis.id||!WASTE_REASONS.includes(body.reason)||body.cashier!==actor?.username)throw Error('原損耗資料需要核對，請保留輸入。')
 return wasteEntryCore(input)
}
export function wasteEntryOriginal(core,rows){if(!Array.isArray(rows))throw Error('損耗紀錄讀不到，請保留原編號。');const row=rows.find(row=>row.id===core.id);if(!row)return null;if(!sameCommand(row,core,wasteEntryFields))throw Error('原損耗編號的內容不同，請保留輸入核對。');operationHeader(row);quantityValue(row.qty,'損耗數量',.001);return row}
export function admitWasteEntry(input,current,{products,wasteLog},actor){
 const data=wasteEntryInput(input,current,actor),original=wasteEntryOriginal(data,wasteLog);if(original)return {data,original}
 const product=products.find(row=>row.id===data.productId),changed=message=>Object.assign(Error(message),{code:'WASTE_ENTRY_REVIEW_CHANGED'})
 if(!product||privateDraftDigest(wasteEntryBasis(product))!==privateDraftDigest(input.wasteBasis))throw changed('商品或單位已更新，請先核對這筆損耗。')
 if(data.qty>product.stock)throw changed('損耗數量超過目前可用庫存，請先核對')
 return {data,original:null}
}
export function wasteEntryLookup(request,current,actor){const core=wasteEntryInput(request,current,actor);return {core,digest:privateDraftDigest(request)}}
