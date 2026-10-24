import {tr,trMessage,getLocale} from "../i18n"
import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, AlertTriangle, Package } from 'lucide-react'
import { exportXLS } from '../utils/exportXLS'
import { localDate } from '../utils/checkoutSafety.mjs'
import { quantityValue } from '../../electron/operationRules.mjs'
import useVisibleViewport from '../hooks/useVisibleViewport'
import {loadWasteCostState} from '../utils/dataAccess'
import {stockWasteCosts,wasteAmountText} from '../../electron/stockWasteCosts.mjs'
import '../styles/waste.css'

const REASONS = ['過期', '破損', '腐壞', '自用', '試吃樣品', '盤虧', '其他']

export default function WastePage({ store, session }) {
  const { products, wasteLog, recordWaste, financialState } = store
  const viewport = useVisibleViewport()
  const compact=window.innerWidth<=600
  const busy = useRef(false), active = useRef(false), pendingId = useRef(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(REASONS[0])
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState(() => localDate().slice(0,7))
  const [costRefresh,setCostRefresh]=useState(0),financialVisible=session?.role!=='staff',actorKey=session?.userId?JSON.stringify([session.userId,session.username,session.role]):''
  const [valuation,setValuation]=useState(()=>({phase:actorKey?'loading':'reference',key:actorKey,rows:[],wasteLog:null,products:null,error:''}))
  useEffect(()=>{
    if(!actorKey||!financialVisible)return
    let alive=true;setValuation({phase:'loading',key:actorKey,rows:[],wasteLog,products,error:''})
    loadWasteCostState(session).then(value=>{if(!alive)return;if(typeof value?.costActive!=='boolean'||!Array.isArray(value.wasteCosts))throw Error('損耗成本需要核對');setValuation({phase:value.costActive?'active':'reference',key:actorKey,rows:value.wasteCosts,wasteLog,products,error:''})}).catch(error=>{if(alive)setValuation({phase:'error',key:actorKey,rows:[],wasteLog,products,error:error.message})})
    return()=>{alive=false}
  },[actorKey,financialVisible,wasteLog,products,costRefresh])
  useEffect(()=>{const refresh=()=>setCostRefresh(value=>value+1);window.addEventListener('pos-stock-cost-changed',refresh);return()=>window.removeEventListener('pos-stock-cost-changed',refresh)},[])
  const costPhase=!actorKey?'reference':valuation.key!==actorKey||valuation.wasteLog!==wasteLog||valuation.products!==products?'loading':valuation.phase
  const costRows=useMemo(()=>new Map((costPhase==='reference'?stockWasteCosts(null,wasteLog):costPhase==='active'?valuation.rows:[]).map(row=>[row.wasteId,row])),[costPhase,wasteLog,valuation.rows])
  const cost=waste=>costRows.get(waste.id)||{complete:false,knownValueCents:0,valueCents:null,basis:'unresolved'}
  const lossText=waste=>cost(waste).complete?wasteAmountText(cost(waste).valueCents,getLocale()):tr('成本待確認')
  const unitCostText=waste=>cost(waste).basis==='original-source'?tr('原始批次'):cost(waste).basis==='posted'?tr('已記錄'):cost(waste).basis==='reference'&&waste.cost>0?waste.cost.toLocaleString(getLocale()):tr('成本待確認')

  function confirmed(recovered=false) {
    active.current=false;pendingId.current=null
    setShowAdd(false);setProductId('');setQty('');setReason(REASONS[0]);setError('')
    setMessage(recovered?'原編號損耗已確認保存，請勿再次記錄。':'損耗已保存並扣除庫存。')
  }
  useEffect(() => {
    if(!active.current)return
    if(financialState?.kind==='waste'&&financialState.phase!=='idle')pendingId.current=financialState.id
    if(financialState?.phase==='idle'&&pendingId.current){
      if(wasteLog.some(w=>w.id===pendingId.current))confirmed(true)
      else {active.current=false;pendingId.current=null}
    }
  }, [financialState, wasteLog])

  const filtered = useMemo(() => {
    return wasteLog.filter(w => {
      const okMonth = !filterMonth || localDate(new Date(w.time)).startsWith(filterMonth)
      const okSearch = !search || w.productName?.includes(search) || w.reason?.includes(search)
      return okMonth && okSearch
    })
  }, [wasteLog, filterMonth, search])

  const totalLossCents=filtered.reduce((sum,waste)=>sum+BigInt(cost(waste).knownValueCents),0n),pendingCosts=filtered.filter(waste=>!cost(waste).complete).length
  const productKinds=new Set(filtered.map(waste=>waste.productId)).size

  // 即期商品
  const expiringSoon = useMemo(() => {
    const today0 = Date.parse(localDate()+'T00:00:00Z')
    return products.filter(p => {
      if (!p.expiryDate || !(p.stock > 0)) return false
      const exp = Date.parse(p.expiryDate+'T00:00:00Z')
      const days = Math.floor((exp - today0) / 86400000)
      return days <= 7
    }).map(p => ({
      ...p,
      daysLeft: Math.floor((Date.parse(p.expiryDate+'T00:00:00Z') - today0) / 86400000),
    })).sort((a,b) => a.daysLeft - b.daysLeft)
  }, [products])

  async function saveLoss(p, quantity, cause) {
    if(busy.current)return
    busy.current=true;setSaving(true);setError('');setMessage('')
    try{
      if(!p)throw Error('請選擇損耗商品')
      quantityValue(quantity,'損耗數量',.001)
      if(quantity>p.stock)throw Error('損耗數量超過目前可用庫存，請先核對')
      active.current=true
      const result=await recordWaste({productId:p.id,productName:p.name,qty:quantity,cost:p.cost||0,reason:cause,cashier:session?.username||''})
      if(typeof result?.id!=='string'||!result.id)throw Error('損耗保存回覆不完整，請核對原編號')
      confirmed()
    }catch(e){setError(e.message||'損耗保存尚未確認，請保留內容並核對原編號')}
    finally{busy.current=false;setSaving(false)}
  }
  async function handleAdd() {
    await saveLoss(products.find(x=>x.id===productId),Number(qty),reason)
  }

  async function handleQuickAdd(p) {
    if (busy.current || !confirm(tr("記錄「{0}」1 個庫存單位過期？", {0: p.name}))) return
    await saveLoss(p,1,'過期')
  }

  function exportExcel() {
    const rows = [['日期','時間','商品','數量','單位',...(financialVisible?['成本依據','損失']:[]),'原因','記錄者'].map(label=>tr(label))]
    filtered.forEach(w => {
      const t = new Date(w.time)
      rows.push([
        t.toLocaleDateString('zh-TW'),
        t.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}),
        w.productName,
        Math.abs(w.qty),
        cost(w).unit||'',
        ...(financialVisible?[unitCostText(w),cost(w).complete?wasteAmountText(cost(w).valueCents,getLocale(),false):tr('成本待確認')]:[]),
        w.reason,
        w.cashier || '',
      ])
    })
    rows.push(['','',tr('合計'),'','',...(financialVisible?['',pendingCosts?tr('成本待確認'):wasteAmountText(totalLossCents,getLocale(),false)]:[]),'',''])
    exportXLS(rows, `損耗紀錄_${filterMonth}.xls`)
  }

  return (
    <div className="waste-page" style={ws.root} data-waste-page data-waste-cost-state={financialVisible?costPhase:'hidden'}>
      {!showAdd&&error&&<p role="alert" style={{color:'var(--red)',marginBottom:12}}>{trMessage(error)}</p>}
      {message&&<p role="status" style={{marginBottom:12}}>{trMessage(message)}</p>}
      {financialVisible&&costPhase==='loading'&&<p role="status">{tr('正在核對損耗成本…')}</p>}
      {financialVisible&&costPhase==='error'&&<div role="alert"><p>{trMessage(valuation.error)}</p><button className="btn" onClick={()=>setCostRefresh(value=>value+1)}>{tr('重新讀取')}</button></div>}
      <div style={ws.header}>
        <div>
          <h2 className="page-title" style={{fontSize:20, fontWeight:600}}>{tr("損耗管理")}</h2>
          <div style={{fontSize:13, color:'var(--text-tertiary)', marginTop:4}}>{tr("記錄過期、破損、自用等庫存損耗")}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-ghost" disabled={saving||financialState&&financialState.phase!=='idle'} onClick={()=>store.setView('lots')}>{tr('批次與效期')}</button><button disabled={saving} className="btn btn-primary" onClick={()=>{setError('');setMessage('');setShowAdd(true)}} style={{display:'flex',alignItems:'center',gap:6}}>
          <Plus size={16}/>{tr(" 新增損耗")}</button></div>
      </div>

      {expiringSoon.length > 0 && (
        <div style={ws.card}>
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12}}>
            <AlertTriangle size={16} color="var(--amber)"/>
            <span style={{fontWeight:600}}>{tr("近 7 天到期 (")}{expiringSoon.length})</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8}}>
            {expiringSoon.map(p => (
              <div key={p.id} style={{
                padding:'10px 12px', borderRadius:8,
                background: p.daysLeft <= 0 ? 'var(--red-dim)' : p.daysLeft <= 3 ? 'var(--amber-dim)' : 'var(--bg-overlay)',
                border:`1px solid ${p.daysLeft <= 0 ? 'rgba(217,79,68,0.22)' : 'transparent'}`,
              }}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4}}>
                  <div style={{fontSize:13, fontWeight:500, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</div>
                  <button disabled={saving} onClick={()=>handleQuickAdd(p)} style={{padding:8,minWidth:44,minHeight:44,fontSize:12,color:'var(--red)',background:'none',border:'1px solid var(--red)',borderRadius:4}}>{tr("報廢")}</button>
                </div>
                <div style={{fontSize:11, color:'var(--text-secondary)'}}>{tr("庫存 ")}{p.stock}{tr(" · 到期 ")}{p.expiryDate}
                </div>
                <div style={{fontSize:11, color: p.daysLeft <= 0 ? 'var(--red)' : 'var(--amber)', fontWeight:600, marginTop:2}}>
                  {p.daysLeft <= 0 ? tr("已過期 {0} 天", {0: -p.daysLeft}) : tr("剩 {0} 天", {0: p.daysLeft})}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={ws.card}>
        <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center'}}>
          <input className="field" type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{width:160}}/>
          <input className="field" placeholder={tr("搜尋商品/原因")} value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1, minWidth:200}}/>
          <button className="btn btn-ghost btn-sm" disabled={financialVisible&&['loading','error'].includes(costPhase)} onClick={exportExcel}>{tr("匯出 Excel")}</button>
        </div>

        <div className="waste-stats" style={{display:'flex', gap:12, marginBottom:14}}>
          <div style={ws.statBox}>
            <div style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr("合計筆數")}</div>
            <div style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)'}}>{filtered.length}</div>
          </div>
          <div style={ws.statBox}>
            <div style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr("商品種類")}</div>
            <div style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)'}}>{productKinds}</div>
          </div>
          {financialVisible&&<div className="waste-total-stat" style={ws.statBox}>
            <div style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr(costPhase==='reference'?'參考損失':pendingCosts?'已確認損失':'合計損失')}</div>
            <div data-waste-total style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)', color:'var(--red)'}}>{['loading','error'].includes(costPhase)?tr('成本待確認'):'NT$ '+wasteAmountText(totalLossCents,getLocale())}</div>
            {pendingCosts>0&&!['loading','error'].includes(costPhase)&&<small>{tr('另有 {0} 筆成本待確認',{0:pendingCosts})}</small>}
          </div>}
        </div>

        {filtered.length === 0 ? (
          <div style={{textAlign:'center', color:'var(--text-tertiary)', padding:'40px 0', fontSize:13}}>
            <Package size={32} color="var(--text-tertiary)" style={{margin:'0 auto 12px', opacity:0.5}}/>
            <div>{tr("無損耗紀錄")}</div>
          </div>
        ) : compact?(
          <div className="waste-mobile-list" data-waste-mobile-list>{filtered.map(waste=><article key={waste.id}>
            <strong>{waste.productName}</strong><p>{tr('數量')}：{Math.abs(waste.qty)} {cost(waste).unit||''}</p>
            {financialVisible&&<div className="waste-card-loss"><span>{tr('損失')}</span><strong data-waste-loss={waste.id}>{cost(waste).complete?'NT$ '+lossText(waste):lossText(waste)}</strong><small>{unitCostText(waste)}</small></div>}
            <p>{waste.reason}</p><details><summary>{tr('查看紀錄')}</summary><p>{new Date(waste.time).toLocaleString(getLocale())}</p><p>{waste.cashier}</p><small>{tr('已入帳，保留紀錄')}</small></details>
          </article>)}</div>
        ) : (
          <div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:650,fontSize:13,borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th style={ws.th}>{tr("時間")}</th>
                <th style={ws.th}>{tr("商品")}</th>
                <th style={{...ws.th, textAlign:'right'}}>{tr("數量")}</th>
                {financialVisible&&<th style={{...ws.th, textAlign:'right'}}>{tr("成本依據")}</th>}
                {financialVisible&&<th style={{...ws.th, textAlign:'right'}}>{tr("損失")}</th>}
                <th style={ws.th}>{tr("原因")}</th>
                <th style={ws.th}>{tr("記錄者")}</th>
                <th style={ws.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => (
                <tr key={w.id} style={{borderBottom:'1px solid var(--border-dim)'}}>
                  <td style={ws.td}>{new Date(w.time).toLocaleString(getLocale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                  <td style={ws.td}>{w.productName}</td>
                  <td style={{...ws.td, textAlign:'right', fontFamily:'var(--font-mono)'}}>{Math.abs(w.qty)}</td>
                  {financialVisible&&<td style={{...ws.td, textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--text-secondary)'}}>{unitCostText(w)}</td>}
                  {financialVisible&&<td data-waste-loss={w.id} style={{...ws.td, textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--red)', fontWeight:500}}>{lossText(w)}</td>}
                  <td style={ws.td}><span className="badge badge-amber">{w.reason}</span></td>
                  <td style={ws.td}>{w.cashier}</td>
                  <td style={ws.td}>
                    <span style={{fontSize:11,color:'var(--text-tertiary)'}}>{tr("已入帳，保留紀錄")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {showAdd && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(23,37,60,0.40)',zIndex:998}} onClick={()=>!saving&&setShowAdd(false)}/>
          <div role="dialog" aria-modal="true" aria-labelledby="waste-dialog-title" style={{position:'fixed',top:viewport.top+viewport.height/2,left:'50%',transform:'translate(-50%,-50%)',background:'var(--bg-raised)',borderRadius:12,width:420,maxWidth:'90vw',maxHeight:viewport.height*.9,overflowY:'auto',boxShadow:'var(--shadow-lg)',zIndex:999}}>
            <div style={{padding:'10px 18px',borderBottom:'1px solid var(--border-dim)',display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:15,fontWeight:600}}><span id="waste-dialog-title">{tr("記錄損耗")}</span><button aria-label={tr("關閉損耗表單")} disabled={saving} onClick={()=>setShowAdd(false)} style={{minWidth:44,minHeight:44}}>✕</button></div>
            <div style={{padding:18}}>
              {error&&<p role="alert" style={{color:'var(--red)',marginBottom:12}}>{trMessage(error)}</p>}
              <div style={{marginBottom:10}}>
                <label htmlFor="waste-product" style={{fontSize:12,color:'var(--text-tertiary)'}}>{tr("商品")}</label>
                <select id="waste-product" disabled={saving} className="field" style={{fontSize:16,minHeight:44}} value={productId} onChange={e=>setProductId(e.target.value)} autoFocus>
                  <option value="">{tr("— 請選擇 —")}</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}{tr(" (庫存 ")}{p.stock})</option>)}
                </select>
              </div>
              <div style={{marginBottom:10}}>
                <label htmlFor="waste-quantity" style={{fontSize:12,color:'var(--text-tertiary)'}}>{tr("數量（與庫存相同單位，最多三位小數）")}</label>
                <input id="waste-quantity" disabled={saving} className="field" style={{fontSize:16,minHeight:44}} type="number" inputMode="decimal" min="0.001" step="0.001" value={qty} onChange={e=>setQty(e.target.value)} placeholder="0"/>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:4}}>{tr("原因")}</div>
                <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6}}>
                  {REASONS.map(r => (
                    <button disabled={saving} key={r} onClick={()=>setReason(r)} style={{
                      padding:'8px 4px',minHeight:44,fontSize:12,borderRadius:6,
                      background: reason===r?'var(--gold)':'var(--bg-overlay)',
                      color: reason===r?'#fff':'var(--text-secondary)',
                      border:`1px solid ${reason===r?'var(--gold)':'var(--border-subtle)'}`,
                    }}>{r}</button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" style={{width:'100%',padding:12,minHeight:44,marginTop:8}} disabled={saving||!productId||qty===''} onClick={handleAdd}>{saving?tr("保存中…"):tr("記錄")}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const ws = {
  root: { flex:1, overflowY:'auto', padding:'20px 24px', background:'var(--bg-base)' },
  header: { display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,flexWrap:'wrap',gap:12 },
  card: {
    background:'var(--bg-raised)', border:'1px solid var(--border-dim)',
    borderRadius:12, padding:'18px 20px', boxShadow:'var(--shadow-sm)',
    marginBottom:12,
  },
  statBox: {
    flex:1, padding:'12px 14px', background:'var(--bg-overlay)', borderRadius:8,
  },
  th: { padding:'8px 10px', textAlign:'left', fontSize:11, color:'var(--text-tertiary)', fontWeight:500, borderBottom:'1px solid var(--border-dim)' },
  td: { padding:'10px', verticalAlign:'middle' },
}
