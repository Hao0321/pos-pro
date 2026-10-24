import {tr,trMessage,getLocale} from "../i18n"
import { useState, useEffect, useRef, useId } from 'react'
import { Clock, Plus, Minus, LogIn, LogOut, FileText, AlertCircle } from 'lucide-react'
import { loadShifts, loadCashLog } from '../utils/dataAccess'
import { summarizeShift } from '../../electron/shiftReconciliation.mjs'
import useVisibleViewport from '../hooks/useVisibleViewport'
import CashCountInput,{cashText,CashCountSummary} from '../components/CashCountInput'
import {emptyCashCount,countedCash,countedDifference} from '../utils/cashCount.mjs'
import {readinessTaskFor} from '../utils/openingGuide.mjs'
import useShiftCountDraft from '../hooks/useShiftCountDraft'
import ShiftCountDraftNotice,{ShiftCountDraftOptions} from '../components/ShiftCountDraftNotice'
import useCashMovementDraft from '../hooks/useCashMovementDraft'
import CashMovementDraftNotice from '../components/CashMovementDraftNotice'

export default function ShiftPage({ store, session }) {
  const { openShift, startShift, endShift, logCash, orders,topups } = store
  const [shifts, setShifts] = useState([])
  const [cashLog, setCashLog] = useState([])
  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showCash, setShowCash] = useState(false)
  const [openingCash, setOpeningCash] = useState(emptyCashCount)
  const [closingCash, setClosingCash] = useState(emptyCashCount)
  const [closeTarget,setCloseTarget] = useState(null)
  const [closeNote, setCloseNote] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [cashType, setCashType] = useState('in')
  const [cashReason, setCashReason] = useState('')
  const [loading,setLoading]=useState(true)
  const [loadError,setLoadError]=useState('')
  const [countBook,setCountBook]=useState(null)
  const [saving,setSaving]=useState(false),[actionError,setActionError]=useState(''),[actionMessage,setActionMessage]=useState('')
  const actionBusy=useRef(false)
  const loadSequence=useRef(0),hasLoaded=useRef(false),pageLive=useRef(true),pageActor=useRef('');pageActor.current=session.userId+':'+session.role
  const guideSeen=useRef(null),openedGuide=useRef(null),openingTask=readinessTaskFor(store.readinessTask,session,'shifts')?store.readinessTask:null
  const countDraft=useShiftCountDraft({session,onFacts:setCountBook,activeKind:showOpen?'open':showClose?'close':null,openingCash,closingCash,closeNote,onResume:value=>{setActionError('');setShowOpen(value.kind==='open');setShowClose(value.kind==='close');if(value.kind==='open')setOpeningCash(value.cash);else{setClosingCash(value.cash);setCloseNote(value.note);setCloseTarget(value.target)}},onReset:()=>{setShowOpen(false);setShowClose(false);setOpeningCash(emptyCashCount());setClosingCash(emptyCashCount());setCloseNote('');setCloseTarget(null)},onSaved:async(kind,row,metadata)=>{const origin=openedGuide.current;await store.reloadOpenShift?.();if(!metadata.isCurrent())return;setShowOpen(false);setShowClose(false);setOpeningCash(emptyCashCount());setClosingCash(emptyCashCount());setCloseNote('');setCloseTarget(null);setCountBook(null);setActionMessage(kind==='open'?'開班已保存。':`交班已保存。預期現金 NT$ ${row.expectedCash.toLocaleString()}；實際現金 NT$ ${row.closeCash.toLocaleString()}；差額 NT$ ${row.diff.toLocaleString()}。`);await reload();if(metadata.isCurrent()&&kind==='open'&&origin)store.finishReadinessTask?.(origin.id)}})
  const cashDraft=useCashMovementDraft({session,active:showCash,type:cashType,amount:cashAmount,reason:cashReason,onResume:value=>{setShowCash(true);setCashType(value.type);setCashAmount(value.amount);setCashReason(value.reason)},onReset:()=>{setShowCash(false);setCashAmount('');setCashReason('');setCashType('in')},onSaved:async(_row,metadata)=>{await store.reloadOpenShift?.();if(!metadata.isCurrent())return;setShowCash(false);setCashAmount('');setCashReason('');setCashType('in');setActionMessage('現金流水已保存。');await reload()}})

  useEffect(()=>{pageLive.current=true;return()=>{pageLive.current=false;loadSequence.current++}},[])
  useEffect(() => { reload() }, [openShift?.id,session.userId,session.role])
  useEffect(()=>{setOpeningCash(emptyCashCount());setClosingCash(emptyCashCount());setCloseTarget(null);setShowOpen(false);setShowClose(false);setCountBook(null);setActionMessage('');setActionError('');guideSeen.current=null;openedGuide.current=null},[session?.userId,session?.role])
  useEffect(()=>{setShowCash(false);setCashAmount('');setCashReason('');setCashType('in')},[session.userId,session.role])
  useEffect(()=>{const handler=()=>reload();window.addEventListener('pos-cash-operation',handler);window.addEventListener('pos-data-refreshed',handler);return()=>{window.removeEventListener('pos-cash-operation',handler);window.removeEventListener('pos-data-refreshed',handler)}},[openShift?.id])
  useEffect(()=>{if(!loading&&!loadError&&!showOpen&&!countDraft.blocked&&openingTask?.kind==='open-shift'&&!openShift&&guideSeen.current!==openingTask.id){guideSeen.current=openingTask.id;openedGuide.current=openingTask;runAction(()=>countDraft.start('open'))}},[loading,loadError,openingTask?.id,openShift?.id,showOpen,countDraft.blocked])

  async function reload() {
    const ticket=++loadSequence.current,who=pageActor.current,current=()=>pageLive.current&&ticket===loadSequence.current&&who===pageActor.current
    setLoading(true);setLoadError('')
    try{
      const [s,c]=await Promise.all([loadShifts(),loadCashLog(openShift?.id)])
      if(!Array.isArray(s)||!Array.isArray(c))throw Error('班別／現金流水回覆不完整')
      if(!current())return;hasLoaded.current=true;setShifts(s);setCashLog(c.filter(x=>!openShift||x.shiftId===openShift.id))
    }catch(e){if(current())setLoadError(e.message)}finally{if(current())setLoading(false)}
  }

  // 即時統計這班
  const shiftStats = (() => {
    if (!openShift) return null
    try { return summarizeShift(openShift, orders, cashLog,topups) }
    catch(error) { return {error:error.message} }
  })()
  const closingStats=(()=>{if(!showClose||!countBook)return shiftStats;try{return summarizeShift(countBook.shifts.find(row=>row.id===closeTarget),countBook.orders,countBook.cashLog,countBook.topups)}catch(error){return {error:error.message}}})()
  const openingTotal=countedCash(openingCash),closingTotal=countedCash(closingCash),closeDifference=countedDifference(closingCash,closingStats?.expected)
  const sameClosingShift=!!openShift&&closeTarget===openShift.id

  if(loading&&!hasLoaded.current)return <div role="status" style={{padding:24}}>{tr("讀取班別與現金流水…")}</div>
  if(!hasLoaded.current&&(loadError||shiftStats?.error))return <div role="alert" style={{padding:24}}><h2 className="page-title">{tr("交班紀錄需要核對")}</h2><p>{loadError||shiftStats.error}</p><button className="btn" onClick={reload}>{tr("重新讀取")}</button></div>

  async function handleOpen() {
    await runAction(async()=>{
      if(countDraft.pending&&!countDraft.retryAllowed){await countDraft.lookup();return}
      if(!openingTotal.valid)throw Error('請先數好現金，再確認開班。')
      const draft=await countDraft.prepare('open');if(draft.alreadySaved)return
      let result;try{result=await startShift(draft.cashier,draft.amount,session?.id||'',draft)}catch(error){if(error.shiftDraftRejected)await countDraft.rejected();throw error}
      if(result?.id!==draft.id||result.openCash!==draft.amount)throw Error('開班保存尚未確認，請核對原班別。')
      await countDraft.confirm()
    })
  }

  async function handleClose() {
    await runAction(async()=>{
      if(countDraft.pending&&!countDraft.retryAllowed){await countDraft.lookup();return}
      if(!sameClosingShift)throw Error('這一班已變更，請關閉後重新點算。')
      if(!closingTotal.valid||closeDifference===null)throw Error('請先點算並填寫實際現金。')
      const draft=await countDraft.prepare('close');if(draft.alreadySaved)return
      const cash=draft.amount;let r;try{r=await endShift(cash,draft.note,draft)}catch(error){if(error.shiftDraftRejected)await countDraft.rejected();throw error}
      if(r?.success!==true||!Number.isFinite(r.expected)||!Number.isFinite(r.diff))throw Error('交班保存尚未確認，請核對原班別。')
      await countDraft.confirm()
    })
  }

  async function handleCash() {
    await runAction(async()=>{
      if(cashDraft.pending&&!cashDraft.retryAllowed){await cashDraft.lookup();return}
      const draft=await cashDraft.prepare();if(draft.alreadySaved)return
      const input=draft.request
      try{await logCash(input.type,input.amount,input.reason,input.cashier,draft)}catch(error){if(error.cashDraftRejected)await cashDraft.rejected();throw error}
      await cashDraft.confirm()
    })
  }
  async function runAction(work){if(actionBusy.current)return;actionBusy.current=true;setSaving(true);setActionError('');setActionMessage('');try{await work()}catch(e){setActionError(e.message||'保存尚未確認，請核對原紀錄。')}finally{actionBusy.current=false;setSaving(false)}}

  return (
    <div style={sh.root}>
      {!showOpen&&!showClose&&<ShiftCountDraftNotice draft={countDraft} busy={saving} run={runAction} error={actionError}/>}
      {actionError&&<p role="alert" style={{color:'var(--red)',marginBottom:12}}>{trMessage(actionError)}</p>}
      {(loadError||shiftStats?.error)&&<p role="alert">{trMessage(loadError||shiftStats.error)}</p>}
      {actionMessage&&<p role="status" style={{marginBottom:12}}>{trMessage(actionMessage)}</p>}
      <div style={sh.header}>
        <div>
          <h2 className="page-title" style={{fontSize:20, fontWeight:600}}>{tr("班別管理")}</h2>
          <div style={{fontSize:13, color:'var(--text-tertiary)', marginTop:4}}>{tr("開班 / 交班 / 現金流水")}</div>
        </div>
        {!openShift ? (
          <button className="btn btn-primary" data-shift-open disabled={saving||countDraft.blocked} onClick={()=>runAction(()=>countDraft.start('open'))} style={{display:'flex',alignItems:'center',gap:6,minHeight:48}}>
            <LogIn size={16}/>{tr(" 開班")}</button>
        ) : (
          <div style={{display:'flex', gap:8}}>
            <button className="btn btn-ghost" data-cash-movement-start disabled={saving||cashDraft.blocked} onClick={()=>runAction(()=>cashDraft.start(openShift.id))} style={{display:'flex',alignItems:'center',gap:6,minHeight:48}}>
              <Plus size={16}/>{tr(" 現金流水")}</button>
            <button className="btn btn-primary" data-shift-close disabled={saving||countDraft.blocked} onClick={()=>runAction(()=>countDraft.start('close',openShift.id))} style={{display:'flex',alignItems:'center',gap:6,minHeight:48}}>
              <LogOut size={16}/>{tr(" 交班")}</button>
          </div>
        )}
      </div>

      {!showCash&&<CashMovementDraftNotice draft={cashDraft} saving={saving} error={actionError} run={runAction}/>}

      {openShift ? (
        <div style={sh.card}>
          <div style={{display:'flex',justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
            <div>
              <div style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr("當班")}</div>
              <div style={{fontSize:18, fontWeight:600}}>{openShift.cashier}</div>
              <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:2}}>
                <Clock size={11} style={{verticalAlign:'middle', marginRight:4}}/>{tr("開班 ")}{new Date(openShift.openTime).toLocaleString(getLocale())}
              </div>
            </div>
            <span className="badge badge-green">{tr("營業中")}</span>
          </div>

          <div style={sh.kpiGrid}>
            <KPI label={tr("開班現金")} value={`NT$ ${(openShift.openCash||0).toLocaleString()}`}/>
            <KPI label={tr("現金銷售")} value={`NT$ ${(shiftStats?.cash||0).toLocaleString()}`} accent="green"/>
            <KPI label={tr("電子支付")} value={`NT$ ${(shiftStats?.card||0).toLocaleString()}`} accent="blue"/>
            <KPI label={tr("現金儲值收入")} value={`+NT$ ${(shiftStats?.cashTopups||0).toLocaleString()}`}/>
            <KPI label={tr("電子儲值收入")} value={`NT$ ${(shiftStats?.cardTopups||0).toLocaleString()}`}/>
            <KPI label={tr("現金進")} value={`+NT$ ${(shiftStats?.cashIn||0).toLocaleString()}`}/>
            <KPI label={tr("現金出")} value={`-NT$ ${(shiftStats?.cashOut||0).toLocaleString()}`}/>
            <KPI label={tr("退貨")} value={`${shiftStats?.refundCount||0} 筆 / NT$ ${(shiftStats?.refundAmt||0).toLocaleString()}`} accent="red"/>
            <KPI label={tr("訂單")} value={`${shiftStats?.orderCount||0} 筆`}/>
            <KPI label={tr("預期現金")} value={`NT$ ${(shiftStats?.expected||0).toLocaleString()}`} accent="gold"/>
          </div>

          {cashLog.length > 0 && (
            <>
              <div style={{fontWeight:600, fontSize:14, margin:'20px 0 10px'}}>{tr("現金流水")}</div>
              <div style={{overflowX:'auto'}}><table style={sh.table}>
                <thead>
                  <tr>
                    <th>{tr("時間")}</th><th>{tr("類型")}</th><th style={{textAlign:'right'}}>{tr("金額")}</th><th>{tr("說明")}</th>
                  </tr>
                </thead>
                <tbody>
                  {cashLog.map(c => (
                    <tr key={c.id}>
                      <td>{new Date(c.time).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})}</td>
                      <td>
                        <span className={`badge badge-${c.type==='in'?'green':'red'}`}>{c.type==='in'?tr("進"):tr("出")}</span>
                      </td>
                      <td style={{textAlign:'right', fontFamily:'var(--font-mono)', color: c.type==='in'?'var(--green)':'var(--red)', fontWeight:500}}>
                        {c.type==='in'?'+':'-'} NT$ {c.amount.toLocaleString()}
                      </td>
                      <td style={{color:'var(--text-secondary)'}}>{String(c.id).startsWith('customer-cash:')&&c.reason?.startsWith('客戶收付 ')?tr('客戶收付 {0}',{0:c.reason.slice(5)}):c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}
        </div>
      ) : (
        <div style={{...sh.card, textAlign:'center', padding:'40px 20px'}}>
          <AlertCircle size={32} color="var(--text-tertiary)" style={{margin:'0 auto 12px'}}/>
          <div style={{fontSize:15, fontWeight:500, marginBottom:6}}>{tr("目前未開班")}</div>
          <div style={{fontSize:13, color:'var(--text-tertiary)'}}>{tr("開班後才能使用收銀台功能")}</div>
        </div>
      )}

      <div style={{...sh.card, marginTop:12}}>
        <div style={{fontWeight:600, fontSize:14, marginBottom:12}}>{tr("歷史班別")}</div>
        {shifts.length === 0 ? (
          <div style={{textAlign:'center', color:'var(--text-tertiary)', padding:'20px 0', fontSize:13}}>{tr("無紀錄")}</div>
        ) : (
          <div style={{overflowX:'auto'}}><table style={sh.table}>
            <thead>
              <tr>
                <th>{tr("收銀員")}</th><th>{tr("開班")}</th><th>{tr("交班")}</th>
                <th style={{textAlign:'right'}}>{tr("現金")}</th><th style={{textAlign:'right'}}>{tr("電子")}</th>
                <th style={{textAlign:'right'}}>{tr("差額")}</th><th>{tr("狀態")}</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map(s => (
                <tr key={s.id}>
                  <td>{s.cashier}</td>
                  <td>{new Date(s.openTime).toLocaleString(getLocale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                  <td>{s.closeTime ? new Date(s.closeTime).toLocaleString(getLocale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-'}</td>
                  <td style={{textAlign:'right', fontFamily:'var(--font-mono)'}}>{s.cashSales?.toLocaleString() || 0}</td>
                  <td style={{textAlign:'right', fontFamily:'var(--font-mono)'}}>{s.cardSales?.toLocaleString() || 0}</td>
                  <td style={{textAlign:'right', fontFamily:'var(--font-mono)', color: s.diff > 0 ? 'var(--green)' : s.diff < 0 ? 'var(--red)' : 'inherit'}}>
                    {s.status === 'closed' ? (s.diff > 0 ? '+' : '') + (s.diff||0).toLocaleString() : '-'}
                  </td>
                  <td>
                    <span className={`badge badge-${s.status==='open' ? 'green' : 'blue'}`}>
                      {s.status === 'open' ? tr("營業中") : tr("已交班")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {showOpen && (
        <Modal kind="open" title={tr("開班")} saving={saving} error={actionError} onClose={()=>setShowOpen(false)}>
          <ShiftCountDraftNotice draft={countDraft} active busy={saving} run={runAction} error={actionError}/><CashCountInput value={openingCash} onChange={setOpeningCash} label="開班零用金" disabled={saving||countDraft.locked}/><ShiftCountDraftOptions draft={countDraft} busy={saving}/>
          <div className="shift-save-action"><CashCountSummary value={openingCash}/><button data-shift-save="open" disabled={saving||countDraft.blocked||!openingTotal.valid||countDraft.stale&&!countDraft.pending} className="btn btn-primary" style={{width:'100%'}} onClick={handleOpen}>{tr(saving?'保存中…':countDraft.pending?countDraft.retryAllowed?'再次確認開班':'核對上次開班':'確認開班')}</button></div>
        </Modal>
      )}

      {showClose && (
        <Modal kind="close" title={tr("交班")} saving={saving} error={actionError} onClose={()=>setShowClose(false)}>
          <ShiftCountDraftNotice draft={countDraft} active busy={saving} run={runAction} error={actionError}/><CashCountInput value={closingCash} onChange={setClosingCash} label="實際交班現金" disabled={saving||countDraft.locked}/>
          <details className="shift-cash-note"><summary>{tr('要補充說明嗎？')}</summary><Field label={tr("備註")}>
            <input className="field" disabled={saving||countDraft.locked} value={closeNote} onChange={e=>setCloseNote(e.target.value)} placeholder={tr("差額原因...")}/>
          </Field></details>
          <ShiftCountDraftOptions draft={countDraft} busy={saving}/><div className="shift-save-action"><CashCountSummary value={closingCash}/>
            {!sameClosingShift?<p role="alert">{tr('這一班已變更，請關閉後重新點算。')}</p>:closeDifference!==null&&<div className="shift-cash-comparison" data-cash-difference={closeDifference}>
              <p>{tr('帳上應有')} NT$ {cashText(closingStats.expected)}</p>
              <strong style={{color:closeDifference===0?'var(--green)':'var(--amber)'}}>{tr(closeDifference===0?'現金剛好相符':closeDifference<0?'比帳上少 NT$ {0}':'比帳上多 NT$ {0}',{0:cashText(Math.abs(closeDifference)/100)})}</strong>
            </div>}
            <button data-shift-save="close" disabled={saving||countDraft.blocked||!closingTotal.valid||!countDraft.pending&&(!sameClosingShift||closeDifference===null||countDraft.stale)} className="btn btn-primary" style={{width:'100%'}} onClick={handleClose}>{tr(saving?'保存中…':countDraft.pending?countDraft.retryAllowed?'再次確認交班':'核對上次交班':'確認交班')}</button>
          </div>
        </Modal>
      )}

      {showCash && (
        <Modal title={tr("現金進出")} saving={saving} error={actionError} onClose={()=>setShowCash(false)}>
          <fieldset className="cash-movement-fields" disabled={saving||cashDraft.locked}>
          <Field label={tr("類型")}>
            <div style={{display:'flex', gap:8}}>
              {[['in','現金進'],['out','現金出']].map(([k,l]) => (
                <button key={k} type="button" data-cash-movement-type={k} aria-pressed={cashType===k} onClick={()=>setCashType(k)} style={{
                  flex:1, padding:10, borderRadius:8, fontSize:13,
                  background: cashType===k?'var(--gold)':'var(--bg-overlay)',
                  color: cashType===k?'#fff':'var(--text-secondary)',
                  border:`1px solid ${cashType===k?'var(--gold)':'var(--border-subtle)'}`,
                }}>{tr(l)}</button>
              ))}
            </div>
          </Field>
          <Field label={tr("金額")}>
            <input className="field" data-cash-movement-amount aria-label={tr('金額')} type="text" inputMode="decimal" value={cashAmount} onChange={e=>setCashAmount(e.target.value)} autoFocus/>
          </Field>
          <Field label={tr("說明")}>
            <input className="field" data-cash-movement-reason aria-label={tr('說明')} value={cashReason} onChange={e=>setCashReason(e.target.value)} placeholder={tr("補零、付水電、貨款...")}/>
          </Field>
          </fieldset>
          {cashAmount.trim()&&Number.isFinite(Number(cashAmount))&&Number(cashAmount)>0&&<p className="cash-movement-summary" data-cash-movement-summary>{tr(cashType==='in'?'放入抽屜 NT$ {0}':'從抽屜取出 NT$ {0}',{0:cashText(Number(cashAmount))})}</p>}
          <CashMovementDraftNotice draft={cashDraft} active saving={saving} error={actionError} run={runAction}/>
          <button data-cash-movement-save disabled={saving||cashDraft.blocked||!cashDraft.pending&&(cashDraft.stale||!cashAmount.trim()||!Number.isFinite(Number(cashAmount))||Number(cashAmount)<=0||!cashReason.trim())} className="btn btn-primary" style={{width:'100%',minHeight:48,fontSize:18,whiteSpace:'normal',marginTop:12}} onClick={handleCash}>{tr(saving?'保存中…':cashDraft.pending?cashDraft.retryAllowed?'再次確認這一筆':'核對這筆現金':cashType==='in'?'確認放入':'確認取出')}</button>
        </Modal>
      )}
    </div>
  )
}

function KPI({ label, value, accent }) {
  return (
    <div style={{padding:'12px 14px', background:'var(--bg-overlay)', borderRadius:8}}>
      <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:4}}>{tr(label)}</div>
      <div style={{fontFamily:'var(--font-mono)', fontWeight:600, fontSize:15, color: accent ? `var(--${accent})` : 'var(--text-primary)'}}>{trMessage(value)}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:4}}>{tr(label)}</div>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children, saving, error,kind='cash' }) {
  const viewport=useVisibleViewport()
  const box=useRef(null),busy=useRef(saving),titleId=useId();busy.current=saving
  useEffect(()=>{const previous=document.activeElement,controls=()=>[...box.current?.querySelectorAll('button,input,select,textarea,summary')||[]].filter(node=>!node.disabled&&!node.closest('fieldset:disabled')&&node.checkVisibility?.()!==false);(box.current?.querySelector('input:not(:disabled)')||controls()[0])?.focus();function keys(event){if(event.key==='Escape'){event.preventDefault();if(!busy.current)onClose()}if(event.key==='Tab'){const nodes=controls(),first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();return}if(!box.current.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}}window.addEventListener('keydown',keys);return()=>{window.removeEventListener('keydown',keys);if(previous?.isConnected)previous.focus()}},[])
  return (
    <>
      <div style={mod.overlay} onClick={()=>!saving&&onClose()}/>
      <div ref={box} className="shift-counted-modal" data-shift-modal={kind} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{...mod.box,top:viewport.top+viewport.height/2,maxHeight:viewport.height*.9}}>
        <div style={mod.head}>
          <span id={titleId} style={{fontSize:22, fontWeight:600}}>{tr(title)}</span>
          <button type="button" data-shift-dismiss aria-label={tr('關閉視窗')} disabled={saving} onClick={onClose} style={{padding:10,minWidth:48,minHeight:48}}>✕</button>
        </div>
        <div style={{padding:'16px 18px'}}>{error&&<p role="alert" style={{color:'var(--red)',marginBottom:10}}>{trMessage(error)}</p>}{children}</div>
      </div>
    </>
  )
}

const sh = {
  root: { flex:1, minWidth:0, overflowY:'auto', padding:'20px 24px', background:'var(--bg-base)' },
  header: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16,flexWrap:'wrap',gap:12 },
  card: {
    background:'var(--bg-raised)', border:'1px solid var(--border-dim)',
    borderRadius:12, padding:'18px 20px', boxShadow:'var(--shadow-sm)',
  },
  kpiGrid: {
    display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:8,
  },
  table: {
    width:'100%', fontSize:13, borderCollapse:'collapse',
  },
}
const mod = {
  overlay:{position:'fixed',inset:0,background:'rgba(23,37,60,0.40)',zIndex:998},
  box:{
    position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
    background:'var(--bg-raised)', borderRadius:12, width:380, maxWidth:'90vw',
    boxShadow:'var(--shadow-lg)', zIndex:999, overflowY:'auto',
  },
  head:{
    display:'flex', justifyContent:'space-between', alignItems:'center',
    padding:'14px 18px', borderBottom:'1px solid var(--border-dim)',
  },
}

const css = `
table th, table td { padding: 8px 10px; text-align: left; }
table th { font-size: 11px; color: var(--text-tertiary); font-weight: 500; border-bottom: 1px solid var(--border-dim); }
table tbody tr { border-bottom: 1px solid var(--border-dim); }
`
if (typeof document !== 'undefined' && !document.getElementById('shift-page-css')) {
  const s = document.createElement('style'); s.id = 'shift-page-css'; s.textContent = css; document.head.appendChild(s)
}
