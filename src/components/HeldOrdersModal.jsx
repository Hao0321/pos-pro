import { Pause, Trash2, X, ShoppingCart } from 'lucide-react'

export default function HeldOrdersModal({ heldOrders, members, onRecall, onRemove, onClose }) {
  return (
    <>
      <div style={ho.overlay} onClick={onClose}/>
      <div style={ho.box}>
        <div style={ho.head}>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <Pause size={16}/>
            <span style={{fontWeight:600}}>掛單列表</span>
            <span className="badge badge-blue">{heldOrders.length}</span>
          </div>
          <button onClick={onClose} style={{padding:6}}><X size={18}/></button>
        </div>
        <div style={ho.list}>
          {heldOrders.length === 0 ? (
            <div style={{textAlign:'center', padding:60, color:'var(--text-tertiary)'}}>
              <ShoppingCart size={32} style={{margin:'0 auto 12px', opacity:0.3}}/>
              <div style={{fontSize:13}}>沒有掛單</div>
            </div>
          ) : heldOrders.map(h => {
            const member = h.memberId ? members.find(m => m.id === h.memberId) : null
            const total = (h.cart || []).reduce((s,i) => s + i.price * i.qty, 0)
            const items = (h.cart || []).reduce((s,i) => s + i.qty, 0)
            return (
              <div key={h.id} style={ho.row}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                    <span style={{fontWeight:500, fontSize:14}}>{h.label}</span>
                    {member && <span className="badge badge-gold">{member.name}</span>}
                  </div>
                  <div style={{fontSize:11, color:'var(--text-tertiary)'}}>
                    {new Date(h.createdAt).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
                    {' · '}{items} 件 / NT$ {total.toLocaleString()}
                  </div>
                  <div style={{fontSize:11, color:'var(--text-secondary)', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                    {(h.cart || []).map(i => `${i.name}×${i.qty}`).join('、')}
                  </div>
                </div>
                <div style={{display:'flex', gap:6, marginLeft:12}}>
                  <button className="btn btn-primary btn-sm" onClick={()=>{ onRecall(h); onClose() }}>取單</button>
                  <button onClick={()=>{ if(confirm('確定刪除此掛單？')) onRemove(h.id) }} style={{padding:6, color:'var(--red)'}}>
                    <Trash2 size={14}/>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

const ho = {
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:998},
  box:{
    position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
    background:'var(--bg-raised)', borderRadius:12, width:520, maxWidth:'92vw',
    maxHeight:'85vh', overflow:'hidden', display:'flex', flexDirection:'column',
    boxShadow:'var(--shadow-lg)', zIndex:999,
  },
  head:{
    display:'flex', justifyContent:'space-between', alignItems:'center',
    padding:'14px 18px', borderBottom:'1px solid var(--border-dim)',
  },
  list:{
    flex:1, overflowY:'auto',
  },
  row:{
    display:'flex', alignItems:'center', padding:'14px 18px',
    borderBottom:'1px solid var(--border-dim)',
  },
}
