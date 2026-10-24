import {canonicalSignature,quantityValue} from './operationRules.mjs'
import {stockLedgerDigest} from './stockLedgerModel.mjs'
import {prepareRefund,refundSignature} from './refundModel.mjs'

export const REFUND_REVIEW='pos-refund-review/v1',REFUND_PREVIEW='pos-refund-preview/v1'
const same=(a,b)=>canonicalSignature(a)===canonicalSignature(b)
const only=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('退款核對欄位不正確')}
const money=value=>Math.round(Math.abs(value)*100)
const summaryKeys=['subtotalCents','paidCents','cashCents','cardCents','balanceCents','discountCents','manualDiscountCents','pointsReturned','pointsReclaimed','pointsDelta','totalReturnedCents','fullRefund']
function selection(input){
  only(input,['refundOf','items','reason','cashier','shiftId'])
  if(typeof input.refundOf!=='string'||!input.refundOf||typeof input.shiftId!=='string'||!input.shiftId||typeof(input.reason??'')!=='string'||(input.reason||'').length>1000||typeof(input.cashier??'')!=='string'||(input.cashier||'').length>128||!Array.isArray(input.items)||!input.items.length||input.items.length>1000)throw Error('請核對原單、退貨數量與班別')
  const seen=new Set(),items=input.items.map(row=>{only(row,['id','qty']);if(typeof row.id!=='string'||!row.id||seen.has(row.id))throw Error('退貨品項不存在或重複');seen.add(row.id);quantityValue(row.qty,'退貨數量',.001);return {id:row.id,qty:row.qty}}).sort((a,b)=>a.id.localeCompare(b.id))
  return {refundOf:input.refundOf,items,reason:input.reason||'',cashier:input.cashier||'',shiftId:input.shiftId}
}
const fromCommand=request=>selection({refundOf:request.refundOf,items:request.items,reason:request.reason||'',cashier:request.cashier||'',shiftId:request.shiftId||''})
export function refundSummary(plan,member){
  const row=plan.order,cashCents=row.payments.filter(p=>p.method==='cash').reduce((sum,p)=>sum+money(p.amount),0),cardCents=row.payments.filter(p=>p.method==='card').reduce((sum,p)=>sum+money(p.amount),0)
  return {subtotalCents:money(row.subtotal),paidCents:money(row.total),cashCents,cardCents,balanceCents:money(row.balanceUsed),discountCents:money(row.discount),manualDiscountCents:money(row.manualDiscount),pointsReturned:Math.abs(row.pointsUsed),pointsReclaimed:Math.abs(row.pointsEarned),pointsDelta:member?(plan.member.points-(member.points||0)):0,totalReturnedCents:money(row.total)+money(row.balanceUsed),fullRefund:row.fullRefund}
}
function source(input,data,issuedAt){
  if(!data.storeId||!data.epoch)throw Error('店面資料尚未準備好，請重新開啟退貨')
  const original=data.orders.find(row=>row.id===input.refundOf),previous=data.orders.filter(row=>row.refundOf===input.refundOf).sort((a,b)=>a.id.localeCompare(b.id)),member=data.members.find(row=>row.id===original?.memberId)||null,shift=data.shifts.find(row=>row.id===input.shiftId)
  if((data.restaurantEntries||[]).some(row=>row.saleId===input.refundOf))throw Error('這是預訂原單，請到預訂出餐取消')
  if(!shift||shift.status!=='open')throw Error('請先開班，再核對退款')
  if(input.items.some(row=>!data.products.some(p=>p.id===row.id)))throw Error('退貨商品已不存在，請先核對庫存')
  const plan=prepareRefund(original,previous,{...input,id:'refund-preview',time:issuedAt},member),summary=refundSummary(plan,member)
  const material={profile:REFUND_REVIEW,storeId:data.storeId,epoch:data.epoch,costMode:data.costMode||'reference',input,original,previous,member:member?{id:member.id,points:member.points??0,balance:member.balance??0,totalSpent:member.totalSpent??0,tier:member.tier??'normal'}:null,shift:{id:shift.id,status:shift.status,openTime:shift.openTime||'',cashierId:shift.cashierId||''},units:original.items.map(row=>({id:row.id,unit:data.products.find(p=>p.id===row.id)?.unit||''})),issuedAt,summary}
  return {original,previous,plan,summary,sourceDigest:stockLedgerDigest(material)}
}
export function makeRefundPreview(raw,data){
  const input=selection(raw),issuedAt=new Date(data.now??Date.now()).toISOString(),value=source(input,data,issuedAt)
  const review={protocol:REFUND_REVIEW,storeId:data.storeId,epoch:data.epoch,costMode:data.costMode||'reference',sourceDigest:value.sourceDigest,issuedAt,summary:value.summary}
  const rows=value.original.items.map(row=>{const soldUnits=Math.round(row.qty*1000),returnedUnits=value.previous.reduce((sum,refund)=>sum+refund.items.filter(item=>item.id===row.id).reduce((n,item)=>n+Math.round(Math.abs(item.qty)*1000),0),0);return {id:row.id,name:row.name,price:row.price,unit:data.products.find(p=>p.id===row.id)?.unit||'',soldUnits,returnedUnits,remainingUnits:soldUnits-returnedUnits}})
  return {protocol:REFUND_PREVIEW,success:true,input,review,rows,original:{id:value.original.id,time:value.original.time,memberId:value.original.memberId||null}}
}
export function assertRefundReviewShape(review){
  only(review,['protocol','storeId','epoch','costMode','sourceDigest','issuedAt','summary'])
  if(Object.keys(review).length!==7||review.protocol!==REFUND_REVIEW||!['active','reference'].includes(review.costMode)||typeof review.storeId!=='string'||!review.storeId||typeof review.epoch!=='string'||!review.epoch||typeof review.sourceDigest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(review.sourceDigest)||!Number.isFinite(Date.parse(review.issuedAt))||new Date(review.issuedAt).toISOString()!==review.issuedAt)throw Error('退款預覽不完整，請重新核對')
  only(review.summary,summaryKeys)
  if(Object.keys(review.summary).length!==summaryKeys.length||typeof review.summary.fullRefund!=='boolean'||summaryKeys.filter(key=>key!=='fullRefund').some(key=>!Number.isSafeInteger(review.summary[key])||Math.abs(review.summary[key])>1e12||key!=='pointsDelta'&&review.summary[key]<0))throw Error('退款預覽金額需要核對')
  const s=review.summary
  if(s.cashCents+s.cardCents!==s.paidCents||s.paidCents+s.balanceCents!==s.totalReturnedCents||s.totalReturnedCents+s.discountCents+s.manualDiscountCents!==s.subtotalCents)throw Error('退款預覽金額需要核對')
  return review
}
export function verifyRefundReview(request,data){
  if(request.review===undefined)return null
  only(request,['id','time','refundOf','items','reason','cashier','shiftId','review'])
  const review=assertRefundReviewShape(request.review)
  if(review.storeId!==data.storeId||review.epoch!==data.epoch)throw Error('店面或資料已還原，請保留原單重新核對')
  if(review.costMode!==(data.costMode||'reference'))throw Error('成本資料已更新，請重新看退款')
  if(Math.abs((data.now??Date.now())-Date.parse(review.issuedAt))>300000)throw Error('退款預覽已過期，請重新看退款')
  const actual=source(fromCommand(request),data,review.issuedAt)
  if(actual.sourceDigest!==review.sourceDigest||!same(actual.summary,review.summary))throw Error('原單、會員或退款資料已更新，請重新看退款')
  return actual.plan
}
export function assertReviewedRefundResult(request,result){
  if(request.review===undefined)return result
  const review=assertRefundReviewShape(request.review),order=result?.order
  if(result?.success!==true||order?.id!==request.id||order.refundOf!==request.refundOf||order.time!==request.time||order.requestSignature!==refundSignature(request)||order.fullRefund!==review.summary.fullRefund||result.original?.id!==request.refundOf||!Array.isArray(order.items)||order.items.length!==request.items.length||request.items.some(row=>order.items.filter(item=>item.id===row.id&&item.qty===-Math.round(row.qty*1000)/1000).length!==1))throw Error('退款回覆不完整，請保留原編號核對')
  const amounts={subtotal:'subtotalCents',total:'paidCents',paid:'paidCents',balanceUsed:'balanceCents',discount:'discountCents',manualDiscount:'manualDiscountCents',pointsUsed:'pointsReturned',pointsEarned:'pointsReclaimed'}
  for(const [key,expected]of Object.entries(amounts)){const value=order[key],actual=key.startsWith('points')?-value:Math.round(-value*100);if(typeof value!=='number'||!Number.isFinite(value)||value>0||actual!==review.summary[expected])throw Error('退款回覆金額不符，請保留原編號核對')}
  if(!Array.isArray(order.payments)||order.payments.length>2||new Set(order.payments.map(row=>row.method)).size!==order.payments.length||order.payments.some(row=>!['cash','card'].includes(row.method)||typeof row.amount!=='number'||!Number.isFinite(row.amount)||row.amount>0))throw Error('退款回覆付款方式不符，請保留原編號核對')
  for(const method of ['cash','card'])if(order.payments.filter(row=>row.method===method).reduce((sum,row)=>sum+Math.round(-row.amount*100),0)!==review.summary[method+'Cents'])throw Error('退款回覆付款方式不符，請保留原編號核對')
  if(order.shiftId!==request.shiftId||order.cashier!==request.cashier||order.note!==(request.reason||'')||order.memberId!==(result.original.memberId||null)||!Array.isArray(result.products)||result.products.length!==request.items.length||request.items.some(row=>result.products.filter(p=>p.id===row.id&&typeof p.stock==='number'&&Number.isFinite(p.stock)&&p.stock>=0).length!==1)||order.memberId&&(!result.member||result.member.id!==order.memberId||!Number.isSafeInteger(result.member.points)||result.member.points<0||!Number.isFinite(result.member.balance)||result.member.balance<0))throw Error('退款回覆不完整，請保留原編號核對')
  if(review.costMode==='active'){
    const receipt=result.costReceipt
    if(receipt?.protocol!=='pos-stock-cost/v1'||receipt.success!==true||receipt.id!==request.id||receipt.sourceMethod!=='refundOrder'||!Number.isSafeInteger(receipt.sequence)||receipt.sequence<2||['eventHash','stateDigest'].some(key=>!/^sha256:[a-f0-9]{64}$/.test(receipt[key])))throw Error('退款成本回覆尚未確認，請保留原編號核對')
  }
  return result
}
