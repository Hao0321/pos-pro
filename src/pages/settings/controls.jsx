import {tr} from "../../i18n"

export function Section({ title, children }) {
  return (
    <div style={{marginBottom:24}}>
      <div style={{fontSize:13, fontWeight:600, marginBottom:10, color:'var(--text-primary)'}}>{tr(title)}</div>
      {children}
    </div>
  )
}

export function FieldLabel({ children }) {
  return <div style={{fontSize:11, color:'var(--text-tertiary)', marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em'}}>{children}</div>
}

export function FL({children}){return <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:5,letterSpacing:'.03em'}}>{children}</div>}

export const ss = {
  root:{display:'flex',flexDirection:'column',height:'100%',padding:'16px',gap:12,overflow:'hidden'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexShrink:0},
  title:{fontFamily:'var(--font-serif)',fontSize:20,fontWeight:600},
  tabBar:{display:'flex',borderBottom:'1px solid var(--border-dim)',flexShrink:0},
  tab:{display:'flex',alignItems:'center',gap:7,padding:'9px 14px',fontSize:13,fontWeight:500,transition:'all 150ms',borderRadius:0,letterSpacing:'.01em'},
  overlay:{position:'fixed',inset:0,background:'rgba(23,37,60,0.30)',backdropFilter:'blur(2px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200},
  modal:{background:'var(--bg-raised)',border:'1px solid var(--border-dim)',borderRadius:'var(--r4)',padding:24,width:'90%',maxWidth:420},
}
