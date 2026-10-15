import {useEffect,useRef,useState} from 'react'
import {tr,trMessage} from '../i18n'
import {getExchangeContext} from '../utils/dataAccess'
import {readPendingFinancial} from '../utils/financialCommand'
import {validateQuote,productReference} from '../../electron/businessExchange.mjs'
import {salesSummary} from '../../electron/salesRules.mjs'
import useSalesDraft,{emptySalesDraft} from './sales/useSalesDraft'
import SalesOrderForm,{salesDraftInput,salesMoney} from './sales/SalesOrderForm'
import SalesDocumentDetail,{salesStatus} from './sales/SalesDocumentDetail'
import SalesOperationForm from './sales/SalesOperationForm'
import '../styles/sales.css'

export default function SalesPage({store,session}){
  const {form,setForm,clear,warning,ready}=useSalesDraft(store.sales,session)
  const [creating,setCreating]=useState(false),[selected,setSelected]=useState(''),[target,setTarget]=useState(null),[query,setQuery]=useState('')
  const [context,setContext]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const running=useRef(false),draftLoaded=useRef(''),heading=useRef(null)
  const documents=store.sales.documents,pending=store.financialState.phase!=='idle',ownPending=pending&&store.financialState.kind==='sales'
  const chosen=documents.find(doc=>doc.id===selected),summaries=documents.map(doc=>salesSummary(doc,store.sales.today,store.sales.customerLedger?.entries))
  const total=key=>Math.round(summaries.reduce((n,summary)=>n+summary[key],0)*100)/100
  const hasDraft=!!form.customer.name||form.items.length>0
  const matches=documents.filter(doc=>(doc.customer.name+' '+doc.customer.id+' '+doc.id).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  useEffect(()=>{let cancelled=false;getExchangeContext(session).then(value=>{if(!cancelled)setContext(value)}).catch(e=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[session.userId])
  useEffect(()=>{if(ready&&!draftLoaded.current){draftLoaded.current=store.sales.storeId;setCreating(hasDraft)}},[ready])
  useEffect(()=>{if(store.salesTarget&&documents.some(doc=>doc.id===store.salesTarget)){setSelected(store.salesTarget);setCreating(false);setTarget(null);store.consumeSalesTarget()}},[store.salesTarget,documents])
  useEffect(()=>{
    if(ownPending){try{const request=readPendingFinancial()?.request;if(request){setSelected(request.action==='create'?request.id:request.orderId);setCreating(false)}}catch(e){setError(e.message)}}
  },[ownPending,store.financialState.id])
  useEffect(()=>{
    function committed(event){const result=event.detail;setSelected(result.document.id);setCreating(false);setTarget(null);setError('');setNotice(result.receipt.action==='create'?'已接單。接下來交貨時，再確認本次數量。':'已保存，原始紀錄已保留。');if(result.receipt.action==='create')clear();requestAnimationFrame(()=>heading.current?.focus())}
    window.addEventListener('pos-sales-operation',committed);return()=>window.removeEventListener('pos-sales-operation',committed)
  },[ready])
  useEffect(()=>{
    if(!ready||!context||!store.salesQuote||pending)return
    if(hasDraft&&!documents.some(doc=>doc.sourceQuote?.id===store.salesQuote.id))return
    acceptQuote(context.state.quotes.find(q=>q.id===store.salesQuote.id&&q.revision===store.salesQuote.revision));store.consumeSalesQuote()
  },[ready,context,store.salesQuote,pending])
  function start(){
    setSelected('');setTarget(null);setError('');setNotice('');setCreating(true)
    if(!hasDraft)setForm({...emptySalesDraft(),date:store.sales.today,customer:{id:'customer-'+crypto.randomUUID(),name:''}})
  }
  function discard(){if(!confirm(tr('確定放棄這張尚未保存的銷售草稿？已保存的銷售單不受影響。')))return;clear();setCreating(false);setError('')}
  function acceptQuote(quote){
    try{
      if(!quote)throw Error('找不到本店已保存的原報價版本')
      const existing=documents.find(doc=>doc.sourceQuote?.id===quote.id)
      if(existing){setSelected(existing.id);setCreating(false);setTarget(null);setError('');setNotice('這份報價已有銷售單，已為你開啟原單。');return}
      validateQuote(quote,{now:Date.now()})
      const items=quote.items.map(row=>{const product=store.products.find(p=>p.id===row.sku);if(!product)throw Error('找不到銷售商品');return {productId:row.sku,qty:String(row.qty),unitPrice:String(row.unitPrice),expectedProduct:productReference(product)}})
      setForm({...emptySalesDraft(),date:store.sales.today,customer:quote.recipient,quoteRef:{id:quote.id,revision:quote.revision},items,note:quote.note,step:3});setCreating(true);setSelected('');setError('');setTarget(null)
    }catch(e){setError(e.message)}
  }
  async function save(formValue,validationError){
    if(validationError){setError(validationError.message);return}
    if(running.current||pending)return
    running.current=true;setBusy(true);setError('')
    try{
      const document=salesDraftInput(formValue)
      if(!store.sales.customerLedger?.customers.some(row=>row.id===document.customer.id))await store.commitCustomerLedger({action:'customer-create',customer:document.customer})
      await store.commitSales({action:'create',storeId:store.sales.storeId,epoch:store.sales.epoch,date:store.sales.today,document})
    }
    catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function operate(input){
    if(running.current||pending)return;running.current=true;setBusy(true);setError('')
    try{await store.commitSales({...input,storeId:store.sales.storeId,epoch:store.sales.epoch})}
    catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function retry(){
    if(running.current)return;running.current=true;setBusy(true);setError('')
    try{await store.retryFinancial()}catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  return <div className="sales-page"><header className="sales-heading"><div><h1 className="page-title" ref={heading} tabIndex={-1}>{tr('接單、交貨、收款')}</h1><p>{tr('照著下一步，貨和款都不漏。')}</p></div><button className="btn btn-primary" data-sales-new disabled={pending||busy||!ready} onClick={start}>{hasDraft?tr('繼續未完成草稿'):tr('新增銷售單')}</button></header>
    {warning&&<p role="status">{trMessage(warning)}</p>}{notice&&<p className="sales-success" role="status">{tr(notice)}</p>}
    {ownPending&&<section className="card sales-recovery"><h2>{tr('這筆銷售操作還在確認')}</h2><p>{tr('請沿用原編號查回結果，先不要重新交貨或收款。')}</p><p className="sales-id">{store.financialState.id}</p><button className="btn btn-primary" data-sales-retry disabled={busy} onClick={retry}>{tr('確認原操作結果')}</button></section>}
    {store.salesQuote&&hasDraft&&!pending&&<section className="card"><p>{tr('原本還有未完成銷售草稿，請先保存或放棄，再帶入這張報價。')}</p><button className="btn btn-ghost" onClick={()=>{store.consumeSalesQuote();setCreating(true)}}>{tr('先繼續原草稿')}</button></section>}
    {error&&!creating&&!target&&<p role="alert">{trMessage(error)}</p>}
    {!chosen&&!creating&&<><div className="sales-metrics"><div><span>{tr('客戶還沒付')}</span><strong>{salesMoney(total('owed'))}</strong></div><div><span>{tr('已逾期未收')}</span><strong>{salesMoney(total('overdue'))}</strong></div><div><span>{tr('還要退給客戶')}</span><strong>{salesMoney(total('credit'))}</strong></div></div><label className="sales-search">{tr('找銷售單')}<input className="field" value={query} onChange={e=>setQuery(e.target.value)} placeholder={tr('輸入客戶名稱或銷售單號')}/></label><div className="sales-documents">{matches.slice(0,50).map(doc=>{const summary=salesSummary(doc,store.sales.today,store.sales.customerLedger?.entries);return <button className="card sales-document-button" data-sales-document={doc.id} key={doc.id} onClick={()=>{setSelected(doc.id);setTarget(null);setError('')}}><span><strong>{doc.customer.name}</strong><small>{doc.date} · {salesStatus(summary.status)}</small><small className="sales-id">{doc.id}</small></span><span><strong>{salesMoney(doc.total)}</strong><small>{tr('尚未收 {0}',{0:salesMoney(summary.owed)})}</small></span></button>})}{matches.length>50&&<p>{tr('先顯示前 50 張，輸入客戶或單號可找到其他銷售單。')}</p>}{!matches.length&&documents.length>0&&<p>{tr('找不到符合的銷售單，試試客戶名稱或原單號。')}</p>}{!documents.length&&<section className="card"><h2>{tr('先接一張訂單，再跟著下一步')}</h2><p>{tr('有報價就直接帶入；沒有報價也能選客戶與商品開始。')}</p></section>}</div></>}
    {creating&&ready&&<SalesOrderForm form={form} setForm={setForm} products={store.products} customers={store.sales.customerLedger?.customers||[]} documents={documents} quotes={context?.state.quotes||[]} onQuote={acceptQuote} onSave={save} onHide={()=>setCreating(false)} onDiscard={discard} busy={pending||busy} error={trMessage(error)}/>}
    {chosen&&!creating&&<>{target?<SalesOperationForm key={target.action+':'+(target.deliveryId||target.paymentId||target.refundId||'')} document={chosen} target={target} store={store} busy={pending||busy} onSave={operate} onCancel={()=>{setTarget(null);setError('')}} error={trMessage(error)}/>:<SalesDocumentDetail document={chosen} today={store.sales.today} customerCredits={store.sales.customerLedger?.entries||[]} onCustomerLedger={()=>store.openCustomerLedger(chosen.customer.id)} pending={pending||busy} onAction={value=>{setError('');setTarget({...value,revision:chosen.revision})}} onBack={()=>{setSelected('');setTarget(null);setError('')}}/>}</>}
  </div>
}
