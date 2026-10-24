// A receipt describes an already-saved POS collection. Customer requests and
// refund rows are separate documents and must never look like new collections.
export function originalPosReceipts(orders,query=''){
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return orders.filter(row=>row&&typeof row.id==='string'&&!row.refundOf&&(!row.source||row.source==='pos')&&
    ['completed','refunded'].includes(row.status)&&row.payMethod!=='pending'&&Number.isFinite(row.total)&&
    terms.every(term=>(row.id+' '+row.time+' '+(row.items||[]).map(item=>item.name).join(' ')).toLocaleLowerCase().includes(term)))
    .sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||a.id.localeCompare(b.id))
}
