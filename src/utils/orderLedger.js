// Preserve dated sale and refund entries; summing their signed amounts gives
// the right result even when a full refund was split over several days.
export function settledOrders(orders=[]) {
  return orders.filter(o=>o.source!=='customer' && o.payMethod!=='pending' &&
    (!o.status || ['completed','refunded'].includes(o.status)))
}
export function netSale(order) {return (order.total||0)+(order.balanceUsed||0)}
export function orderCost(order,products=[]) {
  return (order.items||[]).reduce((sum,item)=>{
    const id=item.id||item.productId,snapshot=order.itemCosts?.[id]
    const cost=typeof snapshot==='number'?snapshot:(products.find(p=>p.id===id)?.cost||0)
    return sum+cost*(item.qty||0)
  },0)
}
