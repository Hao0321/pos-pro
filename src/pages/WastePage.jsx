import WasteEntryEditor from '../components/WasteEntryEditor'
import {tr,trMessage,getLocale} from "../i18n"
import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, AlertTriangle, Package } from 'lucide-react'
import { exportXLS } from '../utils/exportXLS'
import { localDate } from '../utils/checkoutSafety.mjs'
import {loadWasteCostState} from '../utils/dataAccess'
import {stockWasteCosts,wasteAmountText} from '../../electron/stockWasteCosts.mjs'
import '../styles/waste.css'


export default function WastePage({ store, session }) {
  const { products, wasteLog, financialState } = store
  const compact=window.innerWidth<=600
  const entryEditor=useRef(null)
  const [saving, setSaving] = useState(false)
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
      <WasteEntryEditor ref={entryEditor} store={store} session={session} onBusy={setSaving}/>
      {financialVisible&&costPhase==='loading'&&<p role="status">{tr('正在核對損耗成本…')}</p>}
      {financialVisible&&costPhase==='error'&&<div role="alert"><p>{trMessage(valuation.error)}</p><button className="btn" onClick={()=>setCostRefresh(value=>value+1)}>{tr('重新讀取')}</button></div>}
      <div style={ws.header}>
        <div>
          <h2 className="page-title" style={{fontSize:20, fontWeight:600}}>{tr("損耗管理")}</h2>
          <div style={{fontSize:13, color:'var(--text-tertiary)', marginTop:4}}>{tr("記錄過期、破損、自用等庫存損耗")}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-ghost" disabled={saving||financialState&&financialState.phase!=='idle'} onClick={()=>store.setView('lots')}>{tr('批次與效期')}</button><button disabled={saving} className="btn btn-primary" data-waste-new onClick={()=>entryEditor.current?.start()} style={{display:'flex',alignItems:'center',gap:6}}>
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
                  <button disabled={saving} data-waste-quick={p.id} onClick={()=>entryEditor.current?.start(p)} style={{padding:8,minWidth:48,minHeight:48,fontSize:16,color:'var(--red)',background:'none',border:'1px solid var(--red)',borderRadius:4}}>{tr("報廢")}</button>
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
