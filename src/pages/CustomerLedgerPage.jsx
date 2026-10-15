import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../i18n'
import {readPendingFinancial} from '../utils/financialCommand'
import {customerDraftRequest,matchingCustomerDraftEntry} from '../utils/customerDraftReceipt.mjs'
import {salesSummary} from '../../electron/salesRules.mjs'
import {salesMoney} from './sales/SalesOrderForm'
import {customerOpenClaims,suggestCustomerAllocation,remainingCustomerAllocation,readCustomerReceiptDraft} from '../utils/customerLedgerUi.mjs'
import useCustomerDraft from './customers/useCustomerDraft'
import CustomerDirectoryForm from './customers/CustomerDirectoryForm'
import CustomerOperationForm,{customerActionTitle} from './customers/CustomerOperationForm'
import '../styles/customers.css'
const empty={version:1,revision:0,customers:[],receipts:[],entries:[]}
const notices={receive:'已保存收款。可以抵付帳單，或保留餘額。',allocate:'已抵付帳單，沒有再收一次錢。',unallocate:'已解除抵付，款項回到原收款餘額。',refund:'已保存退款紀錄。','refund-reverse':'已保存退款更正，原紀錄仍保留。','receipt-reverse':'已沖銷原收款，原紀錄仍保留。','customer-create':'客戶已加入名單，下次可以直接選。','customer-update':'客戶資料已更新，歷史單據維持原文。'}
export default function CustomerLedgerPage({store,session}){
  const ledger=store.sales.customerLedger||empty,documents=store.sales.documents
  const {draft,setDraft,saveNow,clear,ready,warning}=useCustomerDraft(store.sales,session)
  const [selected,setSelected]=useState(''),[editing,setEditing]=useState(false),[query,setQuery]=useState(''),[agentText,setAgentText]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const running=useRef(false),heading=useRef(null),loaded=useRef(false)
  const [historyLimit,setHistoryLimit]=useState(50)
  const pending=store.financialState.phase!=='idle',ownPending=pending&&store.financialState.kind==='customer-ledger'
  const parties=new Map();for(const doc of documents)if(!parties.has(doc.customer.id))parties.set(doc.customer.id,{...doc.customer,registered:false,available:0});for(const customer of ledger.customers)parties.set(customer.id,{...customer,registered:true})
  const customers=[...parties.values()],chosen=customers.find(c=>c.id===selected),receipts=ledger.receipts.filter(r=>r.customerId===selected),claims=customerOpenClaims(documents,selected,ledger.entries,store.sales.today)
  const summaries=documents.filter(d=>d.customer.id===selected).map(d=>salesSummary(d,store.sales.today,ledger.entries)),owed=summaries.reduce((n,s)=>n+Math.round(s.owed*100),0)/100,credit=summaries.reduce((n,s)=>n+Math.round(s.credit*100),0)/100
  const history=ledger.entries.filter(e=>e.customerId===selected&&!['customer-create','customer-update','receive'].includes(e.action))
  useEffect(()=>setHistoryLimit(50),[selected])
  useEffect(()=>{if(ready&&!loaded.current){loaded.current=true;if(draft){const completed=matchingCustomerDraftEntry(draft,ledger.entries);setSelected(draft.customerId);if(completed){clear();setEditing(false);setNotice('這份草稿已經保存，已為你開啟原紀錄。')}else setEditing(true)}}},[ready])
  useEffect(()=>{if(store.customerTarget&&ready){setSelected(store.customerTarget);setEditing(false);store.consumeCustomerTarget()}},[store.customerTarget,ready])
  useEffect(()=>{
    function committed(event){const result=event.detail;setSelected(result.event.customerId);setEditing(false);setError('');setNotice(result.draftWarning||notices[result.event.action]);if(matchingCustomerDraftEntry(draft,[result.event]))clear();requestAnimationFrame(()=>heading.current?.focus())}
    window.addEventListener('pos-customer-ledger-operation',committed);return()=>window.removeEventListener('pos-customer-ledger-operation',committed)
  },[draft])
  useEffect(()=>{if(!ready||!ownPending)return;try{const request=readPendingFinancial()?.request;if(request){const id=request.customerId||request.customer?.id;setSelected(id);if(!draft){setDraft({...base(request.action,id),...Object.fromEntries(['customer','method','reference','note','reason','receiptId','allocationId','refundId','date','storeId','epoch'].filter(key=>request[key]!==undefined).map(key=>[key,request[key]])),operationIdentity:{id:request.id,time:request.time},submittedShiftId:request.shiftId||'',method:request.method||(request.shiftId?'cash':'bank'),ledgerRevision:request.expectedRevision,amount:String(request.amount||''),items:request.items?.map(row=>({...row,amount:String(row.amount)})),confirmed:request.confirmed??request.reviewed??false});setEditing(true)}}}catch(e){setError(e.message)}},[ready,ownPending,store.financialState.id])
  function base(action,customerId=selected){return {action,customerId,storeId:store.sales.storeId,epoch:store.sales.epoch,ledgerRevision:ledger.revision,date:store.sales.today,amount:'',method:store.openShift?'cash':'bank',reference:'',note:'',reason:'',confirmed:false}}
  function start(action,target){
    setError('');setNotice('')
    if(draft){setSelected(draft.customerId);setEditing(true);setNotice('先完成或放棄原草稿，再開始下一件事。');return}
    let form=base(action)
    if(action==='customer-create'||action==='customer-update'){
      const customer=target||{id:'customer-'+crypto.randomUUID(),name:'',phone:''};form={...form,customerId:customer.id,customer:Object.fromEntries(['id','name','contact','phone','email','address','note'].map(key=>[key,customer[key]||'']))};setSelected(customer.id)
    }else if(action==='allocate'||action==='refund'){
      const receipt=target||receipts.find(r=>r.available>0&&!r.reversed);if(!receipt){setError('目前沒有可用的原收款餘額。');return}
      form.receiptId=receipt.id
      form.method=receipt.method
      if(action==='allocate'){const suggestion=suggestCustomerAllocation(receipt,claims);form.items=claims.slice(0,100).map(c=>({documentId:c.documentId,deliveryId:c.deliveryId,expectedRevision:c.expectedRevision,amount:String(suggestion.find(row=>row.deliveryId===c.deliveryId)?.amount||'')}))}
      else form.amount=String(receipt.available)
    }else if(action==='unallocate'){
      form.allocationId=target.id;form.receiptId=target.receiptId;form.items=remainingCustomerAllocation(target,ledger.entries).map(row=>({...row,expectedRevision:documents.find(d=>d.id===row.documentId)?.revision||row.expectedRevision,amount:String(row.amount)}))
    }else if(action==='receipt-reverse'){form.receiptId=target.id;form.method=target.method;form.amount=String(target.amount)}
    else if(action==='refund-reverse'){form.refundId=target.id;form.receiptId=target.receiptId;form.method=target.method;form.amount=String(target.amount)}
    setDraft(form);setEditing(true)
  }
  async function save(input,identity=null){
    if(running.current||pending)return;running.current=true;setBusy(true);setError('')
    let pinned
    try{await store.commitCustomerLedger(input,draft.operationIdentity||identity,prepared=>{pinned=saveNow({...draft,operationIdentity:{id:prepared.request.id,time:prepared.request.time},submittedShiftId:prepared.request.shiftId||''})})}catch(e){if(e.notCommitted&&pinned?.operationIdentity.id===e.operationId){const next={...pinned,operationIdentity:undefined,submittedShiftId:undefined,confirmed:false};try{saveNow(next)}catch{setDraft(next)}}setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function retryPinned(){
    if(running.current||pending||!draft?.operationIdentity)return;running.current=true;setBusy(true);setError('')
    try{await store.commitCustomerLedger(customerDraftRequest(draft),draft.operationIdentity)}catch(e){if(e.notCommitted&&draft.operationIdentity.id===e.operationId){const next={...draft,operationIdentity:undefined,submittedShiftId:undefined,confirmed:false};try{saveNow(next)}catch{setDraft(next)}}setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function refresh(){
    if(running.current)return;running.current=true;setBusy(true);setError('')
    try{const state=await store.refreshTrading();if(state.storeId!==draft.storeId)throw Error('草稿屬於另一間店，請回原店面核對；內容仍保留。');setDraft(previous=>({...previous,epoch:state.epoch,ledgerRevision:state.customerLedger.revision,confirmed:false,items:previous.items?.map(row=>({...row,expectedRevision:state.documents.find(d=>d.id===row.documentId)?.revision||row.expectedRevision}))}))}catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function retry(){if(running.current)return;running.current=true;setBusy(true);try{await store.retryFinancial()}catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}}
  function importAgent(){try{if(draft)throw Error('先完成或放棄原草稿，再開始下一件事。');const value=readCustomerReceiptDraft(agentText,{storeId:store.sales.storeId,customers:ledger.customers,entries:ledger.entries});setDraft({...base('receive',value.customerId),amount:String(value.amount),method:value.method,reference:value.reference,note:value.note,agentDraftId:value.id});setSelected(value.customerId);setEditing(true);setError('')}catch(e){setError(e.message)}}
  function discard(){if(draft?.operationIdentity){setError('這份草稿已有原操作編號，請先核對結果，不能直接放棄。');return}if(!confirm(tr('放棄尚未保存的客戶款項草稿？已保存紀錄不受影響。')))return;clear();setEditing(false);setError('')}
  const draftCustomer=draft?customers.find(c=>c.id===draft.customerId)||draft.customer||{id:draft.customerId,name:draft.customerId}:null
  const formStale=draft&&(draft.epoch!==store.sales.epoch||draft.storeId!==store.sales.storeId||draft.ledgerRevision!==ledger.revision)
  return <div className="customer-page"><header className="customer-heading"><div><h1 className="page-title" ref={heading} tabIndex={-1}>{tr('客戶與款項')}</h1><p>{tr('先選客戶，收到的錢、抵付的帳，一次看清楚。')}</p></div><button className="btn btn-primary" data-customer-new disabled={pending||busy||!ready} onClick={()=>start('customer-create')}>{tr('新增往來客戶')}</button></header>
    {warning&&<p role="status">{tr(warning)}</p>}{notice&&<p className="customer-success" role="status">{tr(notice)}</p>}
    {ownPending&&<section className="card customer-note"><h2>{tr('這筆客戶款項還在確認')}</h2><p>{tr('請沿用原編號查回結果，先不要再收一次錢。')}</p><p className="customer-id">{store.financialState.id}</p><button className="btn btn-primary" data-customer-retry onClick={retry} disabled={busy}>{tr('確認原操作結果')}</button></section>}
    {draft?.operationIdentity&&!ownPending&&<section className="card customer-note"><h2>{tr("先核對這份草稿的原結果")}</h2><p className="customer-id">{draft.operationIdentity.id}</p><p>{tr("原操作編號會保留，核對前不會建立另一筆收款。")}</p><button className="btn btn-primary" data-customer-pinned-retry disabled={pending||busy} onClick={retryPinned}>{tr("確認原操作結果")}</button></section>}
    {draft&&!editing&&<section className="card"><p>{tr('還有一份未完成的客戶款項草稿。')}</p><button className="btn btn-primary" data-customer-resume onClick={()=>{setSelected(draft.customerId);setEditing(true)}}>{tr('繼續未完成草稿')}</button><button className="btn btn-ghost" disabled={pending} onClick={discard}>{tr('放棄草稿')}</button></section>}
    {editing&&draft&&ready?<>
      {['customer-create','customer-update'].includes(draft.action)?<>{formStale&&<p role="alert">{tr('資料已更新，請重新核對；已填內容會保留。')} <button className="btn btn-ghost" onClick={refresh} disabled={pending||busy||!!draft.operationIdentity}>{tr('重新核對最新資料')}</button></p>}<CustomerDirectoryForm draft={draft} setDraft={setDraft} onSave={save} onHide={()=>setEditing(false)} busy={pending||busy||formStale||!!draft.operationIdentity} error={trMessage(error)}/></>:<CustomerOperationForm draft={draft} setDraft={setDraft} customer={draftCustomer} ledger={ledger} epoch={store.sales.epoch} storeId={store.sales.storeId} documents={documents} claims={customerOpenClaims(documents,draft.customerId,ledger.entries,store.sales.today)} openShift={store.openShift} onSave={save} onRefresh={refresh} onHide={()=>setEditing(false)} busy={pending||busy||!!draft.operationIdentity} error={trMessage(error)}/>}
      <details className="customer-more"><summary>{tr('草稿選項')}</summary><button className="btn btn-ghost" onClick={discard} disabled={pending||busy}>{tr('放棄草稿')}</button></details>
    </>:chosen?<>
      <div className="customer-heading"><div><h2>{chosen.name}</h2><p className="customer-id">{chosen.id}</p>{chosen.phone&&<p>{chosen.phone}</p>}</div><button className="btn btn-ghost" data-customer-back onClick={()=>setSelected('')}>{tr('回客戶列表')}</button></div>
      <div className="customer-metrics"><div><span>{tr('可用預收餘額')}</span><strong>{salesMoney(chosen.available)}</strong></div><div><span>{tr('客戶還沒付')}</span><strong>{salesMoney(owed)}</strong></div><div><span>{tr('交付後多收，待處理')}</span><strong>{salesMoney(credit)}</strong></div></div>
      {!chosen.registered?<section className="card"><p>{tr('這是既有銷售的往來身份，加入名單後就能共用客戶餘額。')}</p><button className="btn btn-primary" data-customer-adopt disabled={pending||busy} onClick={()=>start('customer-create',chosen)}>{tr('加入客戶名單')}</button></section>:<div className="customer-main-actions"><button className="btn btn-primary" data-customer-receive disabled={pending||busy} onClick={()=>start('receive')}>{tr('收到款項')}</button><button className="btn btn-ghost" data-customer-allocate disabled={pending||busy||chosen.available<=0||owed<=0} onClick={()=>start('allocate')}>{tr('抵付帳單')}</button><button className="btn btn-ghost" data-customer-refund disabled={pending||busy||chosen.available<=0} onClick={()=>start('refund')}>{tr('退回餘額')}</button></div>}
      {credit>0&&<p className="customer-note">{tr('交付退貨後的多收款，先解除原抵付，再從原收款退回。逐單收款請回原銷售單處理。')}</p>}
      {error&&<p role="alert">{trMessage(error)}</p>}
      <section><h2>{tr('原收款與可用餘額')}</h2>{receipts.length===0&&<p>{tr('還沒有預收款。實際收到錢後，按「收到款項」。')}</p>}{receipts.map(r=><article className="card customer-receipt" key={r.id} data-customer-receipt-card={r.id}><div className="customer-heading"><strong>{salesMoney(r.amount)}</strong><span>{r.date} · {tr(r.method==='cash'?'現金':'銀行收款')}{r.reversed?' · '+tr('已沖銷'):''}</span></div><p>{tr('可用 {0} · 已抵付 {1} · 已退款 {2}',{0:salesMoney(r.available),1:salesMoney(r.allocated),2:salesMoney(r.refunded)})}</p><p className="customer-id">{r.id}</p><details><summary>{tr('這筆記錯了？')}</summary><p>{tr('沖銷會保留原紀錄；已有抵付或退款時，請先更正相關紀錄。')}</p><button className="btn btn-ghost" disabled={pending||busy||r.reversed||r.allocated>0||r.refunded>0} onClick={()=>start('receipt-reverse',r)}>{tr('沖銷原收款')}</button></details></article>)}</section>
      <section><h2>{tr('抵付與退款紀錄')}</h2>{history.slice(-historyLimit).reverse().map(event=><article key={event.id} className="card customer-history" data-customer-history={event.id}><strong>{customerActionTitle(event.action)} · {salesMoney(event.amount)}</strong><p>{event.date} · {event.actor.username}</p><p className="customer-id">{event.id}</p>{event.reason&&<p>{event.reason}</p>}{event.action==='allocate'&&remainingCustomerAllocation(event,ledger.entries).length>0&&<button className="btn btn-ghost" data-customer-unallocate={event.id} disabled={pending||busy} onClick={()=>start('unallocate',event)}>{tr('解除這筆抵付')}</button>}{event.action==='refund'&&!ledger.entries.some(r=>r.action==='refund-reverse'&&r.refundId===event.id)&&<button className="btn btn-ghost" data-customer-refund-reverse={event.id} disabled={pending||busy} onClick={()=>start('refund-reverse',event)}>{tr('這筆退款記錯了')}</button>}</article>)}<p className="customer-note">{tr('已顯示 {0} / {1} 筆紀錄',{0:Math.min(historyLimit,history.length),1:history.length})}</p>{historyLimit<history.length&&<button className="btn btn-ghost" data-customer-history-more onClick={()=>setHistoryLimit(value=>value+50)}>{tr('顯示更早的紀錄')}</button>}</section>
      {claims.length>0&&<section><h2>{tr('尚未付清的交付請款')}</h2>{claims.map(c=><button key={c.deliveryId} className="card customer-claim" onClick={()=>store.openSalesDocument(c.documentId)}><span>{c.name}<small>{c.dueDate} · {c.documentId}</small></span><strong>{salesMoney(c.owed)}</strong></button>)}</section>}
      {chosen.registered&&<details className="customer-more"><summary>{tr('客戶資料')}</summary><button className="btn btn-ghost" disabled={pending||busy} onClick={()=>start('customer-update',chosen)}>{tr('編輯客戶資料')}</button>{chosen.note&&<p>{chosen.note}</p>}</details>}
    </>:<><label className="customer-search">{tr('找客戶')}<input className="field" data-customer-search value={query} onChange={e=>setQuery(e.target.value)} placeholder={tr('輸入名稱、電話或客戶代碼')}/></label><div className="customer-list">{customers.filter(c=>(c.name+' '+c.id+' '+(c.phone||'')).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,100).map(c=><button key={c.id} className="card customer-list-item" data-customer-select={c.id} onClick={()=>{setSelected(c.id);setError('');setNotice('')}}><span><strong>{c.name}</strong><small>{c.phone||c.id}</small></span><span>{c.registered?tr('可用 {0}',{0:salesMoney(c.available)}):tr('既有往來')}</span></button>)}</div>{!customers.length&&<section className="card"><h2>{tr('先新增一位客戶，或從銷售單開始')}</h2><p>{tr('客戶資料只需建一次，之後接單與收款都能沿用。')}</p></section>}
      <details className="card customer-agent"><summary>{tr('讓 Agent 幫我填收款草稿')}</summary><p>{tr('貼上 Agent 準備的 JSON，系統會先帶你核對，不會直接收款。')}</p><textarea className="field" data-customer-agent value={agentText} onChange={e=>setAgentText(e.target.value)} rows={6} maxLength={16384} spellCheck={false}/><button className="btn btn-primary" data-customer-agent-review disabled={pending||busy||!ready} onClick={importAgent}>{tr('帶入並核對')}</button></details>{error&&<p role="alert">{trMessage(error)}</p>}
    </>}
  </div>
}
