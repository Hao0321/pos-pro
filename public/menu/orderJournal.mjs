export const CUSTOMER_JOURNAL='pos_customer_order_journal_v1'
const invalid=()=>Error('這台裝置的原訂單需要核對，紀錄已保留')
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const signature=v=>JSON.stringify(canonical(v))
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
export function customerQuoteTotal(lines){
 let total=0n
 for(const row of lines){if(typeof row.price!=='number'||!Number.isFinite(row.price)||row.price<=0||row.price>1e9||Math.abs(row.price*100-Math.round(row.price*100))>1e-6||!Number.isSafeInteger(row.qty)||row.qty<1||row.qty>1000000)throw invalid();total+=BigInt(Math.round(row.price*100))*BigInt(row.qty)}
 if(total>100000000000n)throw Error('金額超過可處理範圍')
 return Number(total)/100
}
export function assertCustomerAcknowledgement(request,ack){
 if(ack?.success!==true||ack.orderId!=='CO'+request.requestId||typeof ack.trackingToken!=='string'||!/^[a-f0-9]{64}$/.test(ack.trackingToken)||typeof ack.total!=='number'||!Number.isFinite(ack.total)||ack.total<=0||ack.total>1e9||Math.abs(ack.total*100-Math.round(ack.total*100))>1e-6)throw Error('送單結果尚未確認，請核對原訂單')
 return {success:true,orderId:ack.orderId,total:ack.total,trackingToken:ack.trackingToken}
}
export function assertCustomerProgress(ack,value){
 const order=value?.order,fulfilment=order?.fulfilmentStatus,states={reserved:'accepted',cooking:'accepted',ready:'accepted',dispatched:'accepted',completed:'completed',cancelled:'rejected'}
 if(value?.success!==true||order?.id!==ack.orderId||order.total!==ack.total||!['pending','accepted','completed','rejected'].includes(order.status)||fulfilment!==undefined&&(!Object.hasOwn(states,fulfilment)||states[fulfilment]!==order.status)||order.pickupNumber!==undefined&&(!Number.isSafeInteger(order.pickupNumber)||order.pickupNumber<1||order.pickupNumber>1000000))throw Error('送單結果尚未確認，請核對原訂單')
 return order
}
function validate(journal){
 const r=journal?.request
 if(journal?.version!==1||!['pending','confirmed'].includes(journal.phase)||typeof journal.storeId!=='string'||!journal.storeId||!uuid(r?.requestId)||!Array.isArray(r.items)||!r.items.length||r.items.length>100||journal.signature!==signature(r)||!Array.isArray(journal.quote)||journal.quote.length!==r.items.length)throw invalid()
 if(Object.keys(r).some(k=>!['requestId','items','customerName','tableNum','note','table','key'].includes(k)))throw invalid()
 const ids=new Set();for(const [index,row]of r.items.entries()){if(typeof row?.id!=='string'||!row.id||row.id.length>500||ids.has(row.id)||Object.keys(row).sort().join(',')!=='id,qty'||!Number.isSafeInteger(row.qty)||row.qty<1||row.qty>1000000||journal.quote[index]?.id!==row.id||journal.quote[index]?.qty!==row.qty||typeof journal.quote[index].name!=='string')throw invalid();ids.add(row.id)}
 for(const [k,max]of [['customerName',100],['tableNum',40],['note',500]])if(r[k]!==undefined&&(typeof r[k]!=='string'||r[k].length>max))throw invalid()
 if((Object.hasOwn(r,'table')||Object.hasOwn(r,'key'))&&(typeof r.table!=='string'||!r.table||typeof r.key!=='string'||!/^[a-f0-9]{64}$/.test(r.key)))throw invalid()
 customerQuoteTotal(journal.quote)
 if(journal.phase==='confirmed')assertCustomerAcknowledgement(r,journal.ack)
 return journal
}
export function readCustomerJournal(storage){const raw=storage.getItem(CUSTOMER_JOURNAL);if(raw===null)return null;try{return validate(JSON.parse(raw))}catch{throw invalid()}}
function write(storage,next,expected){if(storage.getItem(CUSTOMER_JOURNAL)!==expected)throw invalid();validate(next);const raw=JSON.stringify(next);storage.setItem(CUSTOMER_JOURNAL,raw);if(storage.getItem(CUSTOMER_JOURNAL)!==raw)throw invalid();return next}
export function beginCustomerRequest(storage,storeId,request,quote){
 const raw=storage.getItem(CUSTOMER_JOURNAL),old=readCustomerJournal(storage)
 if(old){if(old.phase!=='pending'||old.storeId!==storeId||old.signature!==signature(request))throw invalid();return old}
 return write(storage,{version:1,phase:'pending',storeId,request:structuredClone(request),quote:structuredClone(quote),signature:signature(request)},raw)
}
export function confirmCustomerRequest(storage,request,ack){
 const raw=storage.getItem(CUSTOMER_JOURNAL),old=readCustomerJournal(storage)
 if(!old||old.signature!==signature(request))throw invalid()
 const complete=assertCustomerAcknowledgement(request,ack)
 if(old.phase==='confirmed'){if(signature(old.ack)!==signature(complete))throw invalid();return old}
 return write(storage,{...old,phase:'confirmed',ack:complete},raw)
}
export function rejectUncommittedRequest(storage,request){const old=readCustomerJournal(storage);if(old?.phase!=='pending'||old.signature!==signature(request))throw invalid();storage.removeItem(CUSTOMER_JOURNAL);if(storage.getItem(CUSTOMER_JOURNAL)!==null)throw invalid()}
export function clearCustomerRequest(storage,requestId){const old=readCustomerJournal(storage);if(!old||old.phase!=='confirmed'||old.request.requestId!==requestId)throw invalid();storage.removeItem(CUSTOMER_JOURNAL);if(storage.getItem(CUSTOMER_JOURNAL)!==null)throw invalid()}
