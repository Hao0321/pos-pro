// Unknown populated tables conservatively require an explicit owner opt-in.
// Catalogues, credentials and empty-runtime metadata are not trading history.
const setup=new Set(['products','users','settings','audit_log','backups','sales_runtime','kitchen_print_runtime','stock_cost_runtime','shifts'])
module.exports=function fundsSetupEligible(db){
 for(const {name}of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
  if(!setup.has(name)&&db.prepare('SELECT 1 FROM "'+name.replaceAll('"','""')+'" LIMIT 1').get())return false
 }
 return true
}
