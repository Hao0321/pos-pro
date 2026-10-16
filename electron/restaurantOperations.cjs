const {planRestaurant,restaurantReceipt,readRestaurantConfig,validateRestaurantRecords}=require('./restaurantRules.mjs')
const finance={prepareCheckout:require('./checkoutSafety.cjs').prepareCheckout,prepareRefund:require('./refundSafety.cjs').prepareRefund}
const {customerOrderView}=require('./tableOrdering.mjs')
const {usesRestaurantFunds}=require('./restaurantFunds.mjs')
const {salesDate}=require('./salesRules.mjs')
const {restaurantFundsSetupState}=require('./restaurantFundsSetup.mjs'),fundsSetupEligible=require('./restaurantFundsSetupStorage.cjs')
module.exports=function restaurantOperations(db,stmts,readOrder,orderInsertParams){
  const readEntries=()=>db.prepare("SELECT data FROM restaurant_orders ORDER BY json_extract(data,'$.createdAt') DESC,id DESC").all().map(r=>JSON.parse(r.data))
  const readOperations=()=>db.prepare('SELECT data FROM restaurant_operations ORDER BY id').all().map(r=>JSON.parse(r.data))
  function read(){
    const data={products:stmts.getAllProducts.all().map(p=>({...p,noBarcode:!!p.noBarcode})),entries:readEntries(),operations:readOperations(),orders:stmts.getAllOrders.all().map(o=>readOrder(o.id)),waste:db.prepare('SELECT * FROM waste_log').all(),cashLogs:db.prepare('SELECT * FROM cash_log').all(),shifts:db.prepare('SELECT * FROM shifts').all(),settings:Object.fromEntries(stmts.getAllSettings.all().map(s=>[s.key,require('./settingEncoding.mjs').nativeSettingText(s)]))}
    data.config=readRestaurantConfig(data.settings.restaurantConfig,data.products)
    if(usesRestaurantFunds(data.config,data.entries,data.orders)){
      require('./databaseFeatureFence.cjs').installFundsFence(db)
      if(!data.settings.sharedStoreId){
        if(data.entries.some(entry=>entry.funds))throw Error('預訂款項缺少店面或復原識別，請保留原資料核對。')
        data.settings.sharedStoreId=require('node:crypto').randomUUID();stmts.setSetting.run('sharedStoreId',data.settings.sharedStoreId)
      }
    }
    data.storeId=data.settings.sharedStoreId||'';data.epoch=db.prepare('SELECT value FROM sales_runtime WHERE id=?').get('epoch').value
    data.costMode=db.prepare('SELECT 1 FROM stock_cost_entries LIMIT 1').get()?'active':'reference'
    data.now=Date.now();data.date=salesDate(new Date(data.now))
    data.fundsSetupEligible=fundsSetupEligible(db)
    validateRestaurantRecords(data.entries,data.operations,data.orders,data.products,{cashLogs:data.cashLogs,waste:data.waste,storeId:data.storeId})
    return data
  }
  return {
    getRestaurantState(){const data=read(),customers=data.orders.filter(o=>o.source==='customer');return {config:data.config,entries:data.entries,fundsSetup:restaurantFundsSetupState(data),...(usesRestaurantFunds(data.config,data.entries,data.orders)?{storeId:data.storeId,epoch:data.epoch,costMode:data.costMode,today:data.date,now:new Date(data.now).toISOString()}:{}),...(customers.length?{customerOrders:customers.map(o=>customerOrderView(o,data.entries))}:{})}},
    applyRestaurantOperation(request,actor){
      if(!actor||!['owner','staff'].includes(actor.role)||request?.action==='configure'&&actor.role!=='owner')throw Error('權限不足')
      if(require('./databaseFeatureFence.cjs').hasFundsFence(db)||request?.action==='configure'&&request.config?.fundsEnabled===true){
        const current=actor.userId&&db.prepare('SELECT id,username,role FROM users WHERE id=?').get(actor.userId)
        if(!current||current.role!==actor.role||current.username!==actor.username)throw Error('權限不足')
      }
      let replay=false,historyChecked=false
      try{return db.transaction(()=>{
        const data=read(),old=data.operations.find(r=>r.id===request?.id);replay=!!old;historyChecked=true
        if(old)return restaurantReceipt(request,old,data)
        if(request?.customerOrderId&&Math.abs(Date.now()-Date.parse(request.time))>300000)throw Error('接單時間已過期，請重新核對原單')
        const plan=planRestaurant(request,data,actor,finance)
        // Stock, production state, ledger, loss and authoritative receipt share this transaction.
        for(const p of plan.next.products){const original=data.products.find(o=>o.id===p.id);if(p.stock!==original.stock)stmts.updateProductStock.run({id:p.id,delta:p.stock-original.stock})}
        if(plan.entry)db.prepare('INSERT INTO restaurant_orders (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(plan.entry.id,JSON.stringify(plan.entry))
        if(plan.order){stmts.insertOrder.run(orderInsertParams(plan.order));for(const i of plan.order.items)stmts.insertOrderItem.run({orderId:plan.order.id,productId:i.id,name:i.name,price:i.price,qty:i.qty})}
        if(plan.original)stmts.updateOrderStatus.run(plan.original.status,plan.original.id)
        if(plan.cashLog)stmts.insertCashLog.run(plan.cashLog)
        for(const w of plan.waste)stmts.insertWaste.run(w)
        if(request.action==='configure')stmts.setSetting.run('restaurantConfig',JSON.stringify(plan.config))
        db.prepare('INSERT INTO restaurant_operations (id,data) VALUES (?,?)').run(request.id,JSON.stringify(plan.receipt))
        validateRestaurantRecords(plan.next.entries,[...data.operations,plan.receipt],plan.next.orders,plan.next.products,{cashLogs:plan.next.cashLogs||data.cashLogs,waste:plan.next.waste,storeId:data.storeId})
        return restaurantReceipt(request,plan.receipt,read())
      })()}catch(error){return {success:false,committed:error.historyUncertain?null:error.operationConflict===true||historyChecked&&!replay?false:null,error:error.message,...(error.historyUncertain?{errorCode:'RECOVERY_REQUIRED'}:{})}}
    },
  }
}
