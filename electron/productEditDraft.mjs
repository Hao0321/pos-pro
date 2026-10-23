import {draftObject,privateDraftDigest,privateDraftMappingInput} from './privateDrafts.mjs'
import {operationHeader,moneyValue,quantityValue} from './operationRules.mjs'
export const PRODUCT_EDIT_JOURNAL='productEditJournalV1'
export const productEditFields=['name','category','price','cost','stock','barcode','unit','noBarcode','imageUrl','expiryDate','supplierId','reorderLevel']
const numbers=['price','cost','stock','reorderLevel'],invalid=()=>Error('商品保存紀錄需要核對，請保留原輸入。')
export const isProductEdit=input=>Object.hasOwn(input||{},'_productEdit')
export function productEditValues(row){return Object.fromEntries(productEditFields.map(key=>[key,key==='noBarcode'?!!row[key]:numbers.includes(key)?row[key]??0:key==='unit'?row[key]||'個':row[key]??'']))}
export function assertProductEditValues(value,partial=false){draftObject(value,productEditFields,partial?[]:productEditFields);for(const[key,row]of Object.entries(value)){if(['price','cost'].includes(key))moneyValue(row,key);else if(['stock','reorderLevel'].includes(key))quantityValue(row,key);else if(key==='noBarcode'){if(typeof row!=='boolean')throw invalid()}else if(typeof row!=='string'||row.length>(key==='imageUrl'?8192:2000))throw invalid()}if(!partial&&(!value.name.trim()||!value.unit.trim()))throw invalid();return value}
export function productEditRequest(productId,input,current){
 if(!Object.hasOwn(input||{},'draftContext'))throw invalid()
 const body=privateDraftMappingInput(input,current),meta=body._productEdit;draftObject(body,[...productEditFields,'_productEdit'],['_productEdit']);draftObject(meta,['id','time','expected']);operationHeader(meta)
 if(!/^product-edit-[-a-f0-9]{36}$/.test(meta.id)||typeof productId!=='string'||!productId||productId.length>128)throw invalid()
 const {_productEdit,...changes}=body;assertProductEditValues(meta.expected);assertProductEditValues(changes,true)
 return {id:meta.id,time:meta.time,productId,expected:meta.expected,changes,draftContext:input.draftContext}
}
export function readProductEditJournal(raw){
 const value=raw==null?{version:1,entries:[]}:typeof raw==='string'?JSON.parse(raw):raw;draftObject(value,['version','entries']);if(value.version!==1||!Array.isArray(value.entries))throw invalid()
 const ids=new Set();for(const row of value.entries){draftObject(row,['id','time','productId','storeId','epoch','userId','role','digest']);if(!/^product-edit-[-a-f0-9]{36}$/.test(row.id)||ids.has(row.id)||!Number.isFinite(Date.parse(row.time))||!['owner','staff'].includes(row.role)||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest)||['productId','storeId','epoch','userId'].some(key=>typeof row[key]!=='string'||!row[key]||row[key].length>128))throw invalid();ids.add(row.id)}return value
}
export function productEditOriginal(input,current,journal){
 const row=journal.entries.find(value=>value.id===input.id);if(!row)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}
 if(['storeId','epoch','userId','role'].some(key=>row[key]!==current[key])||row.digest!==input.digest)throw Error('原商品保存編號內容不同，請保留輸入並核對。')
 return {protocol:'pos-private-draft-original/v1',status:'matched',id:row.id,digest:row.digest,action:'update',entryId:row.productId}
}
export const productEditConflicts=(expected,changes,current)=>Object.keys(changes).filter(key=>current[key]!==expected[key]&&current[key]!==changes[key])
export function admitProductEdit(productId,input,current,product,journal){
 const request=productEditRequest(productId,input,current),digest=privateDraftDigest(request),original=productEditOriginal({id:request.id,digest},current,journal)
 if(original.status==='matched')return {request,original}
 if(!product||productEditConflicts(request.expected,request.changes,productEditValues(product)).length)throw Object.assign(Error('商品已更新，請先核對差異。'),{code:'PRODUCT_EDIT_CONFLICT'})
 return {request,original:null,data:{...request.changes,_expectedPricing:{price:product.price,cost:product.cost,unit:product.unit},...(Object.hasOwn(request.changes,'stock')?{_expectedStock:product.stock}:{})}}
}
export function productEditReceipt(request,current){return {id:request.id,time:request.time,productId:request.productId,storeId:current.storeId,epoch:current.epoch,userId:current.userId,role:current.role,digest:privateDraftDigest(request)}}
export function productEditRejection(productId,input,error){return {success:false,committed:false,error:error.message,errorCode:'PRODUCT_EDIT_REJECTED',requestDigest:privateDraftDigest([productId,input])}}
export const isProductEditRejection=(result,productId,input)=>result?.success===false&&result.committed===false&&result.errorCode==='PRODUCT_EDIT_REJECTED'&&result.requestDigest===privateDraftDigest([productId,input])
