import {tr,trMessage,getLocale} from "../i18n"
import { browserStorage } from '../utils/browserStorage'
import { useState, useEffect, useRef } from 'react'
import { Clock, Plus, Minus, LogIn, LogOut, FileText, AlertCircle } from 'lucide-react'
import { loadShifts, loadCashLog } from '../utils/dataAccess'
import { summarizeShift } from '../../electron/shiftReconciliation.mjs'
import useVisibleViewport from '../hooks/useVisibleViewport'

export default function ShiftPage({ store, session }) {
  const { openShift, startShift, endShift, logCash, orders,topups } = store
  const [shifts, setShifts] = useState([])
  const [cashLog, setCashLog] = useState([])
  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showCash, setShowCash] = useState(false)
  const [openCash, setOpenCash] = useState('')
  const [closeCash, setCloseCash] = useState('')
  const [closeNote, setCloseNote] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [cashType, setCashType] = useState('in')
  const [cashReason, setCashReason] = useState('')
  const [loading,setLoading]=useState(true)
  const [loadError,setLoadError]=useState('')
  const [saving,setSaving]=useState(false),[actionError,setActionError]=useState(''),[actionMessage,setActionMessage]=useState('')
  const actionBusy=useRef(false)

  useEffect(() => { reload() }, [openShift?.id])
  useEffect(()=>{const handler=()=>reload();window.addEventListener('pos-cash-operation',handler);window.addEventListener('pos-data-refreshed',handler);return()=>{window.removeEventListener('pos-cash-operation',handler);window.removeEventListener('pos-data-refreshed',handler)}},[openShift?.id])

  async function reload() {
    setLoading(true);setLoadError('')
    try{
      const [s,c]=await Promise.all([loadShifts(),loadCashLog(openShift?.id)])
      if(!Array.isArray(s)||!Array.isArray(c))throw Error('班別／現金流水回覆不完整')
      setShifts(s);setCashLog(c.filter(x=>!openShift||x.shiftId===openShift.id))
    }catch(e){setLoadError(e.message)}finally{setLoading(false)}
  }

  // 即時統計這班
  const shiftStats = (() => {
    if (!openShift) return null
    try { return summarizeShift(openShift, orders, cashLog,topups) }
    catch(error) { return {error:error.message} }
  })()

  if(loading)return <div role="status" style={{padding:24}}>{tr("讀取班別與現金流水…")}</div>
  if(loadError||shiftStats?.error)return <div role="alert" style={{padding:24}}><h2 className="page-title">{tr("交班紀錄需要核對")}</h2><p>{loadError||shiftStats.error}</p><button className="btn" onClick={reload}>{tr("重新讀取")}</button></div>

  async function handleOpen() {
    await runAction(async()=>{
      const cash=Number(openCash)
      await startShift(session?.username||'',cash,session?.id||'')
      setShowOpen(false);setOpenCash('');setActionMessage('開班已保存。')
    })
  }

  async function handleClose() {
    await runAction(async()=>{
      if(closeCash.trim()==='')throw Error('請先點算並填寫實際現金。')
      const cash=Number(closeCash),r=await endShift(cash,closeNote)
      if(!r)throw Error('交班保存尚未確認，請核對原班別。')
      setShowClose(false);setCloseCash('');setCloseNote('')
      setActionMessage(`交班已保存。預期現金 NT$ ${r.expected.toLocaleString()}；實際現金 NT$ ${cash.toLocaleString()}；差額 NT$ ${r.diff.toLocaleString()}。`)
      await reload()
    })
  }

  async function handleCash() {
    await runAction(async()=>{
      const amt=Number(cashAmount)
      if(!amt||!cashReason.trim())throw Error('請填金額與現金進出原因。')
      await logCash(cashType,amt,cashReason,session?.username||'')
      setShowCash(false);setCashAmount('');setCashReason('');setCashType('in');setActionMessage('現金流水已保存。');await reload()
    })
  }
  async function runAction(work){if(actionBusy.current)return;actionBusy.current=true;setSaving(true);setActionError('');setActionMessage('');try{await work()}catch(e){setActionError(e.message||'保存尚未確認，請核對原紀錄。')}finally{actionBusy.current=false;setSaving(false)}}

  return (
    <div style={sh.root}>
      {actionError&&<p role="alert" style={{color:'var(--red)',marginBottom:12}}>{trMessage(actionError)}</p>}
      {actionMessage&&<p role="status" style={{marginBottom:12}}>{trMessage(actionMessage)}</p>}
      <div style={sh.header}>
        <div>
          <h2 className="page-title" style={{fontSize:20, fontWeight:600}}>{tr("班別管理")}</h2>
          <div style={{fontSize:13, color:'var(--text-tertiary)', marginTop:4}}>{tr("開班 / 交班 / 現金流水")}</div>
        </div>
        {!openShift ? (
          <button className="btn btn-primary" onClick={()=>{ setShowOpen(true); try { setOpenCash(browserStorage.getItem('pos_last_open_cash') || '') } catch {} }} style={{display:'flex',alignItems:'center',gap:6}}>
            <LogIn size={16}/>{tr(" 開班")}</button>
        ) : (
          <div style={{display:'flex', gap:8}}>
            <button className="btn btn-ghost" onClick={()=>setShowCash(true)} style={{display:'flex',alignItems:'center',gap:6}}>
              <Plus size={16}/>{tr(" 現金流水")}</button>
            <button className="btn btn-primary" onClick={()=>{setShowClose(true);setCloseCash(String(shiftStats?.expected||0))}} style={{display:'flex',alignItems:'center',gap:6}}>
              <LogOut size={16}/>{tr(" 交班")}</button>
          </div>
        )}
      </div>

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
              <table style={sh.table}>
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
              </table>
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
          <table style={sh.table}>
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
          </table>
        )}
      </div>

      {showOpen && (
        <Modal title={tr("開班")} saving={saving} error={actionError} onClose={()=>setShowOpen(false)}>
          <Field label={tr("收銀員")}><div style={{padding:'10px 14px', fontSize:14}}>{session?.username}</div></Field>
          <Field label={tr("開班零用金")}>
            <input className="field" type="number" value={openCash} onChange={e=>setOpenCash(e.target.value)} placeholder="0" autoFocus/>
          </Field>
          <button disabled={saving} className="btn btn-primary" style={{width:'100%', padding:12, marginTop:12}} onClick={handleOpen}>{saving?tr("保存中…"):tr("確認開班")}</button>
        </Modal>
      )}

      {showClose && (
        <Modal title={tr("交班")} saving={saving} error={actionError} onClose={()=>setShowClose(false)}>
          <div style={{background:'var(--bg-overlay)', padding:'12px 14px', borderRadius:8, marginBottom:12}}>
            <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4}}>
              <span style={{color:'var(--text-secondary)'}}>{tr("預期現金")}</span>
              <span style={{fontFamily:'var(--font-mono)', fontWeight:600}}>NT$ {(shiftStats?.expected||0).toLocaleString()}</span>
            </div>
          </div>
          <Field label={tr("實際現金")}>
            <input aria-label={tr("實際交班現金")} className="field" type="number" min="0" step="0.01" value={closeCash} onChange={e=>setCloseCash(e.target.value)} autoFocus/>
          </Field>
          {closeCash !== '' && (
            <div style={{padding:'8px 14px', borderRadius:8,
              background: parseFloat(closeCash) - (shiftStats?.expected||0) >= 0 ? 'var(--green-dim)' : 'var(--red-dim)',
              color: parseFloat(closeCash) - (shiftStats?.expected||0) >= 0 ? 'var(--green)' : 'var(--red)',
              fontSize:13, marginBottom:12}}>{tr("差額：")}{parseFloat(closeCash) - (shiftStats?.expected||0) >= 0 ? '+' : ''}
              NT$ {(parseFloat(closeCash) - (shiftStats?.expected||0)).toLocaleString()}
            </div>
          )}
          <Field label={tr("備註")}>
            <input className="field" value={closeNote} onChange={e=>setCloseNote(e.target.value)} placeholder={tr("差額原因...")}/>
          </Field>
          <button disabled={saving} className="btn btn-primary" style={{width:'100%', padding:12, marginTop:12}} onClick={handleClose}>{saving?tr("保存中…"):tr("確認交班")}</button>
        </Modal>
      )}

      {showCash && (
        <Modal title={tr("現金進出")} saving={saving} error={actionError} onClose={()=>setShowCash(false)}>
          <Field label={tr("類型")}>
            <div style={{display:'flex', gap:8}}>
              {[['in','現金進'],['out','現金出']].map(([k,l]) => (
                <button key={k} onClick={()=>setCashType(k)} style={{
                  flex:1, padding:10, borderRadius:8, fontSize:13,
                  background: cashType===k?'var(--gold)':'var(--bg-overlay)',
                  color: cashType===k?'#fff':'var(--text-secondary)',
                  border:`1px solid ${cashType===k?'var(--gold)':'var(--border-subtle)'}`,
                }}>{tr(l)}</button>
              ))}
            </div>
          </Field>
          <Field label={tr("金額")}>
            <input className="field" type="number" value={cashAmount} onChange={e=>setCashAmount(e.target.value)} autoFocus/>
          </Field>
          <Field label={tr("說明")}>
            <input className="field" value={cashReason} onChange={e=>setCashReason(e.target.value)} placeholder={tr("補零、付水電、貨款...")}/>
          </Field>
          <button disabled={saving} className="btn btn-primary" style={{width:'100%', padding:12, marginTop:12}} onClick={handleCash}>{saving?tr("保存中…"):tr("記錄")}</button>
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

function Modal({ title, onClose, children, saving, error }) {
  const viewport=useVisibleViewport()
  return (
    <>
      <div style={mod.overlay} onClick={()=>!saving&&onClose()}/>
      <div style={{...mod.box,top:viewport.top+viewport.height/2,maxHeight:viewport.height*.9}}>
        <div style={mod.head}>
          <span style={{fontSize:15, fontWeight:600}}>{tr(title)}</span>
          <button disabled={saving} onClick={onClose} style={{padding:10,minWidth:44,minHeight:44}}>✕</button>
        </div>
        <div style={{padding:'16px 18px'}}>{error&&<p role="alert" style={{color:'var(--red)',marginBottom:10}}>{trMessage(error)}</p>}{children}</div>
      </div>
    </>
  )
}

const sh = {
  root: { flex:1, overflowY:'auto', padding:'20px 24px', background:'var(--bg-base)' },
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
