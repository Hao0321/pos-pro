import {useEffect,useRef,useState} from 'react'
import {Printer} from 'lucide-react'
import {tr} from '../i18n'
import './ReceiptPrint.css'

export default function ReceiptPrintControl({orderId,reviewFirst=false}){
  const [phase,setPhase]=useState('idle'),[review,setReview]=useState(false)
  const pending=useRef(null)
  useEffect(()=>{
    pending.current=null;setPhase('idle');setReview(false)
    return()=>{pending.current=null}
  },[orderId])
  const api=window.electronAPI
  const available=!api?.sharedStore&&typeof api?.printer?.printReceipt==='function'

  async function send(){
    if(pending.current||!available||!orderId)return
    const attempt={orderId};pending.current=attempt;setReview(false);setPhase('sending')
    let reply
    try{reply=await api.printer.printReceipt({id:orderId})}catch{}
    if(pending.current!==attempt)return
    pending.current=null
    // RP3: the existing printer contract only acknowledges transport submission.
    // Incomplete or contradictory replies cannot prove that paper was printed.
    setPhase(reply&&typeof reply==='object'&&!Array.isArray(reply)&&Object.keys(reply).length===1&&reply.success===true?'sent':'uncertain')
  }
  if(!available)return <p className="receipt-device-hint" data-receipt-device-hint>{tr('收據請到店面電腦列印。')}</p>
  const sending=phase==='sending'
  const message=phase==='sent'?'已送印，請確認紙張':phase==='uncertain'?'收據列印待核對，請先查看印表機。':phase==='checked'?'已自行核對紙張':''
  return <section className="receipt-print-control" data-receipt-print-state={phase} aria-busy={sending}>
    {message&&<p role={phase==='uncertain'?'alert':'status'}>{tr(message)}</p>}
    {phase==='uncertain'&&<p>{tr('結帳已完成，不需再次收款。')}</p>}
    {review?<div className="receipt-print-review" role="group" aria-label={tr('確認補印')}>
      <p>{tr('可能已印過。請先看紙張，再決定是否補印。')}</p>
      <p>{tr('只印收據，不再次收款。')}</p>
      <div className="receipt-print-actions">
        <button className="btn btn-ghost" data-receipt-cancel onClick={()=>setReview(false)}>{tr('取消')}</button>
        <button className="btn btn-primary" data-receipt-confirm onClick={send}>{tr('確認補印')}</button>
      </div>
    </div>:<div className="receipt-print-actions">
      <button className="btn btn-ghost" data-receipt-print disabled={sending} onClick={()=>phase==='idle'&&!reviewFirst?send():setReview(true)}>
        <Printer size={16}/>{tr(sending?'正在送印':phase==='idle'&&!reviewFirst?'列印收據':'需要補印')}
      </button>
      {(phase==='sent'||phase==='uncertain')&&<button className="btn btn-ghost" data-receipt-paper onClick={()=>setPhase('checked')}>{tr('已拿到收據')}</button>}
    </div>}
  </section>
}
