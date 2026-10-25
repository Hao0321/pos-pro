module.exports=function(db,api,stock){
 const model=require('./wasteEntryDraft.mjs'),{assertDraftLookup}=require('./privateDrafts.mjs'),add=api.addWaste,lookup=api.lookupPrivateDraftOriginal
 api.addWaste=function(input,actor){if(!model.isWasteEntry(input))return add.call(this,input,actor);try{return db.transaction(()=>{const checked=model.admitWasteEntry(input,this.getPrivateDraftContext(actor),{products:this.getProducts(),wasteLog:this.getWasteLog()},actor);return add.call(this,checked.data,actor)})()}catch(error){return {success:false,committed:false,error:error.message}}}
 api.lookupPrivateDraftOriginal=function(input,actor){if(input?.family!=='waste-entry')return lookup.call(this,input,actor);return db.transaction(()=>{
  const context=this.getPrivateDraftContext(actor);assertDraftLookup(input,context);const {core,digest}=model.wasteEntryLookup(input.document,context,actor);if(core.id!==input.id||digest!==input.digest)throw Error('原損耗資料需要核對，請保留輸入。')
  const row=model.wasteEntryOriginal(core,this.getWasteLog());if(!row)return {protocol:'pos-private-draft-original/v1',status:'missing',id:input.id}
  let costReceipt=null;if(stock.active()){costReceipt=stock.lookup(core,actor,'addWaste');if(!costReceipt&&!stock.read().projection.legacyOperationIds?.addWaste?.includes(core.id))throw Error('原單缺少成本回執，請保留原編號核對')}
  return {protocol:'pos-private-draft-original/v1',status:'matched',id:input.id,digest,action:'create',entryId:core.id,result:{success:true,waste:row,product:this.getProducts().find(row=>row.id===core.productId)||{id:core.productId},...(costReceipt?{costReceipt}:{})}}
 })()}
}
