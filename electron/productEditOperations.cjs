module.exports=function(db,api){
 const {PRODUCT_EDIT_JOURNAL,isProductEdit,admitProductEdit,readProductEditJournal,productEditOriginal,productEditReceipt,productEditRejection}=require('./productEditDraft.mjs'),{assertDraftLookup}=require('./privateDrafts.mjs'),settings=require('./databaseSettings.cjs')(db),original=api.updateProduct,lookup=api.lookupPrivateDraftOriginal,setOne=api.setSetting,setMany=api.setSettings
 api.setSetting=function(key,value){if(key===PRODUCT_EDIT_JOURNAL)throw Error('商品保存紀錄由正式保存與完整備份流程管理。');return setOne.call(this,key,value)}
 api.setSettings=function(values){if(Object.hasOwn(values,PRODUCT_EDIT_JOURNAL))throw Error('商品保存紀錄由正式保存與完整備份流程管理。');return setMany.call(this,values)}
 api.lookupPrivateDraftOriginal=function(input,actor){if(input?.family!=='product-edit')return lookup.call(this,input,actor);return db.transaction(()=>{const context=this.getPrivateDraftContext(actor);assertDraftLookup(input,context);return productEditOriginal(input,context,readProductEditJournal(this.getSetting(PRODUCT_EDIT_JOURNAL)))})()}
 api.updateProduct=function(id,input,actor){
  if(!isProductEdit(input))return original.call(this,id,input,actor)
  let admitted=false
  try{return db.transaction(()=>{
   const context=this.getPrivateDraftContext(actor),journal=readProductEditJournal(this.getSetting(PRODUCT_EDIT_JOURNAL)),product=this.getProducts().find(row=>row.id===id),checked=admitProductEdit(id,input,context,product,journal)
   if(checked.original)return {success:true,product:product||null,receipt:journal.entries.find(row=>row.id===checked.request.id),alreadySaved:true}
   admitted=true;const result=original.call(this,id,checked.data,actor);if(result?.success!==true)throw Error(result?.error||'商品保存紀錄需要核對，請保留原輸入。')
   const receipt=productEditReceipt(checked.request,context);settings.setSetting.run(PRODUCT_EDIT_JOURNAL,JSON.stringify({version:1,entries:[...journal.entries,receipt]}))
   return {success:true,product:this.getProducts().find(row=>row.id===id),receipt}
  })()}catch(error){if(admitted||error.code==='PRODUCT_EDIT_CONFLICT')return productEditRejection(id,input,error);throw error}
 }
}
