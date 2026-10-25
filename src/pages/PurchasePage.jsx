import {tr,trMessage} from "../i18n"
import { browserStorage } from "../utils/browserStorage"
import { useState, useEffect, useRef, lazy, Suspense } from "react"
import { writeAuditLog } from "../utils/security"
import { isElectron, loadSuppliers, loadPurchases, dbAddPurchase, dbUpdatePurchase } from "../utils/dataAccess"
import { canonicalSignature } from "../../electron/operationRules.mjs"
import { localDate } from "../utils/checkoutSafety.mjs"
import { poItemKey, ps } from "./purchase/controls.jsx"
import { PurchaseList } from "./purchase/PurchaseList.jsx"
import { SupplierList } from "./purchase/SupplierList.jsx"
import { PayableTab } from "./purchase/PayableTab.jsx"
import {ProcurementPanel} from './purchase/ProcurementPanel.jsx'
import {isProcurement,procurementSummary} from '../../electron/procurementRules.mjs'
import SupplierPurchaseStatus,{purchaseApprovalBlocked} from './suppliers/SupplierPurchaseStatus'
import usePurchasePaymentDraft from '../hooks/usePurchasePaymentDraft'
import PurchasePaymentComposer from '../components/PurchasePaymentComposer'
const ArrivalModal=lazy(()=>import('./purchase/ArrivalModal.jsx'))
const NewPurchase=lazy(()=>import('./purchase/NewPurchase.jsx').then(module=>({default:module.NewPurchase})))

