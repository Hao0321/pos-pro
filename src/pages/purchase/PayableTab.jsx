import {tr} from "../../i18n"
import {isProcurement,procurementSummary} from '../../../electron/procurementRules.mjs'

export function PayableTab({ purchases, suppliers, onMarkPaid,onOpen,readOnly=false,supplierCredits=[] }) {
  const managed=purchases.filter(isProcurement),legacy=purchases.filter(p=>!isProcurement(p))
  // 已到貨（含部分到貨）且未付款 = 應付帳款
  const unpaid = legacy.filter(p => (p.status === 'received' || p.status === 'partial') && !p.paidDate)
  const paid = legacy.filter(p => p.paidDate)
  // 部分到貨只欠「已到貨部分」的錢；全到貨欠全額
  const owedOf = (p) => p.status === 'partial'
    ? (p.items || []).reduce((s,i) => s + (i.received || 0) * (i.unitCost || 0), 0)
    : p.total

  // 依供應商彙總
  const bySupplier = {}
  unpaid.forEach(p => {
    const sid = p.supplierId || p.supplierName || '未指定'
    if (!bySupplier[sid]) bySupplier[sid] = { name: p.supplierName || '未指定', total: 0, count: 0, items: [] }
    bySupplier[sid].total += owedOf(p)
    bySupplier[sid].count += 1
    bySupplier[sid].items.push(p)
  })
  const supplierList = Object.values(bySupplier).sort((a,b) => b.total - a.total)
  const totalUnpaid = unpaid.reduce((s,p) => s + owedOf(p), 0)

  return (
    <div style={{flex:1, overflowY:'auto', padding:'4px 0'}}>
      {managed.length>0&&<div className="card" style={{padding:16,marginBottom:16}}><h3>{tr("採購請款與付款")}</h3><p>{tr("應付餘額 NT$ ")}{managed.reduce((n,p)=>n+procurementSummary(p,undefined,supplierCredits).owed,0).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>{managed.map(po=>{const s=procurementSummary(po,undefined,supplierCredits);return <button className="btn btn-ghost" key={po.id} style={{display:'flex',width:'100%',justifyContent:'space-between',minHeight:44,gap:12,flexWrap:'wrap',marginTop:6}} onClick={()=>onOpen(po)}><span>{po.supplierName} · {po.id}</span><span>{tr("未付 ")}{s.owed.toFixed(2)}{tr(" · 待請款 ")}{s.unbilled.toFixed(2)}{s.credit>0?tr(" · 供應商待退 {0}", {0: s.credit.toFixed(2)}):''}{s.overdue>0?tr(" · 已逾期"):''}</span></button>})}</div>}
      {managed.length>0&&legacy.length>0&&<h3>{tr("歷史進貨單（保留原帳）")}</h3>}
      <div className="card" style={{padding:'18px 20px', marginBottom:14, borderTop:'2px solid var(--red)'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
          <span style={{fontSize:12, color:'var(--text-tertiary)', textTransform:'uppercase', letterSpacing:'.05em'}}>{tr("未付款總額")}</span>
          <span style={{fontFamily:'var(--font-mono)', fontSize:24, fontWeight:600, color:'var(--red)'}}>NT$ {totalUnpaid.toLocaleString()}</span>
        </div>
        <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:4}}>
          {unpaid.length}{tr(" 張未付款 · ")}{supplierList.length}{tr(" 家供應商")}</div>
      </div>

      {supplierList.length === 0 ? (
        <div className="card" style={{padding:'40px 20px', textAlign:'center', color:'var(--text-tertiary)'}}>{tr("🎉 沒有未付款進貨")}</div>
      ) : supplierList.map((s, i) => (
        <div key={i} className="card" style={{padding:'18px 20px', marginBottom:10}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <div>
              <div style={{fontSize:14, fontWeight:600}}>{s.name}</div>
              <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:2}}>{s.count}{tr(" 筆未付")}</div>
            </div>
            <div style={{fontFamily:'var(--font-mono)', fontSize:18, fontWeight:600, color:'var(--red)'}}>
              NT$ {s.total.toLocaleString()}
            </div>
          </div>
          <table style={{width:'100%', fontSize:13}}>
            <tbody>
              {s.items.map(p => (
                <tr key={p.id} style={{borderTop:'1px solid var(--border-dim)'}}>
                  <td style={{padding:'8px 4px'}}>
                    {p.id}
                    {p.status === 'partial' && <span className="badge badge-amber" style={{marginLeft:6}}>{tr("部分到貨")}</span>}
                  </td>
                  <td style={{padding:'8px 4px', color:'var(--text-tertiary)'}}>{p.receivedDate || p.date}</td>
                  <td style={{padding:'8px 4px', textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:500}}>
                    NT$ {owedOf(p).toLocaleString()}
                    {p.status === 'partial' && <div style={{fontSize:10, color:'var(--text-tertiary)'}}>{tr("全單 NT$ ")}{p.total.toLocaleString()}</div>}
                  </td>
                  <td style={{padding:'8px 4px', textAlign:'right'}}>
                    {p.status === 'partial' ? (
                      // 先不開放付款：付了會把狀態鎖死、也容易多付 — 貨到齊再結一次
                      <span style={{fontSize:11, color:'var(--text-tertiary)'}}>{tr("貨到齊再付")}</span>
                    ) : !readOnly&&(
                      <button className="btn btn-primary btn-sm" onClick={()=>{ if(confirm(tr("確認 {0} 已付款？", {0: p.id}))) onMarkPaid(p.id) }}>{tr("標記已付")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {paid.length > 0 && (
        <details style={{marginTop:14}}>
          <summary style={{cursor:'pointer', padding:'10px 16px', fontSize:13, color:'var(--text-secondary)'}}>{tr("已付款歷史 (")}{paid.length})
          </summary>
          <div className="card" style={{padding:'12px 16px', marginTop:8}}>
            <table style={{width:'100%', fontSize:12}}>
              <thead>
                <tr style={{color:'var(--text-tertiary)'}}>
                  <th style={{textAlign:'left', padding:'6px 4px'}}>{tr("進貨單")}</th>
                  <th style={{textAlign:'left', padding:'6px 4px'}}>{tr("供應商")}</th>
                  <th style={{textAlign:'left', padding:'6px 4px'}}>{tr("付款日")}</th>
                  <th style={{textAlign:'right', padding:'6px 4px'}}>{tr("金額")}</th>
                </tr>
              </thead>
              <tbody>
                {paid.slice(0,30).map(p => (
                  <tr key={p.id} style={{borderTop:'1px solid var(--border-dim)'}}>
                    <td style={{padding:'6px 4px'}}>{p.id}</td>
                    <td style={{padding:'6px 4px'}}>{p.supplierName}</td>
                    <td style={{padding:'6px 4px', color:'var(--text-tertiary)'}}>{p.paidDate}</td>
                    <td style={{padding:'6px 4px', textAlign:'right', fontFamily:'var(--font-mono)'}}>NT$ {p.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
