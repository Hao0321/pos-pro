import { browserStorage } from "../utils/browserStorage"
import { useState, useEffect, useRef } from "react"
import { writeAuditLog } from "../utils/security"
import { isElectron, loadSuppliers, loadPurchases, dbAddPurchase, dbUpdatePurchase } from "../utils/dataAccess"
import { canonicalSignature } from "../../electron/operationRules.mjs"
import { poItemKey, ps } from "./purchase/controls.jsx"
import { PurchaseList, ReceiveModal } from "./purchase/PurchaseList.jsx"
import { NewPurchase } from "./purchase/NewPurchase.jsx"
import { SupplierList } from "./purchase/SupplierList.jsx"
import { PayableTab } from "./purchase/PayableTab.jsx"

export default function PurchasePage({ store, session }) {
  const { products, commitInventory, orders = [] } = store
  const [suppliers,  setSuppliers]  = useState([])
  const [purchases,  setPurchases]  = useState([])
  const [tab,        setTab]        = useState('list')
  const [selected,   setSelected]   = useState(null)
  const [receiving,  setReceiving]  = useState(null)
  const [saveError,setSaveError]=useState(''),[saving,setSaving]=useState(false)
  const receivingBusy=useRef(false)

  useEffect(() => {
    const reload=()=>{loadSuppliers([]).then(setSuppliers).catch(e=>setSaveError(e.message));loadPurchases([]).then(setPurchases).catch(e=>setSaveError(e.message))};reload()
    const changed=event=>{const r=event.detail;if(r?.purchase)setPurchases(p=>p.map(po=>po.id===r.purchase.id?r.purchase:po));if(r?.supplier)setSuppliers(p=>p.map(s=>s.id===r.supplier.id?r.supplier:s))}
    window.addEventListener('pos-inventory-operation',changed);window.addEventListener('pos-data-refreshed',reload);return()=>{window.removeEventListener('pos-inventory-operation',changed);window.removeEventListener('pos-data-refreshed',reload)}
  }, [])

  function saveSuppliers(s) {
    if (!isElectron) browserStorage.setItem('pos_suppliers', JSON.stringify(s))
    setSuppliers(s)
  }
  function savePurchases(p) {
    if (!isElectron) browserStorage.setItem('pos_purchases', JSON.stringify(p))
    setPurchases(p)
  }

  // 在 Electron 模式同步單筆異動到 SQLite
  async function persistPurchase(po, isNew=false) {
    if (!isElectron) return
    try {
      const result = isNew ? await dbAddPurchase(po) : await dbUpdatePurchase(po.id, po)
      if (result?.success === false) throw Error(result.error || '進貨單保存失敗')
      return result.purchase
    } catch (e) { setSaveError(e.message);throw e }
  }

  async function handleReceive(po, receivedQtys) {
    if (receivingBusy.current) return
    receivingBusy.current=true;setSaving(true);setSaveError('')
    try {
      const result=await commitInventory('receive',{
        purchaseId:po.id,expectedPurchase:canonicalSignature(po),
        quantities:po.items.map((item,index)=>Number(receivedQtys[poItemKey(item,index)]||0)),
      })
      setPurchases(p=>p.map(row=>row.id===po.id?result.purchase:row))
      if(result.supplier)setSuppliers(p=>p.map(row=>row.id===result.supplier.id?result.supplier:row))
      setSelected(result.purchase);setReceiving(null)
    } catch(e) {setSaveError(e.message)}
    finally {receivingBusy.current=false;setSaving(false)}
  }

  // v2.6: 已付款 (paid) / 部分到 (partial) 也算已到貨，不再從已到貨清單消失
  const DONE_STATUS = ['received', 'partial', 'paid']
  const pending  = purchases.filter(p => !DONE_STATUS.includes(p.status))
  const done     = purchases.filter(p => DONE_STATUS.includes(p.status))
  const totalOwed = purchases.filter(p=>p.status!=='draft'&&!p.paidDate&&p.status!=='paid').reduce((s,p)=>s+p.total,0)

  return (
    <div style={ps.root}>
      <div style={ps.header}>
        <div>
          <h2 style={ps.title}>進貨管理</h2>
          <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
            {pending.length} 張待處理 · 待付款 NT$ {totalOwed.toLocaleString()}
          </div>
        </div>
        <div style={{display:'flex', gap:8}}>
          {[['list','進貨單'],['new','+ 新增'],['suppliers','供應商'],['payable','應付帳款']].map(([k,l])=>(
            <button key={k} onClick={()=>{setTab(k);setSelected(null)}} className={`btn btn-sm ${tab===k?'btn-primary':'btn-ghost'}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'list'      && <PurchaseList purchases={purchases} selected={selected} onSelect={setSelected} onReceive={setReceiving}/>}
      {saveError&&!receiving&&<p role="alert" style={{color:'var(--red)'}}>{saveError}</p>}
      {tab === 'new'       && <NewPurchase  products={products} suppliers={suppliers} purchases={purchases} orders={orders} onSave={async po=>{const saved=await persistPurchase(po,true)||po;savePurchases([saved,...purchases.filter(p=>p.id!==po.id)]);setTab('list');writeAuditLog('PURCHASE_CREATE',session,{id:po.id})}}/>}
      {tab === 'suppliers' && <SupplierList suppliers={suppliers} products={products} purchases={purchases} onSave={saveSuppliers} onGoInventory={()=>store.setView?.('inventory')}/>}
      {tab === 'payable'   && <PayableTab   purchases={purchases} suppliers={suppliers} onMarkPaid={async(id)=>{
        const target = purchases.find(p => p.id === id)
        if (!target) return
        // 保底：部分到貨不改 status（否則「補收到貨」按鈕會消失、貨永遠收不齊）
        const updatedPo = { ...target, paidDate: new Date().toISOString().slice(0,10), status: target.status === 'partial' ? 'partial' : 'paid' }
        const updated = purchases.map(p => p.id === id ? updatedPo : p)
        try {await persistPurchase(updatedPo);savePurchases(updated)}catch {return}
        writeAuditLog('PURCHASE_PAY', session, { poId:id })
      }}/>}

      {receiving && (
        <ReceiveModal po={receiving} products={products} saving={saving} error={saveError} onConfirm={q=>handleReceive(receiving,q)} onClose={()=>{if(!saving){setReceiving(null);setSaveError('')}}}/>
      )}
    </div>
  )
}
