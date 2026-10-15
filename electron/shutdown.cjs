// Both network services own their startup/drain barriers. SQLite stays open
// until every barrier succeeds, including when a quit is requested twice.
module.exports=function shutdown({stopServices,closeDatabase}){
  let task=null,complete=false
  return function stop(){
    if(complete)return Promise.resolve()
    if(task)return task
    task=Promise.resolve().then(()=>Promise.allSettled(stopServices().map(stop=>Promise.resolve().then(stop)))).then(async results=>{
      const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason)
      if(failures.length)throw new AggregateError(failures,'店面連線尚未完全停止')
      await closeDatabase()
      complete=true
    }).finally(()=>{task=null})
    return task
  }
}
