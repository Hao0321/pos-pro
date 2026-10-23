module.exports=function(db,api){
 const {isShiftCountRequest,admitShiftCount,shiftCountResult,shiftCountRejection}=require('./shiftCountDraft.mjs')
 for(const [method,kind]of [['openShift','open'],['closeShift','close']]){
  const original=api[method]
  api[method]=function(...args){
   const input=args[kind==='open'?0:1],actor=args[kind==='open'?1:2]
   if(!isShiftCountRequest(input))return original.apply(this,args)
   return db.transaction(()=>{
    const id=kind==='open'?input.id:args[0],context=this.getPrivateDraftContext(actor),book={shifts:this.getShifts(),...(kind==='close'?{orders:this.getOrders(),cashLog:this.getCashLog(id),topups:this.getTopups()}:{})};let checked
    try{checked=admitShiftCount(kind,id,input,context,book,actor)}catch(error){return shiftCountRejection(kind,id,input,error)}
    if(checked.original)return shiftCountResult(kind,checked.original,true)
    const result=kind==='open'?original.call(this,checked.data,actor):original.call(this,id,checked.data,actor)
    if(result?.success!==true)return result
    const row=this.getShifts().find(value=>value.id===id)
    if(!row)throw Error('班別資料需要核對')
    return shiftCountResult(kind,row)
   })()
  }
 }
}
