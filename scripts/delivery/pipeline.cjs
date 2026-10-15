const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync,execFileSync}=require('node:child_process')
const {identity,inventory,equalInventory,currentIdentities,noLinks,inside,write}=require('./files.cjs')
const {provision}=require('./tools.cjs'),{calibrate}=require('./calibrate.cjs'),{verifyEnvelope}=require('./envelope.cjs')
function sourceInputs(root){
  const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString('utf8').split('\0').filter(p=>p&&fs.existsSync(path.join(root,p))).sort()
  return paths.map(p=>identity(inside(root,path.join(root,p)),root))
}
function frontendInputs(root){return inventory(path.join(root,'dist')).map(row=>({...row,path:'dist/'+row.path}))}
function validateContract(c){
  assert.ok(c.schemaVersion===1&&c.product==='POS Pro'&&c.productVersion,'delivery contract identity absent')
  assert.ok(c.evaluator.selfTestPassed&&c.evaluator.taskFixturePassed,'delivery evaluator uncalibrated')
  for(const key of ['unsafe-entry','duplicate-entry','missing-file','unexpected-file','identity-mismatch','stale-build-inputs','stale-build-outputs','missing-embedded-receipt','semantic-version-drift'])assert.ok(c.negativeControls.includes(key),'delivery failure class not calibrated: '+key)
  assert.ok(c.canonicalBuild.deliveryGateAutomatic&&c.runtimeJourney.deliveredPayloadExecutedOrLoaded&&c.runtimeJourney.receiptReadback&&c.runtimeJourney.semanticFieldsMatch,'automatic delivered runtime gate absent')
  assert.ok(c.buildReceipt.currentInputs&&c.buildReceipt.currentOutputs&&c.buildReceipt.rawBytesEmbedded&&c.buildReceipt.runtimeSemanticReadback,'incomplete build chain')
  assert.ok(c.payload.closedWorld.expectedCount===c.payload.closedWorld.actualCount&&c.payload.closedWorld.missingCount===0&&c.payload.closedWorld.unexpectedCount===0&&c.payload.closedWorld.identityMismatchCount===0,'open payload inventory')
}
async function delivery({root,output,installer,inputs,frontend,sourceRevision,version,electronVersion,automatic=false,upgradeFixtures=[]}){
  assert.ok(automatic,'canonical automatic invocation required');inside(root,output);inside(output,installer)
  equalInventory(inputs,sourceInputs(root),'source changed after canonical build snapshot');equalInventory(frontend,frontendInputs(root),'frontend changed after canonical build')
  const base=path.join(root,'.rd/build');noLinks(base);fs.mkdirSync(base,{recursive:true})
  const run=fs.mkdtempSync(path.join(base,'delivery-')),extractor=await provision(path.join(base,'tools-7zip-26.04'))
  const calibration=calibrate(path.join(run,'calibration'),extractor)
  const current=verifyEnvelope({root,installer,buildDirectory:path.join(output,'win-unpacked'),run:path.join(run,'inspection'),extractor,inputs,frontend,version,electronVersion,sourceRevision})
  const runtimeInput={root,run:current.run,payload:current.payload,report:current.report,version,upgradeFixtures}
  const runtimeConfig=path.join(run,'runtime-input.json');write(runtimeConfig,runtimeInput)
  const runtimeTarget=path.join(__dirname,'runtime-cli.cjs'),started=Date.now()
  const result=spawnSync(process.execPath,[runtimeTarget,runtimeConfig],{cwd:root,windowsHide:true,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024})
  const log=path.join(run,'runtime.log');fs.writeFileSync(log,(result.stdout||'')+(result.stderr||'')+(result.error?.stack||''),{flag:'wx'})
  assert.ok(!result.error&&result.status===0,'delivered runtime failed; preserve '+log)
  const runtimeFile=path.join(current.run,'runtime-report.json'),runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'))
  assert.ok(runtime.status==='PASS'&&runtime.marker==='POS_DELIVERED_RUNTIME_PASS'&&runtime.tests>=23,'delivered runtime success marker absent')
  assert.equal(runtime.version,version,'runtime product version drift')
  equalInventory(inputs,sourceInputs(root),'source changed during delivered runtime');equalInventory(frontend,frontendInputs(root),'frontend changed during delivered runtime')
  const envelope=JSON.parse(fs.readFileSync(current.report)),rawReceipt=path.join(current.payload,'resources/build-receipt.json')
  currentIdentities(root,inputs,'final source inputs');currentIdentities(current.payload,envelope.payload,'final delivered payload')
  assert.deepEqual(identity(installer,root),envelope.installer,'delivery envelope changed during runtime')
  const evaluatorReport=path.join(run,'evaluator-report.json')
  const report={schemaVersion:1,status:'PASS',version,automatic:true,run,calibration,sourceRevision,installer:envelope.installer,envelopeReport:current.report,runtimeReport:runtimeFile,runtime:{tests:runtime.tests,upgrades:runtime.upgradeSources.length,elapsedMs:Date.now()-started,exit:result.status,executable:identity(runtime.executable,current.payload),log:identity(log,root)},evaluatorFiles:inventory(__dirname),signing:'unsigned',installerExecuted:false,publicRelease:false}
  write(evaluatorReport,report)
  const id=file=>identity(file,root),contract={schemaVersion:1,artifactKind:'installer',product:'POS Pro',productVersion:version,
    evaluator:{name:'POS Pro canonical delivery evaluator',sha256:identity(__filename,__dirname).sha256,selfTestPassed:true,taskFixturePassed:true,report:id(evaluatorReport)},
    deliveryEnvelope:{...id(installer),inspected:true},buildArtifact:{...id(path.join(output,'win-unpacked','POS Pro.exe')),authority:false},
    deliveredArtifact:{...id(runtime.executable),authority:true,source:'delivery-envelope-extraction',identity:{architecture:'x64',productName:'POS Pro',productVersion:version}},
    payload:{entryCount:envelope.runtimeFiles,unsafeEntryCount:0,duplicateEntryCount:0,closedWorld:{expectedCount:envelope.runtimeFiles,actualCount:envelope.runtimeFiles,missingCount:0,unexpectedCount:0,identityMismatchCount:0}},
    buildReceipt:{currentInputs:true,currentOutputs:true,rawBytesEmbedded:true,runtimeSemanticReadback:true,rawEmbeddedReceipt:id(rawReceipt),identityModes:{embedding:'raw-bytes',runtime:'semantic-fields'}},
    canonicalBuild:{nativeOutputsRebuilt:true,deliveryGateAutomatic:true},distributionMetadata:{sbomEmbedded:true,noticesEmbedded:true},runtimeJourney:{deliveredPayloadExecutedOrLoaded:true,receiptReadback:true,semanticFieldsMatch:true},negativeControls:calibration.negativeControls.map(c=>c.name),deterministicArchives:[]}
  validateContract(contract);write(path.join(run,'delivery-contract.json'),contract)
  return {report,contract,contractPath:path.join(run,'delivery-contract.json'),run,installer:envelope.installer}
}
module.exports={delivery,sourceInputs,frontendInputs,validateContract}
