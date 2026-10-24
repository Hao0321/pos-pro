import {tr} from '../../i18n'
import OriginalCreditMethod from '../../components/OriginalCreditMethod'
import {salesMoney} from '../sales/SalesOrderForm'
import {supplierDraftRequest} from '../../utils/supplierDraftReceipt.mjs'
import {suggestSupplierAllocation} from '../../utils/supplierLedgerUi.mjs'
import {supplierClaimKey} from '../../../electron/supplierCredit.mjs'
import {SupplierProposalDetails} from './SupplierApprovalCard'
export const supplierActionTitle=action=>tr({pay:'已付訂金',allocate:'抵付請款',unallocate:'解除供應商抵付',refund:'收到退回款','refund-reverse':'更正收到退回款','pay-reverse':'沖銷原預付款','policy-set':'採購核對設定','purchase-register':'建立採購並保留核准要求','purchase-enroll':'將這張採購納入核准','purchase-approve':'核准這張採購','purchase-reject':'退回這張採購','purchase-withdraw':'撤回這張採購','payment-propose':'送出預付款提案','payment-approve':'核准預付款提案','payment-reject':'退回預付款提案','payment-withdraw':'撤回預付款提案'}[action]||'供應商款項')
const actualActions=['pay','refund','refund-reverse','pay-reverse']
export default function SupplierOperationForm({draft,setDraft,state,claims,openShift,onSave,onHide,onRefresh,busy,error}){
 const ledger=state.supplierLedger,payment=ledger.payments.find(row=>row.id===draft.paymentId),supplier=state.suppliers.find(row=>row.id===draft.supplierId),proposal=ledger.paymentApprovals.find(row=>row.id===draft.proposalId),approval=ledger.purchaseApprovals.find(row=>row.purchaseId===draft.purchaseId),purchase=state.purchases.find(row=>row.id===draft.purchaseId)
 const isAllocation=['allocate','unallocate'].includes(draft.action),isActual=actualActions.includes(draft.action),isProposal=draft.action==='payment-propose',isPurchase=draft.action.startsWith('purchase-'),isReview=draft.action.startsWith('payment-')&&!isProposal,cash=draft.method==='cash',limit=payment?.available||0
 const stale=draft.epoch!==state.epoch||draft.storeId!==state.storeId||draft.ledgerRevision!==ledger.revision||draft.expectedPurchaseRevision!==undefined&&draft.expectedPurchaseRevision!==purchase?.procurement?.revision||(draft.items||[]).some(row=>(state.purchases.find(po=>po.id===row.purchaseId)?.procurement?.revision??ledger.openingClaims?.find(c=>c.purchaseId===row.purchaseId&&c.invoiceId===row.invoiceId)?.revision)!==row.expectedRevision)||(['pay','payment-propose','allocate','unallocate','refund','refund-reverse','pay-reverse'].includes(draft.action)&&draft.expectedSupplierName!==supplier?.name)
 const update=(key,value)=>setDraft(previous=>{
  const next={...previous,[key]:value,confirmed:key==='confirmed'?value:false}
  if(key==='paymentId'){const original=ledger.payments.find(row=>row.id===value);next.method=original?.fundingKind==='opening-credit'?previous.method:original?.method||previous.method;next.fundingKind=original?.fundingKind;if(draft.action==='refund')next.amount=String(original?.available||'')}
  return next
 })
 const claimMap=new Map(claims.map(row=>[supplierClaimKey(row.purchaseId,row.invoiceId),row])),count=(draft.items||[]).filter(row=>Number(row.amount)>0).length,total=(draft.items||[]).reduce((sum,row)=>sum+Math.round(Number(row.amount||0)*100),0)/100
 const needsReason=['policy-set','unallocate','refund','refund-reverse','pay-reverse','purchase-reject','purchase-withdraw','payment-reject','payment-withdraw'].includes(draft.action)
 function suggest(){const rows=suggestSupplierAllocation(payment,claims);setDraft(previous=>({...previous,confirmed:false,items:claims.slice(0,100).map(claim=>({purchaseId:claim.purchaseId,invoiceId:claim.invoiceId,expectedRevision:claim.expectedRevision,amount:String(rows.find(row=>row.purchaseId===claim.purchaseId&&row.invoiceId===claim.invoiceId)?.amount||'')}))}))}
 return <section className="card customer-form supplier-form" aria-label={supplierActionTitle(draft.action)}><h2>{supplierActionTitle(draft.action)}</h2>
  {supplier&&<p><strong>{supplier.name}</strong> · <span className="customer-id">{supplier.id}</span></p>}
  {draft.agentDraftId&&<p className="customer-note">{tr('已帶入 Agent 草稿，仍需核對；系統不會替你轉帳。')}</p>}
  {stale&&<div role="alert" className="customer-note"><p>{tr('資料已更新，請重新核對；已填內容會保留。')}</p><button className="btn btn-ghost" onClick={onRefresh} disabled={busy}>{tr('重新核對最新資料')}</button></div>}
  <form onSubmit={event=>{event.preventDefault();onSave(supplierDraftRequest(draft,openShift?.id||''),draft.agentDraftId?{id:draft.agentDraftId,time:new Date().toISOString()}:null)}}><fieldset disabled={busy||stale}>
   {(draft.action==='pay'||isProposal)&&<>
    {proposal&&<div className="customer-note"><p>{tr('沿用已核准提案，供應商、金額與方式不能更改。')}</p><SupplierProposalDetails proposal={proposal}/></div>}
    <label>{tr(isProposal?'準備預付多少？':'實際付出多少？')}<input className="field" data-supplier-amount type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" required readOnly={!!draft.proposalId} value={draft.amount} onChange={event=>update('amount',event.target.value)}/></label>
    <label>{tr('付款方式')}<select className="field" data-supplier-method disabled={!!draft.proposalId} value={draft.method} onChange={event=>update('method',event.target.value)}><option value="cash">{tr('現金')}</option><option value="bank">{tr('銀行付款')}</option></select></label>
    <p className="customer-note">{tr(isProposal?'這一步只送審，不記現金、不表示已付款。另一帳號核准後，再記錄實際付款。':'這筆錢先保留為供應商預付款。收到貨並核對請款後，再抵付，不會付第二次。')}</p>
   </>}
   {(['allocate','refund','unallocate','refund-reverse','pay-reverse'].includes(draft.action))&&<label>{tr(payment?.fundingKind==='opening-credit'?'原單貸項':'原預付款')}<select className="field" data-supplier-payment value={draft.paymentId} disabled={!['allocate','refund'].includes(draft.action)} onChange={event=>update('paymentId',event.target.value)}>{ledger.payments.filter(row=>row.supplierId===draft.supplierId&&(!row.reversed||row.id===draft.paymentId)).map(row=><option key={row.id} value={row.id}>{row.fundingKind==='opening-credit'?tr('原單貸項')+' · ':''}{row.date} · {salesMoney(row.amount)} · {tr('可用 {0}',{0:salesMoney(row.available)})} · {row.id.slice(-8)}</option>)}</select></label>}
   {isAllocation&&<>
    <p>{tr(draft.fundingKind==='opening-credit'?(draft.action==='allocate'?'本次只抵用原單貸項，不會再收付款。':'解除後回到原單貸項，這一步不代表收付款。'):draft.action==='allocate'?'本次只分配已付出的預付款，不會再付一次錢。':'解除後回到原預付款餘額，這一步不表示供應商已退錢。')}</p>
    {draft.action==='allocate'&&<button className="btn btn-ghost" type="button" data-supplier-suggest onClick={suggest}>{tr('依到期日建議分配')}</button>}
    <div className="customer-allocation-items">{(draft.items||[]).map(row=>{const key=supplierClaimKey(row.purchaseId,row.invoiceId),claim=claimMap.get(key),po=state.purchases.find(purchase=>purchase.id===row.purchaseId),invoice=po?.procurement?.bills.find(bill=>bill.id===row.invoiceId);return <label key={key}><span><strong>{invoice?.reference||claim?.reference||row.invoiceId}</strong><span>{po?.items.map(item=>item.name).join('、')}</span><small className="customer-id">{row.purchaseId}</small>{claim&&<small>{tr('尚未付 {0}',{0:salesMoney(claim.owed)})}</small>}</span><input className="field" data-supplier-allocation={row.invoiceId} aria-label={tr('本次抵付金額')} type="number" inputMode="decimal" min="0" step="0.01" value={row.amount} onChange={event=>setDraft(previous=>({...previous,confirmed:false,items:previous.items.map(item=>supplierClaimKey(item.purchaseId,item.invoiceId)===key?{...item,amount:event.target.value}:item)}))}/></label>})}</div>
    <strong className="customer-total">{tr('本次 {0} 張，共 {1}',{0:count,1:salesMoney(total)})}</strong>{draft.action==='allocate'&&<p>{tr('原預付款可用 {0}；本次後剩餘 {1}',{0:salesMoney(limit),1:salesMoney(limit-total)})}</p>}
   </>}
   {draft.action==='refund'&&draft.fundingKind==='opening-credit'&&<OriginalCreditMethod kind="supplier" method={draft.method} onChange={value=>update('method',value)}/>}
   {draft.action==='refund'&&<><p>{tr('原預付款可退餘額 {0}',{0:salesMoney(limit)})}</p><label>{tr('實際收回多少？')}<input className="field" data-supplier-amount type="number" inputMode="decimal" min="0.01" max={limit} step="0.01" required value={draft.amount} onChange={event=>update('amount',event.target.value)}/></label></>}
   {['refund-reverse','pay-reverse'].includes(draft.action)&&<strong>{salesMoney(Number(draft.amount))}</strong>}
   {isActual&&draft.action!=='pay'&&!(draft.action==='refund'&&draft.fundingKind==='opening-credit')&&<p>{tr('沿用原付款方式：{0}',{0:tr(cash?'現金':'銀行付款')})}</p>}
   {(isPurchase||isReview)&&<><SupplierProposalDetails purchase={purchase} approval={approval} proposal={proposal}/><p className="customer-note">{tr(draft.action==='purchase-enroll'?'這次才納入核准，既有收貨與付款不會補造核准人。':'本次核對只更新提案狀態，不會替你付款或收貨。')}</p></>}
   {draft.action==='policy-set'&&<div className="customer-note"><strong>{tr(draft.mode==='dual-owner'?'之後的新採購與預付款，改由另一管理員帳號核准。':'之後的新提案改用一位管理員的簡單流程。')}</strong><p>{tr('已送審的提案仍保留原核准要求，不會因切換模式自動放行。')}</p></div>}
   {needsReason&&<label>{tr('原因')}<input className="field" data-supplier-reason value={draft.reason||''} maxLength={500} required onChange={event=>update('reason',event.target.value)}/></label>}
   {cash&&isActual&&!openShift&&<p role="alert">{tr('請先開班，再記錄現金收付。')}</p>}
   <details><summary>{tr('日期、備註與參考編號')}</summary><label>{tr('日期')}<input className="field" type="date" required value={draft.date} onChange={event=>update('date',event.target.value)}/></label>{['pay','payment-propose','refund'].includes(draft.action)&&<label>{tr('參考編號')}<input className="field" value={draft.reference||''} maxLength={100} onChange={event=>update('reference',event.target.value)}/></label>}{['pay','payment-propose'].includes(draft.action)&&<label>{tr('備註')}<textarea className="field" data-supplier-note maxLength={1000} value={draft.note||''} onChange={event=>update('note',event.target.value)}/></label>}</details>
   <label className="customer-confirm"><input type="checkbox" data-supplier-confirm required checked={draft.confirmed} onChange={event=>update('confirmed',event.target.checked)}/>{tr(draft.action==='pay'?'我已實際付出這筆款項':draft.action==='refund'?'我已實際收到供應商退回的款項':isActual?'我已核對這是登記更正，現金或銀行紀錄一致':isAllocation?'我已核對供應商、請款和本次金額':'我已核對提案內容與這次選擇')}</label>
   {error&&<p role="alert">{error}</p>}<div className="customer-actions"><button className="btn btn-ghost" type="button" onClick={onHide}>{tr('先收起草稿')}</button><button className="btn btn-primary" data-supplier-save type="submit" disabled={!draft.confirmed||cash&&isActual&&!openShift||isAllocation&&(count===0||!Number.isFinite(total)||draft.action==='allocate'&&total>limit)}>{busy?tr('保存中…'):tr(isProposal?'確認送審':'確認保存')}</button></div>
  </fieldset></form>
 </section>
}
