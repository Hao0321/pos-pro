import {productEditFields,productEditValues,assertProductEditValues,productEditConflicts} from '../../electron/productEditDraft.mjs'
const numbers=['price','cost','stock','reorderLevel']
export const productEditForm=row=>Object.fromEntries(productEditFields.map(key=>[key,key==='noBarcode'?!!row[key]:String(productEditValues(row)[key])]))
export const newProductEditDraft=(row,guided=false)=>({productId:row.id,base:productEditValues(row),form:productEditForm(row),guided,pricing:null,submission:null})
export function productEditFormValues(form){
 if(['name','unit','price','cost','stock'].some(key=>typeof form[key]!=='string'||!form[key].trim()))throw Error('請填商品名稱、單位與正確金額，原輸入會保留。')
 const value=Object.fromEntries(productEditFields.map(key=>[key,numbers.includes(key)?Number(form[key]||0):form[key]]));return assertProductEditValues(value)
}
export function productEditChanges(value){const desired=productEditFormValues(value.form);return Object.fromEntries(productEditFields.filter(key=>desired[key]!==value.base[key]).map(key=>[key,desired[key]]))}
export const hasProductEditInput=value=>!!value&&(!!value.submission||productEditFields.some(key=>value.form[key]!==productEditForm(value.base)[key]))
export function validProductEditDraft(value){
 if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='base,form,guided,pricing,productId,submission'||typeof value.productId!=='string'||!value.productId||value.productId.length>128||typeof value.guided!=='boolean')return false
 try{assertProductEditValues(value.base)}catch{return false}
 if(!value.form||Object.keys(value.form).length!==productEditFields.length||productEditFields.some(key=>key==='noBarcode'?typeof value.form[key]!=='boolean':typeof value.form[key]!=='string'||value.form[key].length>(key==='imageUrl'?8192:2000)))return false
 const p=value.pricing;if(p!==null&&(!p||typeof p!=='object'||Object.keys(p).sort().join(',')!=='signature,stale,unit'||typeof p.unit!=='string'||typeof p.signature!=='string'||p.signature.length>131072||typeof p.stale!=='boolean'))return false
 const s=value.submission;if(s===null)return true;if(!s||Object.keys(s).sort().join(',')!=='id,time'||!/^product-edit-[-a-f0-9]{36}$/.test(s.id)||!Number.isFinite(Date.parse(s.time)))return false
 try{productEditChanges(value);return true}catch{return false}
}
export function productEditInput(value,context){if(!value.submission)throw Error('請先核對這次商品保存結果。');return {...productEditChanges(value),_productEdit:{...value.submission,expected:value.base},draftContext:context}}
export function productEditReview(value,row){if(!row)throw Error('找不到原商品，原輸入仍保留。');const current=productEditValues(row);return {current,conflicts:productEditConflicts(value.base,productEditChanges(value),current)}}
export function rebaseProductEdit(value,row,choice){
 const current=productEditValues(row),changed=productEditChanges(value),conflicts=productEditConflicts(value.base,changed,current),form=productEditForm(current)
 for(const key of Object.keys(changed))if(choice==='mine'||!conflicts.includes(key))form[key]=value.form[key]
 return {...value,base:current,form,submission:null}
}
