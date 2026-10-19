import {tr,trMessage,getLocale} from "../i18n"
import { Fragment,useState, useMemo,useRef } from 'react'
import useAccountingView from '../hooks/useAccountingView'
import {stockPeriodDisclosure} from '../../electron/stockAccounting.mjs'
import {aggregateJournal,formatMoneyCents,journalLineCents} from '../../electron/journalAmounts.mjs'
import './AccountingPage.css'
import { localDate } from '../utils/checkoutSafety.mjs'
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

export default function AccountingPage({ store,session }) {
  const { manualEntries, addManualEntry, deleteManualEntry } = store
  const accounting=useAccountingView(store,session),allJournal=accounting.journals
  const [tab, setTab]   = useState('pnl')

  const now   = new Date()
  const y     = now.getFullYear()
  const m     = String(now.getMonth()+1).padStart(2,'0')
  const [from, setFrom] = useState(`${y}-${m}-01`)
  const [to,   setTo]   = useState(localDate(now))

  const disclosure=useMemo(()=>stockPeriodDisclosure(accounting.report,from,to),[accounting.report,from,to])
  const pnl     = useMemo(() => buildPnL(allJournal, from, to,disclosure), [allJournal, from, to,disclosure])
  const balance = useMemo(() => buildBalanceSheet(allJournal, to,disclosure), [allJournal, to,disclosure])
  const grouped = useMemo(() => groupJournalByDate(
    allJournal.filter(j => j.date >= from && j.date <= to)
  ), [allJournal, from, to])

  function handleExport() {
    if (tab === 'journal') downloadCSV(exportJournalCSV(allJournal.filter(j=>j.date>=from&&j.date<=to)), `日記帳_${from}_${to}.csv`)
    else if (tab === 'pnl') downloadCSV(exportPnLCSV(pnl, from, to), `損益表_${from}_${to}.csv`)
  }

  const validPeriod=!!from&&!!to&&from<=to,canRead=!accounting.loading&&!accounting.error&&validPeriod
  const canExport = canRead&&(tab === 'journal' || tab === 'pnl')

  return (
    <div style={ac.root} className="accounting-page">
      {/* Header */}
      <div style={ac.header}>
        <div>
          <h2 className="page-title" style={ac.title}>{tr("會計帳務")}</h2>
          <div style={{fontSize:12,color:'var(--text-tertiary)',marginTop:2}}>{tr("自動複式記帳 · ")}{allJournal.length}{tr(" 筆分錄")}</div>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <div style={ac.dateRange}>
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={ac.dateInput}/>
            <span style={{color:'var(--text-tertiary)',fontSize:12}}>{tr("至")}</span>
            <input type="date" value={to}   onChange={e=>setTo(e.target.value)}   style={ac.dateInput}/>
          </div>
          {canExport && (
            <button className="btn btn-ghost btn-sm" onClick={handleExport}>
              <Download size={14}/>{tr("匯出 CSV")}</button>
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
            <Icon size={14}/>{tr(label)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={ac.content}>
        {accounting.loading&&<p role="status">{tr('正在核對庫存成本與帳務…')}</p>}
        {accounting.error&&<p role="alert">{trMessage(accounting.error)}</p>}
        {!validPeriod&&<p role="alert">{tr('請確認起訖日期，結束日不能早於開始日')}</p>}
        {canRead&&accounting.report.status==='active'&&<p className="accounting-notice">{tr('成本已按實際庫存異動計算；開帳前的分錄保留原紀錄。')}</p>}
        {canRead&&accounting.report.financialOpening?.pending&&<p role="status" className="accounting-notice">{tr('期初對帳尚未完成')}</p>}
        {canRead&&(!pnl.complete||!balance.complete)&&<p role="status" className="accounting-notice">{tr('成本或帳務仍有待核對項目，完整毛利、淨利與資產不顯示為已確認。')}</p>}
        {canRead&&tab === 'pnl'     && <PnLView     pnl={pnl} from={from} to={to} />}
        {canRead&&tab === 'journal' && <JournalView grouped={grouped} manualEntries={manualEntries} deleteManualEntry={deleteManualEntry} frozenIds={accounting.report.status==='active'?accounting.report.frozenManualIds||[]:[]}/>}
        {canRead&&tab === 'balance' && <BalanceView balance={balance} asOf={to}/>}
        {canRead&&tab === 'expense' && <ExpenseView addManualEntry={addManualEntry} stockActive={accounting.report.status==='active'} onPurchase={()=>store.setView('purchase')}/>}
      </div>
    </div>
  )
}

// ── 損益表 ────────────────────────────────────────────────
function PnLView({ pnl, from, to }) {
  const { revenue, cogs, grossProfit, grossMargin, opExpenses, netIncome, netMargin, expenseLines } = pnl
  const loss = netIncome < 0

  return (
    <div className="accounting-columns" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, overflowY:'auto'}}>
      {/* Main P&L */}
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={ac.cardTitle}>{tr("損益彙總 ")}<span style={{fontSize:11,color:'var(--text-tertiary)',fontWeight:400}}>{from} ~ {to}</span></div>

        <div style={ac.pnlSection}>
          <PnLRow label={tr("營業收入")} cents={pnl.exact.revenue} bold highlight="blue"/>
          <PnLRow label={tr("銷貨成本")} cents={pnl.exact.cogs===null?null:(-BigInt(pnl.exact.cogs)).toString()} sub/>
          <div style={ac.pnlDivider}/>
          <PnLRow label={tr("毛利")} cents={pnl.exact.grossProfit} bold highlight={grossProfit>=0?'green':'red'}/>
          <div style={{fontSize:11,color:'var(--text-tertiary)',textAlign:'right',marginBottom:4}}>{tr("毛利率 ")}{grossMargin===null?'—':grossMargin+'%'}</div>
          <PnLRow label={tr("營業費用")} cents={(-BigInt(pnl.exact.opExpenses)).toString()} sub/>
          <div style={ac.pnlDivider}/>
          <PnLRow label={tr("本期淨利")} cents={pnl.exact.netIncome} bold lg highlight={loss?'red':'gold'}/>
          <div style={{fontSize:11,color:loss?'var(--red)':'var(--text-tertiary)',textAlign:'right',marginTop:4}}>{tr("淨利率 ")}{netMargin===null?'—':netMargin+'%'}</div>
          {!pnl.complete&&<PnLRow label={tr('已知銷貨成本（非完整成本）')} cents={pnl.knownExact.cogs}/>}
        </div>

        {/* Expense breakdown */}
        {expenseLines.length > 0 && (
          <div className="card" style={{padding:'14px 16px'}}>
            <div style={{fontSize:11,color:'var(--text-tertiary)',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:12}}>{tr("費用明細")}</div>
            {expenseLines.map(l=>(
              <div key={l.code} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border-dim)',fontSize:13}}>
                <span style={{color:'var(--text-secondary)'}}>{tr(l.name)}</span>
                <span style={{fontFamily:'var(--font-mono)',color:'var(--red)'}}>({formatMoneyCents(l.amountCents,getLocale())})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Visual cards */}
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={ac.cardTitle}>{tr("關鍵指標")}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {[
            {label:'營業收入', val:`NT$ ${formatMoneyCents(pnl.exact.revenue,getLocale())}`,    color:'var(--blue)'},
            {label:'毛利',     val:pnl.complete?`NT$ ${formatMoneyCents(pnl.exact.grossProfit,getLocale())}`:tr('成本待確認'), color:'var(--teal)'},
            {label:'毛利率',   val:grossMargin===null?'—':`${grossMargin}%`,                    color:'var(--gold)'},
            {label:'本期淨利', val:pnl.complete?`NT$ ${formatMoneyCents(pnl.exact.netIncome,getLocale())}`:tr('成本待確認'),   color: loss?'var(--red)':'var(--green)'},
          ].map(({label,val,color},i)=>(
            <div key={i} className="card" style={{padding:'14px 16px',borderTop:`2px solid ${color}`}}>
              <div style={{fontSize:10,color:'var(--text-tertiary)',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{tr(label)}</div>
              <div style={{fontFamily:'var(--font-mono)',fontSize:18,fontWeight:500,color}}>{val}</div>
            </div>
          ))}
        </div>

        {/* Margin bar */}
        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:12,letterSpacing:'.06em',textTransform:'uppercase'}}>{tr("收支結構")}</div>
          {pnl.complete&&revenue > 0 && (
            <div>
              <div style={{display:'flex',height:24,borderRadius:4,overflow:'hidden',marginBottom:8}}>
                <div style={{width:`${cogs/revenue*100}%`,background:'var(--red)',opacity:.7}} title={tr("銷貨成本 {0}%", {0: Math.round(cogs/revenue*100)})}/>
                <div style={{width:`${opExpenses/revenue*100}%`,background:'var(--amber)',opacity:.7}} title={tr("費用 {0}%", {0: Math.round(opExpenses/revenue*100)})}/>
                <div style={{flex:1,background:'var(--green)',opacity:.7}} title={tr("毛利")}/>
              </div>
              <div style={{display:'flex',gap:14,fontSize:11}}>
                <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:10,height:10,borderRadius:2,background:'var(--red)',opacity:.7,display:'inline-block'}}/><span style={{color:'var(--text-secondary)'}}>{tr("成本 ")}{Math.round(cogs/revenue*100)}%</span></span>
                <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:10,height:10,borderRadius:2,background:'var(--amber)',opacity:.7,display:'inline-block'}}/><span style={{color:'var(--text-secondary)'}}>{tr("費用 ")}{Math.round(opExpenses/revenue*100)}%</span></span>
                <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:10,height:10,borderRadius:2,background:'var(--green)',opacity:.7,display:'inline-block'}}/><span style={{color:'var(--text-secondary)'}}>{tr("淨利 ")}{netMargin}%</span></span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PnLRow({ label, cents, bold, sub, lg, highlight }) {
  const negative=cents!==null&&BigInt(cents)<0n
  const colorMap = { blue:'var(--blue)', green:'var(--green)', red:'var(--red)', gold:'var(--gold-bright)', teal:'var(--teal)' }
  const color = highlight ? colorMap[highlight] : negative ? 'var(--red)' : 'var(--text-primary)'
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:`${lg?10:6}px 0`,marginLeft:sub?16:0}}>
      <span style={{fontSize:sub?12:13,color:sub?'var(--text-secondary)':'var(--text-primary)',fontWeight:bold?600:400}}>{tr(label)}</span>
      <span style={{fontFamily:'var(--font-mono)',fontSize:lg?20:sub?12:14,fontWeight:bold?600:400,color}}>
        {cents===null?tr('成本待確認'):'NT$ '+formatMoneyCents(negative?-BigInt(cents):cents,getLocale())}
        {negative && <span style={{fontSize:10,opacity:.7}}>{tr(" (費)")}</span>}
      </span>
    </div>
  )
}

