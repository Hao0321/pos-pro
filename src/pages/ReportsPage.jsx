import {tr,trMessage} from "../i18n"
import { settledOrders, netSale, orderCost } from '../utils/orderLedger'
import { useMemo, useState } from 'react'
import { TrendingUp, ShoppingCart, Users, Package, ArrowUp, ArrowDown, Download, Zap, AlertTriangle, Trophy } from 'lucide-react'
import { exportXLS } from '../utils/exportXLS'
import { productPerformance,classifyProductRevenue } from '../utils/analytics'
import {businessReportRows,businessCashFlows,reportDay,reportLineRevenue} from '../utils/businessReports'
import {salesDate,salesSummary} from '../../electron/salesRules.mjs'

export default function ReportsPage({ store }) {
  const { orders: rawOrders, products, members } = store
  const [range, setRange] = useState('today')

  const now = new Date()
  // 排除完整退貨配對；部分退貨保留兩邊（原訂單 + 負數退貨訂單），總額自動抵銷正確
  const businessDocuments=store.sales?.documents||[]
  const customerEntries=store.sales?.customerLedger?.entries
  const supplierEntries=store.supplierState?.supplierLedger.entries
  const orders = useMemo(()=>[...settledOrders(rawOrders),...businessReportRows(businessDocuments)],[rawOrders,businessDocuments])
  const today=store.sales?.today||salesDate(now)
  function inRange(day){const age=(Date.parse(today)-Date.parse(day))/86400000;return range==='today'?day===today:range==='week'?age>=0&&age<7:range==='month'?day.slice(0,7)===today.slice(0,7):true}
  const filtered = useMemo(() => orders.filter(o => {
    return inRange(reportDay(o))
  }), [orders, range,today])

  const prev = useMemo(() => {
    const shift = range==='today'?864e5 : range==='week'?7*864e5 : 30*864e5
    return orders.filter(o => {
      const age=Date.parse(today)-Date.parse(reportDay(o))
      return age>=shift&&age<shift*2
    })
  }, [orders, range,today])

  const revenue = Math.round(filtered.reduce((s,o)=>s+netSale(o),0)*100)/100
  const prevRevenue = Math.round(prev.reduce((s,o)=>s+netSale(o),0)*100)/100
  const revDelta = prevRevenue ? ((revenue-prevRevenue)/prevRevenue*100).toFixed(1) : null

  const profit=useMemo(()=>Math.round(filtered.reduce((sum,o)=>sum+netSale(o)-orderCost(o,products),0)*100)/100,[filtered,products])

  const saleCount=filtered.filter(row=>!row.refundOf).length
  const avgOrder = saleCount ? Math.round(revenue / saleCount) : 0
  const currentReceivables=businessDocuments.map(doc=>salesSummary(doc,today,store.sales?.customerLedger?.entries)).reduce((sum,row)=>sum+row.owed,0)
  const newMembers = members.filter(m => {
    const d = new Date(m.joinDate)
    if (range === 'today') return d.toDateString()===now.toDateString()
    if (range === 'week')  return (now-d) < 7*864e5
    return d.getMonth()===now.getMonth()
  }).length

  // Top products
  const topProducts = useMemo(() => {
    const map = {}
    filtered.forEach(o => o.items.forEach(i => {
      if (!map[i.id]) map[i.id] = { name:i.name, qty:0, revenue:0 }
      map[i.id].qty += i.qty
      map[i.id].revenue += reportLineRevenue(i)
    }))
    return Object.values(map).sort((a,b)=>b.revenue-a.revenue).slice(0,8)
  }, [filtered])

  const maxRevenue = topProducts[0]?.revenue || 1

  // Hourly chart (today)
  const hourly = useMemo(() => {
    const arr = Array(24).fill(0)
    const src = range==='today' ? filtered : orders.filter(o=>reportDay(o)===today)
    src.forEach(o => arr[new Date(o.time).getHours()] += o.total)
    return arr
  }, [filtered, orders, range])
  const maxHour = Math.max(...hourly, 1)

  // Pay method breakdown (支援混合付款拆分)
  const payBreakdown = useMemo(() => {
    let cash = 0, card = 0,bank=0
    for (const o of filtered.filter(row=>row.source!=='business-report')) {
      if (o.payMethod === 'cash') cash += o.total
      else if (o.payMethod === 'mixed' && Array.isArray(o.payments)) {
        for (const p of o.payments) {
          if (p.method === 'cash') cash += p.amount
          else card += p.amount
        }
      } else card += o.total
    }
    for(const row of businessCashFlows(businessDocuments,customerEntries,store.purchases,supplierEntries).filter(row=>inRange(row.date))){if(row.method==='cash')cash+=row.amount;else bank+=row.amount}
    return { cash, card,bank, total: cash+card+bank }
  }, [filtered,businessDocuments,customerEntries,store.purchases,supplierEntries,range,today])

  // 30 天商品表現分析（基於 store.orders 全部訂單，獨立於 range filter）
  const perf30d = useMemo(() => productPerformance(products, orders, 30), [products, orders])

  // 員工績效（依當前期間）
  const staffPerf = useMemo(() => {
    const map = {}
    for (const o of filtered) {
      if (o.refundOf) continue // 不計入退貨負數訂單
      const cashier = o.cashier || '未指定'
      if (!map[cashier]) map[cashier] = { cashier, orders: 0, revenue: 0, refunds: 0 }
      map[cashier].orders += 1
      map[cashier].revenue += o.total || 0
    }
    // 計入退貨筆數
    for (const o of filtered) {
      if (!o.refundOf) continue
      const cashier = o.cashier || '未指定'
      if (!map[cashier]) map[cashier] = { cashier, orders: 0, revenue: 0, refunds: 0 }
      map[cashier].refunds += 1
      map[cashier].revenue += o.total || 0 // 負數
    }
    return Object.values(map)
      .map(s => ({ ...s, avgTicket: s.orders > 0 ? s.revenue / s.orders : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [filtered])

  // ABC 分析（依累計營收佔比分類）
  const abcAnalysis = useMemo(() => {
    const map = new Map()
    filtered.forEach(o => o.items.forEach(i => {
      if (!map.has(i.id)) map.set(i.id,{ id:i.id, name:i.name, qty:0, revenue:0 })
      map.get(i.id).qty += i.qty
      map.get(i.id).revenue += reportLineRevenue(i)
    }))
    return classifyProductRevenue([...map.values()])
  }, [filtered])

  function exportReport() {
    const rangeLabel = { today:'今日', week:'本週', month:'本月', all:'全部' }[range]
    const rows = [
      [`銷售報表 - ${rangeLabel}`],
      [`匯出時間：${new Date().toLocaleString('zh-TW')}`],
      [],
      ['指標', '數值'],
      ['營業額', revenue],
      ['毛利', profit],
      ['毛利率(%)', revenue > 0 ? (profit/revenue*100).toFixed(1) : 0],
      ['銷售筆數', saleCount],
      ['每筆銷售平均', avgOrder],
      ['現金淨收付', payBreakdown.cash],
      ['電子支付淨收付', payBreakdown.card],
      ['銀行淨收付',payBreakdown.bank],
      [],
      ['暢銷商品 Top 8'],
      ['排名', '商品', '數量', '營收'],
      ...topProducts.map((p,i) => [i+1, p.name, p.qty, p.revenue]),
      [],
      ['ABC 分析'],
      ['商品', '銷量', '營收', '營收佔比%', '累計%', '類別'],
      ...abcAnalysis.items.map(p => [
        p.name, p.qty, p.revenue,
        (abcAnalysis.total>0?Math.max(0,p.revenue)/abcAnalysis.total*100:0).toFixed(2),
        p.cumPct.toFixed(2),
        p.cls,
      ]),
      [],
      ['訂單明細'],
      ['訂單編號','時間','付款方式','金額','會員','點數獲得','統編'],
      ...filtered.map(o => [
        o.id,
        new Date(o.time).toLocaleString('zh-TW'),
        o.source==='business-report'?'客戶交付／折抵':o.payMethod === 'cash' ? '現金' : o.payMethod === 'card' ? '電子' : '混合',
        o.total,
        o.memberId ? (members.find(m=>m.id===o.memberId)?.name || '') : '',
        o.pointsEarned || 0,
        o.taxId || '',
      ]),
    ]
    exportXLS(rows, `銷售報表_${rangeLabel}_${new Date().toISOString().slice(0,10)}.xls`)
  }

  const RANGES = [['today','今日'],['week','本週'],['month','本月'],['all','全部']]
  const KPIS = [
    { label:'營業額', value:`NT$ ${revenue.toLocaleString()}`, delta:revDelta, icon:<TrendingUp size={16}/>, color:'var(--gold)' },
    { label:'毛利',   value:`NT$ ${profit.toLocaleString()}`,  delta:null,     icon:<ArrowUp size={16}/>,   color:'var(--green)' },
    { label:'銷售筆數', value:`${saleCount} 筆`,           delta:null,     icon:<ShoppingCart size={16}/>, color:'var(--blue)' },
    { label:'每筆銷售平均', value:`NT$ ${avgOrder.toLocaleString()}`, delta:null,    icon:<Package size={16}/>,   color:'var(--teal)' },
  ]

  return (
    <div style={rs.root}>
      <div style={rs.topBar}>
        <h2 className="page-title" style={rs.title}>{tr("報表分析")}</h2>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <div style={{display:'flex', gap:4}}>
            {RANGES.map(([k,l])=>(
              <button key={k} onClick={()=>setRange(k)} style={{
                ...rs.rangeBtn,
                background: range===k?'var(--gold)':'var(--bg-overlay)',
                color: range===k?'#fff':'var(--text-secondary)',
              }}>{tr(l)}</button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={exportReport} style={{display:'flex', alignItems:'center', gap:4}}>
            <Download size={14}/>{tr(" 匯出 Excel")}</button>
        </div>
      </div>

      {/* KPI row */}
      {businessDocuments.length>0&&<section className="card" style={{padding:18,marginBottom:16,lineHeight:1.8}} data-business-report><p>{tr('營業額與毛利包含收銀及客戶交付，分批交付每批算一筆銷售；收款不再重複計入營業額。')}</p><p>{tr('目前全部客戶未付款：{0}',{0:'NT$ '+currentReceivables.toLocaleString(undefined,{maximumFractionDigits:2})})}</p><button className="btn btn-ghost" style={{minHeight:48}} onClick={()=>store.setView('sales')}>{tr('查看銷售與應收')}</button></section>}
      <div style={rs.kpiGrid}>
        {KPIS.map((kpi, i) => (
          <div key={i} className="card animate-up" style={{padding:'16px 18px', animationDelay:`${i*40}ms`, borderTop:`2px solid ${kpi.color}`}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10}}>
              <div style={{fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.06em', textTransform:'uppercase'}}>{tr(kpi.label)}</div>
              <div style={{color:kpi.color, opacity:.7}}>{kpi.icon}</div>
            </div>
            <div style={{fontFamily:'var(--font-mono)', fontSize:22, fontWeight:500, letterSpacing:'-.01em'}}>{trMessage(kpi.value)}</div>
            {kpi.delta !== null && (
              <div style={{fontSize:11, marginTop:6, display:'flex', alignItems:'center', gap:3, color: parseFloat(kpi.delta)>=0?'var(--green)':'var(--red)'}}>
                {parseFloat(kpi.delta)>=0 ? <ArrowUp size={11}/> : <ArrowDown size={11}/>}
                {Math.abs(parseFloat(kpi.delta))}{tr("% vs 上期")}</div>
            )}
          </div>
        ))}
      </div>

      <div style={rs.twoCol}>
        {/* Hourly bars */}
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={rs.cardTitle}>{tr("今日各時段銷售")}</div>
          <div style={{display:'flex', alignItems:'flex-end', gap:3, height:100, marginTop:14}}>
            {hourly.map((v,h)=>{
              const h24 = h < 6 || h > 21
              return (
                <div key={h} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2}}>
                  <div style={{
                    width:'100%', borderRadius:'3px 3px 0 0',
                    background: v>0 ? 'var(--gold)' : 'var(--border-dim)',
                    height: `${Math.max(4, (v/maxHour)*88)}px`,
                    opacity: h24 ? .4 : 1,
                    transition:'height .4s var(--ease)',
                  }}/>
                  {h % 4 === 0 && <span style={{fontSize:8, color:'var(--text-tertiary)', fontFamily:'var(--font-mono)'}}>{h}</span>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Pay breakdown */}
        <div className="card" data-pay-breakdown style={{padding:'18px 20px'}}>
          <div style={rs.cardTitle}>{tr('實際收付淨額')}</div>
          <p style={{fontSize:12,color:'var(--text-secondary)',marginTop:8}}>{tr('包含客戶收款與供應商收付；預收、預付的抵付不會重複計入。')}</p>
          <div style={{marginTop:20, display:'flex', flexDirection:'column', gap:14}}>
            {[
              ['cash','現金', payBreakdown.cash, 'var(--green)'],
              ['card','電子支付', payBreakdown.card, 'var(--blue)'],
              ['bank','銀行',payBreakdown.bank,'var(--teal)'],
            ].map(([method,label, val, color])=>{
              const scale=Math.max(Math.abs(payBreakdown.cash),Math.abs(payBreakdown.card),Math.abs(payBreakdown.bank),1),pct=Math.abs(val)/scale*100
              return (
                <div key={method} data-pay-method={method}>
                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:13}}>
                    <span style={{color:'var(--text-secondary)'}}>{tr(label)}</span>
                    <span data-pay-amount style={{fontFamily:'var(--font-mono)', fontSize:12,color:val<0?'var(--red)':undefined}}>NT$ {Math.round(val*100)/100}</span>
                  </div>
                  <div style={{height:6, background:'var(--border-dim)', borderRadius:3}}>
                    <div data-pay-bar style={{height:'100%', width:`${pct}%`, background:color, borderRadius:3, transition:'width .6s var(--ease)'}}/>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ABC 分析 */}
      {abcAnalysis.items.length > 0 && (
        <div className="card" style={{padding:'18px 20px', flexShrink:0}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div style={rs.cardTitle}>{tr("ABC 商品分類")}</div>
            <span style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr("依營收貢獻")}</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginTop:12}}>
            {[
              { cls:'A', label:'A 類（優先商品）', color:'var(--green)', items:abcAnalysis.a, desc:'核心商品，重點維護庫存' },
              { cls:'B', label:'B 類（定期留意）', color:'var(--gold)', items:abcAnalysis.b, desc:'次要商品，定期檢視' },
              { cls:'C', label:'C 類（其餘商品）', color:'var(--text-tertiary)', items:abcAnalysis.c, desc:'長尾商品，可考慮汰除' },
            ].map(g => (
              <div key={g.cls} data-abc-group={g.cls} style={{padding:'12px 14px', background:'var(--bg-overlay)', borderRadius:8, borderTop:`2px solid ${g.color}`}}>
                <div style={{fontSize:12, fontWeight:600, color:g.color, marginBottom:6}}>{tr(g.label)}</div>
                <div data-abc-count style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)'}}>{g.items.length} <span style={{fontSize:11, color:'var(--text-tertiary)', fontWeight:400}}>{tr("項")}</span></div>
                <div style={{fontSize:10, color:'var(--text-tertiary)', marginTop:4}}>{tr(g.desc)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 30 天商品分析：熱賣 / 滯銷 / 高毛利 */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:12, flexShrink:0}}>
        {/* 熱賣 Top 10 */}
        <div className="card" style={{padding:'16px 18px'}}>
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:10}}>
            <Trophy size={14} style={{color:'var(--gold)'}}/>
            <div style={rs.cardTitle}>{tr("30天 熱賣 Top 10")}</div>
          </div>
          {perf30d.topSellers.length === 0 ? (
            <div style={{color:'var(--text-tertiary)', fontSize:12, padding:'20px 0', textAlign:'center'}}>{tr("近 30 天無銷售")}</div>
          ) : perf30d.topSellers.map((p, i) => (
            <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border-dim)', fontSize:12}}>
              <span style={{display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1}}>
                <span style={{fontFamily:'var(--font-mono)', color: i<3?'var(--gold)':'var(--text-tertiary)', fontWeight:600, width:18}}>{i+1}</span>
                <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</span>
              </span>
              <span style={{fontFamily:'var(--font-mono)', color:'var(--text-secondary)', whiteSpace:'nowrap'}}>
                {Math.round(p.totalSold)}{tr(" 件 · NT$ ")}{Math.round(p.revenue).toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* 滯銷預警 */}
        <div className="card" style={{padding:'16px 18px', borderTop:'2px solid var(--red)'}}>
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:10}}>
            <AlertTriangle size={14} style={{color:'var(--red)'}}/>
            <div style={rs.cardTitle}>{tr("30天 滯銷預警")}</div>
          </div>
          {perf30d.slowMovers.length === 0 ? (
            <div style={{color:'var(--green)', fontSize:12, padding:'20px 0', textAlign:'center'}}>{tr("🎉 沒有滯銷商品")}</div>
          ) : (
            <>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:8}}>{tr("共 ")}{perf30d.slowMovers.length}{tr(" 項，積壓成本 NT$ ")}{Math.round(perf30d.slowMovers.reduce((s,p)=>s+(p.stock*(p.cost||0)),0)).toLocaleString()}
              </div>
              {perf30d.slowMovers.slice(0, 10).map(p => (
                <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border-dim)', fontSize:12}}>
                  <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</span>
                  <span style={{fontFamily:'var(--font-mono)', color:'var(--text-secondary)', whiteSpace:'nowrap'}}>{tr("積壓 ")}{p.stock}{tr(" 件 · NT$ ")}{Math.round(p.stock*(p.cost||0)).toLocaleString()}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* 高毛利 Top 10 */}
        <div className="card" style={{padding:'16px 18px', borderTop:'2px solid var(--green)'}}>
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:10}}>
            <Zap size={14} style={{color:'var(--green)'}}/>
            <div style={rs.cardTitle}>{tr("30天 高毛利商品")}</div>
          </div>
          {perf30d.highMargin.length === 0 ? (
            <div style={{color:'var(--text-tertiary)', fontSize:12, padding:'20px 0', textAlign:'center'}}>{tr("需要成本資料才能計算")}</div>
          ) : perf30d.highMargin.map((p, i) => (
            <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border-dim)', fontSize:12}}>
              <span style={{display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1}}>
                <span style={{fontFamily:'var(--font-mono)', color: i<3?'var(--green)':'var(--text-tertiary)', fontWeight:600, width:18}}>{i+1}</span>
                <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</span>
              </span>
              <span style={{fontFamily:'var(--font-mono)', whiteSpace:'nowrap'}}>
                <span style={{color:'var(--green)'}}>{tr("毛利 ")}{p.margin.toFixed(0)}%</span>
                <span style={{color:'var(--text-tertiary)'}}> · NT$ {Math.round(p.profit).toLocaleString()}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 員工績效 */}
      {staffPerf.length > 0 && (
        <div className="card" style={{padding:'18px 20px', flexShrink:0}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <div style={rs.cardTitle}>{tr("員工銷售排行")}</div>
            <span style={{fontSize:11, color:'var(--text-tertiary)'}}>{range==='today'?tr("今日"):range==='week'?tr("本週"):range==='month'?tr("本月"):tr("全部期間")}</span>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', fontSize:13, minWidth:500}}>
              <thead>
                <tr style={{color:'var(--text-tertiary)', fontSize:11, textTransform:'uppercase', letterSpacing:'.05em'}}>
                  <th style={{textAlign:'left', padding:'8px 6px', width:32}}>#</th>
                  <th style={{textAlign:'left', padding:'8px 6px'}}>{tr("員工")}</th>
                  <th style={{textAlign:'right', padding:'8px 6px'}}>{tr("訂單數")}</th>
                  <th style={{textAlign:'right', padding:'8px 6px'}}>{tr("退貨")}</th>
                  <th style={{textAlign:'right', padding:'8px 6px'}}>{tr("營業額")}</th>
                  <th style={{textAlign:'right', padding:'8px 6px'}}>{tr("平均客單")}</th>
                </tr>
              </thead>
              <tbody>
                {staffPerf.map((s, i) => (
                  <tr key={s.cashier} style={{borderTop:'1px solid var(--border-dim)'}}>
                    <td style={{padding:'10px 6px', fontFamily:'var(--font-mono)', color: i<3?'var(--gold)':'var(--text-tertiary)', fontWeight:600}}>{i+1}</td>
                    <td style={{padding:'10px 6px', fontWeight:500}}>{s.cashier}</td>
                    <td style={{padding:'10px 6px', textAlign:'right', fontFamily:'var(--font-mono)'}}>{s.orders}</td>
                    <td style={{padding:'10px 6px', textAlign:'right', fontFamily:'var(--font-mono)', color: s.refunds > 0 ? 'var(--red)' : 'var(--text-tertiary)'}}>{s.refunds}</td>
                    <td style={{padding:'10px 6px', textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:500, color:'var(--gold-bright)'}}>
                      NT$ {Math.round(s.revenue).toLocaleString()}
                    </td>
                    <td style={{padding:'10px 6px', textAlign:'right', fontFamily:'var(--font-mono)', color:'var(--text-secondary)'}}>
                      NT$ {Math.round(s.avgTicket).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:6}}>{tr("※ 統計以結帳人員為準，員工帳號登入時系統會自動帶入")}</div>
        </div>
      )}

      {/* Top products table */}
      <div className="card" style={{padding:'18px 20px', flexShrink:0}}>
        <div style={rs.cardTitle}>{tr("暢銷商品（依當前期間：")}{range==='today'?tr("今日"):range==='week'?tr("本週"):range==='month'?tr("本月"):tr("全部")}）</div>
        {topProducts.length === 0 ? (
          <div style={{color:'var(--text-tertiary)', fontSize:13, padding:'24px 0', textAlign:'center'}}>{tr("此區間尚無銷售資料")}</div>
        ) : (
          <div style={{display:'flex', flexDirection:'column', gap:0, marginTop:12}}>
            {topProducts.map((p,i)=>(
              <div key={p.name} style={{display:'grid', gridTemplateColumns:'24px 1fr 70px 100px', gap:12, padding:'9px 4px', borderBottom:'1px solid var(--border-dim)', alignItems:'center'}}>
                <span style={{fontFamily:'var(--font-mono)', fontSize:12, color: i<3?'var(--gold)':'var(--text-tertiary)', textAlign:'center', fontWeight:600}}>
                  {i+1}
                </span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</div>
                  <div style={{height:4, background:'var(--border-dim)', borderRadius:2, marginTop:4, maxWidth:200}}>
                    <div style={{height:'100%', width:`${p.revenue/maxRevenue*100}%`, background:'var(--gold)', borderRadius:2, opacity:.6}}/>
                  </div>
                </div>
                <span style={{fontSize:12, color:'var(--text-secondary)', fontFamily:'var(--font-mono)', textAlign:'right'}}>{p.qty}{tr(" 件")}</span>
                <span style={{fontFamily:'var(--font-mono)', fontSize:13, fontWeight:500, color:'var(--gold-bright)', textAlign:'right'}}>
                  NT$ {p.revenue.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const rs = {
  root:{ display:'flex', flexDirection:'column', height:'100%', padding:'16px', gap:16, overflowY:'auto' },
  topBar:{ display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0, flexWrap:'wrap', gap:10 },
  title:{ fontFamily:'var(--font-serif)', fontSize:20, fontWeight:600 },
  rangeBtn:{ padding:'6px 14px', borderRadius:20, fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 150ms' },
  kpiGrid:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, flexShrink:0 },
  twoCol:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, flexShrink:0 },
  cardTitle:{ fontSize:12, fontWeight:600, color:'var(--text-secondary)', letterSpacing:'.04em', textTransform:'uppercase' },
}
