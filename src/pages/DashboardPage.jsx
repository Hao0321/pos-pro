import {tr,trMessage,getLocale} from "../i18n"
import { settledOrders, netSale, orderCost } from '../utils/orderLedger'
import { useMemo, useEffect, useState } from 'react'
import {
  TrendingUp, ShoppingBag, Users, Package, AlertTriangle,
  DollarSign, Target, Award, Calendar, Clock, ArrowUpRight, ArrowDownRight,
  Truck, BarChart2, Percent, Sparkles,
} from 'lucide-react'
import { getSetting, setSetting } from '../utils/dataAccess'
import { averageTicket, profitAnalysis, getExpiringProducts, getReorderList, customerSegmentation, computeAllRFM } from '../utils/analytics'
import {businessReportRows,reportDay,reportLineRevenue} from '../utils/businessReports'
import {salesDate} from '../../electron/salesRules.mjs'
import useSalesReportView from '../hooks/useSalesReportView'
import ReportCostStatus from '../components/ReportCostStatus'
import {formatMoneyCents,centsNumber} from '../../electron/journalAmounts.mjs'

export default function DashboardPage({ store:sourceStore, session }) {
  const view=useSalesReportView(sourceStore,session),report=view.report,actual=report?.status==='active',waiting=view.loading||!!view.error
  const store=actual?{...sourceStore,...report.data}:sourceStore
  const { products, members, orders:posOrders, todayRevenue:referenceRevenue, todayOrders, todayProfit:referenceProfit, lowStockCount, openShift } = store
  const todayRevenue=actual?centsNumber(report.periods.today.revenueCents):referenceRevenue
  const todayProfit=waiting?null:actual?(report.periods.today.profitCents===null?null:centsNumber(report.periods.today.profitCents)):referenceProfit
  const revenueText=waiting?'—':actual?formatMoneyCents(report.periods.today.revenueCents):todayRevenue.toLocaleString()
  const profitText=waiting?'—':todayProfit===null?tr('成本待確認'):actual?'$'+formatMoneyCents(report.periods.today.profitCents):'$'+todayProfit.toLocaleString()
  const orders=useMemo(()=>[...posOrders,...businessReportRows(store.sales?.documents||[])],[posOrders,store.sales?.documents])
  const [salesGoal, setSalesGoal] = useState(0)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState('')

  useEffect(() => {
    getSetting('dailySalesGoal').then(v => {
      const n = parseFloat(v) || 0
      setSalesGoal(n)
      setGoalInput(String(n))
    })
  }, [])

  const handleSaveGoal = async () => {
    const n = parseFloat(goalInput) || 0
    setSalesGoal(n)
    await setSetting('dailySalesGoal', String(n))
    setEditingGoal(false)
  }

  // 統計
  const stats = useMemo(() => {
    // 排除完整退貨配對（原訂單 status='refunded' + 對應的全退負數訂單）；
    // 部分退貨保留：原訂單 (status='completed') 與負數退貨訂單兩邊都計入，總和會正確
    const validOrders = settledOrders(orders)
    const today = report?.today||store.sales?.today||salesDate(new Date())
    const yesterday = new Date(Date.parse(today)-86400000).toISOString().slice(0,10)
    const ordersToday    = validOrders.filter(o => reportDay(o) === today)
    const ordersYesterday = validOrders.filter(o => reportDay(o) === yesterday)
    const revYesterday    = actual?centsNumber(report.periods.yesterday.revenueCents):ordersYesterday.reduce((s,o) => s + netSale(o), 0)
    const revDelta = revYesterday > 0 ? ((todayRevenue - revYesterday) / revYesterday * 100) : 0

    // 最近 7 天
    const last7 = Array.from({length:7}, (_,i) => {
      const d = new Date(); d.setDate(d.getDate() - (6-i))
      const ds = new Date(Date.parse(today)-(6-i)*86400000).toISOString().slice(0,10)
      const dayOrders = validOrders.filter(o => reportDay(o) === ds)
      return { date: d, label: d.getDate() + '日', revenue: actual?centsNumber(report.days[i].revenueCents):dayOrders.reduce((s,o)=>s+netSale(o),0), count: dayOrders.length }
    })
    const max7 = Math.max(...last7.map(d => d.revenue), 1)

    // 暢銷 Top 5
    const itemMap = {}
    ordersToday.forEach(o => {
      (o.items||[]).forEach(i => {
        if (!itemMap[i.id]) itemMap[i.id] = { name: i.name, qty: 0, revenue: 0 }
        itemMap[i.id].qty += i.qty
        itemMap[i.id].revenue += reportLineRevenue(i)
      })
    })
    const topItems = Object.values(itemMap).sort((a,b)=>b.qty-a.qty).slice(0,5)

    // 低庫存
    const lowStock = products.filter(p => p.stock > 0 && p.stock <= 5).slice(0, 5)
    const outOfStock = products.filter(p => p.stock === 0).length

    // 即期商品
    const today0 = new Date(); today0.setHours(0,0,0,0)
    const expiringSoon = products.filter(p => {
      if (!p.expiryDate) return false
      const exp = new Date(p.expiryDate)
      const days = Math.floor((exp - today0) / 86400000)
      return days >= 0 && days <= 7
    }).slice(0, 5)

    return { ordersToday, revDelta, last7, max7, topItems, lowStock, outOfStock, expiringSoon }
  }, [orders, products, todayRevenue,actual,report])

  // 30 天指標（analytics utils）
  const analytics30d = useMemo(() => {
    const avgTicket = averageTicket(orders, 30)
    const profit = profitAnalysis(orders, products, 30)
    const segmentation = customerSegmentation(orders, members)
    const reorderList = getReorderList(products)
    const { expired, soon } = getExpiringProducts(products, 7)
    const rfmList = computeAllRFM(members, orders)
    const tagCounts = rfmList.reduce((acc, m) => {
      const tag = m.rfm?.tag || '未消費'
      acc[tag] = (acc[tag] || 0) + 1
      return acc
    }, {})
    return { avgTicket, profit, segmentation, reorderList, expired, soon, tagCounts, rfmList }
  }, [orders, products, members])

  const goalPct = salesGoal > 0 ? Math.min(100, todayRevenue / salesGoal * 100) : 0

  return (
    <div style={ds.root} data-dashboard>
      <ReportCostStatus view={view}/>
      {/* 營運摘要 */}
      <div style={ds.hero} className="animate-up">
        <div style={{position:'relative', zIndex:1}}>
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:8, fontSize:12.5, color:'var(--text-tertiary)', fontWeight:500}}>
            <Calendar size={13}/>
            {new Date().toLocaleDateString(getLocale(), { year:'numeric', month:'long', day:'numeric', weekday:'long' })}
          </div>
          <h1 style={{fontSize:'clamp(22px,3vw,32px)', fontWeight:800, letterSpacing:'-.02em', color:'var(--text-primary)'}}>
            {tr(greet())}，<span style={{background:'var(--accent-grad)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>{session?.username || tr("使用者")}</span>
          </h1>
          <div style={{fontSize:14, color:'var(--text-secondary)', marginTop:6}}>{tr("今天有 ")}<strong style={{color:'var(--accent-deep)'}}>{stats.ordersToday.length}</strong>{tr(" 筆訂單，營收 ")}<strong style={{color:'var(--accent-deep)', fontFamily:'var(--font-mono)'}}>${revenueText}</strong>
          </div>
        </div>
        {openShift && (
          <div style={ds.shiftBadge}>
            <span style={ds.liveDot}/>{tr("營業中 · 開班 ")}{new Date(openShift.openTime).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit'})}
          </div>
        )}
      </div>

      {/* KPI cards — 今日 */}
      <div style={ds.kpiGrid}>
        <KpiCard metric="revenue" icon={DollarSign} color="gold" label={tr("今日營收")} value={`$${revenueText}`}
          delta={stats.revDelta} subtitle={tr("比昨日 {0}{1}%", {0: stats.revDelta >= 0 ? '+' : '', 1: stats.revDelta.toFixed(1)})} idx={0}/>
        <KpiCard icon={ShoppingBag} color="blue" label={tr("今日訂單")}
          value={stats.ordersToday.length} subtitle={tr("平均 ${0}/單", {0: stats.ordersToday.length ? Math.round(todayRevenue / stats.ordersToday.length) : 0})} idx={1}/>
        <KpiCard metric="profit" icon={TrendingUp} color="green" label={tr("今日毛利")}
          value={profitText} subtitle={waiting||todayProfit===null?'':tr("毛利率 {0}%", {0: actual?report.periods.today.margin:todayRevenue > 0 ? (todayProfit/todayRevenue*100).toFixed(1) : 0})} idx={2}/>
        <KpiCard icon={Users} color="teal" label={tr("會員 / 商品")} value={`${members.length} / ${products.length}`} subtitle={tr("會員數 / 商品數")} idx={3}/>
      </div>

      <details data-dashboard-details><summary style={{minHeight:48,cursor:'pointer',fontSize:16,padding:'12px 0'}}>{tr('看明細')}</summary>
      {/* 30 天指標 row */}
      <div style={ds.kpiGrid}>
        <KpiCard icon={BarChart2} color="purple" label={tr("30 天客單價")}
          value={`$${Math.round(analytics30d.avgTicket.avg).toLocaleString()}`}
          subtitle={tr("{0} 筆訂單", {0: analytics30d.avgTicket.count})} idx={0}/>
        <KpiCard metric="margin30" icon={Percent} color="green" label={tr("30 天毛利率")}
          value={waiting?'—':actual?(report.periods.last30.margin===null?tr('成本待確認'):report.periods.last30.margin+'%'):`${analytics30d.profit.marginRate.toFixed(1)}%`}
          subtitle={waiting?'':actual?(report.periods.last30.profitCents===null?'':tr('毛利 ${0}',{0:formatMoneyCents(report.periods.last30.profitCents)})):tr("毛利 ${0}", {0: Math.round(analytics30d.profit.profit).toLocaleString()})} idx={1}/>
        <KpiCard icon={Truck} color="amber" label={tr("待補貨")}
          value={analytics30d.reorderList.length}
          subtitle={analytics30d.reorderList.length > 0 ? tr("點進貨管理 ➜") : tr("庫存充足")} idx={2}/>
        <KpiCard icon={Clock} color="red" label={tr("即將/已過期")}
          value={`${analytics30d.soon.length} / ${analytics30d.expired.length}`}
          subtitle={tr("7天內 / 已過期")} idx={3}/>
      </div>

      {/* 會員結構 */}
      <div style={ds.card}>
        <div style={ds.cardHead}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <Sparkles size={16} color="var(--purple)"/>
            <span style={{fontWeight:600}}>{tr("會員結構（30 天）")}</span>
          </div>
          <span style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr("會員占 ")}{analytics30d.segmentation.memberRevenue + analytics30d.segmentation.anonRevenue > 0
              ? ((analytics30d.segmentation.memberRevenue / (analytics30d.segmentation.memberRevenue + analytics30d.segmentation.anonRevenue)) * 100).toFixed(0)
              : 0}{tr("% 營收")}</span>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:8, marginTop:8}}>
          {[
            ['VIP', analytics30d.tagCounts['VIP'] || 0, 'var(--gold)'],
            ['核心會員', analytics30d.tagCounts['核心會員'] || 0, 'var(--green)'],
            ['新會員', analytics30d.tagCounts['新會員'] || 0, 'var(--blue)'],
            ['流失預警', analytics30d.tagCounts['流失預警'] || 0, 'var(--amber)'],
            ['沉睡會員', analytics30d.tagCounts['沉睡會員'] || 0, 'var(--red)'],
          ].map(([tag, n, color]) => (
            <div key={tag} style={{padding:'10px 12px', background:'var(--bg-overlay)', borderRadius:8, borderTop:`2px solid ${color}`}}>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:3}}>{tr(tag)}</div>
              <div style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)', color}}>{n}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 銷售目標 */}
      <div style={ds.card}>
        <div style={ds.cardHead}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <Target size={16} color="var(--gold)"/>
            <span style={{fontWeight:600}}>{tr("今日銷售目標")}</span>
          </div>
          {!editingGoal ? (
            <button className="btn btn-ghost btn-sm" onClick={()=>setEditingGoal(true)}>{tr("設定目標")}</button>
          ) : (
            <div style={{display:'flex', gap:6}}>
              <input className="field" type="number" value={goalInput} onChange={e=>setGoalInput(e.target.value)}
                style={{width:120, padding:'4px 8px', fontSize:13}}/>
              <button className="btn btn-primary btn-sm" onClick={handleSaveGoal}>{tr("儲存")}</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>{setEditingGoal(false);setGoalInput(String(salesGoal))}}>{tr("取消")}</button>
            </div>
          )}
        </div>
        {salesGoal > 0 ? (
          <>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6}}>
              <span style={{fontFamily:'var(--font-mono)', fontSize:18, fontWeight:600}}>
                NT$ {todayRevenue.toLocaleString()} <span style={{fontSize:12, color:'var(--text-tertiary)', fontWeight:400}}>/ {salesGoal.toLocaleString()}</span>
              </span>
              <span style={{fontSize:14, fontWeight:600, color: goalPct >= 100 ? 'var(--green)' : 'var(--gold)'}}>
                {goalPct.toFixed(0)}%
              </span>
            </div>
            <div style={ds.progressBar}>
              <div style={{...ds.progressFill, width: `${goalPct}%`, background: goalPct >= 100 ? 'var(--green)' : 'var(--gold)'}}/>
            </div>
            <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:6}}>
              {goalPct >= 100 ? tr("🎉 已達標！") : tr("還差 NT$ {0}", {0: Math.max(0, salesGoal - todayRevenue).toLocaleString()})}
            </div>
          </>
        ) : (
          <div style={{color:'var(--text-tertiary)', fontSize:13, textAlign:'center', padding:'12px 0'}}>{tr("尚未設定目標")}</div>
        )}
      </div>

      <div style={ds.row2}>
        {/* 7 天趨勢 */}
        <div style={ds.card}>
          <div style={ds.cardHead}>
            <span style={{fontWeight:600}}>{tr("近 7 天營收")}</span>
          </div>
          <div style={{display:'flex', alignItems:'flex-end', gap:8, height:140, padding:'8px 0'}}>
            {stats.last7.map((d,i) => {
              const h = d.revenue / stats.max7 * 100
              const isToday = i === stats.last7.length - 1
              return (
                <div key={i} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
                  <div style={{fontSize:10, color:'var(--text-tertiary)', fontFamily:'var(--font-mono)'}}>
                    {d.revenue > 0 ? Math.round(d.revenue/1000)+'k' : ''}
                  </div>
                  <div style={{flex:1, width:'100%', display:'flex', alignItems:'flex-end'}}>
                    <div style={{
                      width:'100%', height:`${Math.max(2, h)}%`,
                      background: isToday ? 'var(--gold)' : 'var(--accent-dim)',
                      borderRadius:'4px 4px 0 0',
                    }}/>
                  </div>
                  <div style={{fontSize:11, color: isToday ? 'var(--gold)' : 'var(--text-tertiary)', fontWeight: isToday ? 600 : 400}}>
                    {trMessage(d.label)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 暢銷 Top 5 */}
        <div style={ds.card}>
          <div style={ds.cardHead}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <Award size={16} color="var(--gold)"/>
              <span style={{fontWeight:600}}>{tr("今日熱銷")}</span>
            </div>
          </div>
          {stats.topItems.length === 0 ? (
            <div style={ds.empty}>{tr("今日尚無銷售")}</div>
          ) : stats.topItems.map((item, i) => (
            <div key={i} style={ds.topRow}>
              <div style={{...ds.rank, background: i===0?'var(--gold)':i===1?'var(--accent-dim)':'var(--bg-overlay)', color: i===0?'#fff':'var(--text-secondary)'}}>{i+1}</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{item.name}</div>
                <div style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr("賣出 ")}{item.qty}{tr(" 件")}</div>
              </div>
              <div style={{fontFamily:'var(--font-mono)', fontWeight:500, fontSize:13}}>NT$ {item.revenue.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={ds.row2}>
        {/* 低庫存警示 */}
        <div style={ds.card}>
          <div style={ds.cardHead}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <Package size={16} color="var(--amber)"/>
              <span style={{fontWeight:600}}>{tr("庫存警示")}</span>
              {lowStockCount > 0 && <span className="badge badge-amber">{lowStockCount}</span>}
            </div>
          </div>
          {stats.lowStock.length === 0 && stats.outOfStock === 0 ? (
            <div style={ds.empty}>{tr("庫存充足")}</div>
          ) : (
            <>
              {stats.outOfStock > 0 && (
                <div style={{padding:'8px 0', borderBottom:'1px solid var(--border-dim)', display:'flex', alignItems:'center', gap:8}}>
                  <AlertTriangle size={14} color="var(--red)"/>
                  <span style={{fontSize:13, color:'var(--red)'}}>{stats.outOfStock}{tr(" 項商品缺貨")}</span>
                </div>
              )}
              {stats.lowStock.map(p => (
                <div key={p.id} style={ds.topRow}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</div>
                    <div style={{fontSize:11, color:'var(--text-tertiary)'}}>{p.category}</div>
                  </div>
                  <span style={{fontFamily:'var(--font-mono)', fontSize:13, color:'var(--amber)', fontWeight:600}}>{p.stock} {p.unit}</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* 即期商品 */}
        <div style={ds.card}>
          <div style={ds.cardHead}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <Clock size={16} color="var(--red)"/>
              <span style={{fontWeight:600}}>{tr("近 7 天到期")}</span>
            </div>
          </div>
          {stats.expiringSoon.length === 0 ? (
            <div style={ds.empty}>{tr("無即期商品")}</div>
          ) : stats.expiringSoon.map(p => {
            const days = Math.floor((new Date(p.expiryDate) - new Date()) / 86400000)
            return (
              <div key={p.id} style={ds.topRow}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</div>
                  <div style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr("到期 ")}{p.expiryDate}</div>
                </div>
                <span style={{fontFamily:'var(--font-mono)', fontSize:13, color: days <= 1 ? 'var(--red)' : 'var(--amber)', fontWeight:600}}>
                  {days <= 0 ? tr("今日") : tr("{0}天", {0: days})}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      </details>
    </div>
  )
}

function KpiCard({ icon: Icon, color, label, value, subtitle, delta, idx = 0,metric }) {
  return (
    <div data-dashboard-kpi={metric} className="card card-hover animate-up" style={{...ds.kpi,minWidth:0,overflowWrap:'anywhere', animationDelay:`${idx*60}ms`}}>
      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14}}>
        <span className="section-title" style={{margin:0}}>{tr(label)}</span>
        <div style={{...ds.kpiIcon, background: `var(--${color}-dim)`, color: `var(--${color})`}}>
          <Icon size={18}/>
        </div>
      </div>
      <div style={{fontSize:28, fontWeight:800, fontFamily:'var(--font-mono)', color:'var(--text-primary)', letterSpacing:'-.02em', lineHeight:1}}>
        {value}
      </div>
      {subtitle && (
        <div style={{fontSize:11.5, color: delta != null && delta >= 0 ? 'var(--green)' : delta != null && delta < 0 ? 'var(--red)' : 'var(--text-tertiary)', marginTop:8, display:'flex', alignItems:'center', gap:4, fontWeight:600}}>
          {delta != null && (delta >= 0 ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>)}
          {trMessage(subtitle)}
        </div>
      )}
    </div>
  )
}

function greet() {
  const h = new Date().getHours()
  if (h < 5) return '深夜辛苦了'
  if (h < 12) return '早安'
  if (h < 18) return '午安'
  return '晚安'
}

const ds = {
  root: { flex:1, overflowY:'auto', padding:'clamp(16px,2vw,24px)', background:'var(--bg-base)' },
  hero: {
    position:'relative',
    padding:'20px 24px',
    marginBottom:20,
    borderRadius:'var(--r4)',
    background:'var(--bg-raised)',
    border:'1px solid var(--border-dim)',
    boxShadow:'var(--shadow-sm)',
    overflow:'hidden',
    display:'flex', justifyContent:'space-between', alignItems:'center', gap:16,
    flexWrap:'wrap',
  },
  shiftBadge: {
    position:'relative', zIndex:1,
    display:'flex', alignItems:'center', gap:8,
    padding:'10px 16px',
    background:'var(--green-dim)',
    color:'var(--green)',
    borderRadius:'var(--r-pill)',
    fontSize:13, fontWeight:600,
    border:'1px solid rgba(22,163,74,0.25)',
  },
  liveDot:{
    width:8, height:8, borderRadius:'50%',
    background:'var(--green)',
    boxShadow:'0 0 0 0 var(--green)',
    animation:'pulseGlow 1.6s var(--ease) infinite',
  },
  kpiGrid: {
    display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',
    gap:14, marginBottom:18,
  },
  kpi: {
    padding:'18px 20px', borderRadius:'var(--r3)',
  },
  kpiIcon: {
    width:38, height:38, borderRadius:'var(--r2)',
    display:'flex', alignItems:'center', justifyContent:'center',
    flexShrink:0,
  },
  card: {
    background:'var(--bg-raised)',
    border:'1px solid var(--border-dim)',
    borderRadius:'var(--r3)',
    padding:'18px 20px', boxShadow:'var(--shadow-sm)',
    marginBottom:14,
  },
  cardHead: {
    display:'flex', justifyContent:'space-between', alignItems:'center',
    marginBottom:14, fontSize:13,
  },
  row2: {
    display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%,300px), 1fr))',
    gap:14,
  },
  topRow: {
    display:'flex', alignItems:'center', gap:12,
    padding:'10px 0', borderBottom:'1px solid var(--border-dim)',
  },
  rank: {
    width:26, height:26, borderRadius:'50%',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:11, fontWeight:700, flexShrink:0,
    fontFamily:'var(--font-mono)',
  },
  empty: { textAlign:'center', color:'var(--text-tertiary)', fontSize:13, padding:'24px 0', fontWeight:500 },
  progressBar: {
    height:10, background:'var(--bg-overlay)',
    borderRadius:'var(--r-pill)', overflow:'hidden',
    boxShadow:'inset 0 1px 2px rgba(0,0,0,0.04)',
  },
  progressFill: {
    height:'100%', borderRadius:'var(--r-pill)',
    transition:'width 800ms var(--ease)',
    boxShadow:'inset 0 1px 0 rgba(255,255,255,0.2)',
  },
}
