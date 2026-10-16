// Database IDs are not chronological. Cancellation notices take precedence;
// within one ticket kind the authority's copy number defines the latest copy.
export function latestKitchenPrintJob(jobs,entryId){
 return jobs.filter(job=>job.entryId===entryId).sort((a,b)=>Number(b.kind==='cancel')-Number(a.kind==='cancel')||b.copy-a.copy)[0]
}
