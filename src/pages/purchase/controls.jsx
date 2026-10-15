
export const STATUS = {
  draft:    { label:'草稿',   color:'var(--text-tertiary)', bg:'var(--bg-active)' },
  ordered:  { label:'已叫貨', color:'var(--blue)',           bg:'var(--blue-dim)' },
  received: { label:'已到貨', color:'var(--green)',          bg:'var(--green-dim)' },
  partial:  { label:'部分到', color:'var(--amber)',          bg:'var(--amber-dim)' },
  paid:     { label:'已付款', color:'var(--green)',          bg:'var(--green-dim)' },
  cancelled:{ label:'已取消', color:'var(--text-tertiary)', bg:'var(--bg-active)' },
}

export const poItemKey = (_item, idx) => String(idx)

export function FL({children}){return <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:5,letterSpacing:'.03em'}}>{children}</div>}

export const ps = {
  root:{display:'flex',flexDirection:'column',height:'100%',padding:'16px',gap:14,overflow:'hidden'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0,flexWrap:'wrap',gap:10},
  title:{fontFamily:'var(--font-serif)',fontSize:20,fontWeight:600},
  poCard:{display:'flex',flexDirection:'column',borderRadius:'var(--r3)',padding:'13px 15px',textAlign:'left',cursor:'pointer',transition:'all 150ms',width:'100%'},
  statusBadge:{fontSize:10,padding:'2px 8px',borderRadius:20,fontWeight:500},
  detail:{flex:1,minWidth:0,overflowY:'auto'},
  emptyDetail:{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'},
  overlay:{position:'fixed',inset:0,background:'rgba(23,37,60,0.30)',backdropFilter:'blur(2px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200},
  modal:{background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:'var(--r4)',padding:20,width:'calc(100% - 24px)',maxWidth:560,maxHeight:'calc(100dvh - 24px)',overflowY:'auto'},
}
