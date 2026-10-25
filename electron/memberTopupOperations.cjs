module.exports=function(db,api){
 const model=require('./memberTopupDraft.mjs'),add=api.addTopup
 api.addTopup=function(input,actor){if(!model.isMemberTopupDraft(input))return add.call(this,input);try{return db.transaction(()=>{
  const context=this.getPrivateDraftContext(actor),checked=model.admitMemberTopup(input,context,{members:this.getMembers(),shifts:this.getShifts(),topups:this.getTopups()},actor)
  return add.call(this,checked.data)
 })()}catch(error){return {success:false,committed:false,error:error.message}}}
}
