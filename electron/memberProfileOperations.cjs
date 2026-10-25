module.exports=function(db,api){
 const model=require('./memberProfile.mjs'),{assertDraftLookup}=require('./privateDrafts.mjs'),settings=require('./databaseSettings.cjs')(db),add=api.addMember,update=api.updateMember,lookup=api.lookupPrivateDraftOriginal,setOne=api.setSetting,setMany=api.setSettings
 api.setSetting=function(key,value){if(key===model.MEMBER_PROFILE_JOURNAL)throw Error('會員保存紀錄由正式保存與完整備份流程管理。');return setOne.call(this,key,value)}
 api.setSettings=function(values){if(Object.hasOwn(values,model.MEMBER_PROFILE_JOURNAL))throw Error('會員保存紀錄由正式保存與完整備份流程管理。');return setMany.call(this,values)}
 api.lookupPrivateDraftOriginal=function(input,actor){if(input?.family!=='member-profile')return lookup.call(this,input,actor);return db.transaction(()=>{const context=this.getPrivateDraftContext(actor);assertDraftLookup(input,context);return model.memberProfileOriginal(input,context,model.readMemberProfileJournal(this.getSetting(model.MEMBER_PROFILE_JOURNAL)))})()}
 function apply(action,memberId,input,actor){
  let admitted=false
  try{return db.transaction(()=>{
   const context=api.getPrivateDraftContext(actor),journal=model.readMemberProfileJournal(api.getSetting(model.MEMBER_PROFILE_JOURNAL)),rows=api.getMembers(),checked=model.admitMemberProfile(action,memberId,input,context,rows,journal)
   if(checked.original)return {success:true,member:rows.find(row=>row.id===memberId)||null,receipt:journal.entries.find(row=>row.id===checked.request.id),alreadySaved:true}
   admitted=true;const result=action==='create'?add.call(api,{...checked.data,id:memberId},actor):update.call(api,memberId,checked.data,actor)
   if(result?.success!==true)throw Error('會員保存紀錄需要核對，請保留原輸入。')
   const receipt=model.memberProfileReceipt(checked.request,context);settings.setSetting.run(model.MEMBER_PROFILE_JOURNAL,JSON.stringify({version:1,entries:[...journal.entries,receipt]}))
   return {success:true,member:api.getMembers().find(row=>row.id===memberId),receipt}
  })()}catch(error){if(admitted||error.code==='MEMBER_PROFILE_REVIEW_CHANGED')return model.memberProfileRejection(action,memberId,input,error);throw error}
 }
 api.addMember=function(input,actor){return model.isMemberProfile(input)?apply('create',input.id,input,actor):add.call(this,input,actor)}
 api.updateMember=function(id,input,actor){return model.isMemberProfile(input)?apply('update',id,input,actor):update.call(this,id,input,actor)}
}
