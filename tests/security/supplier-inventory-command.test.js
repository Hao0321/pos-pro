import {test,expect} from 'vitest'
import {supplierInventoryCommand} from '../../src/utils/supplierInventoryCommand.mjs'
import {procurementCreationRequests} from '../../electron/procurementHistory.mjs'
import {planInventory,INVENTORY_PREFIX,INVENTORY_ACTION} from '../../electron/inventoryOperations.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
const now=new Date('2026-10-16T02:00:00Z'),identity={id:'agent-source-draft',time:'2026-10-13T02:00:00Z'},input={purchase:{id:'PO-agent-source-draft',supplierId:'supplier',date:'2026-10-16',note:'Original note',items:[{productId:'p',name:'Rice',unit:'袋',qty:2,unitCost:100,received:0}]}},state=()=>({storeId:'store',epoch:'current-epoch',supplierLedger:{revision:8,entries:[]},creationRequests:[]})
test('first Agent confirmation uses current operation time while preserving the older source document and its ID',()=>{
 const sourceQuote={document:{issuedAt:identity.time,terms:'original terms'}},request=supplierInventoryCommand('purchase-create',{...input,sourceQuote},identity,state(),{now})
 expect(request.identity).toEqual({id:identity.id,time:now.toISOString()});expect(request.input.sourceQuote).toEqual(sourceQuote);expect(request.input.supplierContext).toEqual({storeId:'store',epoch:'current-epoch',revision:8});expect(input.purchase.note).toBe('Original note')
})
test('reopening a saved Agent purchase reuses its exact command time and old supplier context after later ledger changes',()=>{
 const original={...input,id:identity.id,time:'2026-10-15T02:00:00Z',kind:'purchase-create',supplierContext:{storeId:'store',epoch:'old-epoch',revision:0}},current=state();current.supplierLedger.entries=[{id:identity.id,action:'purchase-register',input:original}]
 const command=supplierInventoryCommand('purchase-create',input,identity,current,{now});expect({...command.input,...command.identity}).toEqual(original)
})
test('changed business contents under one Agent ID remain rejected rather than rebased onto the old saved request',()=>{
 const original={...structuredClone(input),id:identity.id,time:'2026-10-15T02:00:00Z',kind:'purchase-create',supplierContext:{storeId:'store',epoch:'old-epoch',revision:0}},current=state();current.supplierLedger.entries=[{id:identity.id,action:'purchase-register',input:original}];const before=canonicalSignature(current)
 for(const changed of [{...input,purchase:{...input.purchase,note:'changed'}},{...input,purchase:{...input.purchase,items:[{...input.purchase.items[0],qty:3}]}},{...input,sourceQuote:{document:{id:'new'}}}])expect(()=>supplierInventoryCommand('purchase-create',changed,identity,current,{now})).toThrow('內容不同')
 expect(canonicalSignature(current)).toBe(before)
})
test('a pre-supplier-format Agent creation keeps its original request without inventing a new approval context',()=>{
 const original={...input,id:identity.id,time:identity.time,kind:'purchase-create'},current=state();current.creationRequests=[original];const command=supplierInventoryCommand('purchase-create',input,identity,current,{now})
 expect({...command.input,...command.identity}).toEqual(original);expect(command.input).not.toHaveProperty('supplierContext')
})
test('unknown IDs remain unchanged for restore fences and ordinary stocktake inputs retain their own original identity',()=>{
 const command=supplierInventoryCommand('purchase-create',input,identity,state(),{now});expect(command.identity.id).toBe(identity.id)
 expect(supplierInventoryCommand('stocktake',{counts:[{id:'p',stock:1,expectedStock:0}]},null,null,{controlled:false,now})).toEqual({input:{kind:'stocktake',counts:[{id:'p',stock:1,expectedStock:0}]},identity:null})
})
test('legacy creation lookup reads the actual canonical receipt, rejects corruption and never guesses from a purchase ID',()=>{
 const actor={userId:'owner',username:'Fixture Owner',role:'owner'},request={...input,...identity,kind:'purchase-create'},plan=planInventory(request,{products:[{id:'p',stock:0}],suppliers:[{id:'supplier',name:'Fixture Supplier'}],purchases:[]},actor),audit={id:INVENTORY_PREFIX+request.id,action:INVENTORY_ACTION,detail:JSON.stringify(plan.receipt)}
 expect(procurementCreationRequests([audit],[plan.purchase])).toEqual([request]);expect(procurementCreationRequests([],[plan.purchase])).toEqual([])
 expect(()=>procurementCreationRequests([{...audit,detail:'broken original'}],[plan.purchase])).toThrow('原始回執')
 expect(()=>procurementCreationRequests([audit,audit],[plan.purchase])).toThrow('原始回執')
 expect(procurementCreationRequests([{id:INVENTORY_PREFIX+'unrelated-stocktake',action:INVENTORY_ACTION,detail:'old opaque note'},audit],[plan.purchase])).toEqual([request])
 const changed={...request,purchase:{...request.purchase,id:'a-different-purchase'}};let failure;try{planInventory(changed,{products:[{id:'p',stock:0}],suppliers:[{id:'supplier',name:'Fixture Supplier'}],purchases:[plan.purchase]},actor)}catch(error){failure=error}expect(failure).toMatchObject({historyUncertain:true});expect(failure.message).toContain('保留原編號')
})
