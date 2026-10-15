const {planRestaurant,restaurantReceipt,readRestaurantConfig,validateRestaurantRecords}=require('./restaurantRules.mjs')
const finance={prepareCheckout:require('./checkoutSafety.cjs').prepareCheckout,prepareRefund:require('./refundSafety.cjs').prepareRefund}
module.exports=function restaurantOperations(db,stmts,readOrder,orderInsertParams){
  const readEntries=()=>db.prepare("SELECT data FROM restaurant_orders ORDER BY json_extract(data,'$.createdAt') DESC,id DESC").all().map(r=>JSON.parse(r.data))
  const readOperations=()=>db.prepare('SELECT data FROM restaurant_operations ORDER BY id').all().map(r=>JSON.parse(r.data))
  function read(){
    const data={products:stmts.getAllProducts.all().map(p=>({...p,noBarcode:!!p.noBarcode})),entries:readEntries(),operations:readOperations(),orders:stmts.getAllOrders.all().map(o=>readOrder(o.id)),waste:db.prepare('SELECT * FROM waste_log').all(),shifts:db.prepare('SELECT * FROM shifts').all(),settings:Object.fromEntries(stmts.getAllSettings.all().map(s=>[s.key,s.value]))}
    data.config=readRestaurantConfig(data.settings.restaurantConfig,data.products)
    validateRestaurantRecords(data.entries,data.operations,data.orders,data.products)
    return data
  }
  return {
    getRestaurantState(){const data=read();return {config:data.config,entries:data.entries}},
    applyRestaurantOperation(request,actor){
      if(!actor||!['owner','staff'].includes(actor.role)||request?.action==='configure'&&actor.role!=='owner')throw Error('權限不足')
      let replay=false,historyChecked=false
      try{return db.transaction(()=>{
        const data=read(),old=data.operations.find(r=>r.id===request?.id);replay=!!old;historyChecked=true
        if(old)return restaurantReceipt(request,old,data)
        const plan=planRestaurant(request,data,actor,finance)
        // Stock, production state, ledger, loss and authoritative receipt share this transaction.
        for(const p of plan.next.products){const original=data.products.find(o=>o.id===p.id);if(p.stock!==original.stock)stmts.updateProductStock.run({id:p.id,delta:p.stock-original.stock})}
        if(plan.entry)db.prepare('INSERT INTO restaurant_orders (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(plan.entry.id,JSON.stringify(plan.entry))
        if(plan.order){stmts.insertOrder.run(orderInsertParams(plan.order));for(const i of plan.order.items)stmts.insertOrderItem.run({orderId:plan.order.id,productId:i.id,name:i.name,price:i.price,qty:i.qty})}
        if(plan.original)stmts.updateOrderStatus.run(plan.original.status,plan.original.id)
        for(const w of plan.waste)stmts.insertWaste.run(w)
        if(request.action==='configure')stmts.setSetting.run('restaurantConfig',JSON.stringify(plan.config))
        db.prepare('INSERT INTO restaurant_operations (id,data) VALUES (?,?)').run(request.id,JSON.stringify(plan.receipt))
        validateRestaurantRecords(plan.next.entries,[...data.operations,plan.receipt],plan.next.orders,plan.next.products)
        return restaurantReceipt(request,plan.receipt,plan.next)
      })()}catch(error){return {success:false,committed:error.operationConflict===true||historyChecked&&!replay?false:null,error:error.message}}
    },
  }
}
