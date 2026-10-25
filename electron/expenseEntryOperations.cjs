module.exports=function(db,api,stock){
 const model=require('./expenseEntry.mjs'),settings=require('./databaseSettings.cjs')(db),add=api.addManualEntry,remove=api.deleteManualEntry,lookup=api.lookupPrivateDraftOriginal,setOne=api.setSetting,setMany=api.setSettings,history=()=>model.readExpenseJournal(api.getSetting(model.EXPENSE_JOURNAL)),rows=id=>db.prepare('SELECT * FROM manual_journal WHERE id=?').all(id).map(row=>({...row,lines:JSON.parse(row.lines)}))
 api.setSetting=function(key,value){if(key===model.EXPENSE_JOURNAL)throw Error('支出保存紀錄由正式記帳與完整備份流程管理。');return setOne.call(this,key,value)}
 api.setSettings=function(values){if(Object.hasOwn(values,model.EXPENSE_JOURNAL))throw Error('支出保存紀錄由正式記帳與完整備份流程管理。');return setMany.call(this,values)}
 api.lookupPrivateDraftOriginal=function(input,actor){if(input?.family!=='expense-entry')return lookup.call(this,input,actor);return db.transaction(()=>model.expenseOriginal(input,this.getPrivateDraftContext(actor),history(),rows(input.id)))()}
 api.addManualEntry=function(input,actor){
  if(input?.protocol!==model.EXPENSE_PROTOCOL){if(history().entries.some(row=>row.id===input?.id))throw Error('請以原支出編號核對，勿重新記帳。');return add.call(this,input,actor)}
  let verified=false,known=false
  try{return db.transaction(()=>{
   const context=this.getPrivateDraftContext(actor),journal=history();verified=true;known=journal.entries.some(row=>row.id===input.id);const plan=model.planExpense(input,context,journal,rows(input.id),stock.active());if(plan.original)return plan.original.result
   const result=add.call(this,plan.entry,actor);if(result?.success!==true)throw Object.assign(Error(result?.error||'支出結果尚未確認，請先核對原編號。'),{historyUncertain:result?.committed!==false})
   settings.setSetting.run(model.EXPENSE_JOURNAL,JSON.stringify({version:1,entries:[...journal.entries,plan.receipt]}));return model.expenseOriginal(model.expenseLookup(input),context,history(),rows(input.id)).result
  })()}catch(error){return {protocol:model.EXPENSE_PROTOCOL,success:false,committed:!verified||known||error.historyUncertain?null:false,id:input.id,digest:require('./privateDrafts.mjs').privateDraftDigest(input),error:error.message}}
 }
 api.deleteManualEntry=function(id,actor){const journal=history(),receipt=journal.entries.find(row=>row.id===id);if(!receipt)return remove.call(this,id,actor);return db.transaction(()=>{const context=this.getPrivateDraftContext(actor);if(context.role!=='owner')throw Error('此操作需要店主權限');if(receipt.removed){if(rows(id).length)throw Error('原支出紀錄需要核對，請勿重新記帳。');return {success:true}}const result=remove.call(this,id,actor);if(result?.success!==true)throw Error(result?.error||'支出取消尚未確認');settings.setSetting.run(model.EXPENSE_JOURNAL,JSON.stringify({version:1,entries:journal.entries.map(row=>row.id===id?{...row,removed:true}:row)}));return result})()}
}
