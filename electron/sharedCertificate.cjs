const fs=require('node:fs'),path=require('node:path'),{randomBytes,X509Certificate}=require('node:crypto'),{spawnSync}=require('node:child_process')
module.exports=function certificate(directory,host){
  fs.mkdirSync(directory,{recursive:true})
  const manifest=path.join(directory,'certificate.json'),pfx=path.join(directory,'store.pfx'),cer=path.join(directory,'store.cer')
  let meta
  if(fs.existsSync(manifest))meta=JSON.parse(fs.readFileSync(manifest,'utf8'))
  if(!meta||meta.host!==host||!fs.existsSync(pfx)||!fs.existsSync(cer)||Date.parse(meta.validTo)<Date.now()+86400000){
    const passphrase=randomBytes(32).toString('hex')
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'createSharedCertificate.ps1'),'-OutputDirectory',directory,'-LanAddress',host],{env:{...process.env,POS_TLS_PASSWORD:passphrase},windowsHide:true,encoding:'utf8',timeout:30000})
    if(result.error||result.status!==0)throw Error('無法建立店面 HTTPS 憑證：'+(result.error?.message||result.stderr))
    const publicCert=new X509Certificate(fs.readFileSync(cer));meta={host,passphrase,fingerprint:publicCert.fingerprint256,validTo:publicCert.validTo}
    fs.writeFileSync(manifest,JSON.stringify(meta),{mode:0o600})
  }
  return {pfx:fs.readFileSync(pfx),passphrase:meta.passphrase,certificate:fs.readFileSync(cer),fingerprint:meta.fingerprint,validTo:meta.validTo}
}
