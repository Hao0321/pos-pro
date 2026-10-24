import {quantityValue,moneyValue,canonicalSignature} from './operationRules.mjs'
import {units,procurementLineCents} from './procurementAmounts.mjs'
import {warehouseRecord,warehouseText} from './warehouseRules.mjs'
import {decimalUnits} from './decimalUnits.mjs'

export const PURCHASE_UNITS_KIND='purchase-create-units',PURCHASE_UNITS_PROTOCOL='pos-purchase-units/v1'
export const PURCHASE_UNITS_FEATURE='procurement-unit-pricing-v1',PURCHASE_UNITS_SETTING='procurementUnitPricingVersionFence'
const invalid='請核對包裝數量、基本單位與原單價格',unrepresentable='換算後的基本數量須能精確到三位小數，請保留原輸入'
export const hasPurchaseUnitBasis=item=>Object.hasOwn(item||{},'costBasis')
export function purchaseUnitFacts(item){
 const basis=item?.costBasis
 try{warehouseRecord(basis,['protocol','purchasedUnit','purchasedQuantity','baseQuantityPerUnit','purchasedUnitPrice']);warehouseText(basis.purchasedUnit,32);warehouseText(item.unit,32)}catch{throw Error(invalid)}
 if(basis.protocol!==PURCHASE_UNITS_PROTOCOL||Object.hasOwn(item,'unitCost'))throw Error(invalid)
 const bought=BigInt(decimalUnits(basis.purchasedQuantity,3,1e12,invalid)),factor=BigInt(decimalUnits(basis.baseQuantityPerUnit,3,1e12,invalid)),price=BigInt(decimalUnits(basis.purchasedUnitPrice,2,1e11,invalid)),product=bought*factor
 if(!bought||!factor||product%1000n||product/1000n>1000000000000n||basis.purchasedUnit===item.unit&&factor!==1000n)throw Error(unrepresentable)
 const base=product/1000n,total=(bought*price+500n)/1000n
 if(!base||total>100000000000n)throw Error(invalid)
 if(item.qty!==undefined){quantityValue(item.qty,'訂購量',.001);if(item.qty!==Number(base)/1000)throw Error('包裝換算與訂購數量不符，請重新核對')}
 return {baseUnits:Number(base),totalCents:Number(total),purchasedQuantityUnits:Number(bought),baseUnitsPerPurchasedUnit:Number(factor),purchasedUnitPriceCents:Number(price)}
}
export function validatePurchaseItemPrice(item){
 quantityValue(item.qty,'訂購量',.001)
 if(hasPurchaseUnitBasis(item))purchaseUnitFacts(item)
 else moneyValue(item.unitCost,'採購單價')
}
// PU2: cumulative allocation retains the original line amount, never a rounded
// per-base-unit price. Legacy prices keep their exact historical calculation.
export function purchaseLineCents(item,quantity=item.qty){
 if(!hasPurchaseUnitBasis(item))return procurementLineCents(quantity,item.unitCost)
 const {baseUnits,totalCents}=purchaseUnitFacts(item),count=units(quantity)
 if(count>baseUnits)throw Error('數量超過原包裝單據')
 return Number((BigInt(totalCents)*BigInt(count)*2n+BigInt(baseUnits))/(2n*BigInt(baseUnits)))
}
export function purchaseReferenceCost(item){
 if(!hasPurchaseUnitBasis(item))return {amount:moneyValue(item.unitCost,'採購單價'),approximate:false}
 const {baseUnits,totalCents}=purchaseUnitFacts(item),rate=(BigInt(totalCents)*2000n+BigInt(baseUnits))/(2n*BigInt(baseUnits))
 return {amount:rate>100000000000n?null:Number(rate)/100,approximate:BigInt(totalCents)*1000n%BigInt(baseUnits)!==0n}
}
export function purchaseSourceSignature(purchase,data){
 const supplier=data.suppliers.find(row=>row.id===purchase.supplierId)
 if(!supplier)throw Error('供應商已變更，請保留原輸入重新核對')
 return canonicalSignature({supplier:{id:supplier.id,name:supplier.name||''},items:purchase.items.map(item=>{
  const product=item.productId?data.products.find(row=>row.id===item.productId):null,catalog=item.catalogId?supplier.catalog?.find(row=>row.id===item.catalogId):null
  if(item.productId&&!product||item.catalogId&&!catalog||!product&&!catalog||catalog?.productId&&product&&catalog.productId!==product.id)throw Error('商品目錄連結已變更，請保留原輸入重新核對')
  return {productId:item.productId||null,catalogId:item.catalogId||null,product:product?{id:product.id,name:product.name,unit:product.unit||'個'}:null,catalog:catalog?{id:catalog.id,name:catalog.name,unit:catalog.unit||'個',productId:catalog.productId||null}:null}
 })})
}
export function assertPurchaseUnitReview(request,data=null){
 const review=request.unitReview
 try{warehouseRecord(review,['protocol','confirmed','sourceSignature'])}catch{throw Error('請由店主核對包裝、數量與原單價格後建單')}
 if(review.protocol!=='pos-purchase-units-review/v1'||review.confirmed!==true||!request.supplierContext||request.sourceQuote!==undefined||request.draftContext!==undefined)throw Error('請由店主核對包裝、數量與原單價格後建單')
 if(typeof review.sourceSignature!=='string'||review.sourceSignature.length>1000000||data&&review.sourceSignature!==purchaseSourceSignature(request.purchase,data))throw Error('商品或供應商資料已變更，請保留原輸入重新核對')
}
export function retainPurchaseUnitFeature(book){
 const flag=(book.settings||[]).find(row=>row.key===PURCHASE_UNITS_SETTING)
 if(flag){if(flag.value!=='1')throw Error('包裝採購版本保護需要核對');return book}
 return {...book,settings:[...book.settings,{key:PURCHASE_UNITS_SETTING,value:'1'}]}
}
export function assertPurchaseUnitFeature(book){
 const flag=(book.settings||[]).find(row=>row.key===PURCHASE_UNITS_SETTING),used=(book.purchases||[]).some(po=>po.procurement?.version===2)
 if(flag&&flag.value!=='1'||used&&!flag)throw Error('包裝採購缺少相容版本保護，請保留原資料核對')
 return !!flag
}
