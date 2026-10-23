import {tr,getLocale} from '../i18n'
import {useState,lazy,Suspense} from 'react'
import {Truck,ChevronUp,ChevronDown} from 'lucide-react'
import {DEFAULT_CATEGORIES,CATEGORY_META,mergeCategories} from '../utils/categories'
import {getProductHistory} from '../utils/analytics'
import {costDraftKey} from '../utils/costPricingDraft'
const CostPricingPanel=lazy(()=>import('./CostPricingPanel'))
export default function ProductFormFields({disabled,guided,editing,form,setForm,categories,suppliers,pricingAppliedRef,pricingInputRef,pricingOpen,setPricingOpen,pricingContext,session,onPricingChanged,orders,wasteLog,purchases}){
 const [showHistory,setShowHistory]=useState(false)
 return (
            <fieldset disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}><div className="product-fields" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14}}>
              <div data-product-core="name" style={{gridColumn:'1/-1'}}>
                <FieldLabel>{tr("商品名稱 *")}</FieldLabel>
                <input className="field" aria-label={tr('商品名稱')} autoFocus={guided} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder={tr("例：花生糖")}/>
              </div>
              <div>
                <FieldLabel>{tr("分類")}</FieldLabel>
                <input className="field" value={form.category} list="cat-list" onChange={e=>setForm(f=>({...f,category:e.target.value}))} placeholder={tr("例：雜貨、生鮮、調味料...")}/>
                <datalist id="cat-list">{mergeCategories(categories).map(c=><option key={c} value={c}/>)}</datalist>
                {/* 預設分類快捷鍵 */}
                <div style={{display:'flex', flexWrap:'wrap', gap:4, marginTop:6}}>
                  {DEFAULT_CATEGORIES.slice(0, 8).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={()=>setForm(f=>({...f,category:c}))}
                      style={{
                        fontSize:11, padding:'3px 8px', borderRadius:12,
                        background: form.category===c ? 'var(--gold-dim)' : 'var(--bg-overlay)',
                        color: form.category===c ? 'var(--gold)' : 'var(--text-secondary)',
                        border:'1px solid var(--border-dim)',
                      }}
                    >
                      {CATEGORY_META[c]?.icon} {c}
                    </button>
                  ))}
                </div>
              </div>
              <div data-product-core="unit">
                <FieldLabel>{tr("單位")}</FieldLabel>
                <input className="field" aria-label={tr('單位')} value={form.unit} onChange={e=>{if(pricingAppliedRef.current)pricingAppliedRef.current.stale=true;setForm(f=>({...f,unit:e.target.value}))}} placeholder={tr("包 / 瓶 / kg")}/>
              </div>
              <div data-product-core="price">
                <FieldLabel>{tr("售價 (NT$) *")}</FieldLabel>
                <input className="field" type="number" name="productPrice" aria-label={tr('售價')} value={form.price} onChange={e=>{pricingAppliedRef.current=null;setForm(f=>({...f,price:e.target.value}))}} placeholder="0"/>
              </div>
              <div data-product-core="cost">
                <FieldLabel>{tr("成本 (NT$)")}</FieldLabel>
                <input className="field" type="number" name="productCost" aria-label={tr('成本')} value={form.cost} onChange={e=>{pricingAppliedRef.current=null;setForm(f=>({...f,cost:e.target.value}))}} placeholder="0"/>
              </div>
              <div data-product-core="pricing" style={{gridColumn:'1/-1'}}>
                <button type="button" className="btn btn-ghost" data-cost-pricing-open style={{minHeight:48,width:'100%',whiteSpace:'normal'}} aria-expanded={pricingOpen} onClick={()=>setPricingOpen(value=>!value)}>{tr('自動算成本與售價')}</button>
                {pricingOpen&&(pricingContext.ready?<Suspense fallback={<p role="status">{tr('正在載入…')}</p>}><CostPricingPanel key={editing==='new'?form._creationId||'new':editing} unit={form.unit} cacheKey={costDraftKey(pricingContext.context,session,editing==='new'?form._creationId:editing)} currentInputRef={pricingInputRef} onDraftEdited={()=>{if(pricingAppliedRef.current){pricingAppliedRef.current.stale=true;onPricingChanged()}}} onApply={(values,signature)=>{pricingAppliedRef.current={signature,unit:form.unit,stale:false};setForm(old=>({...old,...values}))}}/></Suspense>:<p role="status">{tr('正在載入…')}</p>)}
              </div>
              <div data-product-core="stock">
                <FieldLabel>{tr("庫存數量")}</FieldLabel>
                <input className="field" aria-label={tr('庫存數量')} type="number" value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))} placeholder="0"/>
              </div>
              <div>
                <FieldLabel>{tr("安全庫存（低於此值提醒補貨）")}</FieldLabel>
                <input className="field" type="number" value={form.reorderLevel} onChange={e=>setForm(f=>({...f,reorderLevel:e.target.value}))} placeholder={tr("例：10")}/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <FieldLabel><Truck size={11} style={{verticalAlign:'-1px',marginRight:4}}/>{tr("主要供應商")}</FieldLabel>
                <select className="field" value={form.supplierId || ''} onChange={e=>setForm(f=>({...f,supplierId:e.target.value}))} style={{cursor:'pointer'}}>
                  <option value="">{tr("— 未指定 —")}</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {suppliers.length === 0 && (
                  <div style={{fontSize:11, color:'var(--text-tertiary)', marginTop:4}}>{tr("尚未建立供應商，請至「進貨管理 → 供應商」新增")}</div>
                )}
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--text-secondary)'}}>
                  <input type="checkbox" checked={form.noBarcode} onChange={e=>setForm(f=>({...f,noBarcode:e.target.checked,barcode:e.target.checked?'':f.barcode}))} style={{accentColor:'var(--gold)'}}/>{tr("此商品為自包裝，無條碼")}</label>
              </div>
              {!form.noBarcode && (
                <div style={{gridColumn:'1/-1'}}>
                  <FieldLabel>{tr("條碼")}</FieldLabel>
                  <input className="field" value={form.barcode} onChange={e=>setForm(f=>({...f,barcode:e.target.value}))} placeholder={tr("掃描或手動輸入")} style={{fontFamily:'var(--font-mono)'}}/>
                </div>
              )}
              <div>
                <FieldLabel>{tr("保存期限（選填）")}</FieldLabel>
                <input className="field" type="date" value={form.expiryDate || ''} onChange={e=>setForm(f=>({...f,expiryDate:e.target.value}))}/>
              </div>
              <div>
                <FieldLabel>{tr("商品圖片網址（選填）")}</FieldLabel>
                <input className="field" value={form.imageUrl || ''} onChange={e=>setForm(f=>({...f,imageUrl:e.target.value}))} placeholder="https://..."/>
              </div>
              {form.imageUrl && (
                <div style={{gridColumn:'1/-1', textAlign:'center'}}>
                  <img src={form.imageUrl} alt={tr("預覽")} style={{maxHeight:120, maxWidth:'100%', borderRadius:8, border:'1px solid var(--border-dim)'}} onError={e=>e.target.style.display='none'}/>
                </div>
              )}
            </div>
            {editing !== 'new' && (
              <div style={{marginTop:6, marginBottom:12, border:'1px solid var(--border-dim)', borderRadius:8, overflow:'hidden'}}>
                <button
                  type="button"
                  onClick={()=>setShowHistory(v=>!v)}
                  style={{
                    width:'100%', padding:'10px 14px', display:'flex',
                    justifyContent:'space-between', alignItems:'center',
                    background:'var(--bg-overlay)', fontSize:13, fontWeight:600,
                    color:'var(--text-secondary)',
                  }}
                >
                  <span>{tr("📋 變動歷史")}</span>
                  {showHistory ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                </button>
                {showHistory && (() => {
                  const history = getProductHistory(editing, { orders, wasteLog, purchases })
                  if (history.length === 0) return (
                    <div style={{padding:'14px', textAlign:'center', color:'var(--text-tertiary)', fontSize:12}}>{tr("此商品尚無變動紀錄")}</div>
                  )
                  return (
                    <div style={{maxHeight:200, overflowY:'auto'}}>
                      {history.slice(0, 30).map((h, i) => {
                        const positive = h.delta > 0
                        const typeMeta = {
                          sale:     { label: '銷售', color: 'var(--blue)',   icon: '🛒' },
                          refund:   { label: '退貨', color: 'var(--amber)',  icon: '↩️' },
                          purchase: { label: '進貨', color: 'var(--green)',  icon: '📦' },
                          waste:    { label: '損耗', color: 'var(--red)',    icon: '🗑️' },
                        }[h.type] || { label: h.type, color: 'var(--text-secondary)', icon: '·' }
                        return (
                          <div key={i} style={{
                            display:'flex', alignItems:'center', gap:10,
                            padding:'8px 14px',
                            borderTop:'1px solid var(--border-dim)',
                            fontSize:12,
                          }}>
                            <span style={{fontSize:14}}>{typeMeta.icon}</span>
                            <div style={{flex:1, minWidth:0}}>
                              <div style={{display:'flex', gap:6, alignItems:'center'}}>
                                <span style={{color:typeMeta.color, fontWeight:600, fontSize:11}}>{tr(typeMeta.label)}</span>
                                <span style={{color:'var(--text-tertiary)', fontSize:11}}>{h.note}</span>
                              </div>
                              <div style={{fontSize:10, color:'var(--text-tertiary)', marginTop:2, fontFamily:'var(--font-mono)'}}>
                                {new Date(h.time).toLocaleString(getLocale(),{ month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' })}
                                {h.unitPrice ? ` · @${h.unitPriceApproximate?'≈':''}$${h.unitPrice}` : ''}
                              </div>
                            </div>
                            <span style={{
                              fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13,
                              color: positive ? 'var(--green)' : 'var(--red)',
                            }}>
                              {positive ? '+' : ''}{h.delta}
                            </span>
                          </div>
                        )
                      })}
                      {history.length > 30 && (
                        <div style={{padding:'8px 14px', textAlign:'center', fontSize:11, color:'var(--text-tertiary)', borderTop:'1px solid var(--border-dim)'}}>{tr("僅顯示最近 30 筆（共 ")}{history.length}{tr(" 筆）")}</div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            </fieldset>
 )
}
function FieldLabel({children}){return <div style={{fontSize:'var(--product-label-size,11px)',color:'var(--text-tertiary)',marginBottom:5,letterSpacing:'.03em'}}>{children}</div>}
