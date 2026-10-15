import {procurementLineCents} from '../../../electron/procurementRules.mjs'

export const quickButton={minHeight:48,fontSize:18}
export const quickField={minHeight:48,fontSize:18,width:'100%'}
export const quickMoney=n=>'NT$ '+n.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
const labels={sale:'賣東西',restaurant:'預訂餐點',purchase:'叫貨進貨'}
export default function QuickDocumentReview({draft,context,preview,issue,question,external,busy,pending,sectionRef,onChange,onBuild,onRetry,onProducts,onSuppliers}){
  function next(){
    if(!question)return onBuild()
    if(question.field==='products')return onProducts()
    if(question.field==='supplier'&&!context.suppliers.length)return onSuppliers()
    const field=sectionRef.current?.querySelector('[data-quick-field="'+question.field+'"]')
    field?.scrollIntoView?.({block:'center'});field?.focus()
  }
  return <section ref={sectionRef} aria-label="單據草稿" className="card quick-review">
    <h3>看一下這張單</h3><p>{labels[draft.kind]}</p>
    <fieldset disabled={busy||pending} className="quick-fields">
      {draft.items.map((item,index)=>{
        const product=context.products.find(p=>p.id===item.productId),priced=preview?.items.find(p=>p.id===item.productId)
        return <div className="quick-line" key={index}>
          <div className="quick-line-name"><strong>{product?.name||'找不到此品項'}</strong>{priced&&<span>單價 {quickMoney(priced.price)}／{priced.unit}<br/>小計 {quickMoney(procurementLineCents(priced.qty,priced.price)/100)}</span>}</div>
          <label>數量（{product?.unit||'個'}）<input aria-label={'數量 '+(product?.name||index)} className="field" type="number" disabled={external} min={draft.kind==='purchase'?'.001':'1'} step={draft.kind==='purchase'?'.001':'1'} style={{...quickField,width:110}} value={item.qty} onChange={e=>onChange('items',draft.items.map((row,i)=>i===index?{...row,qty:Number(e.target.value)}:row))}/></label>
          <button className="btn btn-ghost" style={quickButton} disabled={external} onClick={()=>onChange('items',draft.items.filter((_,i)=>i!==index))} aria-label={'移除 '+(product?.name||index)}>移除</button>
        </div>
      })}
      {draft.kind==='purchase'&&<>
        <label>向誰叫貨？<select data-quick-field="supplier" aria-label="叫貨供應商" className="field" style={quickField} value={draft.supplierId||''} onChange={e=>onChange('supplierId',e.target.value)}><option value="">請選供應商</option>{context.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>叫貨日期<input data-quick-field="date" aria-label="快速採購日期" className="field" type="date" style={quickField} value={draft.date||''} onChange={e=>onChange('date',e.target.value)}/></label>
      </>}
      {draft.kind==='restaurant'&&<>
        <label>怎麼交給客人？<select data-quick-field="channel" aria-label="交付方式" className="field" style={quickField} value={draft.channel||''} onChange={e=>onChange('channel',e.target.value)}><option value="" disabled>請選交付方式</option><option value="preorder">預訂自取</option><option value="walkin">現場</option><option value="delivery">外送</option></select></label>
        <label>取餐日期<input data-quick-field="day" aria-label="快速取餐日期" className="field" type="date" style={quickField} value={draft.day||''} onChange={e=>onChange('day',e.target.value)}/></label>
        <label>取餐時間<input data-quick-field="slot" aria-label="快速取餐時間" className="field" type="time" step="900" style={quickField} value={draft.slot||''} onChange={e=>onChange('slot',e.target.value)}/></label>
        <label>怎麼稱呼客人？（可不填）<input aria-label="快速客人稱呼" className="field" style={quickField} maxLength={100} value={draft.customer||''} onChange={e=>onChange('customer',e.target.value)}/></label>
        <label>聯絡電話或方式{draft.channel==='walkin'?'（可不填）':''}<input data-quick-field="contact" aria-label="快速聯絡方式" className="field" style={quickField} maxLength={100} value={draft.contact||''} onChange={e=>onChange('contact',e.target.value)}/></label>
      </>}
      <label>{draft.channel==='delivery'?'地址與備註':'備註（可不填）'}<textarea data-quick-field="note" aria-label="快速單據備註" className="field" style={quickField} maxLength={1000} value={draft.note||''} onChange={e=>onChange('note',e.target.value)}/></label>
    </fieldset>
    <div className="quick-confirm">
      {preview&&<strong className="quick-total">合計 {quickMoney(preview.total)}</strong>}
      {pending?<><p role="status">這張單的保存結果還在確認，先不要再開一張。</p><button className="btn btn-primary" style={quickButton} disabled={busy} onClick={onRetry}>{busy?'正在確認…':'確認這張單的結果'}</button></>:<>
        {question?<p role="status" className="quick-question">{question.message}</p>:issue&&<p role="status">{issue}</p>}
        <button className="btn btn-primary" style={quickButton} disabled={busy||!question&&!preview} onClick={next}>{busy?'正在建單…':question?question.action:draft.kind==='sale'?'帶入收銀台':draft.kind==='restaurant'?'確認建立預訂':'確認建立採購'}</button>
      </>}
      <p className="quick-hint">{draft.kind==='sale'?'帶入後再確認收款。':draft.kind==='restaurant'?'建單會預留庫存；尚未收款。':'建單後再確認收貨與付款。'}</p>
    </div>
  </section>
}
