import {tr,trMessage,getLocale} from "../i18n"
import { useState, useRef, lazy, Suspense } from 'react'
import { Check, X, AlertTriangle, Search, ChevronDown, ChevronUp, Download, Camera } from 'lucide-react'
import { writeAuditLog } from '../utils/security'
import { stringifyCSV } from '../utils/csv'
const BarcodeScannerModal = lazy(() => import('../components/BarcodeScannerModal'))

export default function StocktakePage({ store, session }) {
  const { products, commitInventory } = store
  const [counts,    setCounts]    = useState({})   // productId -> counted qty
  const [search,    setSearch]    = useState('')
  const [category,  setCategory]  = useState('全部')
  const [stage,     setStage]     = useState('count')  // count | review | done
  const [applied,setApplied]=useState(null)
  const [showOnly,  setShowOnly]  = useState('all')    // all | diff | missing
  const [showCamera, setShowCamera] = useState(false)
  const [scanFeedback, setScanFeedback] = useState('')
  const inputRefs = useRef({})
  const countsRef = useRef({})   // counts 的同步鏡像（source of truth）：掃描連加時讀最新值，避免在 setState updater 內製造副作用
  const expected=useRef({}),busy=useRef(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState('')

  function handleScannedCode(code) {
    const p = products.find(x => x.barcode === code)
    if (!p) {
      setScanFeedback(`✗ 條碼 ${code} 查無商品`)
      setTimeout(() => setScanFeedback(''), 2500)
      return 'keep'
    }
    // 每掃一次 +1。用 countsRef 讀最新值、setCounts 傳「新物件」而非 updater，
    // 避免在 state updater 內呼叫 setScanFeedback（updater 必須是 pure，StrictMode 會重跑兩次）
    const next = (typeof countsRef.current[p.id] === 'number' ? countsRef.current[p.id] : 0) + 1
    if(expected.current[p.id]===undefined)expected.current[p.id]=p.stock
    countsRef.current = { ...countsRef.current, [p.id]: next }
    setCounts(countsRef.current)
    setScanFeedback(`✓ ${p.name} +1（累計 ${next}）`)
    setTimeout(() => setScanFeedback(''), 1500)
    // focus 對應的 input（方便手動修正）
    setTimeout(() => inputRefs.current[p.id]?.focus(), 50)
    return 'keep' // 連續掃描
  }

  const categories = ['全部', ...new Set(products.map(p=>p.category))]

  const filtered = products.filter(p => {
    const okSearch = !search || p.name.includes(search)
    const okCat    = category === '全部' || p.category === category
    if (showOnly === 'diff')    return okSearch && okCat && counts[p.id] !== undefined && counts[p.id] !== p.stock
    if (showOnly === 'missing') return okSearch && okCat && counts[p.id] === undefined
    return okSearch && okCat
  })

  const counted   = Object.keys(counts).length
  const total     = products.length
  const pct       = total?Math.min(100,Math.round(counted / total * 100)):0
  const diffs     = products.filter(p => counts[p.id] !== undefined && counts[p.id] !== p.stock)
  const shortages = diffs.filter(p => (counts[p.id] ?? p.stock) < p.stock)
  const surpluses = diffs.filter(p => (counts[p.id] ?? p.stock) > p.stock)

  function setCount(id, val) {
    const n = val===''?NaN:Number(val)
    if(val===''){delete expected.current[id];delete countsRef.current[id];setCounts({...countsRef.current});return}
    if(expected.current[id]===undefined)expected.current[id]=products.find(p=>p.id===id)?.stock
    countsRef.current = { ...countsRef.current, [id]: isNaN(n) ? undefined : Math.max(0, n) }
    setCounts(countsRef.current)
  }

  function handleKeyDown(e, idx) {
    if (e.key === 'Enter') {
      const nextRef = inputRefs.current[filtered[idx+1]?.id]
      if (nextRef) nextRef.focus()
    }
  }

  async function applyAdjustments() {
    if(busy.current)return;busy.current=true;setSaving(true);setSaveError('')
    try{
    if(diffs.length)await commitInventory('stocktake',{counts:diffs.map(p=>({id:p.id,stock:counts[p.id],expectedStock:expected.current[p.id]??p.stock}))})
    writeAuditLog('STOCKTAKE_DONE', session, {
      total, counted, diffs: diffs.length,
      shortages: shortages.length, surpluses: surpluses.length,
    })
    setApplied({products:structuredClone(products),counts:{...counts},counted,total,diffs:diffs.length})
    setStage('done')
    }catch(e){setSaveError(e.message)}finally{busy.current=false;setSaving(false)}
  }

  function exportReport() {
    // 用共用 stringifyCSV 處理逗號/引號跳脫，避免各頁手刻 CSV 規則不一致
    const header = ['商品名稱', '分類', '系統庫存', '實盤數量', '差異']
    const source=stage==='done'&&applied?applied:{products,counts}
    const records = source.products.map(p => ({
      '商品名稱': p.name,
      '分類': p.category,
      '系統庫存': p.stock,
      '實盤數量': source.counts[p.id] ?? '未盤',
      '差異': source.counts[p.id] !== undefined ? source.counts[p.id] - p.stock : '—',
    }))
    const content = `盤點日期,${new Date().toLocaleDateString(getLocale())}\n` + stringifyCSV(records, header)
    const BOM  = '\uFEFF'
    const blob = new Blob([BOM+content],{type:'text/csv;charset=utf-8;'})
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href=url; a.download=`盤點報告_${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
    writeAuditLog('DATA_EXPORT', session, { type: '盤點報告' })
  }

  if (stage === 'done') return (
    <div style={st.root}>
      <div style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16}}>
        <div style={{fontSize:48}}>✅</div>
        <div style={{fontFamily:'var(--font-serif)', fontSize:22, fontWeight:700}}>{tr("盤點完成")}</div>
        <div style={{display:'flex', gap:24, fontSize:13, color:'var(--text-secondary)'}}>
          <span>{tr("共盤 ")}<strong style={{color:'var(--text-primary)'}}>{counted}</strong>{tr(" 項")}</span>
          <span>{tr("差異 ")}<strong style={{color: applied?.diffs?'var(--amber)':'var(--green)'}}>{applied?.diffs??0}</strong>{tr(" 項")}</span>
          <span>{tr("已更正 ")}<strong style={{color:'var(--green)'}}>{applied?.diffs??0}</strong>{tr(" 項庫存")}</span>
        </div>
        <div style={{display:'flex', gap:10}}>
          <button className="btn btn-ghost" onClick={exportReport}><Download size={14}/>{tr("匯出報告")}</button>
          <button className="btn btn-primary" onClick={()=>{countsRef.current={};expected.current={};setCounts({});setStage('count')}}>{tr("重新盤點")}</button>
        </div>
      </div>
    </div>
  )

  if (stage === 'review') return (
    <div style={st.root}>
      <div style={st.header}>
        {saveError&&<p role="alert" style={{color:'var(--red)'}}>{trMessage(saveError)}</p>}
        <div>
          <h2 className="page-title" style={st.title}>{tr("確認差異")}</h2>
          <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
            {diffs.length}{tr(" 項庫存有差異，確認後系統將自動更新")}</div>
        </div>
        <div style={{display:'flex', gap:8}}>
              <button disabled={saving} className="btn btn-ghost btn-sm" onClick={()=>setStage('count')}>{tr("返回修改")}</button>
              <button disabled={saving} className="btn btn-primary btn-sm" onClick={applyAdjustments}>
                <Check size={14}/>{saving?tr("保存中…"):tr("確認更新 {0} 項", {0: diffs.length})}
          </button>
        </div>
      </div>

      {diffs.length === 0 ? (
        <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12}}>
          <div style={{fontSize:36}}>🎉</div>
          <div style={{color:'var(--green)', fontSize:16, fontWeight:600}}>{tr("庫存完全吻合，無需調整")}</div>
                  <button disabled={saving} className="btn btn-primary" onClick={applyAdjustments}>{tr("完成盤點")}</button>
        </div>
      ) : (
        <div style={{flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:8}}>
          {shortages.length > 0 && (
            <SummaryBanner color="var(--red)" bg="var(--red-dim)" icon="📉" label={tr("短少 {0} 項", {0: shortages.length})} detail={shortages.map(p=>`${p.name}（${p.stock}→${counts[p.id]}）`).join('、')}/>
          )}
          {surpluses.length > 0 && (
            <SummaryBanner color="var(--teal)" bg="var(--teal-dim)" icon="📈" label={tr("多出 {0} 項", {0: surpluses.length})} detail={surpluses.map(p=>`${p.name}（${p.stock}→${counts[p.id]}）`).join('、')}/>
          )}

          <div className="card" style={{overflow:'hidden'}}>
            <div style={{display:'grid', gridTemplateColumns:'1fr 80px 80px 80px 100px', gap:8, padding:'9px 14px', background:'var(--bg-overlay)', fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.05em'}}>
              <span>{tr("商品")}</span><span style={{textAlign:'right'}}>{tr("系統")}</span><span style={{textAlign:'right'}}>{tr("實盤")}</span><span style={{textAlign:'right'}}>{tr("差異")}</span><span style={{textAlign:'right'}}>{tr("狀態")}</span>
            </div>
            {diffs.map(p => {
              const diff = (counts[p.id]??p.stock) - p.stock
              return (
                <div key={p.id} style={{display:'grid', gridTemplateColumns:'1fr 80px 80px 80px 100px', gap:8, padding:'10px 14px', borderTop:'1px solid var(--border-dim)', alignItems:'center', fontSize:13}}>
                  <span style={{fontWeight:500}}>{p.name}</span>
                  <span style={{textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--text-secondary)'}}>{p.stock}</span>
                  <span style={{textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600}}>{counts[p.id]}</span>
                  <span style={{textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600, color:diff<0?'var(--red)':'var(--teal)'}}>
                    {diff > 0 ? '+' : ''}{diff}
                  </span>
                  <span style={{textAlign:'right', fontSize:11}}>
                    <span style={{padding:'2px 8px', borderRadius:20, background:diff<0?'var(--red-dim)':'var(--teal-dim)', color:diff<0?'var(--red)':'var(--teal)'}}>
                      {diff<0?tr("短少"):tr("盈餘")}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div style={st.root}>
      <div style={st.header}>
        <div>
          <h2 className="page-title" style={st.title}>{tr("每日盤點")}</h2>
          <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
            {new Date().toLocaleDateString(getLocale(), {year:'numeric',month:'long',day:'numeric',weekday:'long'})}
          </div>
        </div>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <div style={{fontSize:12, color:'var(--text-secondary)'}}>{tr("已盤 ")}<span style={{fontFamily:'var(--font-mono)', fontWeight:600, color:'var(--text-primary)'}}>{counted}/{total}</span>
          </div>
          <div style={st.progressWrap}>
            <div style={{...st.progressBar, width:`${pct}%`}}/>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={()=>setShowCamera(true)}>
            <Camera size={14}/>{tr("掃條碼")}</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>{countsRef.current={};expected.current={};setCounts({});setSaveError('')}}>{tr("清除")}</button>
          <button className="btn btn-primary btn-sm" onClick={()=>setStage('review')}>{tr("審核差異 →")}</button>
        </div>
      </div>

      {scanFeedback && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          background: scanFeedback.startsWith('✗') ? 'var(--red-dim)' : 'var(--green-dim)',
          color: scanFeedback.startsWith('✗') ? 'var(--red)' : 'var(--green)',
          border: `1px solid ${scanFeedback.startsWith('✗') ? 'var(--red)' : 'var(--green)'}`,
          padding:'10px 16px', borderRadius:8, fontSize:13, zIndex:600,
          boxShadow:'var(--shadow-md)',
        }}>{scanFeedback}</div>
      )}

      {showCamera && (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            title={tr("掃條碼快速盤點（每掃 +1）")}
            mode="continuous"
            onScan={handleScannedCode}
            onClose={()=>setShowCamera(false)}
          />
        </Suspense>
      )}

      <div style={{display:'flex', gap:10, flexShrink:0, flexWrap:'wrap'}}>
        <div style={{flex:1, display:'flex', alignItems:'center', gap:8, background:'var(--bg-overlay)', border:'1px solid var(--border-subtle)', borderRadius:8, padding:'7px 12px', minWidth:160}}>
          <Search size={13} color="var(--text-tertiary)"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={tr("搜尋商品...")} style={{background:'none', flex:1, fontSize:13, color:'var(--text-primary)'}}/>
        </div>
        <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
          {categories.map(c=>(
            <button key={c==='全部'?tr('全部'):c} onClick={()=>setCategory(c)} style={{padding:'5px 12px', borderRadius:20, fontSize:11, cursor:'pointer', background:category===c?'var(--gold)':'var(--bg-overlay)', color:category===c?'#fff':'var(--text-secondary)', border:'none'}}>
              {c==='全部'?tr('全部'):c}
            </button>
          ))}
        </div>
        <div style={{display:'flex', gap:4}}>
          {[['all','全部'],['diff','有差異'],['missing','未盤']].map(([k,l])=>(
            <button key={k} onClick={()=>setShowOnly(k)} style={{padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:showOnly===k?'var(--bg-active)':'transparent', color:showOnly===k?'var(--text-primary)':'var(--text-tertiary)', border:`1px solid ${showOnly===k?'var(--border-mid)':'transparent'}`}}>
              {tr(l)}
            </button>
          ))}
        </div>
      </div>

      <div style={st.table}>
        <div style={{display:'grid', gridTemplateColumns:'1fr 80px 90px 100px', gap:8, padding:'9px 14px', background:'var(--bg-overlay)', fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.05em', flexShrink:0}}>
          <span>{tr("商品名稱")}</span><span style={{textAlign:'right'}}>{tr("系統庫存")}</span><span style={{textAlign:'right'}}>{tr("實盤數量")}</span><span style={{textAlign:'right'}}>{tr("差異")}</span>
        </div>
        <div style={{flex:1, overflowY:'auto'}}>
          {filtered.map((p, idx) => {
            const cnt  = counts[p.id]
            const diff = cnt !== undefined ? cnt - p.stock : null
            const hasDiff = diff !== null && diff !== 0
            return (
              <div key={p.id} className="cv-row" style={{display:'grid', gridTemplateColumns:'1fr 80px 90px 100px', gap:8, padding:'9px 14px', borderBottom:'1px solid var(--border-dim)', alignItems:'center', background:hasDiff?'rgba(217,119,6,0.06)':'transparent'}}>
                <div style={{minWidth:0}}>
                  <span style={{fontSize:13, fontWeight:500}}>{p.name}</span>
                  <span style={{fontSize:11, color:'var(--text-tertiary)', marginLeft:8}}>{p.category}</span>
                </div>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)', fontSize:13, color:p.stock<=5?'var(--amber)':'var(--text-secondary)'}}>{p.stock}</span>
                <div style={{display:'flex', justifyContent:'flex-end'}}>
                  <input
                    ref={el=>{ if (el) inputRefs.current[p.id]=el; else delete inputRefs.current[p.id] }}
                    type="number" min={0} step="0.001" aria-label={tr("實盤數量 {0}", {0: p.name})}
                    value={cnt ?? ''}
                    onChange={e=>setCount(p.id, e.target.value)}
                    onKeyDown={e=>handleKeyDown(e,idx)}
                    placeholder="—"
                    style={{
                      width:70, background:'var(--bg-overlay)',
                      border:`1px solid ${hasDiff?'var(--amber)':cnt!==undefined?'var(--green)':'var(--border-subtle)'}`,
                      borderRadius:6, color:'var(--text-primary)', padding:'5px 8px',
                      textAlign:'right', fontFamily:'var(--font-mono)', fontSize:13,
                    }}
                  />
                </div>
                <span style={{textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:600, fontSize:13, color:diff===null?'var(--text-disabled)':diff<0?'var(--red)':diff>0?'var(--teal)':'var(--green)'}}>
                  {diff===null ? '—' : diff===0 ? '✓' : `${diff>0?'+':''}${diff}`}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SummaryBanner({ color, bg, icon, label, detail }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{background:bg, border:`1px solid ${color}22`, borderRadius:10, padding:'10px 14px'}}>
      <button onClick={()=>setOpen(v=>!v)} style={{display:'flex', alignItems:'center', gap:8, width:'100%', background:'none', color}}>
        <span>{icon}</span><span style={{fontWeight:600, fontSize:13}}>{tr(label)}</span>
        {open?<ChevronUp size={13} style={{marginLeft:'auto'}}/>:<ChevronDown size={13} style={{marginLeft:'auto'}}/>}
      </button>
      {open && <div style={{fontSize:12, color, marginTop:6, opacity:.8}}>{detail}</div>}
    </div>
  )
}

const st = {
  root:{display:'flex', flexDirection:'column', height:'100%', padding:'16px', gap:14, overflow:'hidden'},
  header:{display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0, flexWrap:'wrap', gap:10},
  title:{fontFamily:'var(--font-serif)', fontSize:20, fontWeight:600},
  progressWrap:{width:80, height:6, background:'var(--border-dim)', borderRadius:3, overflow:'hidden'},
  progressBar:{height:'100%', background:'var(--gold)', borderRadius:3, transition:'width .4s'},
  table:{flex:1, display:'flex', flexDirection:'column', background:'var(--bg-raised)', border:'1px solid var(--border-dim)', borderRadius:'var(--r3)', overflow:'hidden'},
}
