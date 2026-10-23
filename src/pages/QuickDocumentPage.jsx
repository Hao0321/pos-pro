import {tr,trMessage} from "../i18n"
import {useEffect,useRef,useState} from 'react'
import {getAgentContext,rememberAgentMappings,loadPrivateDraftContext,lookupPrivateDraftOriginal} from '../utils/dataAccess'
import {AGENT_PROTOCOL,draftFromText,validateAgentDraft,agentCommand,agentBusinessDay} from '../../electron/agentDraftRules.mjs'
import {BUSINESS_PROTOCOL} from '../../electron/businessDocument.mjs'
import {QUOTE_PROTOCOL,CATALOGUE_PROTOCOL} from '../../electron/businessExchange.mjs'
import {prepareExternalDocument,validateExternalDraft,quotePurchaseSource} from '../../electron/quoteImport.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {isAgentDocumentText,parseAgentDocument,makeAgentHandoff,projectAgentContext} from '../../electron/agentHandoff.mjs'
import {RESTAURANT_AGENT_PROTOCOL,assertRestaurantAgentShape,reviewedRestaurantAgentDraft} from '../../electron/restaurantAgentDraft.mjs'
import {assertOrdinaryRestaurantAgentDraft,reviewedOrdinaryRestaurantDraft} from '../../electron/ordinaryRestaurantAgent.mjs'
import useRestaurantAgentReview from '../hooks/useRestaurantAgentReview'
import {readPendingFinancial} from '../utils/financialCommand'
import useWorkspaceDraft from '../hooks/useWorkspaceDraft'
import WorkspaceDraftNotice from '../components/WorkspaceDraftNotice'
import LegacyQuickDraft from '../components/LegacyQuickDraft'
import {validWorkspaceQuickDraft} from '../utils/restaurantDraftShapes.mjs'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {verifyQuickOriginal} from '../utils/quickDraftRecovery'
import {isPurchaseImport,purchaseImportId} from '../../electron/quickPurchaseOriginal.mjs'
import {nextQuickQuestion} from '../utils/quickQuestions'
import QuickDocumentReview from './quick/QuickDocumentReview'
import '../styles/quick-document.css'

