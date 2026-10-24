module.exports=function(db,api){
 const {isCashMovementDraft,admitCashMovement,cashMovementOriginal,cashMovementRejection}=require('./cashMovementDraft.mjs'),original=api.addCashLog
 api.addCashLog=function(input,actor){
  if(!isCashMovementDraft(input))return original.call(this,input,actor)
  return db.transaction(()=>{
   const context=this.getPrivateDraftContext(actor);let checked
   try{checked=admitCashMovement(input,context,{shifts:this.getShifts(),cashLog:this.getCashLog()})}catch(error){if(error.code==='CASH_MOVEMENT_SHIFT_CHANGED')return cashMovementRejection(input,error);throw error}
   if(checked.original)return {success:true,cashLog:checked.original,alreadySaved:true}
   const result=original.call(this,checked.data,actor)
   if(result?.success===false&&result.committed===false)return cashMovementRejection(input,Error(result.error))
   if(result?.success!==true)return result
   const row=cashMovementOriginal(checked.data,this.getCashLog());if(!row)throw Error('現金流水回覆不完整，請保留原輸入。')
   return {success:true,cashLog:row}
  })()
 }
}
