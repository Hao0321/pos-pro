const stopServer=require('./serverShutdown.cjs')

// Browser HTTP/HTTPS port policy, checked 2026-10-18 against WHATWG Fetch 2.9
// https://fetch.spec.whatwg.org/#port-blocking and Chromium net/base/port_util.cc.
// Port 0 may request an OS allocation, but is never a usable advertised port.
const blocked=new Set([0,1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080])
const blockedError=()=>Error('這個連接埠無法用瀏覽器開啟，請使用 3443 或 8080。')
function isBrowserHttpPort(port){return Number.isInteger(port)&&port>0&&port<=65535&&!blocked.has(port)}
function assertRequestedBrowserPort(port,{minimum=1,allowDynamic=false}={}){
 if(allowDynamic&&port===0)return
 if(!Number.isInteger(port)||port<minimum||port>65535)throw Error('連接埠需介於 1024 到 65535')
 if(!isBrowserHttpPort(port))throw blockedError()
}
async function listenForBrowser(create,requested,host){
 assertRequestedBrowserPort(requested,{allowDynamic:true})
 for(let attempt=0;attempt<8;attempt++){
  const server=create(),stop=stopServer(server)
  try{
   await new Promise((resolve,reject)=>{
    const fail=error=>{server.removeListener('listening',ready);reject(error)},ready=()=>{server.removeListener('error',fail);resolve()}
    server.once('error',fail);server.once('listening',ready)
    try{server.listen(requested,host)}catch(error){server.removeListener('error',fail);server.removeListener('listening',ready);reject(error)}
   })
   const port=server.address()?.port
   if(isBrowserHttpPort(port))return {server,stop,port}
   await stop()
   if(requested!==0)throw blockedError()
  }catch(error){await stop();throw error}
 }
 throw Error('暫時找不到可供瀏覽器使用的連接埠，請重試。')
}
module.exports={isBrowserHttpPort,assertRequestedBrowserPort,listenForBrowser}
