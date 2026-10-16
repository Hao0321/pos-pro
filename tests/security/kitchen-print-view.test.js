import {test,expect} from 'vitest'
import {latestKitchenPrintJob} from '../../src/utils/kitchenPrintView'
import native from '../fixtures/kitchen-print-native-v1.json'
test('a lexically earlier copy supersedes the first ticket, independent of SQL ID order or clock order',()=>{
 const original={...native.packet.book.kitchenPrintJobs[0],id:'kp-restaurant-z',state:'confirmed'},first={...original,id:'kp-copy-b',copy:1,state:'submitted'},second={...original,id:'kp-copy-a',copy:2,state:'uncertain',createdAt:'2000-01-01T00:00:00Z'},other={...original,entryId:'other',copy:100};const jobs=[second,first,original,other],before=structuredClone(jobs)
 expect(latestKitchenPrintJob(jobs,original.entryId)).toBe(second);expect(jobs).toEqual(before);expect(latestKitchenPrintJob([...jobs].reverse(),original.entryId)).toBe(second)
 const cancel={...original,id:'cancellation-notice',kind:'cancel',state:'queued',copy:0};expect(latestKitchenPrintJob([...jobs,cancel],original.entryId)).toBe(cancel);expect(latestKitchenPrintJob(jobs,'missing')).toBeUndefined()
})

test('funded cancellation sources use immutable source versions before copy numbers or database/clock ordering',()=>{
 const entry={id:'funded',funds:{events:[{id:'partial-z',version:3},{id:'partial-a',version:6}]}},older={entryId:'funded',kind:'cancel',sourceOperationId:'partial-z',copy:99},latest={entryId:'funded',kind:'cancel',sourceOperationId:'partial-a',copy:0},copy={...latest,copy:1},prep={entryId:'funded',kind:'prepare',sourceOperationId:'partial-a',copy:100}
 expect(latestKitchenPrintJob([older,latest,prep],entry.id,entry)).toBe(latest)
 expect(latestKitchenPrintJob([copy,older,latest],entry.id,entry)).toBe(copy)
})
