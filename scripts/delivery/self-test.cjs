const fs=require('node:fs'),path=require('node:path')
const {provision}=require('./tools.cjs'),{calibrate}=require('./calibrate.cjs'),{noLinks}=require('./files.cjs')
;(async()=>{
  if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24+ required')
  const root=path.resolve(__dirname,'../..'),base=path.join(root,'.rd/build');noLinks(base);fs.mkdirSync(base,{recursive:true})
  const extractor=await provision(path.join(base,'tools-7zip-26.04')),run=fs.mkdtempSync(path.join(base,'calibration-run-'))
  const report=calibrate(path.join(run,'fixtures'),extractor)
  console.log(JSON.stringify({success:true,marker:'POS_DELIVERY_CALIBRATION_PASS',negativeControls:report.negativeControls.length,run}))
})().catch(error=>{console.error(error.stack);process.exitCode=1})
