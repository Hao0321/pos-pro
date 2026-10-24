// Database IDs are not chronological. Cancellation notices take precedence;
// within one ticket kind the authority's copy number defines the latest copy.
export function latestKitchenPrintJob(jobs,entryId,entry=null){
 const versions=new Map(entry?.funds?.events.map(event=>[event.id,event.version])||[])
 if(entry?.funds)versions.set(entry.id,1)
 return jobs.filter(job=>job.entryId===entryId).sort((a,b)=>Number(b.kind==='cancel')-Number(a.kind==='cancel')||(versions.get(b.sourceOperationId)||0)-(versions.get(a.sourceOperationId)||0)||b.copy-a.copy)[0]
}
