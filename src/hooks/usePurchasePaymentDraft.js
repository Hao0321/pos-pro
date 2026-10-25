import {useRef,useState} from 'react'
import useWorkspaceDraft from './useWorkspaceDraft'
import {loadPrivateDraftContext} from '../utils/dataAccess'
import {readPurchasePayment,lookupPurchasePayment} from '../utils/purchasePaymentAccess'
import {newPurchasePayment,validPurchasePayment,paymentTarget,paymentLookup} from '../utils/purchasePaymentDraft'
import {privateDraftDigest} from '../../electron/privateDrafts.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
import {expenseMoney} from '../../electron/expenseEntry.mjs'
import {readPendingFinancial} from '../utils/financialCommand'
import {supplierInventoryCommand} from '../utils/supplierInventoryCommand.mjs'
export default function usePurchasePaymentDraft({store,session}){
 const [value,setValue]=useState(newPurchasePayment),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[retryAllowed,setRetryAllowed]=useState(false),[needsReview,setNeedsReview]=useState(false),latest=useRef(null),gate=useRef(false),completed=useRef(null)
 latest.current={value,session,store};const put=next=>{latest.current.value=next;setValue(next)}
 const workspace=useWorkspaceDraft({kind:'purchase-payment',session,state:value,hasContent:!!value.target,validate:validPurchasePayment,enabled:session.role==='owner',onRestore:saved=>{put(saved||newPurchasePayment());setVisible(!!saved?.target);setRetryAllowed(false)},
  findOriginal:async(saved,metadata)=>{if(!saved?.submission)return null;const proof=await lookupPurchasePayment(paymentLookup(saved,metadata.context),latest.current.session);return proof.status==='matched'?proof:null},onOriginal:(proof,saved,metadata)=>finish(saved,proof,metadata,false)})
 function scope(context){workspace.assertScope(context);if(privateDraftDigest(context)!==privateDraftDigest(workspace.scope.context))throw Error('店面或帳號已變更，請保留原輸入核對。')}
 async function task(work){if(gate.current)return;gate.current=true;setBusy(true);try{return await work()}finally{gate.current=false;setBusy(false)}}
 async function finish(saved,proof,metadata=null,clear=true){const context=metadata?.context||workspace.scope.context,isCurrent=metadata?.isCurrent||(()=>{try{scope(context);return true}catch{return false}});if(!isCurrent())return false;await latest.current.store.confirmPurchasePayment(paymentLookup(saved,context),proof,{isCurrent});if(!isCurrent())return false;completed.current=saved.submission.id;if(clear)workspace.complete();put(newPurchasePayment());setVisible(false);setRetryAllowed(false);setNeedsReview(false);setMessage(proof.result.paymentReversed?'這筆付款已沖銷，沒有再次記帳。':'付款已記好，未付餘額已更新。');return true}
 async function open(purchaseId,invoiceId){return task(async()=>{if(workspace.blocked)throw Error('請先等草稿核對完成');if(latest.current.value.target){setVisible(true);throw Error('先完成或保留目前這筆付款輸入。')}const snapshot=await readPurchasePayment(purchaseId,invoiceId,latest.current.session);scope(snapshot.context);if(snapshot.bill.balance<=0)throw Error('這張請款單已經付清，請核對原付款。');workspace.begin();const next={...newPurchasePayment(),target:paymentTarget(snapshot),form:{amount:String(snapshot.bill.balance),method:'bank',note:''}};await workspace.adopt(next);put(next);setVisible(true);setMessage('');setNeedsReview(false)})}
 function field(key,text){if(gate.current||workspace.blocked||latest.current.value.submission)return;workspace.begin();put({...latest.current.value,form:{...latest.current.value.form,[key]:text}});setMessage('')}
 async function refresh(){return task(async()=>{const saved=latest.current.value;if(!saved.target||saved.submission||workspace.blocked)return;const snapshot=await readPurchasePayment(saved.target.purchaseId,saved.target.invoiceId,latest.current.session);scope(snapshot.context);const next={...saved,target:paymentTarget(snapshot)};await workspace.adopt(next);put(next);setNeedsReview(false);setMessage('已更新未付餘額，原金額與備註都保留。')})}
 function pendingFor(saved){const pending=readPendingFinancial();return pending?.kind==='purchase-pay'&&pending.request.id===saved.submission?.id&&privateDraftDigest(pending.request)===saved.submission.digest?pending:null}
 async function original(saved,context){const proof=await lookupPurchasePayment(paymentLookup(saved,context),latest.current.session);scope(context);if(proof.status==='matched')return finish(saved,proof);if(!pendingFor(saved))throw Error('原付款命令在這台裝置讀不到，請保留草稿核對。');return false}
 async function save(){return task(async()=>{
  if(workspace.blocked)throw Error('請先等草稿核對完成');const saved=latest.current.value,context=await loadPrivateDraftContext(latest.current.session);scope(context);if(!saved.target)throw Error('請先選擇要記錄付款的請款單。')
  if(saved.submission){if(await original(saved,context))return true;if(!retryAllowed)throw Error('請先核對原付款。');try{await latest.current.store.retryFinancial();scope(context);const proof=await lookupPurchasePayment(paymentLookup(saved,context),latest.current.session);scope(context);if(proof.status!=='matched')throw Error('付款原紀錄需要核對，請保留輸入，勿重複付款。');return finish(saved,proof)}catch(error){if(error.notCommitted&&!error.historyUncertain){scope(context);const next={...saved,submission:null};await workspace.adopt(next);put(next);setNeedsReview(true);setRetryAllowed(false)}throw error}}
  if(readPendingFinancial())throw Error('請先核對上一筆操作');const snapshot=await readPurchasePayment(saved.target.purchaseId,saved.target.invoiceId,latest.current.session);scope(snapshot.context);const target=paymentTarget(snapshot),cash=saved.form.method==='cash'
  if(target.purchaseDigest!==saved.target.purchaseDigest||target.balance!==saved.target.balance||target.supplierName!==saved.target.supplierName||cash&&privateDraftDigest(target.shift)!==privateDraftDigest(saved.target.shift)){setNeedsReview(true);throw Error('帳款或班次已變更，請先核對最新資料。')}
  const amount=expenseMoney(saved.form.amount);if(Math.round(amount*100)>Math.round(target.balance*100))throw Error('付款超過此請款單未付餘額');if(cash&&!target.shift)throw Error('請先開班，才能記錄本班次現金付款。')
  const input={purchaseId:target.purchaseId,invoiceId:target.invoiceId,expectedPurchase:canonicalSignature(snapshot.po),supplierContext:{storeId:snapshot.state.storeId,epoch:snapshot.state.epoch,revision:snapshot.state.supplierLedger.revision},amount,method:saved.form.method,note:saved.form.note,...(cash?{shiftId:target.shift.id}:{})},identity={id:'purchase-pay-'+crypto.randomUUID(),time:new Date().toISOString()};let candidate=null
  const planned=supplierInventoryCommand('purchase-pay',input,identity,snapshot.state),frozen={...planned.input,...planned.identity};candidate={...saved,submission:{id:frozen.id,time:frozen.time,digest:privateDraftDigest(frozen)}}
  workspace.persist();completed.current=null;await workspace.adopt(candidate);if(completed.current===candidate.submission.id)return true;scope(context);put(candidate);setRetryAllowed(false);let entered=false
  try{
   await latest.current.store.commitInventory('purchase-pay',input,identity,async pending=>{
    scope(context);if(pending.request.id!==candidate.submission.id||privateDraftDigest(pending.request)!==candidate.submission.digest)throw Error('付款原紀錄需要核對，請保留輸入，勿重複付款。')
    // Use the same command builder as the store, persist the small binding first,
    // then verify it against the coordinator's durable full request before mutation.
    entered=true;workspace.persist()
   });scope(context);const proof=await lookupPurchasePayment(paymentLookup(candidate,context),latest.current.session);scope(context);if(proof.status!=='matched')throw Error('付款原紀錄需要核對，請保留輸入，勿重複付款。');return finish(candidate,proof)
  }catch(error){if((error.notCommitted&&!error.historyUncertain||!entered)&&candidate&&!workspace.blocked){scope(context);const next={...candidate,submission:null};await workspace.adopt(next);put(next);setNeedsReview(true)}throw error}
 })}
 async function check(){return task(async()=>{const saved=latest.current.value;if(!saved.submission)throw Error('請先核對原付款。');const context=await loadPrivateDraftContext(latest.current.session);scope(context);if(await original(saved,context))return true;setRetryAllowed(true);setMessage('還沒找到這筆付款，可沿用原編號繼續。');return false})}
 function hide(){if(busy)return;workspace.persist();setVisible(false)}
 function discard(){if(busy||workspace.blocked||latest.current.value.submission)return;workspace.complete();put(newPurchasePayment());setVisible(false);setMessage('已放棄這份未保存輸入。')}
 return {value,visible,workspace,busy,message,retryAllowed,needsReview,pending:!!value.submission,open,field,refresh,save,check,hide,resume:()=>setVisible(true),discard}
}
