import {readRecords, writeRecords, withSalesLock, browserStorage,assertOriginalOperationAvailable} from './browserStorage'
import { prepareCheckout } from './checkoutSafety.mjs'
import { prepareRefund, refundSignature } from './refundSafety.mjs'
import {signature} from '../../electron/checkoutSignature.mjs'
import {hasBrowserStockCost,commitBrowserStockBusiness} from './browserStockBusiness'
import {browserToBook} from '../../electron/recoveryRules.mjs'
import {validateStockCostBook} from '../../electron/stockBackup.mjs'
import {browserStockActor} from '../../electron/browserStockPlan.mjs'
export const SALES_PROTOCOL='pos-checkout-v5'
function receipt(order,data) {
  return {protocol:SALES_PROTOCOL,success:true,orderId:order.id,order,
    ...(order.status==='refunded'&&!order.refundOf?{refunds:data.pos2_orders.filter(row=>row.refundOf===order.id)}:{}),
    products:data.pos2_products.filter(p=>order.items.some(i=>i.id===p.id)),
    member:order.memberId ? data.pos2_members.find(m=>m.id===order.memberId) : null}
}
export async function commitBrowserRefund(request,actor) {
  return withSalesLock(()=>{
    try {
      const current=readRecords(),data=current.data,existing=data.pos2_orders.find(o=>o.id===request.id)
      if(hasBrowserStockCost(current))return commitBrowserStockBusiness('refundOrder',request,actor,current)
      assertOriginalOperationAvailable('refundOrder',request.id,current,request)
      if (existing) {
        if(existing.requestSignature!==refundSignature(request)) throw new Error('退貨單號內容不一致')
        return {...receipt(existing,data),original:data.pos2_orders.find(o=>o.id===existing.refundOf)}
      }
      const original=data.pos2_orders.find(o=>o.id===request.refundOf),member=data.pos2_members.find(m=>m.id===original?.memberId)
      if(data.pos_restaurant_orders.some(e=>e.saleId===request.refundOf))throw Error('預訂退款請在「預訂出餐」取消原單，避免回補已耗用食材')
      const plan=prepareRefund(original,data.pos2_orders.filter(o=>o.refundOf===original?.id),request,member)
      if (plan.stockUpdates.some(u=>!data.pos2_products.some(p=>p.id===u.id))) throw new Error('退貨商品已不存在，請先核對庫存')
      const orig={...original,...(plan.order.fullRefund?{status:'refunded'}:{})}
      const next=writeRecords({pos2_orders:[plan.order,...data.pos2_orders.map(o=>o.id===orig.id?orig:o)],
        pos2_products:data.pos2_products.map(p=>{const u=plan.stockUpdates.find(u=>u.id===p.id);return u?{...p,stock:p.stock+u.delta}:p}),
        pos2_members:data.pos2_members.map(m=>m.id===plan.member?.id?plan.member:m)},current.revision)
      return {...receipt(plan.order,next.data),original:orig}
    }catch(error){return {success:false,committed:error.historyUncertain?null:false,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  })
}
export function browserReceipt(id,actor) {
  const record=readRecords(),{data}=record,order=data.pos2_orders.find(o=>o.id===id)
  if(hasBrowserStockCost(record)){
    const book=browserToBook(data),state=validateStockCostBook(book)
    if(actor)browserStockActor(book,actor,'checkout')
    const event=state.entries.find(row=>row.evidence?.order?.id===id||row.evidence?.entry?.saleId===id&&row.input.action==='pay'||row.evidence?.entry?.refundId===id&&row.input.action==='cancel')
    const legacy=[...(state.projection.legacyOperationIds?.checkout||[]),...(state.projection.legacyOperationIds?.refundOrder||[])]
    if(!order&&(event||legacy.includes(id)))throw Error('原單資料需要核對，請保留原編號')
    if(order&&order.source!=='customer'){
      if(event){const operation=state.operations.find(row=>row.method===event.method&&row.operationId===event.input.id);if(!operation)throw Error('原單缺少成本回執');return {...receipt(order,data),costReceipt:structuredClone(operation.receipt)}}
      if(!legacy.includes(id))throw Error('原單缺少成本回執')
    }
  }
  return order ? receipt(order,data) : {protocol:SALES_PROTOCOL,success:true,found:false}
}
export async function commitBrowserSale(request,actor) {
  return withSalesLock(()=>{
    try {
      const current=readRecords(),data=current.data,existing=data.pos2_orders.find(o=>o.id===request.id)
      if(hasBrowserStockCost(current))return commitBrowserStockBusiness('checkout',request,actor,current)
      assertOriginalOperationAvailable('checkout',request.id,current,request)
      if (existing) {
        if(existing.refundOf||!['completed','refunded'].includes(existing.status)||signature(request)!==signature(existing)||Object.keys(request).some(k=>k!=='status'&&JSON.stringify(request[k])!==JSON.stringify(existing[k]))) throw new Error('單號內容不一致')
        return receipt(existing,data)
      }
      const setting=(key,fallback)=>{const raw=browserStorage.getItem('pos_settings_'+key);return raw==null ? fallback : Number(JSON.parse(raw))}
      const plan=prepareCheckout({cart:request.items,products:data.pos2_products,members:data.pos2_members,
        activeMember:request.memberId?{id:request.memberId}:null,pointsRule:{earn:setting('pointsEarnRate',10),redeem:setting('pointsRedeemRate',1)},
        birthdayBonus:setting('birthdayBonus',100),openShift:data.pos2_shifts.find(s=>s.id===request.shiftId),
        payMethod:request.payMethod,paid:request.paid,pointsUsed:request.pointsUsed,id:request.id,now:new Date(request.time),
        opts:{taxId:request.taxId,cashier:request.cashier,manualDiscountAmt:request.manualDiscount,balanceUsed:request.balanceUsed,
          ...(request.payMethod==='mixed'?{payments:request.payments}:{})}})
      if (Object.keys(plan.order).some(k=>JSON.stringify(plan.order[k])!==JSON.stringify(request[k]))) throw new Error('交易資料已改變，請重新確認')
      plan.order.itemCosts=Object.fromEntries(plan.order.items.map(i=>[i.id,Number(data.pos2_products.find(p=>p.id===i.id).cost)||0]))
      const products=data.pos2_products.map(p=>{const u=plan.stockUpdates.find(u=>u.id===p.id);return u?{...p,stock:p.stock+u.delta}:p})
      const members=data.pos2_members.map(m=>m.id===plan.memberUpdate?.id ? {...m,
        points:m.points+plan.memberUpdate.pointsDelta,totalSpent:(m.totalSpent||0)+plan.memberUpdate.spentDelta,
        balance:(m.balance||0)+plan.memberUpdate.balanceDelta,tier:plan.memberUpdate.tier,
        ...(plan.memberUpdate.lastBirthdayBonus?{lastBirthdayBonus:plan.memberUpdate.lastBirthdayBonus}:{})} : m)
      const next=writeRecords({pos2_products:products,pos2_members:members,pos2_orders:[plan.order,...data.pos2_orders]},current.revision)
      return receipt(plan.order,next.data)
    } catch(error) {return {protocol:SALES_PROTOCOL,success:false,committed:error.historyUncertain?null:false,orderId:request.id,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{}),error:error.message}}
  })
}
