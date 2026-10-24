import {moneyValue,quantityValue} from '../../electron/operationRules.mjs'
const fields=['name','category','price','cost','stock','barcode','unit','noBarcode','imageUrl','expiryDate','supplierId','reorderLevel','_creationId']
export const emptyNewProduct=seed=>({name:'',category:'',price:'',cost:'',stock:'',barcode:'',unit:'個',noBarcode:false,imageUrl:'',expiryDate:'',supplierId:'',reorderLevel:'',...seed,_creationId:'p'+crypto.randomUUID()})
export function validNewProductDraft(value){
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['form','guided','pricing'].includes(k))||typeof value.guided!=='boolean')return false
 const form=value.form;if(!form||typeof form!=='object'||Object.keys(form).length!==fields.length||fields.some(k=>!Object.hasOwn(form,k))||typeof form.noBarcode!=='boolean'||!/^p[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(form._creationId))return false
 if(fields.filter(k=>k!=='noBarcode').some(k=>typeof form[k]!=='string'||form[k].length>(k==='imageUrl'?8192:2000)))return false
 const p=value.pricing;return p===null||!!p&&typeof p==='object'&&Object.keys(p).length===3&&typeof p.unit==='string'&&p.unit.length<=2000&&typeof p.signature==='string'&&p.signature.length<=131072&&typeof p.stale==='boolean'
}
export function newProductValues(form){
 if(!form.name.trim()||!form.price.trim())throw Error('請先填商品名稱與售價，內容會保留。')
 const data={...form,price:Number(form.price),cost:Number(form.cost||0),stock:Number(form.stock||0),reorderLevel:Number(form.reorderLevel||0),noBarcode:!form.barcode||form.noBarcode}
 moneyValue(data.price,'售價');moneyValue(data.cost,'成本');quantityValue(data.stock,'庫存');quantityValue(data.reorderLevel,'安全庫存');return data
}
export function savedNewProduct(rows,form,role){
 if(!Array.isArray(rows))throw Error('商品還沒確認保存，請保留原輸入並核對。')
 const row=rows.find(p=>p.id===form._creationId);if(!row)return null
 let expected;try{expected=newProductValues(form)}catch{throw Error('這個編號已有商品，請保留草稿並核對已保存商品。')}
 const keys=['name','category','price','stock','barcode','unit','noBarcode','imageUrl','expiryDate','supplierId','reorderLevel',...(role==='owner'?['cost']:[])]
 const normal=(value,key)=>key==='unit'?value||'個':key==='noBarcode'?!!value:['price','cost','stock','reorderLevel'].includes(key)?value??0:value??''
 if(keys.some(key=>normal(row[key],key)!==normal(expected[key],key)))throw Error('這個編號已有商品，請保留草稿並核對已保存商品。')
 return row
}
