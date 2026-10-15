const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os')
const modes={
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
