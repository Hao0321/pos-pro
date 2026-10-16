const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os')
const modes={
  '--refund-review':['native-refund-review.cjs','POS_REFUND_REVIEW_PASS',false],
  '--refund-review-ui':['native-refund-review-ui.cjs','POS_REFUND_REVIEW_UI_PASS',true],
  '--browser-stock-business':['native-browser-stock-business.cjs','POS_BROWSER_STOCK_BUSINESS_PASS',false],
  '--physical-stocktake':['native-physical-stocktake.cjs','POS_PHYSICAL_STOCKTAKE_PASS',false],
  '--physical-stocktake-ui':['native-physical-stocktake-ui.cjs','POS_PHYSICAL_STOCKTAKE_UI_PASS',true],
  '--physical-stocktake-browser-ui':['native-physical-stocktake-browser-ui.cjs','POS_PHYSICAL_BROWSER_UI_PASS',true],
  '--recovery-transfer':['native-recovery-transfer.cjs','POS_RECOVERY_TRANSFER_PASS',false],
  '--recovery-transfer-ui':['native-recovery-transfer-ui.cjs','POS_RECOVERY_TRANSFER_UI_PASS',true],
  '--recovery-transfer-browser-ui':['native-recovery-transfer-browser-ui.cjs','POS_RECOVERY_TRANSFER_BROWSER_UI_PASS',true],
  '--stock-recovery':['native-stock-recovery.cjs','POS_STOCK_RECOVERY_PASS',false],
  '--stock-recovery-ui':['native-stock-recovery-ui.cjs','POS_STOCK_RECOVERY_UI_PASS',true],
  '--stock-browser-ui':['native-stock-browser-ui.cjs','POS_STOCK_BROWSER_UI_PASS',true],
  '--stock-reports':['native-stock-reports.cjs','POS_STOCK_REPORTS_PASS',false],
  '--stock-reports-ui':['native-stock-reports-ui.cjs','POS_STOCK_REPORTS_UI_PASS',true],
  '--stock-accounting':['native-stock-accounting.cjs','POS_STOCK_ACCOUNTING_PASS',false],
 '--cost-pricing-ui':['native-cost-pricing-ui.cjs','POS_COST_PRICING_UI_PASS',true],
  '--stock-sources':['native-stock-sources.cjs','POS_STOCK_SOURCES_PASS',false],
  '--stock-sources-ui':['native-stock-sources-ui.cjs','POS_STOCK_SOURCES_UI_PASS',true],
  '--stock-ledger':['native-stock-ledger.cjs','POS_STOCK_LEDGER_PASS',false],
  '--stock-opening':['native-stock-opening.cjs','POS_STOCK_OPENING_PASS',false],
  '--suppliers':['native-suppliers.cjs','POS_SUPPLIERS_PASS',false],
  '--suppliers-ui':['native-suppliers-ui.cjs','POS_SUPPLIERS_UI_PASS',true],
  '--suppliers-shared':['native-suppliers-shared.cjs','POS_SUPPLIERS_SHARED_PASS',false],
  '--customers':['native-customers.cjs','POS_CUSTOMERS_PASS',false],
  '--customers-ui':['native-customers-ui.cjs','POS_CUSTOMERS_UI_PASS',true],
  '--recovery':['native-recovery.cjs','POS_RECOVERY_PASS',false],
  '--recovery-ui':['native-recovery-ui.cjs','POS_RECOVERY_UI_PASS',true],
  '--sales':['native-sales.cjs','POS_SALES_PASS',false],
  '--sales-ui':['native-sales-ui.cjs','POS_SALES_UI_PASS',true],
  '--display-ui':['native-display-ui.cjs','POS_DISPLAY_UI_PASS',true],
  '--exchange':['native-exchange.cjs','POS_EXCHANGE_PASS',false],
  '--exchange-ui':['native-exchange-ui.cjs','POS_EXCHANGE_UI_PASS',true],
  '--shutdown':['native-shutdown.cjs','POS_SHUTDOWN_PASS',false],
  '--procurement-returns':['native-procurement-returns.cjs','POS_PROCUREMENT_RETURNS_PASS',false],
  '--agent-ui':['native-agent-ui.cjs','POS_AGENT_UI_PASS',true],
  '--procurement':['native-procurement.cjs','POS_PROCUREMENT_PASS',false],
  '--procurement-ui':['native-procurement-ui.cjs','POS_PROCUREMENT_UI_PASS',true],
  '--operations-ui':['native-operations-ui.cjs','POS_OPERATIONS_UI_PASS',true],
  '--restaurant':['native-restaurant.cjs','POS_RESTAURANT_PASS',false],
  '--restaurant-ui':['native-restaurant-ui.cjs','POS_RESTAURANT_UI_PASS',true],
  '--pwa':['native-pwa.cjs','POS_PWA_PASS',true],
  '--ui':['native-ui.cjs','POS_NATIVE_UI_PASS',true],
  '--mobile':['native-mobile.cjs','POS_MOBILE_PASS',true],
  '--shifts':['native-shift.cjs','POS_SHIFT_PASS',false],
  '--business':['native-business.cjs','POS_BUSINESS_PASS',false],
  '--shared':['native-shared.cjs','POS_SHARED_PASS',false],
  '--shared-ui':['native-shared-ui.cjs','POS_SHARED_UI_PASS',true],
  '--scenarios':['native-scenarios.cjs','POS_SCENARIO_NATIVE_PASS',false],
  '--scenario-ui':['native-scenario-ui.cjs','POS_SCENARIO_UI_PASS',true],
}
const selected=process.argv.slice(2);if(selected.length>1||selected.some(k=>!modes[k]))throw Error('Select one native test mode')
const spec=selected.length?modes[selected[0]]:['native-database.cjs','POS_NATIVE_SECURITY_PASS',false]
const executable=require('electron'),ui=spec[2]
const target=path.resolve(__dirname,'../tests/security',spec[0])
const env={...process.env};if(ui)delete env.ELECTRON_RUN_AS_NODE;else env.ELECTRON_RUN_AS_NODE='1'
const owned=fs.mkdtempSync(path.join(os.tmpdir(),ui?'pos-isolated-desktop-':'pos-isolated-security-'))
env.POS_SECURITY_FIXTURE_ROOT=owned
env.POS_SCENARIO_FIXTURE_ROOT=owned
const result=spawnSync(executable,[target],{env,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024})
const resolved=path.resolve(owned),parent=path.resolve(os.tmpdir())
if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('pos-isolated-'))throw new Error('unsafe test cleanup target')
fs.rmSync(resolved,{recursive:true,force:true})
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'')
if(result.error){process.stderr.write(result.error.message+'\n');process.exit(1)}
if(result.status!==0||!result.stdout.includes(spec[1]))process.exit(1)
