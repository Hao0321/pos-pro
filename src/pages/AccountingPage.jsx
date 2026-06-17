import { useState, useMemo } from 'react'
import {
  buildPnL, buildBalanceSheet, groupJournalByDate,
  exportJournalCSV, exportPnLCSV, downloadCSV,
  ACCOUNTS,
} from '../utils/accounting'
import { Download, Plus, Trash2, X, Check, ChevronDown, ChevronRight, BookOpen, TrendingUp, Scale, FileText } from 'lucide-react'

const TABS = [
  { key: 'pnl',      label: '損益表',   Icon: TrendingUp },
  { key: 'journal',  label: '日記帳',   Icon: BookOpen   },
  { key: 'balance',  label: '資產負債', Icon: Scale      },
  { key: 'expense',  label: '記錄費用', Icon: Plus       },
]

const EXPENSE_ACCOUNTS = Object.entries(ACCOUNTS)
  .filter(([,v]) => v.type === 'expense')
  .map(([k,v]) => ({ code: k, name: v.name, group: v.group }))

const ASSET_ACCOUNTS = Object.entries(ACCOUNTS)
  .filter(([,v]) => v.type === 'asset')
  .map(([k,v]) => ({ code: k, name: v.name }))

export default function AccountingPage({ store }) {
  const { allJournal, manualEntries, addManualEntry, deleteManualEntry } = store
  const [tab, setTab]   = useState('pnl')

  const now   = new Date()
  const y     = now.getFullYear()
  const m     = String(now.getMonth()+1).padStart(2,'0')
  const [from, setFrom] = useState(`${y}-${m}-01`)
  const [to,   setTo]   = useState(now.toISOString().slice(0,10))

  const pnl     = useMemo(() => buildPnL(allJournal, from, to), [allJournal, from, to])
  const balance = useMemo(() => buildBalanceSheet(allJournal, to), [allJournal, to])
  const grouped = useMemo(() => groupJournalByDate(
    allJournal.filter(j => j.date >= from && j.date <= to)
  ), [allJournal, from, to])

  function handleExport() {
    if (tab === 'journal') downloadCSV(exportJournalCSV(allJournal.filter(j=>j.date>=from&&j.date<=to)), `日記帳_${from}_${to}.csv`)
    else if (tab === 'pnl') downloadCSV(exportPnLCSV(pnl, from, to), `損益表_${from}_${to}.csv`)
  }

  const canExport = tab === 'journal' || tab === 'pnl'

  return (
    <div style={ac.root}>
      {/* Header */}
      <div style={ac.header}>
        <div>
          <h2 style={ac.title}>會計帳務</h2>
          <div style={{fontSize:12,color:'var(--text-tertiary)',marginTop:2}}>
            自動複式記帳 · {allJournal.length} 筆分錄
          </div>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <div style={ac.dateRange}>
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={ac.dateInput}/>
            <span style={{color:'var(--text-tertiary)',fontSize:12}}>至</span>
            <input type="date" value={to}   onChange={e=>setTo(e.target.value)}   style={ac.dateInput}/>
          </div>
          {canExport && (
            <button className="btn btn-ghost btn-sm" onClick={handleExport}>
              <Download size={14}/>匯出 CSV
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={ac.tabBar}>
        {TABS.map(({key,label,Icon})=>(
          <button key={key} onClick={()=>setTab(key)} style={{
            ...ac.tab,
            background: tab===key ? 'var(--bg-active)' : 'transparent',
            color: tab===key ? 'var(--text-primary)' : 'var(--text-tertiary)',
            borderBottom: `2px solid ${tab===key?'var(--gold)':'transparent'}`,
          }}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={ac.content}>
        {tab === 'pnl'     && <PnLView     pnl={pnl} from={from} to={to} />}
        {tab === 'journal' && <JournalView grouped={grouped} manualEntries={manualEntries} deleteManualEntry={deleteManualEntry}/>}
        {tab === 'balance' && <BalanceView balance={balance} asOf={to}/>}
        {tab === 'expense' && <ExpenseView addManualEntry={addManualEntry}/>}
      </div>
    </div>
  )
}

// ── 損益表 ────────────────────────────────────────────────
function PnLView({ pnl, from, to }) {
  const { revenue, cogs, grossProfit, grossMargin, opExpenses, netIncome, netMargin, expenseLines } = pnl
  const loss = netIncome < 0

  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, height:'100%', overflowY:'auto'}}>
      {/* Main P&L */}
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={ac.cardTitle}>損益彙總 <span style={{fontSize:11,color:'var(--text-tertiary)',fontWeight:400}}>{from} ~ {to}</span></div>

        <div style={ac.pnlSection}>
          <PnLRow label="營業收入" amount={revenue} bold highlight="blue"/>
          <PnLRow label="銷貨成本" amount={-cogs} sub/>
          <div style={ac.pnlDivider}/>
          <PnLRow label="毛利" amount={grossProfit} bold highlight={grossProfit>=0?'green':'red'}/>
          <div style={{fontSize:11,color:'var(--text-tertiary)',textAlign:'right',marginBottom:4}}>毛利率 {grossMargin}%</div>
          <PnLRow label="營業費用" amount={-opExpenses} sub/>
          <div style={ac.pnlDivider}/>
          <PnLRow label="本期淨利" amount={netIncome} bold lg highlight={loss?'red':'gold'}/>
          <div style={{fontSize:11,color:loss?'var(--red)':'var(--text-tertiary)',textAlign:'right',marginTop:4}}>淨利率 {netMargin}%</div>
        </div>

        {/* Expense breakdown */}
        {expenseLines.length > 0 && (
          <div className="card" style={{padding:'14px 16px'}}>
            <div style={{fontSize:11,color:'var(--text-tertiary)',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:12}}>費用明細</div>
            {expenseLines.map(l=>(
              <div key={l.code} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border-dim)',fontSize:13}}>
                <span style={{color:'var(--text-secondary)'}}>{l.name}</span>
                <span style={{fontFamily:'var(--font-mono)',color:'var(--red)'}}>({l.amount.toLocaleString()})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Visual cards */}
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={ac.cardTitle}>關鍵指標</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {[
            {label:'營業收入', val:`NT$ ${revenue.toLocaleString()}`,    color:'var(--blue)'},
            {label:'毛利',     val:`NT$ ${grossProfit.toLocaleString()}`, color:'var(--teal)'},
            {label:'毛利率',   val:`${grossMargin}%`,                    color:'var(--gold)'},
            {label:'本期淨利', val:`NT$ ${netIncome.toLocaleString()}`,   color: loss?'var(--red)':'var(--green)'},
          ].map(({label,val,color},i)=>(
            <div key={i} className="card" style={{padding:'14px 16px',borderTop:`2px solid ${color}`}}>
              <div style={{fontSize:10,color:'var(--text-tertiary)',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{label}</div>
              <div style={{fontFamily:'var(--font-mono)',fontSize:18,fontWeight:500,color}}>{val}</div>
            </div>
          ))}
        </div>

        {/* Margin bar */}
        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:12,letterSpacing:'.06em',textTransform:'uppercase'}}>收支結構</div>
          {revenue > 0 && (
            <div>
              <div style={{display:'flex',height:24,borderRadius:4,overflow:'hidden',marginBottom:8}}>
                <div style={{width:`${cogs/revenue*100}%`,background:'var(--red)',opacity:.7}} title={`銷貨成本 ${Math.round(cogs/revenue*100)}%`}/>
                <div style={{width:`${opExpenses/revenue*100}%`,background:'var(--amber)',opacity:.7}} title={`費用 ${Math.round(opExpenses/revenue*100)}%`}/>
                <div style={{flex:1,background:'var(--green)',opacity:.7}} title="毛利"/>
              </div>
              <div style={{display:'flex',gap:14,fontSize:11}}>
                <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:10,height:10,borderRadius:2,background:'var(--red)',opacity:.7,display:'inline-block'}}/><span style={{color:'var(--text-secondary)'}}>成本 {Math.round(cogs/revenue*100)}%</span></span>
                <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:10,height:10,borderRadius:2,background:'var(--amber)',opacity:.7,display:'inline-block'}}/><span style={{color:'var(--text-secondary)'}}>費用 {Math.round(opExpenses/revenue*100)}%</span></span>
                <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:10,height:10,borderRadius:2,background:'var(--green)',opacity:.7,display:'inline-block'}}/><span style={{color:'var(--text-secondary)'}}>淨利 {netMargin}%</span></span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PnLRow({ label, amount, bold, sub, lg, highlight }) {
  const colorMap = { blue:'var(--blue)', green:'var(--green)', red:'var(--red)', gold:'var(--gold-bright)', teal:'var(--teal)' }
  const color = highlight ? colorMap[highlight] : amount < 0 ? 'var(--red)' : 'var(--text-primary)'
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:`${lg?10:6}px 0`,marginLeft:sub?16:0}}>
      <span style={{fontSize:sub?12:13,color:sub?'var(--text-secondary)':'var(--text-primary)',fontWeight:bold?600:400}}>{label}</span>
      <span style={{fontFamily:'var(--font-mono)',fontSize:lg?20:sub?12:14,fontWeight:bold?600:400,color}}>
        NT$ {Math.abs(amount).toLocaleString()}
        {amount < 0 && <span style={{fontSize:10,opacity:.7}}> (費)</span>}
      </span>
    </div>
  )
}

