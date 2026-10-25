module.exports=function(db,api){
 const model=require('./expenseDrawer.mjs'),settings=require('./databaseSettings.cjs')(db),fence=require('./databaseFeatureFence.cjs'),add=api.addManualEntry,cash=api.addCashLog,remove=api.deleteManualEntry,lookup=api.lookupPrivateDraftOriginal,report=api.getStockAccountingState,close=api.closeShift,setOne=api.setSetting,setMany=api.setSettings
 const raw=()=>api.getSetting(model.DRAWER_JOURNAL),history=()=>model.readDrawerJournal(raw()),facts=()=>({manualEntries:db.prepare('SELECT * FROM manual_journal').all().map(row=>({...row,lines:JSON.parse(row.lines)})),cashLog:db.prepare('SELECT * FROM cash_log').all(),shifts:db.prepare('SELECT * FROM shifts').all(),orders:db.prepare('SELECT id,shiftId,source,status,payMethod,total,payments,refundOf FROM orders').all(),topups:db.prepare('SELECT * FROM member_topups').all()})
 const verify=()=>{if(raw()!=null)model.validateDrawerBook(history(),facts())},managed=id=>history().entries.some(row=>row.id===id||row.returned?.entry.id===id)
 if(raw()!=null)fence.installExpenseDrawerFence(db)
 api.setSetting=function(key,value){if(key===model.DRAWER_JOURNAL)throw Error('抽屜支出紀錄由正式支出與退回流程保存。');return setOne.call(this,key,value)}
 api.setSettings=function(values){if(Object.hasOwn(values,model.DRAWER_JOURNAL))throw Error('抽屜支出紀錄由正式支出與退回流程保存。');return setMany.call(this,values)}
 api.getExpenseDrawerState=function(actor){return db.transaction(()=>model.expenseDrawerState(this.getPrivateDraftContext(actor),history(),facts(),actor))()}
 api.lookupPrivateDraftOriginal=function(input,actor){if(!['expense-drawer','expense-drawer-return'].includes(input?.family))return lookup.call(this,input,actor);return db.transaction(()=>model.drawerOriginal(input,this.getPrivateDraftContext(actor),history(),facts()))()}
 api.addManualEntry=function(input,actor){
  if(![model.DRAWER_EXPENSE,model.DRAWER_RETURN].includes(input?.protocol)){verify();if(managed(input?.id))throw Error('抽屜支出請先確認現金已退回，不能直接刪改。');return add.call(this,input,actor)}
  let verified=false,known=false
  try{return db.transaction(()=>{
   const context=this.getPrivateDraftContext(actor),journal=history();verified=true;known=journal.entries.some(row=>row.id===input.id||row.returned?.id===input.id);const plan=model.planDrawerOperation(input,context,journal,facts(),actor)
   if(plan.original)return plan.original
   fence.installExpenseDrawerFence(db)
   const entry=add.call(this,plan.entry,actor);if(entry?.success!==true)throw Object.assign(Error(entry?.error||'抽屜支出尚未確認。'),{historyUncertain:entry?.committed!==false})
   const movement=cash.call(this,plan.cash,actor);if(movement?.success!==true)throw Object.assign(Error(movement?.error||'抽屜支出尚未確認。'),{historyUncertain:movement?.committed!==false})
   settings.setSetting.run(model.DRAWER_JOURNAL,JSON.stringify(plan.journal))
   return model.drawerOriginal(model.drawerLookup(input),context,history(),facts()).result
  })()}catch(error){return model.drawerRejection(input,error,!verified||known)}
 }
 api.addCashLog=function(input,actor){if(/^expense-(?:out|in)-/.test(input?.id||''))throw Error('抽屜支出現金只能由原支出或退回流程保存。');verify();return cash.call(this,input,actor)}
 api.deleteManualEntry=function(id,actor){verify();if(managed(id))throw Error('抽屜支出請先確認現金已退回，不能直接刪改。');return remove.call(this,id,actor)}
 api.getStockAccountingState=function(actor){verify();return report.call(this,actor)}
 api.closeShift=function(...args){verify();return close.apply(this,args)}
 for(const method of ['applyRestorePreview','restoreBackup','importData']){const previous=api[method];api[method]=function(...args){return db.transaction(()=>{const result=previous.apply(this,args);verify();if(raw()!=null)fence.installExpenseDrawerFence(db);return result})()}}
}
