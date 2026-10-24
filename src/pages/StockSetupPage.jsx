import {useEffect,useMemo,useRef,useState} from 'react'
import {tr,trMessage,getLocale} from '../i18n'
import {loadStockSetupState,previewStockSetup} from '../utils/dataAccess'
import {readPendingFinancial} from '../utils/financialCommand'
import {STOCK_SETUP_PREVIEW,stockSetupChoice} from '../../electron/stockSetup.mjs'
import {assertStockSetupReview} from '../../electron/stockSetupReview.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {makeStockOpeningHandoff,readStockOpeningAgent} from '../../electron/stockOpeningAgent.mjs'
import {stockSetupDraftKey,readStockSetupDraft,writeStockSetupDraft,clearStockSetupDraft} from '../utils/stockSetupDraft'
import './StockSetupPage.css'

const scope=state=>{const {now,...context}=state.context;return context},money=cents=>'NT$ '+(cents/100).toLocaleString(getLocale(),{minimumFractionDigits:2,maximumFractionDigits:2})
function download(value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='stock-cost-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export default function StockSetupPage({store,session,loadState=loadStockSetupState,previewOperation=previewStockSetup}){
  const [state,setState]=useState(null),[draft,setDraft]=useState(null),[step,setStep]=useState(1),[preview,setPreview]=useState(null),[pending,setPending]=useState(null),[done,setDone]=useState(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false)
  const [query,setQuery]=useState(''),[limit,setLimit]=useState(4),[error,setError]=useState(''),[notice,setNotice]=useState(''),[cacheError,setCacheError]=useState(''),[corrupt,setCorrupt]=useState(null),[packet,setPacket]=useState(''),[refresh,setRefresh]=useState(0)
  const saved=useRef({key:null,raw:null}),current=useRef(null),gate=useRef(false),finished=useRef(false),heading=useRef(null)
  current.current=draft
  useEffect(()=>{
    let active=true;setError('')
    ;(async()=>{try{
      const old=readPendingFinancial()
      if(old){
        if(old.kind!=='stock-cost')throw Error('上一筆異動結果尚未確認。請先核對原單。')
        if(active){
          const key=stockSetupDraftKey({storeId:old.request.storeId},session,old.request.action==='open'?'opening':'pricing')
          try{const stored=readStockSetupDraft(localStorage,key),review=old.request.review
            if(stored.value?.reviewId===review?.sourceDigest&&stored.value.useReferences===review.selection.useReferences&&review.selection.entries.every(row=>{const choice=stored.value.choices[row.key];return choice?.mode===row.mode&&(['unit','total'].includes(row.mode)?choice.raw:'')===row.raw}))saved.current={key,raw:stored.raw}
          }catch{}
          setPending(old)
        }
        return
      }
      const value=await loadState(session);if(!active)return
      const key=stockSetupDraftKey(value.context,session,value.mode);saved.current={key,raw:null};setState(value)
      let stored
      try{stored=readStockSetupDraft(localStorage,key);saved.current.raw=stored.raw}
      catch(e){setCorrupt(e.originalRaw??'');setCacheError(e.message);return}
      const next=stored.value||{protocol:'pos-stock-setup-draft/v1',reviewId:value.context.reviewId,useReferences:false,choices:{},selectedKey:'',agentText:''}
      if(next.reviewId!==value.context.reviewId)setNotice('資料已更新，請再核對數量與成本')
      setDraft({...next,reviewId:value.context.reviewId});setStep(1);setPreview(null);setConfirmed(false);setCorrupt(null)
      if(stored.notSaved)setCacheError('草稿暫時存不下，請先不要關閉頁面')
    }catch(e){if(active)setError(e.message)}})()
    return()=>{active=false}
  },[session.userId,session.role,loadState,refresh])
  function keep(value){if(!saved.current.key||!value||finished.current)return;try{saved.current.raw=writeStockSetupDraft(localStorage,saved.current.key,value);setCacheError('')}catch(e){setCacheError(e.message)}}
  useEffect(()=>{if(draft&&!pending&&corrupt===null)keep(draft)},[draft,pending,corrupt])
  useEffect(()=>{heading.current?.focus({preventScroll:true})},[step,pending,done])
  const rows=state?.rows||[],selected=rows.find(row=>row.key===draft?.selectedKey),terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),filtered=rows.filter(row=>terms.every(term=>(row.name+' '+row.unit+' '+row.productId).toLocaleLowerCase().includes(term))),visible=filtered.slice(0,limit)
  const editable=state?.mode==='pricing'?(selected?[selected]:[]):visible,locked=busy||!!pending||corrupt!==null
  function choice(row){const value=draft?.choices[row.key]||{mode:draft?.useReferences&&row.referenceAllowed?'reference':'unknown',raw:''};return {key:row.key,mode:value.mode,raw:['unit','total'].includes(value.mode)?value.raw:''}}
  function updateChoice(key,patch){setDraft(old=>({...old,choices:{...old.choices,[key]:{...(old.choices[key]||{mode:old.useReferences&&rows.find(row=>row.key===key)?.referenceAllowed?'reference':'unknown',raw:''}),...patch}}}));setPreview(null);setConfirmed(false);setError('')}
  function original(){try{const value=readPendingFinancial();if(value?.kind==='stock-cost'){setPending(value);return value}}catch(e){setError(e.message)}return null}
  async function seeResult(){
    if(gate.current||locked||!state||!draft||cacheError)return;gate.current=true;setBusy(true);setError('')
    try{
      const entries=(state.mode==='pricing'?selected?[selected]:[]:rows.filter(row=>Object.hasOwn(draft.choices,row.key))).map(choice)
      const selection={entries,useReferences:state.mode==='opening'&&draft.useReferences},result=await previewOperation({context:scope(state),...selection},session)
      if(result?.protocol!==STOCK_SETUP_PREVIEW||result.success!==true||result.input?.storeId!==state.context.storeId||result.input.epoch!==state.context.epoch||result.input.review?.sourceDigest!==state.context.reviewId)throw Error('庫存成本預覽需要重新核對')
      assertStockSetupReview(result.input.review);setPreview(result);setStep(3);setConfirmed(false)
      if(canonicalSignature(result.input.review.selection)!==canonicalSignature(selection)||result.input.action!==(state.mode==='opening'?'open':'price')||state.mode==='pricing'&&result.input.sourceId!==selected?.sourceId){setPreview(null);setStep(2);throw Error('庫存成本預覽需要重新核對')}
    }catch(e){setError(e.message)}finally{gate.current=false;setBusy(false)}
  }
  async function submit(){
    if(gate.current||locked||!preview||!confirmed||cacheError)return;gate.current=true;setBusy(true);setError('')
    try{const result=await store.commitStockSetup(preview.input);if(!result)throw Error('庫存成本回覆尚未確認，請保留原編號核對');finish(result)}
    catch(e){setError(e.message);if(!original()&&e.notCommitted){setPreview(null);setStep(2);setConfirmed(false)}}finally{gate.current=false;setBusy(false)}
  }
  function finish(result){finished.current=true;try{const next=clearStockSetupDraft(localStorage,saved.current.key,saved.current.raw,result.command);if(next){setDraft(next);current.current=next}}catch(e){setCacheError(e.message)};setPending(null);setDone(result)}
  async function recover(){if(gate.current)return;gate.current=true;setBusy(true);setError('');try{const result=await store.retryFinancial();if(!result)throw Error('庫存成本回覆尚未確認，請保留原編號核對');finish(result)}catch(e){setError(e.message);if(e.notCommitted){setPending(null);setPreview(null);setStep(1);setRefresh(n=>n+1)}else original()}finally{gate.current=false;setBusy(false)}}
  function applyAgent(raw){try{const entries=readStockOpeningAgent(raw,state);setDraft(old=>({...old,agentText:raw,choices:{...old.choices,...Object.fromEntries(entries.map(entry=>[entry.key,{mode:entry.mode,raw:entry.raw||old.choices[entry.key]?.raw||''}]))}}));setPreview(null);setConfirmed(false);setNotice('成本草稿已帶入，請核對');setError('')}catch(e){setError(e.message)}}
  async function readFile(file){if(!file||gate.current)return;if(file.size>32768){setError('單據太大，請分批匯入（每次最多 32 KB）');return}gate.current=true;setBusy(true);try{const raw=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('檔案讀取失敗，請保留原檔再試'));reader.readAsText(file)});setDraft(old=>({...old,agentText:raw}));applyAgent(raw)}catch(e){setError(e.message)}finally{gate.current=false;setBusy(false)}}
  const activeReview=pending?.request.review||done?.command?.review||preview?.input.review
  const activeInput=pending?.request||done?.command||preview?.input,isPrice=activeInput?.action==='price'
  const summary=activeReview?.summary,total=<>{activeReview?.subject&&<p>{activeReview.subject.name} · {activeReview.subject.quantityUnits/1000} {activeReview.subject.unit}</p>}<div className="setup-total" data-setup-summary><span>{tr(isPrice?'這批總成本':'目前已確認的庫存成本')}</span><strong>{summary?money(isPrice?activeInput.valueCents:summary.ownedKnownValueCents):''}</strong><p>{tr(summary?.complete?'成本已齊':isPrice?'其他成本仍待確認':'仍有成本待確認')}</p><details><summary>{tr('查看成本去向')}</summary>{summary&&(isPrice?[['1211','還在店內'],['5101','已售出'],['5208','耗損'],['5204','已退供應商']]:[['available','可販售'],['reserved','預訂、製作中'],...(summary.categories.quarantined?[['quarantined','暫停販售']]:[]),['consumed','已售出'],['wasted','耗損'],['supplierReturned','已退供應商']]).map(([stage,label])=><div className="setup-tender" key={stage}><span>{tr(label)}</span><span>{money(isPrice?activeReview.journalLines.filter(row=>row.account===stage).reduce((sum,row)=>sum+row.debitCents,0):summary.categories[stage].knownValueCents)}{!isPrice&&summary.categories[stage].unknownSources?' + '+tr('待確認'):''}</span></div>)}</details></div></>
  const messages=<>{error&&<p className="setup-error" role="alert">{trMessage(error)}</p>}{notice&&<p className="setup-notice" role="status">{trMessage(notice)}</p>}{cacheError&&<div className="setup-error" role="alert"><p>{trMessage(cacheError)}</p><div className="setup-actions"><button className="btn" disabled={locked} onClick={()=>keep(current.current)}>{tr('重試保存草稿')}</button><button className="btn" onClick={()=>download({draft:current.current,originalRaw:corrupt,pending})}>{tr('下載草稿')}</button></div></div>}</>
  return <div className="stock-setup" data-stock-setup>
    <header><h1 ref={heading} tabIndex={-1}>{tr(done?'成本已保存':pending?'核對上次成本設定':'核對庫存成本')}</h1><button className="btn" disabled={busy} onClick={()=>store.setView('dashboard')}>{tr('首頁')}</button></header>
    {messages}
    {done?<>{total}{store.stockSetupEnabled&&<button className="btn setup-primary" onClick={()=>{finished.current=false;setDone(null);setDraft(null);setState(null);setRefresh(n=>n+1)}}>{tr('繼續補成本')}</button>}<button className="btn btn-primary setup-primary" onClick={()=>store.setView('dashboard')}>{tr('完成，回首頁')}</button></>:pending?<>{total}<p className="setup-subtle">{pending.request.id}</p><p>{tr('沿用原編號，庫存與付款不會再做一次。')}</p><button className="btn btn-primary setup-primary" onClick={recover} disabled={busy}>{tr(busy?'處理中...':'核對上次成本設定')}</button><button className="btn setup-primary" onClick={()=>store.setView('recovery')} disabled={busy}>{tr('資料復原')}</button></>:!state||!draft?<>{!error&&!cacheError&&<p role="status">{tr('正在讀取庫存成本…')}</p>}{error&&<button className="btn" onClick={()=>setRefresh(n=>n+1)}>{tr('重新讀取')}</button>}</>:step===1?<>
      <h2>{tr(state.mode==='opening'?'1 先看現有庫存':'1 選一批補成本')}</h2><p>{tr('數量由系統帶入，成本設定不會改數量。')}</p>
      <input className="field" aria-label={tr('找商品或批次')} placeholder={tr('找商品或批次')} value={query} onChange={e=>{setQuery(e.target.value);setLimit(4)}}/>
      <div className="setup-list">{visible.map(row=><div className="setup-card" key={row.key}><strong>{row.name}</strong><p>{row.quantityUnits/1000} {row.unit} · {tr(row.stage==='available'?'可販售':row.stage==='reserved'?'預訂、製作中':row.stage==='consumed'?'已售出':'原始批次')}</p>{state.mode==='pricing'&&<p className="setup-subtle">{tr('還在店內 {0} {1}',{0:((row.quantities.available||0)+(row.quantities.reserved||0)+(row.quantities.quarantined||0))/1000,1:row.unit})}</p>}{state.mode==='pricing'&&<button className="btn" onClick={()=>{setDraft(old=>({...old,selectedKey:row.key}));setStep(2)}}>{tr('補這批成本')}</button>}</div>)}</div>
      {filtered.length>limit&&<button className="btn" onClick={()=>setLimit(n=>n+4)}>{tr('載入更多')}</button>}
      {state.mode==='pricing'&&!rows.length&&<p>{tr('目前沒有待補成本')}</p>}
      {state.blocked?<p className="setup-error">{tr('舊存貨帳金額需要先核對，請保留草稿')}</p>:state.mode==='opening'&&<button className="btn btn-primary setup-primary" disabled={locked} onClick={()=>{setStep(2);setQuery('');setLimit(4)}}>{tr('庫存對了，下一步')}</button>}
      <button className="btn setup-primary" onClick={()=>store.setView('stocktake')}>{tr('調整數量：先盤點')}</button>
    </>:step===2?<>
      <h2>{tr('2 填成本')}</h2>{state.mode==='pricing'&&<p>{tr('填這批原本的成本，系統會自動分到各個去向。')}</p>}{state.mode==='opening'&&<div className="setup-actions"><button className="btn" onClick={()=>{setDraft(old=>({...old,useReferences:true}));setPreview(null)}}>{tr('帶入目前成本')}</button><button className="btn" onClick={()=>setStep(1)}>{tr('再看一次庫存')}</button></div>}
      {state.mode==='opening'&&<input className="field" placeholder={tr('找商品或批次')} aria-label={tr('找商品或批次')} value={query} onChange={e=>{setQuery(e.target.value);setLimit(4)}}/>}
      <div className="setup-list">{editable.map(row=>{const value=choice(row);let amount=null,issue='';try{amount=stockSetupChoice(row,value)}catch(e){issue=e.message}return <div className="setup-card" data-setup-key={row.key} key={row.key}><strong>{row.name}</strong><p>{row.quantityUnits/1000} {row.unit} · {tr(row.stage==='available'?'可販售':row.stage==='reserved'?'預訂、製作中':row.stage==='consumed'?'已售出':'原始批次')}</p><label>{tr('這批成本怎麼填')}<select className="field" data-setup-mode={row.productId} aria-label={tr('成本選項：{0}',{0:row.name})} value={value.mode} disabled={locked} onChange={e=>updateChoice(row.key,{mode:e.target.value})}>{row.referenceAllowed&&<option value="reference">{tr('沿用目前成本')}</option>}<option value="unknown">{tr('不知道，先留待確認')}</option><option value="free">{tr('確定免費')}</option><option value="unit">{tr('填單價')}</option><option value="total">{tr('填整批總價')}</option></select></label>{['unit','total'].includes(value.mode)&&<label>{tr(value.mode==='unit'?'每 {0} 單價':'整批花多少',{0:row.unit})}<input className="field" inputMode="decimal" data-setup-money={row.productId} aria-label={tr('成本金額：{0}',{0:row.name})} value={draft.choices[row.key]?.raw||''} maxLength={32} disabled={locked} onChange={e=>updateChoice(row.key,{raw:e.target.value})}/></label>}{issue&&<p role="alert" className="setup-error">{trMessage(issue)}</p>}{amount!==null&&!issue&&<p data-setup-line-total>{tr('這批共 {0}',{0:money(amount)})}</p>}</div>})}</div>
      {state.mode==='opening'&&filtered.length>limit&&<button className="btn" onClick={()=>setLimit(n=>n+4)}>{tr('載入更多')}</button>}
      <details className="setup-agent" data-setup-agent><summary>{tr('讓 Agent 幫填成本')}</summary><p>{tr('提供你的進貨資料，Agent 只填草稿，最後由你確認。')}</p><button className="btn" onClick={async()=>{try{const text=makeStockOpeningHandoff(state,editable.map(row=>row.key));setPacket(text);await navigator.clipboard.writeText(text);setNotice('成本資料包已複製')}catch(e){setError(e.message)}}} disabled={locked||!editable.length}>{tr('複製本頁資料包')}</button>{packet&&<details><summary>{tr('手動複製')}</summary><textarea aria-label={tr('成本資料包')} value={packet} readOnly/></details>}<textarea aria-label={tr('貼上成本回覆')} value={draft.agentText} disabled={locked} onChange={e=>setDraft(old=>({...old,agentText:e.target.value}))}/><div className="setup-actions"><button className="btn" disabled={locked||!draft.agentText} onClick={()=>applyAgent(draft.agentText)}>{tr('帶入草稿')}</button><label className="btn">{tr('選回覆檔案')}<input data-setup-agent-file type="file" accept=".json,.txt,text/plain,application/json" disabled={locked} onChange={e=>{const file=e.target.files?.[0];e.target.value='';readFile(file)}}/></label></div></details>
      <button className="btn btn-primary setup-primary" disabled={locked||!!cacheError||state.mode==='pricing'&&!selected} onClick={seeResult}>{tr(busy?'處理中...':'看成本結果')}</button>
    </>:<>
      <h2>{tr('3 看結果，再確認')}</h2>{total}<p>{tr('只保存成本，原付款與庫存數量保持原紀錄。')}</p><label className="setup-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={locked}/>{tr('數量與已填成本都對')}</label><button className="btn btn-primary setup-primary" disabled={locked||!confirmed||!!cacheError} onClick={submit}>{tr(busy?'處理中...':'確認保存成本')}</button><button className="btn setup-primary" disabled={locked} onClick={()=>{setPreview(null);setConfirmed(false);setStep(2)}}>{tr('修改成本')}</button>
    </>}
    {!pending&&!done&&state&&<details data-setup-draft><summary>{tr('資料與草稿')}</summary><div className="setup-actions"><button className="btn" disabled={locked} onClick={()=>setRefresh(n=>n+1)}>{tr('重新讀取')}</button><button className="btn" onClick={()=>download({draft:current.current,originalRaw:corrupt})}>{tr('下載草稿')}</button></div></details>}
  </div>
}
