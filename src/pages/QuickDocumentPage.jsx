import {useEffect,useRef,useState} from 'react'
import {getAgentContext,rememberAgentMappings} from '../utils/dataAccess'
import {AGENT_PROTOCOL,draftFromText,validateAgentDraft,agentCommand,agentBusinessDay} from '../../electron/agentDraftRules.mjs'
import {BUSINESS_PROTOCOL,prepareBusinessDocument} from '../../electron/businessDocument.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'

const button={minHeight:48,fontSize:18},field={minHeight:48,fontSize:18,width:'100%'}
const labels={sale:'賣東西',restaurant:'預訂餐點',purchase:'叫貨進貨'}
const money=n=>'NT$ '+n.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
export default function QuickDocumentPage({store,session,incoming=''}){
  const [context,setContext]=useState(null),[text,setText]=useState(incoming),[kind,setKind]=useState('sale'),[draft,setDraft]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(''),[packet,setPacket]=useState('')
  const running=useRef(false)
  const imported=useRef('')
  const fileRef=useRef(null),previewRef=useRef(null)
  const [external,setExternal]=useState(null),[remember,setRemember]=useState(session.role==='owner')
  const [editMappings,setEditMappings]=useState(false)
  const statusRef=useRef(null)
  useEffect(()=>{if(done)statusRef.current?.scrollIntoView?.({block:'nearest'})},[done])
  useEffect(()=>{let cancelled=false;getAgentContext(session).then(c=>{if(!cancelled)setContext(c)}).catch(e=>setError(e.message));return()=>{cancelled=true}},[session.userId])
  useEffect(()=>{if(incoming){setText(incoming);setDraft(null);setDone('')}},[incoming])
  useEffect(()=>{if(incoming&&context&&imported.current!==incoming){imported.current=incoming;readDocument(incoming).catch(e=>setError(e.message))}},[incoming,context])
  useEffect(()=>{if(draft)previewRef.current?.scrollIntoView?.({block:'nearest'})},[draft?.id])
  useEffect(()=>{
    const committed=e=>{if(draft&&e.detail?.receipt?.id==='agent-'+draft.id){running.current=false;setBusy(false);setError('');setDone(draft.kind==='purchase'?'採購單已建立':'預訂已建立，尚未收款');setDraft(null);setExternal(null);setText('')}}
    window.addEventListener('pos-inventory-operation',committed);window.addEventListener('pos-restaurant-operation',committed)
    return()=>{window.removeEventListener('pos-inventory-operation',committed);window.removeEventListener('pos-restaurant-operation',committed)}
  },[draft])
  useEffect(()=>{const refresh=()=>getAgentContext(session).then(setContext).catch(e=>setError(e.message));window.addEventListener('pos-data-refreshed',refresh);return()=>window.removeEventListener('pos-data-refreshed',refresh)},[session.userId])
  function update(key,value){setDraft(d=>({...d,[key]:value}));setError('')}
  function baseDraft(){return {protocol:AGENT_PROTOCOL,id:crypto.randomUUID(),issuedAt:new Date().toISOString(),storeId:context.storeId,catalogueRevision:context.catalogueRevision,kind,items:[],note:'',...(kind==='purchase'?{supplierId:'',date:agentBusinessDay(context)}:{}),...(kind==='restaurant'?{channel:'preorder',day:agentBusinessDay(context),slot:'',customer:'',contact:''}:{})}}
  function choose(product){setError('');setDone('');setDraft(previous=>{const d=previous||baseDraft(),found=d.items.find(i=>i.productId===product.id);return {...d,items:found?d.items.map(i=>i===found?{...i,qty:Number(i.qty)+1}:i):[...d.items,{productId:product.id,qty:1}]}})}
  async function readDocument(raw){
    if(raw.length>32768)throw Error('單據太大，請分批匯入（每次最多 32 KB）')
    const d=JSON.parse(raw)
    if(d?.protocol===BUSINESS_PROTOCOL){const result=await prepareBusinessDocument(d,context);setExternal({document:d,overrides:{},...result});setEditMappings(false);setDraft(result.draft);setKind(d.intent)}
    else{validateAgentDraft(d,context,Date.now(),true);setExternal(null);setDraft(d);setKind(d.kind)}
    setText('');setDone('');setError('')
  }
  async function organize(){setError('');setDone('');try{if(text.trim().startsWith('{'))await readDocument(text);else{const d=draftFromText(text,context,kind);setExternal(null);setDraft(d);setKind(d.kind)}}catch(e){setError(e.message)}}
  async function mapItem(key,productId){try{const overrides={...external.overrides,[key]:productId},result=await prepareBusinessDocument(external.document,context,overrides);setExternal({...external,overrides,...result});setDraft(result.draft);setError('')}catch(e){setDraft(null);setError(e.message)}}
  async function readFile(file){if(!file)return;try{if(file.size>32768)throw Error('單據太大，請分批匯入（每次最多 32 KB）');await readDocument(await file.text())}catch(e){setError(e.message)}}
  let preview=null,issue=''
  if(draft&&context)try{preview=validateAgentDraft(draft,context)}catch(e){issue=e.message}
  async function build(){
    if(running.current)return;running.current=true;setBusy(true);setError('')
    try{
      const fresh=await getAgentContext(session)
      if(external){const normalized=await prepareBusinessDocument(external.document,fresh,external.overrides);if(!normalized.draft||canonicalSignature(normalized.draft.items)!==canonicalSignature(draft.items))throw Error('外部單據明細有變更，請重新核對來源單據');if(remember&&session.role==='owner'){const r=await rememberAgentMappings({senderId:normalized.senderId,entries:normalized.chosen},session);if(r?.success!==true)throw Error('品項對照尚未保存，請重試');fresh.mappings=r.mappings}}
      const verified=validateAgentDraft(draft,fresh),command=agentCommand(verified)
      if(command.kind==='sale'){store.stageQuickSale(command.items);return}
      if(command.kind==='restaurant')await store.commitRestaurant(command.input,command.identity)
      else await store.commitInventory(command.kind,command.input,command.identity)
      setDone(command.kind==='restaurant'?'預訂已建立，尚未收款':'採購單已建立');setDraft(null);setExternal(null);setText('');setContext(fresh)
    }catch(e){setError(e.message)}finally{running.current=false;setBusy(false)}
  }
  async function exportPacket(){try{const c=await getAgentContext(session);setContext(c);setPacket(JSON.stringify(c,null,2))}catch(e){setError(e.message)}}
  return <div style={{flex:1,overflowY:'auto',padding:16,fontSize:18}}><div style={{maxWidth:800,margin:'0 auto',paddingBottom:40}}>
    <h2 style={{fontSize:26}}>快速建單</h2><p>說要什麼，或點商品。看一下，就能建好。</p>
    {done&&<div ref={statusRef} role="status" className="card" style={{padding:16,marginTop:12}}><strong>{done}</strong><button className="btn btn-primary" style={{...button,display:'block',marginTop:12}} onClick={()=>store.setView(kind==='purchase'?'purchase':'restaurant')}>查看單據</button></div>}
    <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'16px 0'}}>{Object.entries(labels).filter(([k])=>k!=='purchase'||session.role==='owner').map(([k,label])=><button key={k} style={button} className={'btn '+(kind===k?'btn-primary':'btn-ghost')} aria-pressed={kind===k} onClick={()=>{setKind(k);setDraft(null);setExternal(null);setDone('');setError('')}}>{label}</button>)}</div>
    {!context?<p role="status">正在讀取店內品項…</p>:<>
      <label>你要開什麼單？<textarea aria-label="建單內容" className="field" style={{...field,minHeight:110}} maxLength={32768} value={text} onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();readFile(e.dataTransfer.files[0])}}} onDragOver={e=>e.preventDefault()} onChange={e=>{setText(e.target.value);setDone('')}} placeholder={`${context.products[0]?.name||'牛丼'} 2，${context.products[1]?.name||'紅茶'} 1；也可以貼上 Agent 草稿`}/></label>
      <input ref={fileRef} type="file" accept=".json,application/json" aria-label="公司單據檔案" style={{display:'none'}} onChange={e=>{readFile(e.target.files?.[0]);e.target.value=''}}/>
      <button className="btn btn-ghost" style={{...button,width:'100%',marginTop:12}} onClick={()=>fileRef.current?.click()}>匯入公司單據</button>
      <button className="btn btn-primary" style={{...button,width:'100%',margin:'12px 0'}} onClick={organize} disabled={!text.trim()}>幫我整理</button>
      {!external&&<details open={!draft}><summary style={{padding:'12px 0',cursor:'pointer'}}>直接點商品也可以</summary><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8}}>{context.products.map(p=><button key={p.id} className="btn btn-ghost" style={{...button,textAlign:'left',whiteSpace:'normal'}} onClick={()=>choose(p)}>{p.name}<br/>{money(kind==='purchase'?p.unitCost||0:p.price)}</button>)}</div></details>}
      {external&&<div className="card" style={{padding:16,marginTop:12}}><strong>來自 {external.document.sender.name||external.senderId} 的單據</strong><p>{external.document.id}</p>{external.document.items.map((row,index)=>{const key=row.sku?'sku:'+row.sku:row.barcode?'barcode:'+row.barcode:'name:'+row.name,name=row.name||row.sku||row.barcode,p=context.products.find(p=>p.id===external.chosen[key]);return editMappings||external.unresolved.some(r=>r.index===index)?<label key={key} style={{display:'block',marginTop:12}}>「{name}」是店內哪個商品？<select className="field" style={field} aria-label={'對照 '+name} value={external.overrides[key]||external.chosen[key]||''} onChange={e=>mapItem(key,e.target.value)}><option value="">請選商品</option>{context.products.map(p=><option key={p.id} value={p.id}>{p.name}（{p.unit}）</option>)}</select></label>:<p key={key}>{name} → {p?.name} · {row.qty} {row.unit}</p>})}{!external.unresolved.length&&<button className="btn btn-ghost" style={button} onClick={()=>setEditMappings(v=>!v)}>{editMappings?'完成對照':'調整品項對照'}</button>}{session.role==='owner'&&<label style={{display:'flex',gap:10,alignItems:'center',marginTop:12}}><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>記住這家公司的品項對照</label>}</div>}
      {draft&&<section ref={previewRef} aria-label="單據草稿" className="card" style={{padding:16,marginTop:16}}><h3>看一下這張單</h3><p>{labels[draft.kind]||'未支援的單據'}</p>
        {Array.isArray(draft.items)&&draft.items.map((item,index)=>{const p=context.products.find(p=>p.id===item?.productId);return <div key={index} style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',margin:'12px 0'}}><span style={{flex:1,minWidth:100}}>{p?.name||'找不到此品項'}</span><label>數量<input aria-label={'數量 '+(p?.name||index)} className="field" type="number" disabled={!!external} min={draft.kind==='purchase'?'.001':'1'} step={draft.kind==='purchase'?'.001':'1'} style={{...field,width:100}} value={item?.qty??''} onChange={e=>update('items',draft.items.map((row,i)=>i===index?{...row,qty:Number(e.target.value)}:row))}/></label><button className="btn btn-ghost" style={button} disabled={!!external} onClick={()=>update('items',draft.items.filter((_,i)=>i!==index))} aria-label={'移除 '+(p?.name||index)}>移除</button></div>})}
        {draft.kind==='purchase'&&<><label>向誰叫貨？<select aria-label="叫貨供應商" className="field" style={field} value={draft.supplierId||''} onChange={e=>update('supplierId',e.target.value)}><option value="">請選供應商</option>{context.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>叫貨日期<input aria-label="快速採購日期" className="field" type="date" style={field} value={draft.date||''} onChange={e=>update('date',e.target.value)}/></label></>}
        {draft.kind==='restaurant'&&<><label>怎麼交給客人？<select aria-label="交付方式" className="field" style={field} value={draft.channel||'preorder'} onChange={e=>update('channel',e.target.value)}><option value="preorder">預訂自取</option><option value="walkin">現場</option><option value="delivery">外送</option></select></label><label>取餐日期<input aria-label="快速取餐日期" className="field" type="date" style={field} value={draft.day||''} onChange={e=>update('day',e.target.value)}/></label><label>取餐時間<input aria-label="快速取餐時間" className="field" type="time" step="900" style={field} value={draft.slot||''} onChange={e=>update('slot',e.target.value)}/></label><label>怎麼稱呼客人？<input aria-label="快速客人稱呼" className="field" style={field} maxLength={100} value={draft.customer||''} onChange={e=>update('customer',e.target.value)}/></label><label>聯絡電話或方式<input aria-label="快速聯絡方式" className="field" style={field} maxLength={100} value={draft.contact||''} onChange={e=>update('contact',e.target.value)}/></label></>}
        <label>{draft.channel==='delivery'?'地址與備註':'備註'}<textarea aria-label="快速單據備註" className="field" style={field} maxLength={1000} value={draft.note||''} onChange={e=>update('note',e.target.value)}/></label>
        {preview&&<p style={{fontSize:24,fontWeight:700}}>合計 {money(preview.total)}</p>}
        {issue&&<p role="status">{issue}</p>}
        <button className="btn btn-primary" style={{...button,width:'100%',marginTop:12}} disabled={!preview||busy} onClick={build}>{busy?'正在建單…':draft.kind==='sale'?'帶入收銀台':draft.kind==='restaurant'?'確認建立預訂':'確認建立採購'}</button>
        <p style={{fontSize:16}}>{draft.kind==='sale'?'帶入後再確認收款。':draft.kind==='restaurant'?'建單會預留庫存；尚未收款。':'建單後再確認收貨與付款。'}</p>
      </section>}
      <details style={{marginTop:24}}><summary style={{cursor:'pointer',padding:'12px 0'}}>讓我的 Agent 幫忙</summary><p>讓 Agent 讀取建單指南和店內資料包，再把草稿貼回上方。</p><a href="./llms.txt" target="_blank" rel="noreferrer">建單指南</a> · <a href="./agent/manifest.json" target="_blank" rel="noreferrer">協議</a><button className="btn btn-ghost" style={{...button,display:'block',marginTop:12}} onClick={exportPacket}>取得店內資料包</button>{packet&&<textarea aria-label="Agent 店內資料包" readOnly className="field" style={{...field,minHeight:140}} value={packet} onFocus={e=>e.target.select()}/>}</details>
    </>}
    {error&&<p role="alert" style={{color:'var(--red)',padding:12}}>{error}{store.cart.length>0&&<button className="btn btn-ghost" style={button} onClick={()=>store.setView('pos')}>回收銀台查看原購物車</button>}</p>}
  </div></div>
}
