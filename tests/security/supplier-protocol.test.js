import fs from 'node:fs'
import {test,expect} from 'vitest'
import {SUPPLIER_PAYMENT_DRAFT,readSupplierPaymentDraft} from '../../src/utils/supplierLedgerUi.mjs'
const schema=JSON.parse(fs.readFileSync('public/agent/supplier-payment-draft-v1.schema.json','utf8'))
const discovery=JSON.parse(fs.readFileSync('public/.well-known/pos-agent.json','utf8'))
const now=Date.now(),valid={protocol:SUPPLIER_PAYMENT_DRAFT,id:'supplier-standard',issuedAt:new Date(now).toISOString(),storeId:'store',supplierId:'supplier',amount:125.5,method:'bank'},options={storeId:'store',suppliers:[{id:'supplier',name:'Fixture Supplier'}],now}
test('machine discovery adds an authenticated owner review profile without reinterpreting the original order protocol',()=>{
 expect(discovery.protocol).toBe('pos-document-draft/v1');expect(discovery.kinds).toEqual(['sale','restaurant','purchase']);expect(discovery.moneyMovement).toBe(false)
 const profile=discovery.financialDrafts.find(row=>row.protocol===SUPPLIER_PAYMENT_DRAFT);expect(profile).toMatchObject({role:'owner',schema:'/agent/supplier-payment-draft-v1.schema.json',pasteSurface:'suppliers',humanReviewRequired:true,moneyMovement:false,linkFragment:false});expect(fs.existsSync('public'+profile.schema)).toBe(true)
 expect(schema.additionalProperties).toBe(false);expect(schema.required).toEqual(['protocol','id','issuedAt','storeId','supplierId','amount','method']);expect(Object.keys(schema.properties)).toEqual(['protocol','id','issuedAt','storeId','supplierId','amount','method','reference','note'])
})
test('schema age, clock, size and money limits agree with the runtime draft admission boundary',()=>{
 expect(schema.properties.protocol.const).toBe(SUPPLIER_PAYMENT_DRAFT);expect(schema['x-pos-maxAgeSeconds']).toBe(86400);expect(schema['x-pos-maxClockLeadSeconds']).toBe(300);expect(schema['x-pos-maxUtf8Bytes']).toBe(16384)
 expect(readSupplierPaymentDraft(JSON.stringify({...valid,amount:schema.properties.amount.maximum}),options).amount).toBe(1000000000)
 for(const changed of [{amount:schema.properties.amount.maximum+.01},{amount:.001},{issuedAt:new Date(now-(schema['x-pos-maxAgeSeconds']*1000+1)).toISOString()},{issuedAt:new Date(now+schema['x-pos-maxClockLeadSeconds']*1000+1).toISOString()},{confirmed:true},{reviewed:true}])expect(()=>readSupplierPaymentDraft(JSON.stringify({...valid,...changed}),options)).toThrow()
 expect(()=>readSupplierPaymentDraft(' '.repeat(schema['x-pos-maxUtf8Bytes'])+JSON.stringify(valid),options)).toThrow('過大')
})
test('the published text-limit annotation reflects real UTF-16 input limits and unknown fields stay rejected',()=>{
 const limit=schema.properties.reference['x-pos-utf16MaxLength'];expect(limit).toBe(100)
 expect(readSupplierPaymentDraft(JSON.stringify({...valid,reference:'😀'.repeat(limit/2)}),options).reference.length).toBe(limit)
 expect(()=>readSupplierPaymentDraft(JSON.stringify({...valid,reference:'😀'.repeat(limit/2+1)}),options)).toThrow('格式不正確');expect(()=>readSupplierPaymentDraft(JSON.stringify({...valid,execute:'pay'}),options)).toThrow('不支援')
})
