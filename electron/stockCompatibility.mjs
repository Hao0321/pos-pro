export const STOCK_COMPAT_SETTING='stockCostVersionFence'
export const hasStockCostHistory=book=>!!(book.stockCostEntries?.length||book.stockCostOperations?.length||book.settings?.some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))
export function retainStockCostCompatibility(current,next){
 if(!hasStockCostHistory(current)&&!hasStockCostHistory(next))return next
 const settings=new Map((next.settings||[]).map(row=>[row.key,row]))
 if([current,next].some(book=>book.stockCostEntries?.some(row=>row.method==='applyInventoryOperation'&&row.input?.kind==='receive-lots')||book.settings?.some(row=>row.key==='stockReceiptLotsVersionFence'&&row.value==='1')))settings.set('stockReceiptLotsVersionFence',{key:'stockReceiptLotsVersionFence',value:'1'})
 if([current,next].some(book=>book.stockCostEntries?.some(row=>row.method==='applyInventoryOperation'&&row.input?.kind==='purchase-return-lots')||book.settings?.some(row=>row.key==='stockSupplierLotReturnsVersionFence'&&row.value==='1')))settings.set('stockSupplierLotReturnsVersionFence',{key:'stockSupplierLotReturnsVersionFence',value:'1'})
 settings.set(STOCK_COMPAT_SETTING,{key:STOCK_COMPAT_SETTING,value:'1'})
 if([current,next].some(book=>book.stockCostEntries?.some(row=>row.method==='applyWarehouseOperation')||book.settings?.some(row=>row.key==='warehouseVersionFence'&&row.value==='1')))settings.set('warehouseVersionFence',{key:'warehouseVersionFence',value:'1'})
 if([current,next].some(book=>book.stockCostEntries?.some(row=>row.method==='applyLotOperation')||book.settings?.some(row=>row.key==='stockLotVersionFence'&&row.value==='1')))settings.set('stockLotVersionFence',{key:'stockLotVersionFence',value:'1'})
 if([current,next].some(book=>book.stockCostEntries?.some(row=>row.method==='applyLotOperation'&&row.input?.action==='count')||book.settings?.some(row=>row.key==='stockLotCountVersionFence'&&row.value==='1')))settings.set('stockLotCountVersionFence',{key:'stockLotCountVersionFence',value:'1'})
 return {...next,settings:[...settings.values()]}
}
