const {validateKitchenRecords,usesKitchenPrinting}=require('./kitchenPrint.mjs'),{readRestaurantConfig}=require('./restaurantRules.mjs'),{canonicalSignature}=require('./operationRules.mjs')
module.exports=function kitchenPrintStorage(db,settings){
 const rows=table=>db.prepare('SELECT data FROM '+table+' ORDER BY id').all().map(r=>JSON.parse(r.data))
 function context(){const products=db.prepare('SELECT * FROM products ORDER BY id').all(),raw=settings.getSetting.get('restaurantConfig')?.value;return {entries:rows('restaurant_orders'),restaurantOperations:rows('restaurant_operations'),config:readRestaurantConfig(raw??null,products)}}
 function read(){const state={jobs:rows('kitchen_print_jobs'),operations:rows('kitchen_print_operations')},data=context();validateKitchenRecords(state.jobs,state.operations,data);return {...state,data}}
 function save(next,before){
  if(!db.inTransaction)throw Error('列印工作必須和原單一起保存')
  validateKitchenRecords(next.jobs,next.operations,context())
  const byId=new Map(before.jobs.map(j=>[j.id,j])),operationIds=new Set(before.operations.map(o=>o.id))
  for(const job of next.jobs)if(canonicalSignature(job)!==canonicalSignature(byId.get(job.id)))db.prepare('INSERT INTO kitchen_print_jobs (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id,JSON.stringify(job))
  for(const op of next.operations)if(!operationIds.has(op.id))db.prepare('INSERT INTO kitchen_print_operations (id,data) VALUES (?,?)').run(op.id,JSON.stringify(op))
  require('./databaseFeatureFence.cjs').installKitchenPrintFence(db)
 }
 function enforce(){const state=read();if(usesKitchenPrinting(state.data.config,state.jobs,state.operations))require('./databaseFeatureFence.cjs').installKitchenPrintFence(db);return state}
 return {read,context,save,enforce}
}
