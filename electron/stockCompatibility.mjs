export const STOCK_COMPAT_SETTING='stockCostVersionFence'
export const hasStockCostHistory=book=>!!(book.stockCostEntries?.length||book.stockCostOperations?.length||book.settings?.some(row=>row.key===STOCK_COMPAT_SETTING&&row.value==='1'))
export function retainStockCostCompatibility(current,next){
 if(!hasStockCostHistory(current)&&!hasStockCostHistory(next))return next
 const settings=new Map((next.settings||[]).map(row=>[row.key,row]))
 settings.set(STOCK_COMPAT_SETTING,{key:STOCK_COMPAT_SETTING,value:'1'})
 return {...next,settings:[...settings.values()]}
}