const button={minHeight:48,fontSize:18},field={minHeight:48,fontSize:18,width:'100%'}
const labels={sale:'賣東西',restaurant:'預訂餐點',purchase:'叫貨進貨'}
const money=n=>'NT$ '+n.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
export default function QuickDocumentPage({store,session,incoming='',onIncomingConsumed}){
  const [context,setContext]=useState(null),[text,setText]=useState(''),[kind,setKind]=useState('sale'),[draft,setDraft]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(''),[packet,setPacket]=useState('')
  const running=useRef(false)
  const imported=useRef('')
  const fileRef=useRef(null),previewRef=useRef(null)
  const [external,setExternal]=useState(null),[remember,setRemember]=useState(session.role==='owner')
  const [editMappings,setEditMappings]=useState(false)
  const [donePurchase,setDonePurchase]=useState(null)
  const statusRef=useRef(null)
  const importSequence=useRef(0)
  const [handoff,setHandoff]=useState(''),[copyMessage,setCopyMessage]=useState('')
  const [manualCopy,setManualCopy]=useState(false)
  const [query,setQuery]=useState('')
  const financialPending=['saving','uncertain'].includes(store.financialState?.phase)
  const pending=!!draft&&store.financialState?.id==='agent-'+draft.id&&financialPending
  const otherPending=financialPending&&!pending
  const menuAgent=useRestaurantAgentReview({draft,session,financialPending,onDraft:setDraft,onContext:setContext,onAccepted:acceptedRestaurant})
  const selected=draft?.protocol===RESTAURANT_AGENT_PROTOCOL,restaurantAgent=selected||draft?.protocol===AGENT_PROTOCOL&&draft.kind==='restaurant',working=busy||menuAgent.busy
  const cacheState={kind,text,draft,external:external?{document:external.document,overrides:external.overrides}:null}
  const hasContent=!!text.trim()||!!draft||!!external
  const workspace=useWorkspaceDraft({kind:'quick',session,state:cacheState,hasContent,validate:validWorkspaceQuickDraft,onRestore:restoreRaw,onOriginal:completeOriginal,findOriginal:(saved,metadata)=>findImportedPurchase(saved?.external?.document||saved?.draft,metadata.context)})
  async function findImportedPurchase(document,authority){
    if(!isPurchaseImport(document))return null
    const id=purchaseImportId(document,authority.storeId),result=await lookupPrivateDraftOriginal({context:authority,id,family:'quick-purchase-import',document},session)
    if(result?.protocol!=='pos-private-draft-original/v1'||result.id!==id||!['matched','missing'].includes(result.status))throw Error('保存結果尚未確認，請保留原編號核對。')
    if(result.status==='missing')return null
    verifyQuickOriginal(result,document);return result
  }
  async function recoverImportedPurchase(document,sequence){
    if(!isPurchaseImport(document))return false
    const authority=await loadPrivateDraftContext(session);if(sequence!==importSequence.current)return true;workspace.assertScope(authority)
    const original=await findImportedPurchase(document,authority);if(sequence!==importSequence.current)return true;workspace.assertScope(authority)
    if(!original)return false
    await completeOriginal(original,null,{isCurrent:()=>sequence===importSequence.current});return true
  }
  async function restoreRaw(saved,metadata){
    const sequence=++importSequence.current;menuAgent.invalidate();setDraft(null);setExternal(null);setText('');setKind('sale');setDone('');setError('');setQuery('');setPacket('');setHandoff('');setCopyMessage('');setContext(null)
    if(!metadata.context)return
    const fresh=await getAgentContext(session)
    if(sequence!==importSequence.current)return
    if(fresh.storeId!==metadata.context.storeId)throw Error('店面或帳號已變更，請保留原輸入核對。')
    const recovered=saved?.external?await prepareExternalDocument(saved.external.document,fresh,saved.external.overrides):null
    if(sequence!==importSequence.current)return
    setContext(fresh);setText(saved?.text||'');setDraft(saved?.draft||null);setExternal(saved?.external?{...saved.external,...recovered}:null);setKind(saved?.kind||'sale')
  }
  async function completeOriginal(original,_state,completion){
    if(completion?.isCurrent&&!completion.isCurrent())return
    const verified=verifyQuickOriginal(original),pending=readPendingFinancial()
    if(pending?.request.id===original.id){if(privateDraftDigest(pending.request)!==original.digest)throw Error('原單資料需要核對');await store.retryFinancial()}
    else if(verified.kind==='purchase-create')await store.refreshSuppliers()
    if(completion?.isCurrent&&!completion.isCurrent())return
    finish(verified.kind==='purchase-create'?'purchase':'restaurant',true,verified.kind==='purchase-create'?verified.result.purchase:null)
  }
  async function acceptedRestaurant(original,proof){
    const sequence=importSequence.current
    if(proof?.id!==original.id||typeof proof.digest!=='string'||!/^[a-f0-9]{64}$/.test(proof.digest))throw Error('保存結果尚未確認，請保留原編號核對。')
    const authority=await loadPrivateDraftContext(session);if(sequence!==importSequence.current)return;workspace.assertScope(authority)
    const result=await lookupPrivateDraftOriginal({context:authority,id:original.id,digest:proof.digest,family:'quick-restaurant'},session)
    if(sequence!==importSequence.current)return;workspace.assertScope(authority)
    await completeOriginal(result,null,{isCurrent:()=>sequence===importSequence.current})
  }
  function clearCache(){workspace.complete()}
  function discard(){
    if(workspace.blocked||financialPending)return
    clearCache();takeControl();setDraft(null);setExternal(null);setText('');setDone('');setError('')
  }
  function finish(kind,accepted=false,purchase=null){
    clearCache();if(!running.current)setBusy(false);setError('');setKind(kind);setDonePurchase(purchase);setDone(accepted?'原單已建立，請到工作單查看目前狀態。':kind==='purchase'?'採購單已建立':'預訂已建立，尚未收款');setDraft(null);setExternal(null);setText('')
  }
  useEffect(()=>{if(done)statusRef.current?.scrollIntoView?.({block:'nearest'})},[done])
  useEffect(()=>()=>{importSequence.current++},[])
  useEffect(()=>{let cancelled=false;getAgentContext(session).then(c=>{if(!cancelled)setContext(c)}).catch(e=>setError(e.message));return()=>{cancelled=true}},[session.userId,session.role])
  useEffect(()=>{if(incoming&&context&&workspace.ready&&!working&&!financialPending&&imported.current!==incoming){imported.current=incoming;workspace.begin();setText(incoming);setDone('');readDocument(incoming).catch(e=>setError(e.message));onIncomingConsumed?.(incoming)}},[incoming,context,onIncomingConsumed,working,financialPending,workspace.ready])
  useEffect(()=>{if(draft)previewRef.current?.scrollIntoView?.({block:'nearest'})},[draft?.id])
  useEffect(()=>{const refresh=()=>getAgentContext(session).then(setContext).catch(e=>setError(e.message));window.addEventListener('pos-data-refreshed',refresh);return()=>window.removeEventListener('pos-data-refreshed',refresh)},[session.userId])
  function update(key,value){if(pending||running.current)return;takeControl(false);setDraft(d=>({...d,[key]:value}));setError('')}
  function baseDraft(){return {protocol:AGENT_PROTOCOL,id:crypto.randomUUID(),issuedAt:new Date().toISOString(),storeId:context.storeId,catalogueRevision:context.catalogueRevision,kind,items:[],note:'',...(kind==='purchase'?{supplierId:'',date:agentBusinessDay(context)}:{}),...(kind==='restaurant'?{channel:'preorder',day:agentBusinessDay(context),slot:'',customer:'',contact:''}:{})}}
  function takeControl(cancelMenu=true){workspace.begin();setHandoff('');setPacket('');setCopyMessage('');importSequence.current++;if(cancelMenu)menuAgent.invalidate();if(incoming){imported.current=incoming;onIncomingConsumed?.(incoming)}}
  function choose(product){takeControl();setError('');setDone('');setDraft(previous=>{
    if(kind==='restaurant'&&context.restaurantMenu){const d=previous?.protocol===RESTAURANT_AGENT_PROTOCOL?previous:{protocol:RESTAURANT_AGENT_PROTOCOL,id:crypto.randomUUID(),issuedAt:new Date().toISOString(),storeId:context.storeId,menuRevision:context.restaurantMenuRevision,kind:'restaurant',items:[],channel:'preorder',day:agentBusinessDay(context),slot:'',customer:'',contact:'',note:''};return {...d,items:[...d.items,{offerId:product.id,qty:1}]}}
    const d=previous||baseDraft(),found=d.items.find(i=>i.productId===product.id);return {...d,items:found?d.items.map(i=>i===found?{...i,qty:Number(i.qty)+1}:i):[...d.items,{productId:product.id,qty:1}]}
  })}
  async function readDocument(raw){
    workspace.begin();const sequence=++importSequence.current;setDraft(null);setExternal(null)
    try{
    const d=parseAgentDocument(raw)
    if(d.protocol===CATALOGUE_PROTOCOL)throw Error('這是價目目錄，請讓 Agent 加上數量整理成叫貨單，或取得對方報價')
    const activeContext=await getAgentContext(session);if(sequence!==importSequence.current)return;setContext(activeContext)
    if(await recoverImportedPurchase(d,sequence))return
    if([BUSINESS_PROTOCOL,QUOTE_PROTOCOL].includes(d?.protocol)){const result=await prepareExternalDocument(d,activeContext);if(sequence!==importSequence.current)return;setExternal({document:d,overrides:{},...result});setEditMappings(false);setDraft(result.draft);setKind(d.protocol===QUOTE_PROTOCOL?'purchase':d.intent)}
    else{if(d.protocol===RESTAURANT_AGENT_PROTOCOL||d.protocol===AGENT_PROTOCOL&&d.kind==='restaurant'){if(d.protocol===RESTAURANT_AGENT_PROTOCOL)assertRestaurantAgentShape(d);else assertOrdinaryRestaurantAgentDraft(d);if(d.storeId!==activeContext.storeId)throw Error('這份草稿屬於另一間店，沒有建立任何單據')}else validateAgentDraft(d,activeContext,Date.now(),true);setExternal(null);setDraft(d);setKind(d.kind)}
    setText('');setDone('');setError('')
    }catch(error){if(sequence===importSequence.current)throw error}
  }
  async function organize(){menuAgent.invalidate();setError('');setDone('');setDraft(null);setExternal(null);try{if(isAgentDocumentText(text))await readDocument(text);else{importSequence.current++;const d=draftFromText(text,context,kind);setExternal(null);setDraft(d);setKind(d.kind)}}catch(e){setError(e.message)}}
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
  if(restaurantAgent){preview=null;try{if(menuAgent.result)preview=selected?reviewedRestaurantAgentDraft(draft,context,menuAgent.result,Date.now(),true):reviewedOrdinaryRestaurantDraft(draft,context,menuAgent.result,Date.now(),true)}catch(e){issue=e.message}if(menuAgent.error)issue=menuAgent.error;if(preview&&!preview.availability.available)issue='原料可用量不足，請調整餐點。'}
  const choices=kind==='restaurant'&&context?.restaurantMenu?context.restaurantMenu.offers.map(offer=>({id:offer.id,name:offer.name,price:offer.variants.find(row=>row.id===offer.defaultVariantId).price,unit:tr('份')})):context?.products
  const matching=choices?.filter(p=>[p.name,p.barcode,p.sku].some(value=>String(value||'').normalize('NFKC').toLowerCase().includes(query.trim().normalize('NFKC').toLowerCase())))||[]
  function focusProducts(){const source=document.querySelector('[data-quick-source]');if(source)source.open=true;const list=document.querySelector('[data-quick-products]');if(list)list.open=true;const input=list?.querySelector('input[type="search"]');input?.scrollIntoView?.({block:'center'});input?.focus()}
  async function retry(){
    if(running.current)return;running.current=true;setBusy(true);setError('')
    const sequence=importSequence.current
    try{const result=await store.retryFinancial();if(sequence===importSequence.current&&result?.receipt?.id==='agent-'+draft.id)finish(draft.kind)}catch(e){if(sequence===importSequence.current)setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function refreshRestaurant(){
    setError('');if(!external){menuAgent.refresh();return}
    if(running.current||financialPending)return;running.current=true;setBusy(true);const sequence=importSequence.current
    try{const fresh=await getAgentContext(session),normalized=await prepareExternalDocument(external.document,fresh,external.overrides);if(sequence!==importSequence.current)return;if(!normalized.draft||normalized.draft.id!==draft.id||canonicalSignature(normalized.draft.items)!==canonicalSignature(draft.items))throw Error('外部單據明細有變更，請重新核對來源單據');setContext(fresh);menuAgent.refresh()}catch(e){if(sequence===importSequence.current)setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function build(){
    if(running.current||financialPending||menuAgent.busy||workspace.blocked)return;running.current=true;setBusy(true);setError('')
    const sequence=importSequence.current
    try{
      if(await recoverImportedPurchase(external?.document||draft,sequence))return
      const fresh=await getAgentContext(session)
      const authority=await loadPrivateDraftContext(session);if(sequence!==importSequence.current)return;workspace.assertScope(authority)
      if(fresh.storeId!==authority.storeId)throw Error('店面或帳號已變更，請保留原輸入核對。')
      if(external){const normalized=await prepareExternalDocument(external.document,fresh,external.overrides);if(sequence!==importSequence.current)return;if(!normalized.draft||canonicalSignature(normalized.draft.items)!==canonicalSignature(draft.items)||normalized.draft.id!==draft.id)throw Error('外部單據明細有變更，請重新核對來源單據');if(remember&&session.role==='owner'){const r=await rememberAgentMappings({senderId:normalized.senderId,entries:normalized.chosen,draftContext:authority},session);if(sequence!==importSequence.current)return;if(r?.success!==true)throw Error('品項對照尚未保存，請重試');fresh.mappings=r.mappings}}
      const verified=restaurantAgent?(selected?reviewedRestaurantAgentDraft(draft,fresh,menuAgent.result):reviewedOrdinaryRestaurantDraft(draft,fresh,menuAgent.result)):validateExternalDraft(draft,fresh,external?.document),command=agentCommand(verified)
      if(external?.document.protocol===QUOTE_PROTOCOL)command.input.sourceQuote=quotePurchaseSource(external.document,external.chosen)
      if(command.kind==='sale'){store.stageQuickSale(command.items);clearCache();return}
      let result
      if(command.kind==='restaurant'){
        workspace.assertScope(selected?command.input.menuReview.quote.scope:command.input.ordinaryReview.scope)
        result=await store.commitRestaurant({...command.input,draftContext:authority},command.identity,pending=>workspace.remember(pending.request))
      }else result=await store.commitInventory(command.kind,{...command.input,draftContext:authority},command.identity,pending=>workspace.remember(pending.request))
      if(sequence===importSequence.current){finish(draft.kind,false,result?.purchase);setContext(fresh)}
    }catch(e){if(sequence===importSequence.current){setError(e.message);try{if(!readPendingFinancial()){workspace.uncommitted();if(restaurantAgent)menuAgent.invalidate()}}catch{}}}finally{running.current=false;setBusy(false)}
  }
  async function exportPacket(){try{const sequence=importSequence.current,c=await getAgentContext(session);if(sequence!==importSequence.current)return;setContext(c);setPacket(JSON.stringify(projectAgentContext(c,kind),null,2))}catch(e){setError(e.message)}}
  async function prepareHandoff(){try{setError('');const sequence=importSequence.current,c=await getAgentContext(session);if(sequence!==importSequence.current)return;const text=JSON.stringify(makeAgentHandoff(c,kind),null,2);setContext(c);setHandoff(text);setManualCopy(false);try{await navigator.clipboard.writeText(text);setCopyMessage('已複製。貼給你的 Agent，再把它回覆的單據貼回上方。')}catch{setManualCopy(true);setCopyMessage('資料已準備好。選取下方內容並複製給你的 Agent。')}}catch(e){setError(e.message)}}
  return <div className="quick-flow" style={{flex:1,overflowY:'auto',padding:16,fontSize:18}}><div style={{maxWidth:800,margin:'0 auto',paddingBottom:40}}>
    <h2 className="page-title" style={{fontSize:26}}>{tr("快速建單")}</h2><p>{tr("說要什麼，或點商品。看一下，就能建好。")}</p>
    <ol className="quick-progress" aria-label={tr("建單步驟")}>{['準備內容','核對這張單','完成'].map((label,index)=><li key={label} aria-current={(done?2:draft||external?1:0)===index?'step':undefined}><span>{index+1}</span>{tr(label)}</li>)}</ol>
    <WorkspaceDraftNotice draft={workspace}/>
    {!hasContent&&!done&&workspace.ready&&<LegacyQuickDraft context={workspace.scope?.context} session={session} blocked={working||financialPending} onResume={async saved=>{const authority=await loadPrivateDraftContext(session);workspace.assertScope(authority);await workspace.adopt(saved)}}/>}
    {hasContent&&workspace.ready&&<button className="btn btn-ghost" style={button} disabled={busy||financialPending} onClick={discard}>{tr("放棄這張草稿")}</button>}
    {done&&<div ref={statusRef} role="status" className="card quick-success" data-quick-done style={{padding:16,marginTop:12}}><strong>{trMessage(done)}</strong>{donePurchase&&<p data-quick-original-purchase style={{overflowWrap:'anywhere'}}>{donePurchase.supplierName} · {money(donePurchase.total)}</p>}<div><button className="btn btn-primary" style={button} disabled={busy} onClick={()=>donePurchase?.id&&store.openPurchaseDocument?store.openPurchaseDocument(donePurchase.id):store.setView(kind==='purchase'?'purchase':'restaurant')}>{tr("查看單據")}</button><button className="btn btn-ghost" style={button} disabled={busy} onClick={()=>{takeControl();setDone('');focusProducts()}}>{tr("再開一張")}</button></div></div>}
    {otherPending&&<p role="status" className="quick-question">{tr("還有一張單的結果需要確認，請先使用上方的原編號重試。")}</p>}
    <fieldset disabled={working||otherPending||workspace.blocked&&!pending} style={{border:0,padding:0,minWidth:0}}>
    {!context?<p role="status">{tr("正在讀取店內品項…")}</p>:<>
    <details className="quick-source" data-quick-source hidden={!!done} open={!draft&&!external&&!done}><summary hidden={!draft&&!external}>{tr("修改建單來源")}</summary>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'16px 0'}}>{Object.entries(labels).filter(([k])=>k!=='purchase'||session.role==='owner').map(([k,label])=><button key={k} data-quick-kind={k} disabled={pending} style={button} className={'btn '+(kind===k?'btn-primary':'btn-ghost')} aria-pressed={kind===k} onClick={()=>{takeControl();setKind(k);setDraft(null);setExternal(null);setDone('');setError('')}}>{tr(label)}</button>)}</div>
      <section className="quick-agent-entry" aria-label={tr("交給 Agent")}><button className="btn btn-primary" style={{...button,width:'100%'}} data-quick-handoff disabled={pending} onClick={prepareHandoff}>{tr("複製建單資料給 Agent")}</button>{copyMessage&&<p role="status">{trMessage(copyMessage)}</p>}{handoff&&<details open={manualCopy}><summary style={{padding:'12px 0'}}>{tr("需要手動複製時，展開這裡")}</summary><textarea aria-label={tr("給 Agent 的建單資料")} className="field" readOnly style={{...field,minHeight:150}} value={handoff} onFocus={e=>e.target.select()}/></details>}</section>
      <fieldset disabled={pending} className="quick-fields">
      <label>{tr("你要開什麼單？")}<textarea data-quick-input aria-label={tr("建單內容")} className="field" style={{...field,minHeight:110}} maxLength={32768} value={text} onPaste={pasteReply} onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();readFile(e.dataTransfer.files[0])}}} onDragOver={e=>e.preventDefault()} onChange={e=>{takeControl();setText(e.target.value);setDraft(null);setExternal(null);setDone('');setError('')}} placeholder={tr("{0} 2，{1} 1；也可以貼上 Agent 的完整回覆", {0: context.products[0]?.name||'牛丼', 1: context.products[1]?.name||'紅茶'})}/></label>
      <p className="quick-hint">{tr("貼上 Agent 回覆會直接整理成下方的單據，確認前不會送出。")}</p>
      <input ref={fileRef} data-quick-file type="file" accept=".json,application/json" aria-label={tr("公司單據檔案")} style={{display:'none'}} onChange={e=>{readFile(e.target.files?.[0]);e.target.value=''}}/>
      <button className="btn btn-ghost" style={{...button,width:'100%',marginTop:12}} onClick={()=>fileRef.current?.click()}>{tr("匯入公司單據")}</button>
      <button className="btn btn-primary" style={{...button,width:'100%',margin:'12px 0'}} data-quick-organize onClick={organize} disabled={!text.trim()}>{tr("幫我整理")}</button>
      {!external&&<details data-quick-products open={!draft}><summary style={{padding:'12px 0',cursor:'pointer'}}>{tr("直接點商品也可以")}</summary><input aria-label={tr("找建單商品")} className="field" type="search" style={{...field,marginBottom:12}} placeholder={tr("找商品名稱或條碼")} value={query} onChange={e=>setQuery(e.target.value)}/><div className="quick-product-grid">{matching.slice(0,24).map(p=><button key={p.id} className="btn btn-ghost" style={{...button,textAlign:'left',whiteSpace:'normal'}} onClick={()=>choose(p)}>{p.name}<br/>{money(kind==='purchase'?p.unitCost||0:p.price)}／{p.unit}</button>)}</div>{!matching.length&&<p role="status">{tr("找不到這個商品。試試其他名稱或條碼。")}</p>}{matching.length>24&&<p className="quick-hint">{tr("先顯示前 24 項。輸入品名或條碼就能找到其他商品。")}</p>}</details>}
      </fieldset>
    </details>
      {external&&<div className="card" style={{padding:16,marginTop:12}}><strong>{tr("來自 ")}{external.document.sender.name||external.senderId}{tr(" 的單據")}</strong><p>{external.document.id}</p>{external.document.items.map((row,index)=>{const key=row.sku?'sku:'+row.sku:row.barcode?'barcode:'+row.barcode:'name:'+row.name,name=row.name||row.sku||row.barcode,p=context.products.find(p=>p.id===external.chosen[key]);return editMappings||external.unresolved.some(r=>r.index===index)?<label key={key} style={{display:'block',marginTop:12}}>「{name}{tr("」是店內哪個商品？")}<select className="field" style={field} aria-label={tr("對照 {0}", {0: name})} value={external.overrides[key]||external.chosen[key]||''} onChange={e=>mapItem(key,e.target.value)}><option value="">{tr("請選商品")}</option>{context.products.map(p=><option key={p.id} value={p.id}>{p.name}（{p.unit}）</option>)}</select></label>:<p key={key}>{name} → {p?.name} · {row.qty} {row.unit}</p>})}{!external.unresolved.length&&<button className="btn btn-ghost" style={button} onClick={()=>setEditMappings(v=>!v)}>{editMappings?tr("完成對照"):tr("調整品項對照")}</button>}{session.role==='owner'&&<label style={{display:'flex',gap:10,alignItems:'center',marginTop:12}}><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>{tr("記住這家公司的品項對照")}</label>}</div>}

      {external?.document.protocol===QUOTE_PROTOCOL&&<p className="card" style={{padding:16}}>{tr('專屬報價：第 {0} 版',{0:external.document.revision})}<br/>{tr('有效至 {0}',{0:new Date(external.document.validUntil).toLocaleString()})}<br/>{tr('本單單價已含全部費用。確認只建立採購，尚未收貨或付款。')}</p>}
      {draft&&<QuickDocumentReview draft={draft} context={context} preview={preview} issue={issue} question={question} external={!!external} quoted={external?.document.protocol===QUOTE_PROTOCOL} busy={working} reviewing={menuAgent.busy} pending={pending} sectionRef={previewRef} onChange={update} onBuild={build} onRetry={retry} onProducts={focusProducts} onSuppliers={()=>store.setView('purchase')} onMenuRefresh={refreshRestaurant}/>}

      <details data-quick-advanced style={{marginTop:24}}><summary style={{cursor:'pointer',padding:'12px 0'}}>{tr("開發者與進階設定")}</summary><a href="./llms.txt" target="_blank" rel="noreferrer">{tr("建單指南")}</a> · <a href="./agent/manifest.json" target="_blank" rel="noreferrer">{tr("協議")}</a><button className="btn btn-ghost" style={{...button,display:'block',marginTop:12}} data-quick-packet onClick={exportPacket}>{tr("取得店內資料包")}</button>{packet&&<textarea data-quick-packet-result aria-label={tr("Agent 店內資料包")} readOnly className="field" style={{...field,minHeight:140}} value={packet} onFocus={e=>e.target.select()}/>}</details>
    </>}
    </fieldset>
    {error&&<p role="alert" style={{color:'var(--red)',padding:12}}>{trMessage(error)}{store.cart.length>0&&<button className="btn btn-ghost" style={button} onClick={()=>store.setView('pos')}>{tr("回收銀台查看原購物車")}</button>}</p>}
  </div></div>
}
