import { useState, useRef } from "react"
import { Plus, Check, X, Package, ChevronDown, Pencil, Trash2 } from "lucide-react"
import { sanitizeObject } from "../../utils/security"
import { isElectron, dbAddSupplier, dbUpdateSupplier, dbDeleteSupplier } from "../../utils/dataAccess"
import { CATEGORY_META, groupByCategory } from "../../utils/categories"
import { canonicalSignature } from "../../../electron/operationRules.mjs"
import { FL, ps } from "./controls.jsx"

export function SupplierList({ suppliers, products = [], purchases = [], onSave, onGoInventory }) {
  const [editing, setEditing] = useState(null)
  const [form,    setForm]    = useState({ name:'', contact:'', phone:'', payTerms:'', note:'' })
  const [expanded, setExpanded] = useState(null) // 展開哪一家看商品
  const [deleting, setDeleting] = useState(null) // v2.6: { s, blocked, boundCount, openPoCount }
  const [catForm,  setCatForm]  = useState(null) // v2.6: { supplierId, name, unit, cost } 貨源新增表單
  const [catalogDrafts,setCatalogDrafts]=useState({}),[error,setError]=useState('')
  const catalogueBase=useRef({}),saving=useRef(false),newId=useRef('s'+crypto.randomUUID())

  // v2.6: Electron 同步單筆供應商到 SQLite（修正：之前只寫 localStorage，重開 app 就消失）
  async function persistSupplier(sup, isNew = false) {
    if (!isElectron) return
    const payload = {
      id: sup.id,
      name: sup.name || '', contact: sup.contact || '', phone: sup.phone || '',
      payTerms: sup.payTerms || '', note: sup.note || '',
      ...(Array.isArray(sup.catalog)?{catalog:sup.catalog}:{}),
      ...(sup._expectedCatalog!==undefined?{_expectedCatalog:sup._expectedCatalog}:{}),
    }
    const result=await(isNew ? dbAddSupplier(payload) : dbUpdateSupplier(sup.id, payload))
    if(result?.success!==true)throw Error(result?.error||'供應商保存失敗')
  }

  async function save() {
    if (!form.name||saving.current) return
    saving.current=true;setError('')
    try{
    // v2.6: catalog 是陣列（sanitizeObject 會把陣列變成物件），modal 不碰 catalog，
    // 一律沿用該供應商目前的 catalog
    const clean = sanitizeObject(form)
    if (editing === 'new') {
      const sup = { ...clean, catalog: [], id:newId.current }
      await persistSupplier(sup, true)
      onSave([...suppliers.filter(s=>s.id!==sup.id), sup]);newId.current='s'+crypto.randomUUID()
    } else {
      const prev = suppliers.find(s => s.id === editing) || {}
      const sup = { ...prev, ...clean, catalog: Array.isArray(prev.catalog) ? prev.catalog : [] }
      await persistSupplier({...clean,id:sup.id})
      onSave(suppliers.map(s => s.id === editing ? sup : s))
    }
    setEditing(null)
    }catch(e){setError(e.message)}finally{saving.current=false}
  }

  // v2.6: 貨源目錄異動 → 立即走同一條儲存路徑（state + localStorage / SQLite）
  function updateCatalog(s, newCatalog) {
    if(!Object.hasOwn(catalogueBase.current,s.id))catalogueBase.current[s.id]=canonicalSignature(s.catalog||[])
    setCatalogDrafts(prev=>({...prev,[s.id]:newCatalog}))
  }
  async function saveCatalog(s){if(saving.current)return;saving.current=true;setError('');try{const updated={...s,catalog:catalogDrafts[s.id],_expectedCatalog:catalogueBase.current[s.id]};await persistSupplier(updated);delete updated._expectedCatalog;onSave(suppliers.map(x=>x.id===s.id?updated:x));setCatalogDrafts(prev=>{const next={...prev};delete next[s.id];return next});delete catalogueBase.current[s.id]}catch(e){setError(e.message)}finally{saving.current=false}}
  function addCatalogItem(s) {
    const name = (catForm?.name || '').trim()
    if (!name) return
    const list = catalogDrafts[s.id]||s.catalog||[]
    updateCatalog(s, [...list, {
      id: 'ci' + Date.now() + list.length,
      name,
      unit: (catForm.unit || '').trim() || '個',
      cost: Number(catForm.cost) || 0,
      barcode: '',
      productId: '',
    }])
    setCatForm({ supplierId: s.id, name: '', unit: '個', cost: '' }) // 清空續填，方便連續新增
  }
  function updateCatalogItem(s, ciId, key, val) {
    updateCatalog(s, (catalogDrafts[s.id]||s.catalog || []).map(ci =>
      ci.id === ciId ? { ...ci, [key]: key === 'cost' ? (parseFloat(val) || 0) : val } : ci))
  }
  function removeCatalogItem(s, ciId) {
    updateCatalog(s, (catalogDrafts[s.id]||s.catalog || []).filter(ci => ci.id !== ciId))
  }

  // v2.6: 刪除廠商 — 有綁定商品或未完成叫貨單時擋下，否則先確認再刪
  function askDelete(s) {
    const boundCount  = products.filter(p => p.supplierId === s.id).length
    const openPoCount = purchases.filter(p => p.supplierId === s.id && ['ordered','partial','draft'].includes(p.status)).length
    setDeleting({ s, blocked: boundCount > 0 || openPoCount > 0, boundCount, openPoCount })
  }
  async function confirmDelete() {
    if(saving.current)return;saving.current=true;setError('')
    try{
    const { s } = deleting
    if (isElectron){const r=await dbDeleteSupplier(s.id);if(r?.success!==true)throw Error(r?.error||'供應商刪除失敗')}
    onSave(suppliers.filter(x => x.id !== s.id))
    if (expanded === s.id) setExpanded(null)
    setDeleting(null)
    }catch(e){setError(e.message)}finally{saving.current=false}
  }

  function productsOf(supplierId) {
    return products.filter(p => p.supplierId === supplierId)
  }

  return (
    <div style={{maxWidth:760, width:'100%', overflowY:'auto'}}>
      {error&&<p role="alert" style={{color:'var(--red)'}}>{error}</p>}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <div style={{fontSize:12, color:'var(--text-tertiary)'}}>
          共 {suppliers.length} 家供應商 · {products.filter(p=>p.supplierId).length} 項已指定供應商
        </div>
        <button className="btn btn-primary btn-sm" onClick={()=>{setEditing('new');setForm({name:'',contact:'',phone:'',payTerms:'',note:''})}}>
          <Plus size={14}/>新增供應商
        </button>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {suppliers.length === 0 && (
          <div className="card" style={{textAlign:'center', padding:'40px', color:'var(--text-tertiary)', fontSize:13}}>
            尚無供應商，點右上「新增供應商」開始
          </div>
        )}
        {suppliers.map(s => {
          const supplierProducts = productsOf(s.id)
          const isOpen = expanded === s.id
          const groups = isOpen ? groupByCategory(supplierProducts) : []

          return (
            <div key={s.id} className="card" style={{overflow:'hidden'}}>
              {/* 卡片頭：供應商基本資料 */}
              <div style={{padding:'14px 16px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                <div style={{flex:1, minWidth:200}}>
                  <div style={{fontWeight:600, fontSize:14}}>{s.name}</div>
                  <div style={{fontSize:12, color:'var(--text-secondary)', marginTop:3}}>
                    📞 {s.contact || '—'}{s.phone ? ` · ☎ ${s.phone}` : ''} · {s.payTerms || '—'}
                    {s.note && <span style={{color:'var(--text-tertiary)'}}> · {s.note}</span>}
                  </div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    style={{
                      display:'flex', alignItems:'center', gap:5,
                      padding:'10px 12px', minHeight:40, borderRadius:6, fontSize:12,
                      background: isOpen ? 'var(--bg-active)' : 'var(--bg-overlay)',
                      color: 'var(--text-secondary)',
                      border:'1px solid var(--border-dim)',
                    }}
                  >
                    <Package size={12}/>
                    {(s.catalog || []).length} 項貨源 · {supplierProducts.length} 項商品
                    <ChevronDown size={12} style={{transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms'}}/>
                  </button>
                  {/* v2.6: 明確的文字按鈕（≥40px），不再只有小圖示 */}
                  <button className="btn btn-ghost btn-sm" style={{minHeight:40}} onClick={()=>{setEditing(s.id);setForm({ name:s.name||'', contact:s.contact||'', phone:s.phone||'', payTerms:s.payTerms||'', note:s.note||'' })}}>
                    <Pencil size={13}/>編輯
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{minHeight:40, color:'var(--red)'}} onClick={()=>askDelete(s)}>
                    <Trash2 size={13}/>刪除
                  </button>
                </div>
              </div>

              {/* 展開：v2.6 貨源目錄 + 已建檔商品（按分類分組）*/}
              {isOpen && (
                <div style={{borderTop:'1px solid var(--border-dim)', padding:'12px 16px', background:'var(--bg-overlay)'}}>
                  {/* ── 貨源目錄：這家能叫的貨（不一定已建檔成庫存商品）── */}
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8, flexWrap:'wrap'}}>
                    <div style={{fontSize:12, fontWeight:600, color:'var(--text-secondary)', letterSpacing:'.05em'}}>
                      📋 貨源目錄 <span style={{fontFamily:'var(--font-mono)', fontWeight:400, color:'var(--text-tertiary)'}}>· {(s.catalog||[]).length}</span>
                    </div>
                    {catForm?.supplierId !== s.id && (
                      <button className="btn btn-primary btn-sm" style={{minHeight:40}} onClick={()=>setCatForm({ supplierId:s.id, name:'', unit:'個', cost:'' })}>
                        <Plus size={14}/>新增貨源
                      </button>
                    )}
                  </div>

                  {(s.catalog||[]).length === 0 && catForm?.supplierId !== s.id && (
                    <div style={{textAlign:'center', padding:'14px 0', color:'var(--text-tertiary)', fontSize:12}}>
                      還沒有貨源，按「＋ 新增貨源」把這家能叫的貨記下來，叫貨時就能直接選
                    </div>
                  )}

                  {catalogDrafts[s.id]&&<button className="btn btn-primary btn-sm" onClick={()=>saveCatalog(s)}>儲存貨源修改</button>}
                  {(catalogDrafts[s.id]||s.catalog||[]).length > 0 && (
                    <div style={{display:'flex', flexDirection:'column', gap:6, marginBottom:10}}>
                      <div style={{display:'grid', gridTemplateColumns:'1fr 64px 84px 56px 40px', gap:8, fontSize:11, color:'var(--text-tertiary)', padding:'0 2px'}}>
                        <span>品名</span><span>單位</span><span style={{textAlign:'right'}}>進價</span><span/><span/>
                      </div>
                      {(catalogDrafts[s.id]||s.catalog||[]).map(ci => (
                        <div key={ci.id} style={{display:'grid', gridTemplateColumns:'1fr 64px 84px 56px 40px', gap:8, alignItems:'center'}}>
                          <input className="field" value={ci.name} onChange={e=>updateCatalogItem(s, ci.id, 'name', e.target.value)} style={{padding:'9px 10px', fontSize:13}}/>
                          <input className="field" value={ci.unit || ''} onChange={e=>updateCatalogItem(s, ci.id, 'unit', e.target.value)} style={{padding:'9px 8px', fontSize:13}}/>
                          <input type="number" className="field" min={0} value={ci.cost} onChange={e=>updateCatalogItem(s, ci.id, 'cost', e.target.value)} style={{padding:'9px 8px', fontSize:13, textAlign:'right', fontFamily:'var(--font-mono)'}}/>
                          {ci.productId && products.find(p=>p.id===ci.productId)
                            ? <span style={{fontSize:10, color:'var(--green)', background:'var(--green-dim)', padding:'3px 5px', borderRadius:4, textAlign:'center'}}>已建檔</span>
                            : <span style={{fontSize:10, color:'var(--amber)', background:'var(--amber-dim)', padding:'3px 5px', borderRadius:4, textAlign:'center'}}>未建檔</span>}
                          <button className="btn-icon" style={{color:'var(--red)', minHeight:40, minWidth:40}} onClick={()=>removeCatalogItem(s, ci.id)} aria-label="刪除貨源"><Trash2 size={14}/></button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 貨源新增表單（inline，取代跨頁繞路）*/}
                  {catForm?.supplierId === s.id && (
                    <div style={{background:'var(--bg-raised)', border:'1px solid var(--border-dim)', borderRadius:8, padding:'10px 12px', marginBottom:12}}>
                      <div style={{display:'grid', gridTemplateColumns:'1fr 64px 84px', gap:8, marginBottom:8}}>
                        <div>
                          <FL>品名 *</FL>
                          <input className="field" autoFocus value={catForm.name} onChange={e=>setCatForm(f=>({...f, name:e.target.value}))} placeholder="例：花生 3斤裝" style={{padding:'9px 10px'}}/>
                        </div>
                        <div>
                          <FL>單位</FL>
                          <input className="field" value={catForm.unit} onChange={e=>setCatForm(f=>({...f, unit:e.target.value}))} style={{padding:'9px 8px'}}/>
                        </div>
                        <div>
                          <FL>進價</FL>
                          <input type="number" className="field" min={0} value={catForm.cost} onChange={e=>setCatForm(f=>({...f, cost:e.target.value}))} style={{padding:'9px 8px', textAlign:'right'}}/>
                        </div>
                      </div>
                      <div style={{display:'flex', gap:8}}>
                        <button className="btn btn-primary btn-sm" style={{minHeight:40, flex:1}} disabled={!(catForm.name||'').trim()} onClick={()=>addCatalogItem(s)}><Plus size={14}/>加入貨源</button>
                        <button className="btn btn-ghost btn-sm" style={{minHeight:40}} onClick={()=>setCatForm(null)}>完成</button>
                      </div>
                    </div>
                  )}

                  {/* ── 已建檔商品：庫存中綁定這家廠商的商品 ── */}
                  <div style={{fontSize:12, fontWeight:600, color:'var(--text-secondary)', letterSpacing:'.05em', margin:'12px 0 8px', paddingTop:10, borderTop:'1px dashed var(--border-dim)'}}>
                    已建檔商品 <span style={{fontFamily:'var(--font-mono)', fontWeight:400, color:'var(--text-tertiary)'}}>· {supplierProducts.length}</span>
                  </div>
                  {supplierProducts.length === 0 ? (
                    <div style={{textAlign:'center', padding:'10px 0', color:'var(--text-tertiary)', fontSize:12}}>
                      還沒有庫存商品綁定這家廠商
                      {onGoInventory && (
                        <button className="btn btn-ghost btn-sm" style={{marginLeft:8, minHeight:40}} onClick={onGoInventory}>去庫存管理設定</button>
                      )}
                    </div>
                  ) : groups.map(g => (
                    <div key={g.category} style={{marginBottom:10}}>
                      <div style={{
                        fontSize:11, fontWeight:600, color:'var(--text-tertiary)',
                        letterSpacing:'.05em', marginBottom:6,
                        display:'flex', alignItems:'center', gap:6,
                      }}>
                        <span>{CATEGORY_META[g.category]?.icon || '📦'}</span>
                        <span>{g.category}</span>
                        <span style={{fontFamily:'var(--font-mono)', fontWeight:400}}>· {g.products.length}</span>
                      </div>
                      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:6}}>
                        {g.products.map(p => {
                          const reorder = Number(p.reorderLevel) || 0
                          const stock = Number(p.stock) || 0
                          const low = reorder > 0 && stock <= reorder
                          return (
                            <div key={p.id} style={{
                              padding:'8px 10px',
                              borderRadius:6,
                              background:'var(--bg-raised)',
                              border:`1px solid ${low ? 'var(--amber)' : 'var(--border-dim)'}`,
                              fontSize:12,
                            }}>
                              <div style={{fontWeight:500, marginBottom:2}}>{p.name}</div>
                              <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-tertiary)'}}>
                                <span>庫存 {stock}{reorder ? `/安全 ${reorder}` : ''}</span>
                                <span style={{fontFamily:'var(--font-mono)'}}>${p.cost || '—'}</span>
                              </div>
                              {low && <div style={{fontSize:10, color:'var(--amber)', marginTop:2}}>⚠ 待補貨</div>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing && (
        <div style={ps.overlay}>
          <div style={{...ps.modal, maxWidth:400}} className="animate-scale">
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:18}}>
              <span style={{fontWeight:700}}>{editing==='new'?'新增供應商':'編輯供應商'}</span>
              <button className="btn-icon" onClick={()=>setEditing(null)}><X size={16}/></button>
            </div>
            {[['name','名稱 *'],['contact','聯絡方式'],['phone','電話'],['payTerms','付款條件'],['note','備註']].map(([k,l])=>(
              <div key={k} style={{marginBottom:12}}>
                <FL>{l}</FL>
                <input className="field" type={k==='phone'?'tel':'text'} value={form[k]||''} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} placeholder={k==='phone'?'例：0912-345-678':l}/>
                {/* v2.6: 付款條件快選 chips，填進輸入框後仍可自行修改 */}
                {k === 'payTerms' && (
                  <div style={{display:'flex', gap:6, marginTop:6, flexWrap:'wrap'}}>
                    {['現金','月結30天','月結60天'].map(t => (
                      <button key={t} onClick={()=>setForm(f=>({...f, payTerms:t}))} style={{
                        fontSize:12, padding:'10px 14px', minHeight:40, borderRadius:14,
                        background: form.payTerms===t ? 'var(--accent-dim)' : 'var(--bg-overlay)',
                        color: form.payTerms===t ? 'var(--accent)' : 'var(--text-secondary)',
                        border:`1px solid ${form.payTerms===t ? 'var(--accent)' : 'var(--border-dim)'}`,
                        fontWeight: form.payTerms===t ? 600 : 400,
                      }}>{t}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div style={{display:'flex', gap:10, marginTop:4}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={save}><Check size={15}/>儲存</button>
              <button className="btn btn-ghost"   style={{flex:1}} onClick={()=>setEditing(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* v2.6: 刪除確認／擋下說明 */}
      {deleting && (
        <div style={ps.overlay}>
          <div style={{...ps.modal, maxWidth:400}} className="animate-scale">
            {deleting.blocked ? (
              <>
                <div style={{fontWeight:700, fontSize:15, fontFamily:'var(--font-serif)', marginBottom:10}}>還不能刪除「{deleting.s.name}」</div>
                <p style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.8, marginBottom:18}}>
                  這家廠商還有
                  {deleting.boundCount > 0 && ` ${deleting.boundCount} 項商品綁定`}
                  {deleting.boundCount > 0 && deleting.openPoCount > 0 && '／'}
                  {deleting.openPoCount > 0 && ` ${deleting.openPoCount} 張未完成叫貨單`}
                  ，請先處理才能刪除。
                </p>
                <button className="btn btn-primary" style={{width:'100%', minHeight:44}} onClick={()=>setDeleting(null)}>知道了</button>
              </>
            ) : (
              <>
                <div style={{fontWeight:700, fontSize:15, fontFamily:'var(--font-serif)', marginBottom:10}}>確定刪除廠商「{deleting.s.name}」？</div>
                <p style={{fontSize:13, color:'var(--text-secondary)', lineHeight:1.8, marginBottom:18}}>
                  貨源目錄會一併刪除，已完成的進貨紀錄會保留。
                </p>
                <div style={{display:'flex', gap:10}}>
                  <button className="btn" style={{flex:1, minHeight:44, background:'var(--red)', color:'#fff'}} onClick={confirmDelete}><Trash2 size={15}/>確定刪除</button>
                  <button className="btn btn-ghost" style={{flex:1, minHeight:44}} onClick={()=>setDeleting(null)}>取消</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