// ── 日記帳 ────────────────────────────────────────────────
function JournalView({ grouped, manualEntries, deleteManualEntry }) {
  const [expanded, setExpanded] = useState({})
  const toggle = (date) => setExpanded(p=>({...p,[date]:!p[date]}))
  const manualIds = new Set(manualEntries.map(e=>e.id))

  if (grouped.length === 0) return (
    <div style={{textAlign:'center',padding:'60px',color:'var(--text-tertiary)',fontSize:13}}>
      此期間無分錄
    </div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,overflowY:'auto',height:'100%'}}>
      {grouped.map(([date, entries]) => {
        const dayTotal = entries.filter(e=>e.type==='auto_sale').reduce((s,e)=>s+(e.lines.find(l=>l.account==='4101')?.credit||0),0)
        const open = expanded[date] !== false  // default open
        return (
          <div key={date} className="card" style={{overflow:'hidden'}}>
            <button onClick={()=>toggle(date)} style={{
              display:'flex',alignItems:'center',gap:10,width:'100%',
              padding:'12px 16px',textAlign:'left',transition:'background 120ms',
            }}>
              {open ? <ChevronDown size={14} style={{color:'var(--text-tertiary)',flexShrink:0}}/> : <ChevronRight size={14} style={{color:'var(--text-tertiary)',flexShrink:0}}/>}
              <span style={{fontFamily:'var(--font-mono)',fontSize:13,color:'var(--text-secondary)',minWidth:90}}>{date}</span>
              <span style={{fontSize:12,color:'var(--text-tertiary)'}}>{entries.length} 筆分錄</span>
              {dayTotal > 0 && <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:13,color:'var(--gold-bright)',fontWeight:500}}>NT$ {dayTotal.toLocaleString()}</span>}
            </button>

            {open && (
              <div style={{borderTop:'1px solid var(--border-dim)'}}>
                {entries.map(j=>(
                  <div key={j.id} style={{borderBottom:'1px solid var(--border-dim)',padding:'10px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                      <span style={{...ac.typeBadge,...TYPE_STYLE[j.type]||TYPE_STYLE.manual}}>{TYPE_LABEL[j.type]||'手動'}</span>
                      <span style={{fontSize:13,fontWeight:500}}>{j.description}</span>
                      {manualIds.has(j.id) && (
                        <button className="btn-icon btn-sm" style={{marginLeft:'auto',color:'var(--red)'}} onClick={()=>deleteManualEntry(j.id)}>
                          <Trash2 size={13}/>
                        </button>
                      )}
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 90px 90px',gap:4,fontSize:11}}>
                      <span style={{color:'var(--text-tertiary)',letterSpacing:'.04em'}}>科目</span>
                      <span style={{color:'var(--text-tertiary)',textAlign:'right'}}>借方</span>
                      <span style={{color:'var(--text-tertiary)',textAlign:'right'}}>貸方</span>
                      {j.lines.map((l,i)=>(
                        <>
                          <span key={i+'a'} style={{color:'var(--text-secondary)',paddingLeft:l.debit===0?16:0}}>
                            {ACCOUNTS[l.account]?.name||l.account}
                            {l.note && <span style={{color:'var(--text-tertiary)',marginLeft:6}}>— {l.note}</span>}
                          </span>
                          <span key={i+'d'} style={{fontFamily:'var(--font-mono)',textAlign:'right',color:l.debit?'var(--blue)':'var(--text-disabled)'}}>
                            {l.debit?l.debit.toLocaleString():'—'}
                          </span>
                          <span key={i+'c'} style={{fontFamily:'var(--font-mono)',textAlign:'right',color:l.credit?'var(--teal)':'var(--text-disabled)'}}>
                            {l.credit?l.credit.toLocaleString():'—'}
                          </span>
                        </>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const TYPE_LABEL = { auto_sale:'銷售', auto_cogs:'成本', auto_discount:'折抵', auto_balance:'儲值折抵', auto_topup:'會員儲值', manual:'手動', }
const TYPE_STYLE = {
  auto_sale:     { background:'var(--teal-dim)',   color:'var(--teal)'  },
  auto_cogs:     { background:'var(--amber-dim)',  color:'var(--amber)' },
  auto_discount: { background:'var(--gold-dim)',   color:'var(--gold-bright)' },
  auto_balance:  { background:'var(--gold-dim)',   color:'var(--gold-bright)' },
  auto_topup:    { background:'var(--green-dim)',  color:'var(--green)' },
  manual:        { background:'var(--blue-dim)',   color:'var(--blue)'  },
}

// ── 資產負債表 ────────────────────────────────────────────
function BalanceView({ balance, asOf }) {
  const { sections, totalAssets, totalLiabilities, totalEquity } = balance
  const balanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,height:'100%',overflowY:'auto'}}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={ac.cardTitle}>資產 <span style={{fontFamily:'var(--font-mono)',color:'var(--blue)',fontSize:14,fontWeight:500}}>NT$ {totalAssets.toLocaleString()}</span></div>
        <BSSection items={sections.asset.items} color="var(--blue)"/>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={ac.cardTitle}>負債 + 業主權益</div>
        <div style={{...ac.cardTitle,fontSize:12,color:'var(--text-tertiary)'}}>負債 <span style={{fontFamily:'var(--font-mono)',color:'var(--red)',fontSize:14}}> NT$ {totalLiabilities.toLocaleString()}</span></div>
        <BSSection items={sections.liability.items} color="var(--red)"/>
        <div style={{fontSize:12,color:'var(--text-tertiary)'}}>業主權益 <span style={{fontFamily:'var(--font-mono)',color:'var(--green)',fontSize:14}}> NT$ {totalEquity.toLocaleString()}</span></div>
        <BSSection items={sections.equity.items} color="var(--green)"/>
        <div className="card" style={{padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',borderLeft:`3px solid ${balanced?'var(--green)':'var(--red)'}`}}>
          <span style={{fontSize:12,color:balanced?'var(--green)':'var(--red)'}}>
            {balanced ? '✓ 借貸平衡' : '⚠ 借貸不平衡'}
          </span>
          <span style={{fontSize:11,color:'var(--text-tertiary)'}}>截至 {asOf}</span>
        </div>
      </div>
    </div>
  )
}

function BSSection({ items, color }) {
  if (!items.length) return <div style={{fontSize:12,color:'var(--text-tertiary)',padding:'8px 0'}}>無資料</div>
  return (
    <div className="card" style={{overflow:'hidden'}}>
      {items.map((item,i)=>(
        <div key={item.code} style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',borderBottom:i<items.length-1?'1px solid var(--border-dim)':'none',fontSize:13,alignItems:'center'}}>
          <div>
            <span style={{color:'var(--text-primary)'}}>{item.name}</span>
            <span style={{fontSize:10,color:'var(--text-tertiary)',marginLeft:6,fontFamily:'var(--font-mono)'}}>{item.code}</span>
          </div>
          <span style={{fontFamily:'var(--font-mono)',fontWeight:500,color}}>{item.amount.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ── 記錄費用 ──────────────────────────────────────────────
const EXPENSE_PRESETS = [
  { label:'月租金',  account:'5202', payAccount:'1101' },
  { label:'水電費',  account:'5203', payAccount:'1101' },
  { label:'薪資',    account:'5201', payAccount:'1101' },
  { label:'進貨',    account:'1211', payAccount:'1101' },
  { label:'廣告費',  account:'5205', payAccount:'1103' },
  { label:'雜費',    account:'5206', payAccount:'1101' },
]

function ExpenseView({ addManualEntry }) {
  const today = new Date().toISOString().slice(0,10)
  const [form, setForm] = useState({ date:today, description:'', amount:'', expenseAccount:'5202', payAccount:'1101', note:'' })
  const [saved, setSaved] = useState(false)

  function applyPreset(preset) {
    setForm(f=>({...f,expenseAccount:preset.account,payAccount:preset.payAccount,description:preset.label}))
  }

  function handleSave() {
    if (!form.amount || !form.description || isNaN(parseFloat(form.amount))) return
    const amount  = parseFloat(form.amount)
    const expAcc  = form.expenseAccount
    const payAcc  = form.payAccount
    const isInventory = expAcc === '1211' // 進貨記庫存，不記費用科目

    addManualEntry({
      date: form.date,
      description: form.description,
      lines: isInventory
        ? [
            { account:'1211',    debit:amount,  credit:0,      note:form.note||'入庫' },
            { account:payAcc,    debit:0,        credit:amount, note:'付款' },
          ]
        : [
            { account:expAcc,    debit:amount,  credit:0,      note:form.note||form.description },
            { account:payAcc,    debit:0,        credit:amount, note:'付款' },
          ],
    })

    setSaved(true)
    setForm(f=>({...f,description:'',amount:'',note:''}))
    setTimeout(()=>setSaved(false), 2000)
  }

  const EXPENSE_ACC = Object.entries(ACCOUNTS)
    .filter(([,v])=>v.type==='expense'||v.code==='1211')
    .filter(([k])=>k!=='5301')

  return (
    <div style={{maxWidth:560,margin:'0 auto',display:'flex',flexDirection:'column',gap:16}}>
      <div style={ac.cardTitle}>記錄費用 / 進貨</div>

      {/* Presets */}
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {EXPENSE_PRESETS.map(p=>(
          <button key={p.label} className="btn btn-ghost btn-sm" onClick={()=>applyPreset(p)} style={{fontSize:12}}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="card" style={{padding:'20px 22px',display:'flex',flexDirection:'column',gap:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div>
            <FieldLabel>日期</FieldLabel>
            <input type="date" className="field" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
          </div>
          <div>
            <FieldLabel>金額 (NT$) *</FieldLabel>
            <input type="number" className="field" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0" style={{fontFamily:'var(--font-mono)'}}/>
          </div>
        </div>

        <div>
          <FieldLabel>摘要 *</FieldLabel>
          <input className="field" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="例：三月份租金、水電費"/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div>
            <FieldLabel>費用科目</FieldLabel>
            <select className="field" value={form.expenseAccount} onChange={e=>setForm(f=>({...f,expenseAccount:e.target.value}))} style={{cursor:'pointer'}}>
              {Object.entries(ACCOUNTS).filter(([,v])=>v.type==='expense'||v.code==='1211').map(([k,v])=>(
                <option key={k} value={k}>{k} {v.name}</option>
              ))}
              <option value="1211">1211 存貨（進貨）</option>
            </select>
          </div>
          <div>
            <FieldLabel>付款方式</FieldLabel>
            <select className="field" value={form.payAccount} onChange={e=>setForm(f=>({...f,payAccount:e.target.value}))} style={{cursor:'pointer'}}>
              <option value="1101">1101 現金</option>
              <option value="1103">1103 銀行存款</option>
              <option value="2101">2101 應付帳款（賒帳）</option>
            </select>
          </div>
        </div>

        <div>
          <FieldLabel>備註</FieldLabel>
          <input className="field" value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))} placeholder="（選填）"/>
        </div>

        <button className="btn btn-primary" onClick={handleSave} style={{width:'100%',padding:13}}>
          {saved ? <><Check size={16}/>已記帳</> : '記帳'}
        </button>
      </div>

      <div className="card" style={{padding:'14px 16px'}}>
        <div style={{fontSize:11,color:'var(--text-tertiary)',lineHeight:1.8}}>
          <div>📒 每筆結帳自動產生 <strong style={{color:'var(--text-secondary)'}}>銷售收入</strong> + <strong style={{color:'var(--text-secondary)'}}>銷貨成本</strong> + <strong style={{color:'var(--text-secondary)'}}>銷項稅額</strong> 三筆分錄</div>
          <div>💰 此頁面補登 <strong style={{color:'var(--text-secondary)'}}>費用、進貨、薪資</strong> 等非銷售支出</div>
          <div>📊 所有資料自動彙整至損益表與資產負債表</div>
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ children }) {
  return <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:5,letterSpacing:'.03em'}}>{children}</div>
}

const ac = {
  root:{ display:'flex',flexDirection:'column',height:'100%',padding:'16px',gap:14,overflow:'hidden' },
  header:{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,flexShrink:0 },
  title:{ fontFamily:'var(--font-serif)',fontSize:20,fontWeight:600 },
  dateRange:{ display:'flex',alignItems:'center',gap:8,background:'var(--bg-overlay)',border:'1px solid var(--border-subtle)',borderRadius:8,padding:'6px 12px' },
  dateInput:{ background:'none',color:'var(--text-primary)',fontSize:12,fontFamily:'var(--font-mono)',cursor:'pointer',border:'none',outline:'none' },
  tabBar:{ display:'flex',gap:0,borderBottom:'1px solid var(--border-dim)',flexShrink:0 },
  tab:{ display:'flex',alignItems:'center',gap:7,padding:'10px 16px',fontSize:13,fontWeight:500,transition:'all 150ms',borderRadius:0,letterSpacing:'.01em' },
  content:{ flex:1,overflow:'hidden',paddingTop:16 },
  cardTitle:{ fontSize:12,fontWeight:600,color:'var(--text-secondary)',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:2,display:'flex',alignItems:'center',gap:10 },
  pnlSection:{ background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:12,padding:'16px 18px' },
  pnlDivider:{ borderTop:'1px solid var(--border-mid)',margin:'6px 0' },
  typeBadge:{ fontSize:10,padding:'2px 8px',borderRadius:20,fontWeight:500,flexShrink:0 },
}
