import {tr,trMessage} from "../i18n"
import {useEffect,useRef,useState} from 'react'
import {getAgentContext,rememberAgentMappings} from '../utils/dataAccess'
import {AGENT_PROTOCOL,draftFromText,validateAgentDraft,agentCommand,agentBusinessDay} from '../../electron/agentDraftRules.mjs'
import {BUSINESS_PROTOCOL} from '../../electron/businessDocument.mjs'
import {QUOTE_PROTOCOL,CATALOGUE_PROTOCOL} from '../../electron/businessExchange.mjs'
import {prepareExternalDocument,validateExternalDraft,quotePurchaseSource} from '../../electron/quoteImport.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {isAgentDocumentText,parseAgentDocument,makeAgentHandoff} from '../../electron/agentHandoff.mjs'
import {quickDraftScope,readQuickDraft,writeQuickDraft} from '../utils/quickDraftCache'
import {nextQuickQuestion} from '../utils/quickQuestions'
import QuickDocumentReview from './quick/QuickDocumentReview'
import '../styles/quick-document.css'

const button={minHeight:48,fontSize:18},field={minHeight:48,fontSize:18,width:'100%'}
const labels={sale:'賣東西',restaurant:'預訂餐點',purchase:'叫貨進貨'}
const money=n=>'NT$ '+n.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
export default function QuickDocumentPage({store,session,incoming='',onIncomingConsumed}){
  const [context,setContext]=useState(null),[text,setText]=useState(()=>['saving','uncertain'].includes(store.financialState?.phase)?'':incoming),[kind,setKind]=useState('sale'),[draft,setDraft]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(''),[packet,setPacket]=useState('')
  const running=useRef(false)
  const imported=useRef('')
  const fileRef=useRef(null),previewRef=useRef(null)
  const [external,setExternal]=useState(null),[remember,setRemember]=useState(session.role==='owner')
  const [editMappings,setEditMappings]=useState(false)
  const statusRef=useRef(null)
  const importSequence=useRef(0)
  const [handoff,setHandoff]=useState(''),[copyMessage,setCopyMessage]=useState('')
  const [manualCopy,setManualCopy]=useState(false)
  const [query,setQuery]=useState(''),[cacheReady,setCacheReady]=useState(''),[cacheNotice,setCacheNotice]=useState(''),[cacheWarning,setCacheWarning]=useState('')
  const hydrated=useRef(''),snapshot=useRef(null),finished=useRef(false),manual=useRef(false),brokenCache=useRef(false)
  const scope=quickDraftScope(context,session),cacheKey=scope?.key||''
  const financialPending=['saving','uncertain'].includes(store.financialState?.phase)
  const pending=!!draft&&store.financialState?.id==='agent-'+draft.id&&financialPending
  const otherPending=financialPending&&!pending
  const cacheState={kind,text,draft,external:external?{document:external.document,overrides:external.overrides}:null}
  snapshot.current={scope,state:cacheState,ready:cacheReady===cacheKey&&!!cacheKey}
  function persist(report=true){
    const latest=snapshot.current
    if(!latest?.ready||finished.current||brokenCache.current)return
    try{writeQuickDraft(localStorage,latest.scope,latest.state);if(report)setCacheWarning('')}
    catch{if(report)setCacheWarning('這個裝置暫時無法保留草稿，內容仍在畫面上，請先不要離開。')}
  }
  useEffect(()=>{
    if(!cacheKey||hydrated.current===cacheKey)return
    const changed=!!hydrated.current;hydrated.current=cacheKey;brokenCache.current=false;finished.current=false
    if(changed){setDraft(null);setExternal(null);setText('');setKind('sale');setCacheNotice('')}
    if(incoming&&!financialPending||!changed&&manual.current){setCacheReady(cacheKey);return}
    const sequence=++importSequence.current;let cancelled=false
    ;(async()=>{
      const saved=readQuickDraft(localStorage,scope)
      if(!saved){if(changed){setDraft(null);setExternal(null);setText('');setKind('sale')}return}
      const recovered=saved.external?await prepareExternalDocument(saved.external.document,context,saved.external.overrides):null
      if(cancelled||sequence!==importSequence.current)return
      setText(saved.text);setDraft(saved.draft);setExternal(saved.external?{...saved.external,...recovered}:null);setKind(saved.kind);setDone('');setCacheNotice('已接回這個裝置上還沒完成的草稿。')
    })().catch(e=>{if(!cancelled){brokenCache.current=true;setCacheWarning(e.message)}}).finally(()=>{if(!cancelled)setCacheReady(cacheKey)})
    return()=>{cancelled=true}
  },[cacheKey])
  useEffect(()=>{persist()},[cacheKey,cacheReady,kind,text,draft,external])
  useEffect(()=>{const flush=()=>persist(false);window.addEventListener('pagehide',flush);return()=>{flush();window.removeEventListener('pagehide',flush)}},[])
  function clearCache(){
    finished.current=true
    try{if(scope)localStorage.removeItem(scope.key)}catch{setCacheWarning('單據已建立，但這個裝置的舊草稿還沒清掉。再次看到同一張時請先查看已建立的紀錄。')}
  }
  function discard(){
    try{if(scope)localStorage.removeItem(scope.key)}catch{setCacheWarning('這個裝置暫時無法清除草稿，內容先留在畫面上。');return}
    takeControl();setDraft(null);setExternal(null);setText('');setDone('');setError('');setCacheWarning('')
  }
  function finish(kind){
    clearCache();if(!running.current)setBusy(false);setError('');setDone(kind==='purchase'?'採購單已建立':'預訂已建立，尚未收款');setDraft(null);setExternal(null);setText('');setCacheNotice('')
  }
  useEffect(()=>{if(done)statusRef.current?.scrollIntoView?.({block:'nearest'})},[done])
  useEffect(()=>{let cancelled=false;getAgentContext(session).then(c=>{if(!cancelled)setContext(c)}).catch(e=>setError(e.message));return()=>{cancelled=true}},[session.userId,session.role])
  useEffect(()=>{if(incoming&&context&&!busy&&!financialPending&&imported.current!==incoming){imported.current=incoming;setText(incoming);setDone('');readDocument(incoming).catch(e=>setError(e.message));onIncomingConsumed?.(incoming)}},[incoming,context,onIncomingConsumed,busy,financialPending])
  useEffect(()=>{if(draft)previewRef.current?.scrollIntoView?.({block:'nearest'})},[draft?.id])
  useEffect(()=>{
    const committed=e=>{if(draft&&e.detail?.receipt?.id==='agent-'+draft.id)finish(draft.kind)}
    window.addEventListener('pos-inventory-operation',committed);window.addEventListener('pos-restaurant-operation',committed)
    return()=>{window.removeEventListener('pos-inventory-operation',committed);window.removeEventListener('pos-restaurant-operation',committed)}
  },[draft])
  useEffect(()=>{const refresh=()=>getAgentContext(session).then(setContext).catch(e=>setError(e.message));window.addEventListener('pos-data-refreshed',refresh);return()=>window.removeEventListener('pos-data-refreshed',refresh)},[session.userId])
  function update(key,value){if(pending||running.current)return;takeControl();setDraft(d=>({...d,[key]:value}));setError('')}
  function baseDraft(){return {protocol:AGENT_PROTOCOL,id:crypto.randomUUID(),issuedAt:new Date().toISOString(),storeId:context.storeId,catalogueRevision:context.catalogueRevision,kind,items:[],note:'',...(kind==='purchase'?{supplierId:'',date:agentBusinessDay(context)}:{}),...(kind==='restaurant'?{channel:'preorder',day:agentBusinessDay(context),slot:'',customer:'',contact:''}:{})}}
  function takeControl(){manual.current=true;finished.current=false;brokenCache.current=false;setCacheNotice('');setHandoff('');setCopyMessage('');importSequence.current++;if(incoming){imported.current=incoming;onIncomingConsumed?.(incoming)}}
  function choose(product){takeControl();setError('');setDone('');setDraft(previous=>{const d=previous||baseDraft(),found=d.items.find(i=>i.productId===product.id);return {...d,items:found?d.items.map(i=>i===found?{...i,qty:Number(i.qty)+1}:i):[...d.items,{productId:product.id,qty:1}]}})}
  async function readDocument(raw){
    finished.current=false;brokenCache.current=false;const sequence=++importSequence.current;setDraft(null);setExternal(null)
    try{
    const d=parseAgentDocument(raw)
    if(d.protocol===CATALOGUE_PROTOCOL)throw Error('這是價目目錄，請讓 Agent 加上數量整理成叫貨單，或取得對方報價')
    const activeContext=await getAgentContext(session);if(sequence!==importSequence.current)return;setContext(activeContext)
    if([BUSINESS_PROTOCOL,QUOTE_PROTOCOL].includes(d?.protocol)){const result=await prepareExternalDocument(d,activeContext);if(sequence!==importSequence.current)return;setExternal({document:d,overrides:{},...result});setEditMappings(false);setDraft(result.draft);setKind(d.protocol===QUOTE_PROTOCOL?'purchase':d.intent)}
    else{validateAgentDraft(d,activeContext,Date.now(),true);setExternal(null);setDraft(d);setKind(d.kind)}
    setText('');setDone('');setError('')
    }catch(error){if(sequence===importSequence.current)throw error}
  }
  async function organize(){setError('');setDone('');setDraft(null);setExternal(null);try{if(isAgentDocumentText(text))await readDocument(text);else{importSequence.current++;const d=draftFromText(text,context,kind);setExternal(null);setDraft(d);setKind(d.kind)}}catch(e){setError(e.message)}}
  async function mapItem(key,productId){const sequence=++importSequence.current;try{const overrides={...external.overrides,[key]:productId},result=await prepareExternalDocument(external.document,context,overrides);if(sequence!==importSequence.current)return;setExternal({...external,overrides,...result});setDraft(result.draft);setError('')}catch(e){if(sequence===importSequence.current){setDraft(null);setError(e.message)}}}
  async function readFile(file){if(!file)return;takeControl();const sequence=++importSequence.current;let activeSequence=sequence;setDraft(null);setExternal(null);setDone('');setError('');try{if(file.size>32768)throw Error('單據太大，請分批匯入（每次最多 32 KB）');const raw=await file.text();if(sequence===importSequence.current){setText(raw);const pending=readDocument(raw);activeSequence=importSequence.current;await pending}}catch(e){if(activeSequence===importSequence.current)setError(e.message)}}
  function pasteReply(e){
    const raw=e.clipboardData.getData('text/plain'),field=e.currentTarget
    if(!isAgentDocumentText(raw)||text.trim()&&!(field.selectionStart===0&&field.selectionEnd===text.length))return
    e.preventDefault();takeControl();setText(raw);setDone('');setError('');readDocument(raw).catch(e=>setError(e.message))
  }
  let preview=null,issue=''
  if(draft&&context)try{preview=validateExternalDraft(draft,context,external?.document)}catch(e){issue=e.message}
  const question=draft&&context?nextQuickQuestion(draft,context):null
  if(!preview&&question)try{preview=validateExternalDraft(draft,context,external?.document,Date.now(),true)}catch{}
  const matching=context?.products.filter(p=>[p.name,p.barcode,p.sku].some(value=>String(value||'').normalize('NFKC').toLowerCase().includes(query.trim().normalize('NFKC').toLowerCase())))||[]
  function focusProducts(){const list=document.querySelector('[data-quick-products]');if(list)list.open=true;const input=list?.querySelector('input[type="search"]');input?.scrollIntoView?.({block:'center'});input?.focus()}
  async function retry(){
    if(running.current)return;running.current=true;setBusy(true);setError('')
    try{const result=await store.retryFinancial();if(result?.receipt?.id==='agent-'+draft.id)finish(draft.kind)}catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function build(){
    if(running.current||financialPending)return;running.current=true;setBusy(true);setError('')
    try{
      const fresh=await getAgentContext(session)
      if(external){const normalized=await prepareExternalDocument(external.document,fresh,external.overrides);if(!normalized.draft||canonicalSignature(normalized.draft.items)!==canonicalSignature(draft.items)||normalized.draft.id!==draft.id)throw Error('外部單據明細有變更，請重新核對來源單據');if(remember&&session.role==='owner'){const r=await rememberAgentMappings({senderId:normalized.senderId,entries:normalized.chosen},session);if(r?.success!==true)throw Error('品項對照尚未保存，請重試');fresh.mappings=r.mappings}}
      const verified=validateExternalDraft(draft,fresh,external?.document),command=agentCommand(verified)
      if(external?.document.protocol===QUOTE_PROTOCOL)command.input.sourceQuote=quotePurchaseSource(external.document,external.chosen)
      if(command.kind==='sale'){store.stageQuickSale(command.items);clearCache();return}
      if(command.kind==='restaurant')await store.commitRestaurant(command.input,command.identity)
      else await store.commitInventory(command.kind,command.input,command.identity)
      finish(draft.kind);setContext(fresh)
    }catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function exportPacket(){try{const c=await getAgentContext(session);setContext(c);setPacket(JSON.stringify(c,null,2))}catch(e){setError(e.message)}}
  async function prepareHandoff(){try{setError('');const sequence=importSequence.current,c=await getAgentContext(session);if(sequence!==importSequence.current)return;const text=JSON.stringify(makeAgentHandoff(c,kind),null,2);setContext(c);setHandoff(text);setManualCopy(false);try{await navigator.clipboard.writeText(text);setCopyMessage('已複製。貼給你的 Agent，再把它回覆的單據貼回上方。')}catch{setManualCopy(true);setCopyMessage('資料已準備好。選取下方內容並複製給你的 Agent。')}}catch(e){setError(e.message)}}
  return <div className="quick-flow" style={{flex:1,overflowY:'auto',padding:16,fontSize:18}}><div style={{maxWidth:800,margin:'0 auto',paddingBottom:40}}>
    <h2 className="page-title" style={{fontSize:26}}>{tr("快速建單")}</h2><p>{tr("說要什麼，或點商品。看一下，就能建好。")}</p>
    <ol className="quick-progress" aria-label={tr("建單步驟")}>{['準備內容','核對這張單','完成'].map((label,index)=><li key={label} aria-current={(done?2:draft||external?1:0)===index?'step':undefined}><span>{index+1}</span>{tr(label)}</li>)}</ol>
    {cacheNotice&&<p role="status" className="quick-hint">{trMessage(cacheNotice)}</p>}
    {cacheWarning&&<p role="status" className="quick-question">{trMessage(cacheWarning)}</p>}
    {(cacheNotice||cacheWarning)&&<button className="btn btn-ghost" style={button} disabled={busy||financialPending} onClick={discard}>{tr("放棄這張草稿")}</button>}
    {done&&<div ref={statusRef} role="status" className="card quick-success" style={{padding:16,marginTop:12}}><strong>{trMessage(done)}</strong><div><button className="btn btn-primary" style={button} disabled={busy} onClick={()=>store.setView(kind==='purchase'?'purchase':'restaurant')}>{tr("查看單據")}</button><button className="btn btn-ghost" style={button} disabled={busy} onClick={()=>{takeControl();setDone('');focusProducts()}}>{tr("再開一張")}</button></div></div>}
    {otherPending&&<p role="status" className="quick-question">{tr("還有一張單的結果需要確認，請先使用上方的原編號重試。")}</p>}
    <fieldset disabled={busy||otherPending||!!context&&cacheReady!==cacheKey} style={{border:0,padding:0,minWidth:0}}>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'16px 0'}}>{Object.entries(labels).filter(([k])=>k!=='purchase'||session.role==='owner').map(([k,label])=><button key={k} disabled={pending} style={button} className={'btn '+(kind===k?'btn-primary':'btn-ghost')} aria-pressed={kind===k} onClick={()=>{takeControl();setKind(k);setDraft(null);setExternal(null);setDone('');setError('')}}>{tr(label)}</button>)}</div>
    {!context?<p role="status">{tr("正在讀取店內品項…")}</p>:<>
      <fieldset disabled={pending} className="quick-fields">
      <label>{tr("你要開什麼單？")}<textarea aria-label={tr("建單內容")} className="field" style={{...field,minHeight:110}} maxLength={32768} value={text} onPaste={pasteReply} onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();readFile(e.dataTransfer.files[0])}}} onDragOver={e=>e.preventDefault()} onChange={e=>{takeControl();setText(e.target.value);setDraft(null);setExternal(null);setDone('');setError('')}} placeholder={tr("{0} 2，{1} 1；也可以貼上 Agent 的完整回覆", {0: context.products[0]?.name||'牛丼', 1: context.products[1]?.name||'紅茶'})}/></label>
      <p className="quick-hint">{tr("貼上 Agent 回覆會直接整理成下方的單據，確認前不會送出。")}</p>
      <input ref={fileRef} type="file" accept=".json,application/json" aria-label={tr("公司單據檔案")} style={{display:'none'}} onChange={e=>{readFile(e.target.files?.[0]);e.target.value=''}}/>
      <button className="btn btn-ghost" style={{...button,width:'100%',marginTop:12}} onClick={()=>fileRef.current?.click()}>{tr("匯入公司單據")}</button>
      <button className="btn btn-primary" style={{...button,width:'100%',margin:'12px 0'}} onClick={organize} disabled={!text.trim()}>{tr("幫我整理")}</button>
      {!external&&<details data-quick-products open={!draft}><summary style={{padding:'12px 0',cursor:'pointer'}}>{tr("直接點商品也可以")}</summary><input aria-label={tr("找建單商品")} className="field" type="search" style={{...field,marginBottom:12}} placeholder={tr("找商品名稱或條碼")} value={query} onChange={e=>setQuery(e.target.value)}/><div className="quick-product-grid">{matching.slice(0,24).map(p=><button key={p.id} className="btn btn-ghost" style={{...button,textAlign:'left',whiteSpace:'normal'}} onClick={()=>choose(p)}>{p.name}<br/>{money(kind==='purchase'?p.unitCost||0:p.price)}／{p.unit}</button>)}</div>{!matching.length&&<p role="status">{tr("找不到這個商品。試試其他名稱或條碼。")}</p>}{matching.length>24&&<p className="quick-hint">{tr("先顯示前 24 項。輸入品名或條碼就能找到其他商品。")}</p>}</details>}
      {external&&<div className="card" style={{padding:16,marginTop:12}}><strong>{tr("來自 ")}{external.document.sender.name||external.senderId}{tr(" 的單據")}</strong><p>{external.document.id}</p>{external.document.items.map((row,index)=>{const key=row.sku?'sku:'+row.sku:row.barcode?'barcode:'+row.barcode:'name:'+row.name,name=row.name||row.sku||row.barcode,p=context.products.find(p=>p.id===external.chosen[key]);return editMappings||external.unresolved.some(r=>r.index===index)?<label key={key} style={{display:'block',marginTop:12}}>「{name}{tr("」是店內哪個商品？")}<select className="field" style={field} aria-label={tr("對照 {0}", {0: name})} value={external.overrides[key]||external.chosen[key]||''} onChange={e=>mapItem(key,e.target.value)}><option value="">{tr("請選商品")}</option>{context.products.map(p=><option key={p.id} value={p.id}>{p.name}（{p.unit}）</option>)}</select></label>:<p key={key}>{name} → {p?.name} · {row.qty} {row.unit}</p>})}{!external.unresolved.length&&<button className="btn btn-ghost" style={button} onClick={()=>setEditMappings(v=>!v)}>{editMappings?tr("完成對照"):tr("調整品項對照")}</button>}{session.role==='owner'&&<label style={{display:'flex',gap:10,alignItems:'center',marginTop:12}}><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>{tr("記住這家公司的品項對照")}</label>}</div>}
      </fieldset>
      {external?.document.protocol===QUOTE_PROTOCOL&&<p className="card" style={{padding:16}}>{tr('專屬報價：第 {0} 版',{0:external.document.revision})}<br/>{tr('有效至 {0}',{0:new Date(external.document.validUntil).toLocaleString()})}<br/>{tr('本單單價已含全部費用。確認只建立採購，尚未收貨或付款。')}</p>}
      {draft&&<QuickDocumentReview draft={draft} context={context} preview={preview} issue={issue} question={question} external={!!external} quoted={external?.document.protocol===QUOTE_PROTOCOL} busy={busy} pending={pending} sectionRef={previewRef} onChange={update} onBuild={build} onRetry={retry} onProducts={focusProducts} onSuppliers={()=>store.setView('purchase')}/>}
      <section className="card" style={{padding:16,marginTop:24}} aria-label={tr("交給 Agent")}><h3>{tr("交給你的 Agent")}</h3><p>{tr("只帶走這次建單需要的資料。貼給你選用的 Agent，再把完整回覆貼回上方。")}</p><button className="btn btn-primary" style={{...button,width:'100%'}} disabled={pending} onClick={prepareHandoff}>{tr("複製建單資料給 Agent")}</button>{copyMessage&&<p role="status">{trMessage(copyMessage)}</p>}{handoff&&<details open={manualCopy}><summary style={{padding:'12px 0'}}>{tr("需要手動複製時，展開這裡")}</summary><textarea aria-label={tr("給 Agent 的建單資料")} className="field" readOnly style={{...field,minHeight:150}} value={handoff} onFocus={e=>e.target.select()}/></details>}</section>
      <details style={{marginTop:24}}><summary style={{cursor:'pointer',padding:'12px 0'}}>{tr("開發者與進階設定")}</summary><a href="./llms.txt" target="_blank" rel="noreferrer">{tr("建單指南")}</a> · <a href="./agent/manifest.json" target="_blank" rel="noreferrer">{tr("協議")}</a><button className="btn btn-ghost" style={{...button,display:'block',marginTop:12}} onClick={exportPacket}>{tr("取得店內資料包")}</button>{packet&&<textarea aria-label={tr("Agent 店內資料包")} readOnly className="field" style={{...field,minHeight:140}} value={packet} onFocus={e=>e.target.select()}/>}</details>
    </>}
    </fieldset>
    {error&&<p role="alert" style={{color:'var(--red)',padding:12}}>{trMessage(error)}{store.cart.length>0&&<button className="btn btn-ghost" style={button} onClick={()=>store.setView('pos')}>{tr("回收銀台查看原購物車")}</button>}</p>}
  </div></div>
}
