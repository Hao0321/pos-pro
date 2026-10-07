const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os')
const executable=require('electron'),pwa=process.argv.includes('--pwa'),ui=process.argv.includes('--ui')||pwa
const target=path.resolve(__dirname,pwa?'../tests/security/native-pwa.cjs':ui?'../tests/security/native-ui.cjs':'../tests/security/native-database.cjs')
const env={...process.env};if(ui)delete env.ELECTRON_RUN_AS_NODE;else env.ELECTRON_RUN_AS_NODE='1'
const owned=fs.mkdtempSync(path.join(os.tmpdir(),ui?'pos-isolated-desktop-':'pos-isolated-security-'))
env.POS_SECURITY_FIXTURE_ROOT=owned
const result=spawnSync(executable,[target],{env,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024})
const resolved=path.resolve(owned),parent=path.resolve(os.tmpdir())
if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('pos-isolated-'))throw new Error('unsafe test cleanup target')
fs.rmSync(resolved,{recursive:true,force:true})
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'')
if(result.error){process.stderr.write(result.error.message+'\n');process.exit(1)}
if(result.status!==0||!result.stdout.includes(pwa?'POS_PWA_PASS':ui?'POS_NATIVE_UI_PASS':'POS_NATIVE_SECURITY_PASS'))process.exit(1)