export default function PurchasePage({ store, session }) {
  const { products, commitInventory, orders = [] } = store
  const canEdit=session?.role==='owner'
  const payment=usePurchasePaymentDraft({store,session:session||{userId:'',username:'',role:''}})
  const [suppliers,  setSuppliers]  = useState([])
  const [purchases,  setPurchases]  = useState(()=>store.purchases||[])
  const [tab,        setTab]        = useState('list')
  const [selected,   setSelected]   = useState(null)
  const [receiving,  setReceiving]  = useState(null)
  const [saveError,setSaveError]=useState(''),[saving,setSaving]=useState(false)
  const receivingBusy=useRef(false)
  const creatingId=useRef(null)
  const supplierCredits=store.supplierState?.supplierLedger.entries||[]
  useEffect(()=>{const target=store.purchaseTarget;if(!target)return;if(target.tab){setTab(target.tab);setSelected(null);store.consumePurchaseTarget()}else{const po=purchases.find(row=>row.id===target.id);if(po){setSelected(po);setTab('list');store.consumePurchaseTarget()}}},[store.purchaseTarget,purchases])

  useEffect(() => {
    const reload=()=>{loadSuppliers([]).then(setSuppliers).catch(e=>setSaveError(e.message));loadPurchases([]).then(rows=>{setPurchases(rows);setSelected(p=>p?rows.find(row=>row.id===p.id)||null:p)}).catch(e=>setSaveError(e.message))};reload()
    const changed=event=>{const r=event.detail;if(r?.purchase){setPurchases(p=>[r.purchase,...p.filter(po=>po.id!==r.purchase.id)]);setSelected(p=>p?.id===r.purchase.id?r.purchase:p);if(r.receipt?.kind==='receive')setReceiving(p=>p?.id===r.purchase.id?null:p);if(r.receipt?.kind==='purchase-create'&&creatingId.current===r.purchase.id){creatingId.current=null;setTab('list');setSelected(r.purchase)}}if(r?.supplier)setSuppliers(p=>p.map(s=>s.id===r.supplier.id?r.supplier:s))}
    window.addEventListener('pos-inventory-operation',changed);window.addEventListener('pos-data-refreshed',reload);return()=>{window.removeEventListener('pos-inventory-operation',changed);window.removeEventListener('pos-data-refreshed',reload)}
  }, [])

  function saveSuppliers(s) {
    if (!isElectron) browserStorage.setItem('pos_suppliers', JSON.stringify(s))
    setSuppliers(s)
    store.refreshSuppliers?.().catch(error=>setSaveError(error.message))
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

  async function handleReceive(po, receivedQtys,extra={}) {
    if (receivingBusy.current) return
    receivingBusy.current=true;setSaving(true);setSaveError('')
    try {
      const result=await commitInventory('receive',{
        purchaseId:po.id,expectedPurchase:canonicalSignature(po),
        quantities:po.items.map((item,index)=>Number(receivedQtys[poItemKey(item,index)]||0)),...extra,
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
  const totalOwed = purchases.reduce((sum,p)=>sum+(isProcurement(p)?procurementSummary(p,undefined,supplierCredits).owed:p.status!=='draft'&&!p.paidDate&&p.status!=='paid'?p.total:0),0)

  return (
    <div style={ps.root}>
      <div style={ps.header}>
        <div>
          <h2 className="page-title" style={ps.title}>{tr("進貨管理")}</h2>
          <div style={{fontSize:12, color:'var(--text-tertiary)', marginTop:2}}>
            {pending.length}{tr(" 張待處理 · 待付款 NT$ ")}{totalOwed.toLocaleString()}
          </div>
        </div>
        <div style={{display:'flex', gap:8,flexWrap:'wrap',minWidth:0}}>
          {canEdit&&<button className="btn btn-ghost btn-sm" data-purchase-supplier-ledger onClick={()=>store.openSupplierLedger(selected?.supplierId||'')}>{tr('供應商與預付款')}</button>}
          {[['list','進貨單'],...(canEdit?[['new','+ 新增'],['suppliers','供應商']]:[]),['payable','應付帳款']].map(([k,l])=>(
            <button key={k} onClick={()=>{setTab(k);setSelected(null)}} className={`btn btn-sm ${tab===k?'btn-primary':'btn-ghost'}`}>{tr(l)}</button>
          ))}
        </div>
      </div>

      <PurchasePaymentComposer draft={payment} onShift={()=>store.setView('shifts')}/>
      {tab === 'list'      && <PurchaseList purchases={purchases} selected={selected} onSelect={setSelected} onReceive={canEdit&&!receiving?setReceiving:null} canReceive={po=>!purchaseApprovalBlocked(po,store.supplierState)} renderProcurement={po=><><SupplierPurchaseStatus po={po} state={store.supplierState} onOpen={store.openSupplierLedger}/><ProcurementPanel key={po.id} po={po} store={store} session={session} onCommand={commitInventory} openShift={store.openShift} readOnly={!canEdit} approvalBlocked={purchaseApprovalBlocked(po,store.supplierState)} supplierCredits={supplierCredits} onSupplierLedger={()=>store.openSupplierLedger(po.supplierId)} onOpenPayment={(purchaseId,invoiceId)=>payment.open(purchaseId,invoiceId).catch(error=>setSaveError(error.message))} paymentReady={!payment.workspace.blocked&&!payment.busy}/></>}/>}
      {saveError&&!receiving&&<p role="alert" style={{color:'var(--red)'}}>{trMessage(saveError)}</p>}
      {tab === 'new'       && <Suspense fallback={<p role="status">{tr('正在核對採購資料…')}</p>}><NewPurchase products={products} suppliers={suppliers} purchases={purchases} orders={orders} store={store} session={session} onSave={async(po,command)=>{creatingId.current=po.id;const r=await commitInventory(command.kind,command.input,command.identity,command.prepare);setSelected(r.purchase);setTab('list');return r}}/></Suspense>}
      {tab === 'suppliers' && <SupplierList suppliers={suppliers} products={products} purchases={purchases} onSave={saveSuppliers} onGoInventory={()=>store.setView?.('inventory')}/>}
      {tab === 'payable'   && <PayableTab purchases={purchases} suppliers={suppliers} supplierCredits={supplierCredits} readOnly={!canEdit||store.supplierState?.legacyReadOnly} onOpen={po=>{setSelected(po);setTab('list')}} onMarkPaid={async(id)=>{
        if(!canEdit)return
        const target = purchases.find(p => p.id === id)
        if (!target) return
        // 保底：部分到貨不改 status（否則「補收到貨」按鈕會消失、貨永遠收不齊）
        const updatedPo = { ...target, paidDate: localDate(), status: target.status === 'partial' ? 'partial' : 'paid' }
        const updated = purchases.map(p => p.id === id ? updatedPo : p)
        try {await persistPurchase(updatedPo);savePurchases(updated)}catch {return}
        writeAuditLog('PURCHASE_PAY', session, { poId:id })
      }}/>}

      {receiving && (
        <Suspense fallback={<p role="status">{tr('正在核對庫存…')}</p>}><ArrivalModal po={receiving} store={store} session={session} suppliers={suppliers} onSourceUpdated={(current,{close=false}={})=>{setPurchases(previous=>previous.map(row=>row.id===current.id?current:row));setSelected(current);setReceiving(close?null:current)}} saving={saving} error={saveError} onLegacy={(q,extra)=>handleReceive(receiving,q,extra)} onSaved={result=>{setSelected(result.purchase);setReceiving(null);setSaveError('')}} onClose={()=>{if(!saving){setReceiving(null);setSaveError('')}}}/></Suspense>
      )}
    </div>
  )
}
