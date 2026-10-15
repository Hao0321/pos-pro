// Stop admission first, then let complete requests finish. Incomplete uploads
// and TLS handshakes cannot keep a closing store alive indefinitely.
module.exports=function serverShutdown(server,{graceMs=1500}={}){
  const sockets=new Set()
  let task=null
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))})
  return function stop(){
    if(task)return task
    task=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{server.closeAllConnections?.();for(const socket of sockets)socket.destroy()},graceMs)
      const complete=error=>{clearTimeout(timer);if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')reject(error);else resolve()}
      try{server.close(complete);server.closeIdleConnections?.()}catch(error){complete(error)}
    }).catch(error=>{task=null;throw error})
    return task
  }
}
