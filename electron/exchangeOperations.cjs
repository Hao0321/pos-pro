const {randomUUID}=require('node:crypto')
const {EXCHANGE_SETTING,EXCHANGE_ACTION,EXCHANGE_PREFIX,readExchangeStore,planExchange,exchangeReceipt,makeCatalogue,makePartyCard}=require('./businessExchange.mjs')
module.exports=function(db,stmts){
  const identity=()=>{let id=stmts.getSetting.get('sharedStoreId')?.value;if(!id){id=randomUUID();stmts.setSetting.run('sharedStoreId',id)}return {id,name:stmts.getSetting.get('storeName')?.value||'商店'}}
  const state=()=>readExchangeStore(stmts.getSetting.get(EXCHANGE_SETTING)?.value)
  return {
    async getExchangeContext(actor){
      if(actor?.role!=='owner')throw Error('權限不足')
      const sender=identity(),products=stmts.getAllProducts.all(),saved=state()
      return {storeId:sender.id,sender,partyCard:makePartyCard(sender),state:saved,catalogue:await makeCatalogue(products,sender)}
    },
    getPublicCatalogue(){return makeCatalogue(stmts.getAllProducts.all().filter(p=>p.stock>0&&p.price>0),identity())},
    applyExchangeOperation(request,actor){
      if(actor?.role!=='owner')throw Error('權限不足')
      let replay=false,checked=false
      try{return db.transaction(()=>{
        const sender=identity()
        if(request.storeId!==sender.id)throw Error('報價店面不符，請回到原店面確認')
        const key=EXCHANGE_PREFIX+request.id,old=db.prepare('SELECT * FROM audit_log WHERE id=?').get(key),saved=state()
        replay=!!old;checked=true
        if(old){if(old.action!==EXCHANGE_ACTION)throw Error('報價回執需要核對');return exchangeReceipt(request,JSON.parse(old.detail),saved)}
        const plan=planExchange(request,saved,stmts.getAllProducts.all(),sender,actor)
        stmts.setSetting.run(EXCHANGE_SETTING,JSON.stringify(plan.state))
        stmts.insertAuditLog.run({id:key,timestamp:new Date().toISOString(),action:EXCHANGE_ACTION,level:'info',label:'客戶報價',userId:actor.userId||'',username:actor.username||'',role:actor.role,detail:JSON.stringify(plan.receipt)})
        return exchangeReceipt(request,plan.receipt,plan.state)
      })()}catch(error){return {success:false,committed:error.operationConflict===true||checked&&!replay?false:null,error:error.message}}
    },
  }
}
