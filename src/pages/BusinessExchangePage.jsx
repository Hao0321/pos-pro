import {useEffect,useRef,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import {getExchangeContext} from '../utils/dataAccess'
import {QUOTE_PRICING,readPartyCard,makeCatalogue,productReference,quoteTotal,party} from '../../electron/businessExchange.mjs'
import {quantityValue,moneyValue} from '../../electron/operationRules.mjs'
import useQuoteDraft,{emptyQuoteForm} from './exchange/useQuoteDraft'
import '../styles/business-exchange.css'

const money=value=>'NT$ '+value.toLocaleString(getLocale(),{minimumFractionDigits:2,maximumFractionDigits:2})
const dateLabel=value=>new Date(value).toLocaleString(getLocale())
const lastQuotes=state=>[...new Map(state.quotes.map(q=>[q.id,q])).values()].reverse()
function download(value){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})),link=document.createElement('a')
  link.href=url;link.download=(value.protocol==='business-quote/v1'?'quote-'+value.id+'-v'+value.revision:value.protocol==='business-party/v1'?'store-card':'catalogue')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function BusinessExchangePage({store,session}){
  const [context,setContext]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(null),[query,setQuery]=useState(''),[historyQuery,setHistoryQuery]=useState('')
  const [card,setCard]=useState(''),[packet,setPacket]=useState(null),[notice,setNotice]=useState(''),[catalogueIds,setCatalogueIds]=useState([])
  const {form,setForm,clear,warning,ready}=useQuoteDraft(context,session)
  const running=useRef(false),section=useRef(null),status=useRef(null)
  const pending=store.financialState.phase!=='idle',ownPending=pending&&store.financialState.kind==='exchange'
  const update=(key,value)=>{setForm(f=>({...f,[key]:value}));setError('')}
  const refresh=()=>getExchangeContext(session).then(setContext).catch(e=>setError(e.message))
  useEffect(()=>{let cancelled=false;getExchangeContext(session).then(c=>{if(!cancelled)setContext(c)}).catch(e=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[session.userId])
  useEffect(()=>{
    const committed=e=>{setDone(e.detail.quote);setPacket(null);setNotice('');setError('');clear();refresh()}
    const changed=()=>refresh()
    window.addEventListener('pos-exchange-operation',committed);window.addEventListener('pos-data-refreshed',changed)
    return()=>{window.removeEventListener('pos-exchange-operation',committed);window.removeEventListener('pos-data-refreshed',changed)}
  },[context?.storeId,session.userId])
  useEffect(()=>{if(done)status.current?.scrollIntoView?.({block:'nearest'})},[done])
  function focus(name){const input=section.current?.querySelector('[data-quote-field="'+name+'"]');input?.scrollIntoView?.({block:'center'});input?.focus()}
  async function share(value){
    setPacket(value);setNotice('')
    try{await navigator.clipboard.writeText(JSON.stringify(value,null,2));setNotice('已複製，請自行傳給對方。')}
    catch{setNotice('無法自動複製，請用下方文字或下載檔案傳給對方。')}
  }
  function priceFor(product,recipient=form.recipient){
    return context.state.pricebooks.find(b=>b.recipient.id===recipient.id)?.prices.find(p=>p.productId===product.id&&p.unit===(product.unit||'個'))?.unitPrice??product.price
  }
  function selectRecipient(recipient){
    setForm(f=>({...f,recipient,confirmed:false,items:f.items.map(row=>{const product=store.products.find(p=>p.id===row.productId);return product?{...row,unitPrice:String(priceFor(product,recipient)),expectedProduct:productReference(product)}:row})}))
    setError('');setNotice('已帶入這位客戶的參考單價，請再次核對。')
  }
  function readCard(value){
    setCard(value)
    try{const recipient=readPartyCard(JSON.parse(value));selectRecipient(recipient);setCard('')}
    catch{if(value.trim())setError('讀不到店面資料卡。請貼上完整內容，或填寫下方店面代碼與名稱。')}
  }
  function add(product){
    setForm(f=>{const old=f.items.find(i=>i.productId===product.id);return {...f,confirmed:false,items:old?f.items.map(i=>i===old?{...i,qty:String(Number(i.qty)+1)}:i):[...f.items,{productId:product.id,qty:'1',unitPrice:String(priceFor(product)),expectedProduct:productReference(product)}]}})
    setError('')
  }
  function changeLine(index,key,value){setForm(f=>({...f,confirmed:false,items:f.items.map((i,n)=>n===index?{...i,[key]:value}:i)}));setError('')}
  async function save(){
    if(running.current||pending)return
    let field='recipient'
    try{
      party(form.recipient)
      field='products';if(!form.items.length)throw Error('請先點選要報價的商品')
      const items=form.items.map(row=>{if(!row.qty.trim()||!row.unitPrice.trim())throw Error('請填寫每個品項的數量與單價');quantityValue(Number(row.qty),'數量',.001);moneyValue(Number(row.unitPrice),'報價單價');return {...row,qty:Number(row.qty),unitPrice:Number(row.unitPrice)}})
      field='expiry';const end=new Date(form.validDay+'T23:59:59');if(!form.validDay||!Number.isFinite(end.getTime())||end.getTime()<=Date.now())throw Error('請選擇有效的報價到期日')
      field='terms';if(!form.confirmed)throw Error('請先確認單價已含本單全部費用')
      running.current=true;setBusy(true);setError('')
      const result=await store.commitExchange({storeId:context.storeId,expectedRevision:context.state.revision,quoteId:form.quoteId,expectedQuoteRevision:form.expectedQuoteRevision,recipient:form.recipient,validUntil:end.toISOString(),items,note:form.note,rememberPrices:form.rememberPrices,pricing:QUOTE_PRICING})
      setDone(result.quote);setPacket(null);setNotice('');clear();await refresh()
    }catch(e){setError(e.message);focus(field)}finally{running.current=false;setBusy(false)}
  }
  function revise(quote){
    const latest=context.state.quotes.filter(q=>q.id===quote.id).at(-1)
    setForm({...emptyQuoteForm(),recipient:latest.recipient,quoteId:latest.id,expectedQuoteRevision:latest.revision,note:latest.note,items:latest.items.map(row=>{const product=store.products.find(p=>p.id===row.sku);return {productId:row.sku,qty:String(row.qty),unitPrice:String(row.unitPrice),expectedProduct:product?productReference(product):{name:row.name,unit:row.unit,price:row.unitPrice}}})})
    setDone(null);setPacket(null);setNotice('');setError('');section.current?.scrollIntoView?.({block:'start'})
  }
  async function exportCatalogue(){
    try{setError('');const products=store.products.filter(p=>catalogueIds.includes(p.id));if(!products.length)throw Error('請先勾選要公開的商品');const value=await makeCatalogue(products,context.sender);setPacket(value);download(value);setNotice('價目表已準備好，請自行傳給對方或公開。')}catch(e){setError(e.message)}
  }
  let total=null
  try{total=quoteTotal(form.items.map(i=>({qty:Number(i.qty),unitPrice:Number(i.unitPrice)})))}catch{}
  const matches=store.products.filter(p=>[p.name,p.barcode,p.id].some(v=>String(v||'').normalize('NFKC').toLowerCase().includes(query.trim().normalize('NFKC').toLowerCase())))
  const books=context?[...new Map([...context.state.quotes.map(q=>[q.recipient.id,q.recipient]),...context.state.pricebooks.map(b=>[b.recipient.id,b.recipient])]).values()]:[]
  const history=context?lastQuotes(context.state).filter(q=>(q.recipient.name+' '+q.id).toLowerCase().includes(historyQuery.toLowerCase())):[]
  return <div className="page-content exchange-page" data-business-exchange><div className="exchange-container">
    <header><p className="exchange-eyebrow">BUSINESS EXCHANGE</p><h1>{tr('報價與價目表')}</h1><p>{tr('選客戶、選商品、看清楚金額，再把報價交給對方。')}</p></header>
    {error&&<p role="alert" className="exchange-error">{trMessage(error)}</p>}
    {warning&&<p role="status" className="exchange-error">{trMessage(warning)} <button className="btn btn-ghost" disabled={pending} onClick={()=>{clear();setDone(null)}}>{tr('重新開始')}</button></p>}
    {notice&&<p role="status">{trMessage(notice)}</p>}
    {!context?<p role="status">{tr('正在載入…')}</p>:<>
      <section className="exchange-intro">
        <div className="card"><h2>{tr('向供應商叫貨')}</h2><p>{tr('先把店面資料給對方，對方就知道這張報價要給誰。收到後到快速建單匯入。')}</p><button className="btn btn-ghost" onClick={()=>share(context.partyCard)}>{tr('複製我的店面資料')}</button><button className="btn btn-ghost" onClick={()=>store.setView('quick')}>{tr('我已收到報價')}</button><p className="exchange-hint">{context.sender.name} · {tr('店面代碼')} <span className="exchange-id">{context.storeId}</span></p></div>
        <div className="card"><h2>{tr('給客戶一般價目表')}</h2><p>{tr('選擇要公開的商品，匯出名稱、單位與一般售價，讓對方的 Agent 或 ERP 讀取。')}</p><a href="#exchange-catalogue" onClick={()=>{const details=document.getElementById('exchange-catalogue');if(details)details.open=true}}>{tr('選商品、下載價目表')}</a><p className="exchange-hint">{tr('只匯出勾選的商品，不含成本、庫存數量或其他客戶價格。')}</p></div>
      </section>
      {ownPending&&<section className="card" role="status"><h2>{tr('這張報價的保存結果還在確認')}</h2><p>{tr('請用原編號確認，先不要再開一張。')}</p><button className="btn btn-primary" disabled={busy} onClick={async()=>{if(running.current)return;running.current=true;setBusy(true);try{await store.retryFinancial();setError('')}catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}}}>{tr('確認原報價結果')}</button></section>}
      {done?<section ref={status} className="card exchange-saved" aria-label={tr('已保存報價')}>
        <p>{tr('報價已保存，尚未傳送或成交')}</p><h2>{done.recipient.name} · {tr('第 {0} 版',{0:done.revision})}</h2><strong className="exchange-total">{money(done.total)}</strong><p>{tr('有效至 {0}',{0:dateLabel(done.validUntil)})}</p><p>{tr('這個檔案只包含這位收件人的本張報價。請自行確認收件人後傳送。')}</p>
        <div className="exchange-actions"><button className="btn btn-primary" onClick={()=>share(done)}>{tr('複製報價給對方')}</button><button className="btn btn-ghost" onClick={()=>download(done)}>{tr('下載報價檔')}</button><button className="btn btn-ghost" data-quote-to-sale={done.id} disabled={pending} onClick={()=>store.openSalesQuote(done)}>{tr('客戶已同意，轉銷售單')}</button><button className="btn btn-ghost" disabled={pending} onClick={()=>revise(done)}>{tr('修改並開新版本')}</button><button className="btn btn-ghost" disabled={pending} onClick={()=>{clear();setDone(null);setPacket(null)}}>{tr('新增另一張報價')}</button></div>
      </section>:<section ref={section} className="card exchange-form" aria-label={tr('開立客戶報價')}>
        <h2>{form.quoteId?tr('修訂報價，保留原版本'):tr('報價給客戶')}</h2>
        <fieldset disabled={busy||pending||!ready}>
          <h3>{tr('1．這張報價給誰？')}</h3>
          {books.length>0&&<label>{tr('用之前的客戶')}<select className="field" aria-label={tr('選擇報價客戶')} disabled={!!form.quoteId} value={books.some(b=>b.id===form.recipient.id)?form.recipient.id:''} onChange={e=>{const found=books.find(b=>b.id===e.target.value);selectRecipient(found||{id:'',name:''})}}><option value="">{tr('新增客戶')}</option>{books.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          <label>{tr('貼上對方的店面資料卡（可選）')}<textarea className="field" aria-label={tr('對方店面資料卡')} disabled={!!form.quoteId} maxLength={4096} value={card} onChange={e=>readCard(e.target.value)} placeholder={tr('請對方按「複製我的店面資料」，再貼到這裡。')}/></label>
          <div className="exchange-columns"><label>{tr('收件店面代碼')}<input className="field" data-quote-field="recipient" disabled={!!form.quoteId} maxLength={128} value={form.recipient.id} onChange={e=>selectRecipient({...form.recipient,id:e.target.value})}/></label><label>{tr('客戶名稱')}<input className="field" maxLength={100} value={form.recipient.name} onChange={e=>update('recipient',{...form.recipient,name:e.target.value})}/></label></div>
          <p className="exchange-hint">{tr('店面代碼用來防止匯入錯店；資料卡與檔案都不代表已驗證對方身份。')}</p>
          <h3>{tr('2．選商品與這位客戶的價格')}</h3>
          <input className="field" data-quote-field="products" type="search" aria-label={tr('搜尋報價商品')} placeholder={tr('找商品名稱或條碼')} value={query} onChange={e=>setQuery(e.target.value)}/>
          <div className="exchange-products">{matches.slice(0,24).map(p=><button className="btn btn-ghost" key={p.id} onClick={()=>add(p)}>{p.name}<span>{money(priceFor(p))}／{p.unit||'個'}</span></button>)}</div>
          {matches.length>24&&<p className="exchange-hint">{tr('先顯示前 24 項。輸入品名或條碼就能找到其他商品。')}</p>}
          {!matches.length&&<p>{tr('找不到這個商品。試試其他名稱或條碼。')}</p>}
          <p className="exchange-hint">{tr('記住的價格只是下次帶入的參考值；每張報價仍由你核對。')}</p>
          {form.items.map((row,index)=><div key={row.productId} className="exchange-line">
            <strong>{row.expectedProduct.name}<span>{row.expectedProduct.unit}</span></strong>
            <label>{tr('數量')}<input className="field" type="number" step=".001" min=".001" aria-label={tr('報價數量 {0}',{0:row.expectedProduct.name})} value={row.qty} onChange={e=>changeLine(index,'qty',e.target.value)}/></label>
            <label>{tr('單價（NT$）')}<input className="field" type="number" step=".01" min="0" aria-label={tr('報價單價 {0}',{0:row.expectedProduct.name})} value={row.unitPrice} onChange={e=>changeLine(index,'unitPrice',e.target.value)}/></label>
            <button className="btn btn-ghost" aria-label={tr('移除 {0}',{0:row.expectedProduct.name})} onClick={()=>update('items',form.items.filter((_,i)=>i!==index))}>{tr('移除')}</button>
          </div>)}
          <h3>{tr('3．看清楚，再保存報價')}</h3>
          <div className="exchange-columns"><label>{tr('報價有效至')}<input className="field" data-quote-field="expiry" type="date" value={form.validDay} onChange={e=>update('validDay',e.target.value)}/></label><label>{tr('備註（可不填）')}<textarea className="field" maxLength={500} value={form.note} onChange={e=>update('note',e.target.value)}/></label></div>
          <label className="exchange-check"><input type="checkbox" checked={form.rememberPrices} onChange={e=>update('rememberPrices',e.target.checked)}/>{tr('記住這位客戶的單價，下次自動帶入')}</label>
          <label className="exchange-check"><input data-quote-field="terms" type="checkbox" checked={form.confirmed} onChange={e=>update('confirmed',e.target.checked)}/>{tr('我確認單價已含本單全部費用，合計不再加價。')}</label>
          {error&&<p className="exchange-error">{trMessage(error)}</p>}
          <div className="exchange-confirm"><strong className="exchange-total">{tr('合計 ')}{total===null?'—':money(total)}</strong><button className="btn btn-primary" onClick={save}>{busy?tr('正在保存…'):tr('保存報價，準備傳給對方')}</button></div>
          <p className="exchange-hint">{tr('保存報價不會扣庫存、收款或建立採購。買方還要核對並確認。')}</p>
        </fieldset>
      </section>}
      <details className="card exchange-history"><summary>{tr('已保存報價與歷史版本')}</summary><input className="field" type="search" aria-label={tr('搜尋已保存報價')} placeholder={tr('搜尋客戶或報價編號')} value={historyQuery} onChange={e=>setHistoryQuery(e.target.value)}/>
        {history.slice(0,20).map(q=><div className="exchange-history-row" key={q.id}><div><strong>{q.recipient.name}</strong><p>{money(q.total)} · {tr('第 {0} 版',{0:q.revision})} · {tr('有效至 {0}',{0:dateLabel(q.validUntil)})}</p><span className="exchange-id">{q.id}</span></div><button className="btn btn-ghost" onClick={()=>{setDone(q);setPacket(null)}}>{tr('查看報價')}</button><details><summary>{tr('歷史版本')}</summary>{context.state.quotes.filter(old=>old.id===q.id).map(old=><button className="btn btn-ghost" key={old.revision} onClick={()=>{setDone(old);setPacket(null)}}>{tr('第 {0} 版',{0:old.revision})} · {money(old.total)}</button>)}</details></div>)}
        {history.length>20&&<p>{tr('先顯示前 20 張，輸入客戶或編號可找到其他報價。')}</p>}
        {!history.length&&<p>{tr('尚無符合的報價')}</p>}
      </details>
      <details id="exchange-catalogue" className="card exchange-catalogue"><summary>{tr('選商品、下載價目表')}</summary><p>{tr('一般售價是參考價格，數量、交期或其他費用仍須雙方確認。')}</p><button className="btn btn-ghost" onClick={()=>setCatalogueIds(store.products.map(p=>p.id))}>{tr('選取全部商品')}</button><button className="btn btn-ghost" onClick={()=>setCatalogueIds([])}>{tr('清除勾選')}</button>
        <div className="exchange-catalogue-list">{store.products.map(p=><label className="exchange-check" key={p.id}><input type="checkbox" checked={catalogueIds.includes(p.id)} onChange={e=>setCatalogueIds(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span>{p.name}<br/>{money(p.price)}／{p.unit||'個'}</span></label>)}</div><button className="btn btn-primary" onClick={exportCatalogue}>{tr('下載勾選商品的價目表')}</button>
      </details>
      {packet&&<section className="card exchange-packet"><h2>{tr('準備傳給對方的內容')}</h2><p>{tr('檔案可被轉傳，請自行確認收件人。店面代碼不會加密檔案。')}</p><textarea className="field" aria-label={tr('對外交換文件')} readOnly value={JSON.stringify(packet,null,2)} onFocus={e=>e.target.select()}/><button className="btn btn-ghost" onClick={()=>download(packet)}>{tr('下載這份文件')}</button></section>}
    </>}
  </div></div>
}
