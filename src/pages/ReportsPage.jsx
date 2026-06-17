import { useMemo, useState } from 'react'
import { TrendingUp, ShoppingCart, Users, Package, ArrowUp, ArrowDown, Download, Zap, AlertTriangle, Trophy } from 'lucide-react'
import { exportXLS } from '../utils/exportXLS'
import { productPerformance } from '../utils/analytics'

export default function ReportsPage({ store }) {
  const { orders: rawOrders, products, members } = store
  const [range, setRange] = useState('today')

  const now = new Date()
  // 排除完整退貨配對；部分退貨保留兩邊（原訂單 + 負數退貨訂單），總額自動抵銷正確
  const orders = rawOrders.filter(o => o.status !== 'refunded' && !(o.refundOf && o.fullRefund))
  const filtered = useMemo(() => orders.filter(o => {
    const d = new Date(o.time)
    if (range === 'today') return d.toDateString() === now.toDateString()
    if (range === 'week')  return (now - d) < 7 * 864e5
    if (range === 'month') return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear()
    return true
  }), [orders, range])

  const prev = useMemo(() => {
    const shift = range==='today'?864e5 : range==='week'?7*864e5 : 30*864e5
    return orders.filter(o => {
      const d = new Date(o.time), a = new Date(o.time)
      if (range === 'today') return new Date(d.getTime()+864e5).toDateString()===now.toDateString() && d.toDateString()!==now.toDateString()
      return (now-d) >= shift && (now-d) < shift*2
    })
  }, [orders, range])

  const revenue = filtered.reduce((s,o)=>s+o.total,0)
  const prevRevenue = prev.reduce((s,o)=>s+o.total,0)
  const revDelta = prevRevenue ? ((revenue-prevRevenue)/prevRevenue*100).toFixed(1) : null

  const profit = useMemo(()=> filtered.reduce((s,o)=> s + o.items.reduce((a,i)=>{
    const p = products.find(x=>x.id===i.id)
    return a + (p ? (i.price-(p.cost||0))*i.qty : 0)
  },0), 0), [filtered, products])

  const avgOrder = filtered.length ? Math.round(revenue / filtered.length) : 0
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
      map[i.id].revenue += i.price * i.qty
    }))
    return Object.values(map).sort((a,b)=>b.revenue-a.revenue).slice(0,8)
  }, [filtered])

  const maxRevenue = topProducts[0]?.revenue || 1

  // Hourly chart (today)
  const hourly = useMemo(() => {
    const arr = Array(24).fill(0)
    const src = range==='today' ? filtered : orders.filter(o=>new Date(o.time).toDateString()===now.toDateString())
    src.forEach(o => arr[new Date(o.time).getHours()] += o.total)
    return arr
  }, [filtered, orders, range])
  const maxHour = Math.max(...hourly, 1)

  // Pay method breakdown (支援混合付款拆分)
  const payBreakdown = useMemo(() => {
    let cash = 0, card = 0
    for (const o of filtered) {
      if (o.payMethod === 'cash') cash += o.total
      else if (o.payMethod === 'mixed' && Array.isArray(o.payments)) {
        for (const p of o.payments) {
          if (p.method === 'cash') cash += p.amount
          else card += p.amount
        }
      } else card += o.total
    }
    return { cash, card, total: cash+card }
  }, [filtered])

  // 30 天商品表現分析（基於 store.orders 全部訂單，獨立於 range filter）
  const perf30d = useMemo(() => productPerformance(products, rawOrders, 30), [products, rawOrders])

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
    const map = {}
    filtered.forEach(o => o.items.forEach(i => {
      if (!map[i.id]) map[i.id] = { id:i.id, name:i.name, qty:0, revenue:0 }
      map[i.id].qty += i.qty
      map[i.id].revenue += i.price * i.qty
    }))
    const sorted = Object.values(map).sort((a,b) => b.revenue - a.revenue)
    const total = sorted.reduce((s,p) => s + p.revenue, 0) || 1
    let cum = 0
    const classified = sorted.map(p => {
      cum += p.revenue
      const pct = cum / total * 100
      const cls = pct <= 70 ? 'A' : pct <= 90 ? 'B' : 'C'
      return { ...p, cumPct: pct, cls }
    })
    return {
      items: classified,
      a: classified.filter(p => p.cls === 'A'),
      b: classified.filter(p => p.cls === 'B'),
      c: classified.filter(p => p.cls === 'C'),
      total,
    }
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
      ['訂單數', filtered.length],
      ['客單價', avgOrder],
      ['現金收入', payBreakdown.cash],
      ['電子支付', payBreakdown.card],
      [],
      ['暢銷商品 Top 8'],
      ['排名', '商品', '數量', '營收'],
      ...topProducts.map((p,i) => [i+1, p.name, p.qty, p.revenue]),
      [],
      ['ABC 分析'],
      ['商品', '銷量', '營收', '營收佔比%', '累計%', '類別'],
      ...abcAnalysis.items.map(p => [
        p.name, p.qty, p.revenue,
        ((p.revenue/abcAnalysis.total)*100).toFixed(2),
        p.cumPct.toFixed(2),
        p.cls,
      ]),
      [],
      ['訂單明細'],
      ['訂單編號','時間','付款方式','金額','會員','點數獲得','統編'],
      ...filtered.map(o => [
        o.id,
        new Date(o.time).toLocaleString('zh-TW'),
        o.payMethod === 'cash' ? '現金' : o.payMethod === 'card' ? '電子' : '混合',
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
    { label:'訂單數', value:`${filtered.length} 筆`,           delta:null,     icon:<ShoppingCart size={16}/>, color:'var(--blue)' },
    { label:'客單價', value:`NT$ ${avgOrder.toLocaleString()}`, delta:null,    icon:<Package size={16}/>,   color:'var(--teal)' },
  ]

  return (
    <div style={rs.root}>
      <div style={rs.topBar}>
        <h2 style={rs.title}>報表分析</h2>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <div style={{display:'flex', gap:4}}>
            {RANGES.map(([k,l])=>(
              <button key={k} onClick={()=>setRange(k)} style={{
                ...rs.rangeBtn,
                background: range===k?'var(--gold)':'var(--bg-overlay)',
                color: range===k?'#fff':'var(--text-secondary)',
              }}>{l}</button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={exportReport} style={{display:'flex', alignItems:'center', gap:4}}>
            <Download size={14}/> 匯出 Excel
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={rs.kpiGrid}>
        {KPIS.map((kpi, i) => (
          <div key={i} className="card animate-up" style={{padding:'16px 18px', animationDelay:`${i*40}ms`, borderTop:`2px solid ${kpi.color}`}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10}}>
              <div style={{fontSize:11, color:'var(--text-tertiary)', letterSpacing:'.06em', textTransform:'uppercase'}}>{kpi.label}</div>
              <div style={{color:kpi.color, opacity:.7}}>{kpi.icon}</div>
            </div>
            <div style={{fontFamily:'var(--font-mono)', fontSize:22, fontWeight:500, letterSpacing:'-.01em'}}>{kpi.value}</div>
            {kpi.delta !== null && (
              <div style={{fontSize:11, marginTop:6, display:'flex', alignItems:'center', gap:3, color: parseFloat(kpi.delta)>=0?'var(--green)':'var(--red)'}}>
                {parseFloat(kpi.delta)>=0 ? <ArrowUp size={11}/> : <ArrowDown size={11}/>}
                {Math.abs(parseFloat(kpi.delta))}% vs 上期
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={rs.twoCol}>
        {/* Hourly bars */}
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={rs.cardTitle}>今日各時段銷售</div>
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
        <div className="card" style={{padding:'18px 20px'}}>
          <div style={rs.cardTitle}>付款方式</div>
          <div style={{marginTop:20, display:'flex', flexDirection:'column', gap:14}}>
            {[
              ['現金', payBreakdown.cash, 'var(--green)'],
              ['電子支付', payBreakdown.card, 'var(--blue)'],
            ].map(([label, val, color])=>{
              const pct = payBreakdown.total ? (val/payBreakdown.total*100).toFixed(0) : 0
              return (
                <div key={label}>
                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:13}}>
                    <span style={{color:'var(--text-secondary)'}}>{label}</span>
                    <span style={{fontFamily:'var(--font-mono)', fontSize:12}}>NT$ {val.toLocaleString()} <span style={{color:'var(--text-tertiary)'}}>({pct}%)</span></span>
                  </div>
                  <div style={{height:6, background:'var(--border-dim)', borderRadius:3}}>
                    <div style={{height:'100%', width:`${pct}%`, background:color, borderRadius:3, transition:'width .6s var(--ease)'}}/>
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
            <div style={rs.cardTitle}>ABC 商品分類</div>
            <span style={{fontSize:11, color:'var(--text-tertiary)'}}>依營收貢獻</span>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginTop:12}}>
            {[
              { cls:'A', label:'A 類（佔 70%）', color:'var(--green)', items:abcAnalysis.a, desc:'核心商品，重點維護庫存' },
              { cls:'B', label:'B 類（佔 90%）', color:'var(--gold)', items:abcAnalysis.b, desc:'次要商品，定期檢視' },
              { cls:'C', label:'C 類（佔 10%）', color:'var(--text-tertiary)', items:abcAnalysis.c, desc:'長尾商品，可考慮汰除' },
            ].map(g => (
              <div key={g.cls} style={{padding:'12px 14px', background:'var(--bg-overlay)', borderRadius:8, borderTop:`2px solid ${g.color}`}}>
                <div style={{fontSize:12, fontWeight:600, color:g.color, marginBottom:6}}>{g.label}</div>
                <div style={{fontSize:20, fontWeight:600, fontFamily:'var(--font-mono)'}}>{g.items.length} <span style={{fontSize:11, color:'var(--text-tertiary)', fontWeight:400}}>項</span></div>
                <div style={{fontSize:10, color:'var(--text-tertiary)', marginTop:4}}>{g.desc}</div>
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
            <div style={rs.cardTitle}>30天 熱賣 Top 10</div>
          </div>
          {perf30d.topSellers.length === 0 ? (
            <div style={{color:'var(--text-tertiary)', fontSize:12, padding:'20px 0', textAlign:'center'}}>近 30 天無銷售</div>
          ) : perf30d.topSellers.map((p, i) => (
            <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border-dim)', fontSize:12}}>
              <span style={{display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1}}>
                <span style={{fontFamily:'var(--font-mono)', color: i<3?'var(--gold)':'var(--text-tertiary)', fontWeight:600, width:18}}>{i+1}</span>
                <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</span>
              </span>
              <span style={{fontFamily:'var(--font-mono)', color:'var(--text-secondary)', whiteSpace:'nowrap'}}>
                {Math.round(p.totalSold)} 件 · NT$ {Math.round(p.revenue).toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* 滯銷預警 */}
        <div className="card" style={{padding:'16px 18px', borderTop:'2px solid var(--red)'}}>
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:10}}>
            <AlertTriangle size={14} style={{color:'var(--red)'}}/>
            <div style={rs.cardTitle}>30天 滯銷預警</div>
          </div>
          {perf30d.slowMovers.length === 0 ? (
            <div style={{color:'var(--green)', fontSize:12, padding:'20px 0', textAlign:'center'}}>🎉 沒有滯銷商品</div>
          ) : (
            <>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:8}}>
                共 {perf30d.slowMovers.length} 項，積壓成本 NT$ {Math.round(perf30d.slowMovers.reduce((s,p)=>s+(p.stock*(p.cost||0)),0)).toLocaleString()}
              </div>
              {perf30d.slowMovers.slice(0, 10).map(p => (
                <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border-dim)', fontSize:12}}>
                  <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</span>
                  <span style={{fontFamily:'var(--font-mono)', color:'var(--text-secondary)', whiteSpace:'nowrap'}}>
                    積壓 {p.stock} 件 · NT$ {Math.round(p.stock*(p.cost||0)).toLocaleString()}
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
            <div style={rs.cardTitle}>30天 高毛利商品</div>
          </div>
          {perf30d.highMargin.length === 0 ? (
            <div style={{color:'var(--text-tertiary)', fontSize:12, padding:'20px 0', textAlign:'center'}}>需要成本資料才能計算</div>
          ) : perf30d.highMargin.map((p, i) => (
            <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border-dim)', fontSize:12}}>
              <span style={{display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1}}>
                <span style={{fontFamily:'var(--font-mono)', color: i<3?'var(--green)':'var(--text-tertiary)', fontWeight:600, width:18}}>{i+1}</span>
                <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{p.name}</span>
              </span>
              <span style={{fontFamily:'var(--font-mono)', whiteSpace:'nowrap'}}>
                <span style={{color:'var(--green)'}}>毛利 {p.margin.toFixed(0)}%</span>
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
            <div style={rs.cardTitle}>員工銷售排行</div>
            <span style={{fontSize:11, color:'var(--text-tertiary)'}}>{range==='today'?'今日':range==='week'?'本週':range==='month'?'本月':'全部期間'}</span>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', fontSize:13, minWidth:500}}>
              <thead>
                <tr style={{color:'var(--text-tertiary)', fontSize:11, textTransform:'uppercase', letterSpacing:'.05em'}}>
                  <th style={{textAlign:'left', padding:'8px 6px', width:32}}>#</th>
                  <th style={{textAlign:'left', padding:'8px 6px'}}>員工</th>
                  <th style={{textAlign:'right', padding:'8px 6px'}}>訂單數</th>
                  <th style={{textAlign:'right', padding:'8px 6px'}}>退貨</th>
                  <th style={{textAlign:'right', padding:'8px 6px'}}>營業額</th>
                  <th style={{textAlign:'right', padding:'8px 6px'}}>平均客單</th>
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
          <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:6}}>
            ※ 統計以結帳人員為準，員工帳號登入時系統會自動帶入
          </div>
        </div>
      )}

      {/* Top products table */}
      <div className="card" style={{padding:'18px 20px', flexShrink:0}}>
        <div style={rs.cardTitle}>暢銷商品（依當前期間：{range==='today'?'今日':range==='week'?'本週':range==='month'?'本月':'全部'}）</div>
        {topProducts.length === 0 ? (
          <div style={{color:'var(--text-tertiary)', fontSize:13, padding:'24px 0', textAlign:'center'}}>此區間尚無銷售資料</div>
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
                <span style={{fontSize:12, color:'var(--text-secondary)', fontFamily:'var(--font-mono)', textAlign:'right'}}>{p.qty} 件</span>
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