// ── 日記帳 ────────────────────────────────────────────────
function JournalView({ grouped, manualEntries, deleteManualEntry,frozenIds }) {
  const [expanded, setExpanded] = useState({})
  const toggle = (date) => setExpanded(p=>({...p,[date]:!p[date]}))
  const manualIds = new Set(manualEntries.map(e=>e.id))

  if (grouped.length === 0) return (
    <div style={{textAlign:'center',padding:'60px',color:'var(--text-tertiary)',fontSize:13}}>{tr("此期間無分錄")}</div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,overflowY:'auto',height:'100%'}}>
      {grouped.map(([date, entries]) => {
        const dayTotal=-BigInt(aggregateJournal(entries).accounts['4101']?.netDebitCents||0)
        const open = expanded[date] !== false  // default open
        return (
          <div key={date} className="card" style={{overflow:'hidden'}}>
            <button onClick={()=>toggle(date)} style={{
              display:'flex',alignItems:'center',gap:10,width:'100%',
              padding:'12px 16px',textAlign:'left',transition:'background 120ms',
            }}>
              {open ? <ChevronDown size={14} style={{color:'var(--text-tertiary)',flexShrink:0}}/> : <ChevronRight size={14} style={{color:'var(--text-tertiary)',flexShrink:0}}/>}
              <span style={{fontFamily:'var(--font-mono)',fontSize:13,color:'var(--text-secondary)',minWidth:90}}>{date}</span>
              <span style={{fontSize:12,color:'var(--text-tertiary)'}}>{entries.length}{tr(" 筆分錄")}</span>
              {dayTotal > 0n && <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:13,color:'var(--gold-bright)',fontWeight:500}}>NT$ {formatMoneyCents(dayTotal,getLocale())}</span>}
            </button>

            {open && (
              <div style={{borderTop:'1px solid var(--border-dim)'}}>
                {entries.map(j=>(
                  <div key={j.id} style={{borderBottom:'1px solid var(--border-dim)',padding:'10px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                      <span style={{...ac.typeBadge,...TYPE_STYLE[j.type]||TYPE_STYLE.manual}}>{tr(TYPE_LABEL[j.type]||'手動')}</span>
                      <span style={{fontSize:13,fontWeight:500}}>{['auto_business_sale','auto_customer_ledger','auto_supplier_ledger'].includes(j.type)?tr(j.descriptionKey,j.descriptionValues):j.type==='stock-cost'?trMessage(j.description):j.description}</span>
                      {manualIds.has(j.id)&&!frozenIds.includes(j.id) && (
                        <button className="btn-icon btn-sm" style={{marginLeft:'auto',color:'var(--red)'}} onClick={()=>deleteManualEntry(j.id).catch(e=>alert(trMessage(e.message)))}>
                          <Trash2 size={13}/>
                        </button>
                      )}
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 90px 90px',gap:4,fontSize:11}}>
                      <span style={{color:'var(--text-tertiary)',letterSpacing:'.04em'}}>{tr("科目")}</span>
                      <span style={{color:'var(--text-tertiary)',textAlign:'right'}}>{tr("借方")}</span>
                      <span style={{color:'var(--text-tertiary)',textAlign:'right'}}>{tr("貸方")}</span>
                      {j.lines.map((l,i)=>{const debit=journalLineCents(j,l,'debit'),credit=journalLineCents(j,l,'credit');return (
                        <Fragment key={i}>
                          <span style={{color:'var(--text-secondary)',paddingLeft:debit===0n?16:0}}>
                            {tr(ACCOUNTS[l.account]?.name||l.account)}
                            {l.note && <span style={{color:'var(--text-tertiary)',marginLeft:6}}>— {l.note}</span>}
                          </span>
                          <span style={{fontFamily:'var(--font-mono)',textAlign:'right',color:debit?'var(--blue)':'var(--text-disabled)'}}>
                            {debit?formatMoneyCents(debit,getLocale()):'—'}
                          </span>
                          <span style={{fontFamily:'var(--font-mono)',textAlign:'right',color:credit?'var(--teal)':'var(--text-disabled)'}}>
                            {credit?formatMoneyCents(credit,getLocale()):'—'}
                          </span>
                        </Fragment>
                      )})}
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

const TYPE_LABEL = { 'stock-cost':'庫存成本異動',auto_sale:'銷售', auto_cogs:'成本', auto_discount:'折抵', auto_balance:'儲值折抵', auto_topup:'會員儲值', auto_business_sale:'客戶銷售與應收',auto_customer_ledger:'客戶預收與抵付',auto_supplier_ledger:'供應商預付與抵付',manual:'手動', }
const TYPE_STYLE = {
  auto_business_sale:{background:'var(--blue-dim)',color:'var(--blue)'},
  auto_customer_ledger:{background:'var(--teal-dim)',color:'var(--teal)'},
  auto_supplier_ledger:{background:'var(--blue-dim)',color:'var(--blue)'},
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
  const balanced = balance.complete&&balance.balanced

  return (
    <div className="accounting-columns" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,overflowY:'auto'}}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={ac.cardTitle}>{tr("資產 ")}<span style={{fontFamily:'var(--font-mono)',color:'var(--blue)',fontSize:14,fontWeight:500}}>{balance.complete?'NT$ '+formatMoneyCents(balance.exact.totalAssets,getLocale()):tr('成本待確認')}</span></div>
        <BSSection items={sections.asset.items} color="var(--blue)"/>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={ac.cardTitle}>{tr("負債 + 業主權益")}</div>
        <div style={{...ac.cardTitle,fontSize:12,color:'var(--text-tertiary)'}}>{tr("負債 ")}<span style={{fontFamily:'var(--font-mono)',color:'var(--red)',fontSize:14}}> NT$ {formatMoneyCents(balance.exact.totalLiabilities,getLocale())}</span></div>
        <BSSection items={sections.liability.items} color="var(--red)"/>
        <div style={{fontSize:12,color:'var(--text-tertiary)'}}>{tr("業主權益 ")}<span style={{fontFamily:'var(--font-mono)',color:'var(--green)',fontSize:14}}> {balance.complete?'NT$ '+formatMoneyCents(balance.exact.totalEquity,getLocale()):tr('成本待確認')}</span></div>
        <BSSection items={sections.equity.items} color="var(--green)"/>
        <div className="card" style={{padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',borderLeft:`3px solid ${balanced?'var(--green)':'var(--red)'}`}}>
          <span style={{fontSize:12,color:balanced?'var(--green)':'var(--red)'}}>
            {!balance.complete?tr('成本或帳務待核對'):balanced ? tr("✓ 借貸平衡") : tr("⚠ 借貸不平衡")}
          </span>
          <span style={{fontSize:11,color:'var(--text-tertiary)'}}>{tr("截至 ")}{asOf}</span>
        </div>
      </div>
    </div>
  )
}

function BSSection({ items, color }) {
  if (!items.length) return <div style={{fontSize:12,color:'var(--text-tertiary)',padding:'8px 0'}}>{tr("無資料")}</div>
  return (
    <div className="card" style={{overflow:'hidden'}}>
      {items.map((item,i)=>(
        <div key={item.code} style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',borderBottom:i<items.length-1?'1px solid var(--border-dim)':'none',fontSize:13,alignItems:'center'}}>
          <div>
            <span style={{color:'var(--text-primary)'}}>{tr(item.name)}</span>
            {item.code!=='current-result'&&<span style={{fontSize:10,color:'var(--text-tertiary)',marginLeft:6,fontFamily:'var(--font-mono)'}}>{item.code}</span>}
          </div>
          <span style={{fontFamily:'var(--font-mono)',fontWeight:500,color}}>{formatMoneyCents(item.amountCents,getLocale())}</span>
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

function ExpenseView({ addManualEntry,stockActive,onPurchase }) {
  const saving=useRef(false),creationId=useRef('JM'+crypto.randomUUID())
  const today = localDate()
  const [form, setForm] = useState({ date:today, description:'', amount:'', expenseAccount:'5202', payAccount:'1101', note:'' })
  const [saved, setSaved] = useState(false)

  function applyPreset(preset) {
    setForm(f=>({...f,expenseAccount:preset.account,payAccount:preset.payAccount,description:preset.label}))
  }

  async function handleSave() {
    if(saving.current)return
    if (!form.amount || !form.description || isNaN(parseFloat(form.amount))) return
    const amount  = parseFloat(form.amount)
    const expAcc  = form.expenseAccount
    const payAcc  = form.payAccount
    const isInventory = expAcc === '1211' // 進貨記庫存，不記費用科目

    saving.current=true
    try{await addManualEntry({
      _creationId:creationId.current,
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

    creationId.current='JM'+crypto.randomUUID();setSaved(true)
    setForm(f=>({...f,description:'',amount:'',note:''}))
    setTimeout(()=>setSaved(false), 2000)
    }catch(e){alert(tr("帳務未確認保存，請保留內容並核對：{0}", {0: trMessage(e.message)}))}finally{saving.current=false}
  }

  const EXPENSE_ACC = Object.entries(ACCOUNTS)
    .filter(([,v])=>v.type==='expense'||v.code==='1211')
    .filter(([k])=>k!=='5301')

  return (
    <div style={{maxWidth:560,margin:'0 auto',display:'flex',flexDirection:'column',gap:16}}>
      <div style={ac.cardTitle}>{tr("記錄費用 / 進貨")}</div>

      {/* Presets */}
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {EXPENSE_PRESETS.filter(row=>!stockActive||row.account!=='1211').map(p=>(
          <button key={p.label} className="btn btn-ghost btn-sm" onClick={()=>applyPreset(p)} style={{fontSize:12}}>
            {tr(p.label)}
          </button>
        ))}
      </div>
      {stockActive&&<button className="btn btn-ghost" onClick={onPurchase}>{tr('進貨請到進貨管理，數量與成本會一起保存')}</button>}

      <div className="card" style={{padding:'20px 22px',display:'flex',flexDirection:'column',gap:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div>
            <FieldLabel>{tr("日期")}</FieldLabel>
            <input type="date" className="field" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
          </div>
          <div>
            <FieldLabel>{tr("金額 (NT$) *")}</FieldLabel>
            <input type="number" className="field" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0" style={{fontFamily:'var(--font-mono)'}}/>
          </div>
        </div>

        <div>
          <FieldLabel>{tr("摘要 *")}</FieldLabel>
          <input className="field" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder={tr("例：三月份租金、水電費")}/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div>
            <FieldLabel>{tr("費用科目")}</FieldLabel>
            <select className="field" value={form.expenseAccount} onChange={e=>setForm(f=>({...f,expenseAccount:e.target.value}))} style={{cursor:'pointer'}}>
              {Object.entries(ACCOUNTS).filter(([,v])=>v.type==='expense'||v.code==='1211').map(([k,v])=>(
                <option key={k} value={k}>{k} {tr(v.name)}</option>
              ))}
              {!stockActive&&<option value="1211">{tr("1211 存貨（進貨）")}</option>}
            </select>
          </div>
          <div>
            <FieldLabel>{tr("付款方式")}</FieldLabel>
            <select className="field" value={form.payAccount} onChange={e=>setForm(f=>({...f,payAccount:e.target.value}))} style={{cursor:'pointer'}}>
              <option value="1101">{tr("1101 現金")}</option>
              <option value="1103">{tr("1103 銀行存款")}</option>
              <option value="2101">{tr("2101 應付帳款（賒帳）")}</option>
            </select>
          </div>
        </div>

        <div>
          <FieldLabel>{tr("備註")}</FieldLabel>
          <input className="field" value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))} placeholder={tr("（選填）")}/>
        </div>

        <button className="btn btn-primary" onClick={handleSave} style={{width:'100%',padding:13}}>
          {saved ? <><Check size={16}/>{tr("已記帳")}</> : tr("記帳")}
        </button>
      </div>

      <div className="card" style={{padding:'14px 16px'}}>
        <div style={{fontSize:11,color:'var(--text-tertiary)',lineHeight:1.8}}>
          <div>{tr('每筆結帳依付款與成本紀錄自動產生分錄。')}</div>
          <div>{tr("💰 此頁面補登 ")}<strong style={{color:'var(--text-secondary)'}}>{tr("費用、進貨、薪資")}</strong>{tr(" 等非銷售支出")}</div>
          <div>{tr("📊 所有資料自動彙整至損益表與資產負債表")}</div>
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
  content:{ flex:1,overflow:'auto',paddingTop:16,minHeight:0 },
  cardTitle:{ fontSize:12,fontWeight:600,color:'var(--text-secondary)',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:2,display:'flex',alignItems:'center',gap:10 },
  pnlSection:{ background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:12,padding:'16px 18px' },
  pnlDivider:{ borderTop:'1px solid var(--border-mid)',margin:'6px 0' },
  typeBadge:{ fontSize:10,padding:'2px 8px',borderRadius:20,fontWeight:500,flexShrink:0 },
}
