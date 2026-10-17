const {randomUUID}=require('node:crypto'),{kitchenTicketBytes,kitchenTicketDigest}=require('./kitchenTicketBytes.mjs')
const transport=require('./printerTransport.cjs')
const printerSettings=target=>target.type==='windows'?{printerType:'windows',printerName:target.name}:{printerType:'network',printerIP:target.ip,printerPort:target.port}
module.exports=function kitchenPrintWorker({db,send=(target,bytes)=>transport.sendToPrinter(printerSettings(target),[Buffer.from(bytes)]),pollMs=1000,onError=()=>{},now=()=>new Date()}={}){
 let stopped=true,session='',timer=null,remove=null,pumping=null,scheduled=false
 function error(error){try{onError(error instanceof Error?error:Error(String(error)))}catch{}}
 async function pump(){
  while(!stopped){
   const work=db.readKitchenPrintWork();if(!work.binding.ready)return
   const job=work.state.jobs.filter(j=>j.state==='queued'&&j.epoch===work.epoch&&(j.dispatch==='manual'||work.policy.enabled)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))[0];if(!job)return
   const request={id:'kp-claim-'+randomUUID(),action:'claim',time:now().toISOString(),jobId:job.id,expectedVersion:job.version,destination:work.binding.destination,format:work.binding.format,contentSha256:kitchenTicketDigest(job.ticket,work.binding.format)}
   let claimed=false
   db.setKitchenPrintActiveAttempt(request.id,true)
   try{
    const result=db.applyKitchenPrintClaim(request);if(result?.success!==true||result.claimed!==true)return;claimed=true
    const bytes=kitchenTicketBytes(result.job.ticket,result.job.attempt.format)
    if(kitchenTicketDigest(result.job.ticket,result.job.attempt.format)!==request.contentSha256)throw Error('備餐單內容與已保存的送印嘗試不同')
    const outcome=await send(result.job.attempt.destination,bytes)
    const saved=db.applyKitchenPrintFinish({id:'kp-finish-'+randomUUID(),action:'finish',time:now().toISOString(),jobId:job.id,attemptId:request.id,submitted:outcome?.success===true,error:outcome?.success===true?'':String(outcome?.error||'送印結果尚未確認')})
    if(saved?.success!==true||saved.saved!==true)error(Error('送印結果未能保存，請先核對紙張'))
   }catch(cause){
    error(cause)
    if(claimed)try{db.applyKitchenPrintFinish({id:'kp-failure-'+randomUUID(),action:'finish',time:now().toISOString(),jobId:job.id,attemptId:request.id,submitted:false,error:String(cause?.message||cause).slice(0,1000)})}catch(failure){error(failure)}
   }finally{db.setKitchenPrintActiveAttempt(request.id,false)}
  }
 }
 function wake(){
  if(stopped||scheduled)return
  scheduled=true;queueMicrotask(()=>{scheduled=false;if(stopped||pumping)return;pumping=pump().catch(error).finally(()=>{pumping=null})})
 }
 return {
  start(){if(!stopped)return;stopped=false;session='kp-worker-'+randomUUID();db.setKitchenPrintWorkerSession(session);remove=db.onKitchenPrintChanged(wake);timer=setInterval(wake,pollMs);timer.unref?.();wake()},
  wake,
  async stop(){stopped=true;clearInterval(timer);remove?.();remove=null;await pumping;db.setKitchenPrintWorkerSession('')},
  status:()=>({running:!stopped,pumping:!!pumping,session}),
 }
}
