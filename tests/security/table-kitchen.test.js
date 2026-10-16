import {describe,test,expect} from 'vitest'
import fixture from '../fixtures/table-kitchen-v1.json'
import {makeCustomerIntake,customerOrderView,normalizeTableOrdering,publicOrderingMenu,assertPublicRecipeAvailability} from '../../electron/tableOrdering.mjs'
import {planRestaurant,validateRestaurantRecords,restaurantAvailability} from '../../electron/restaurantRules.mjs'
import {trMessage} from '../../public/i18n/core.mjs'
const actor=fixture.owner,book=fixture.beforeAccept,source=book.orders.find(o=>o.id===fixture.response.orderId),time='2026-10-16T10:00:00Z'
const data=()=>({products:structuredClone(book.products),entries:[],operations:[],orders:structuredClone(book.orders),waste:[],shifts:book.shifts,settings:{},config:fixture.config})
const request=(changes={})=>({...makeCustomerIntake(source,new Date(time)),id:'intake-fixture',kind:'restaurant',time,...changes})
describe('signed-table and formal customer intake rules',()=>{
 test('recipe menu uses exact milliunits and hides material rows, including0.3/0.1',()=>{
  const products=[{id:'rice',stock:.3,price:1},{id:'bowl',stock:0,price:100}],config={enabled:true,recipes:{bowl:[{id:'rice',qty:.1}]}}
  expect(publicOrderingMenu(products,config)).toEqual([{id:'bowl',name:undefined,category:undefined,price:100,stock:3,unit:undefined}]);expect(restaurantAvailability(products[1],config,products)).toBe(3)
  expect(()=>assertPublicRecipeAvailability([{id:'bowl',qty:4}],products,config)).toThrow(/可用量/)
  config.recipes.second=[{id:'rice',qty:.1}];expect(()=>assertPublicRecipeAvailability([{id:'bowl',qty:2},{id:'second',qty:2}],products,config)).toThrow(/可用量/)
 })
 test('one original becomes one reserved kitchen entry without taking payment',()=>{
  const input=data(),before=JSON.stringify(input),plan=planRestaurant(request(),input,actor,{})
  expect(JSON.stringify(input)).toBe(before);expect(plan.entry).toMatchObject({customerOrderId:source.id,tableNum:'5',status:'reserved',total:80,saleId:'',quantity:1});expect(plan.next.products.find(p=>p.id==='ready').stock).toBe(2)
  expect(plan.next.orders).toEqual(input.orders);expect(customerOrderView(source,plan.next.entries)).toMatchObject({restaurantId:request().id,status:'accepted',paymentReceived:false})
  validateRestaurantRecords(plan.next.entries,[plan.receipt],plan.next.orders,plan.next.products)
  expect(()=>planRestaurant(request({id:'different-operation'}),{...input,...plan.next},actor,{})).toThrow(/已處理/)
 })
 test.each([
  ['another original',r=>r.customerOrderId='COmissing'],['wrong signature',r=>r.customerOrderSignature='changed'],['wrong quantity',r=>r.items[0].qty=2],['false price',r=>r.items[0].price=.01],['wrong channel',r=>r.channel='delivery'],['wrong notes',r=>r.note='changed'],['wrong date',r=>r.day='2030-01-01'],['wrong time',r=>r.slot='03:15'],
 ])('rejects%s before changing source, stock or money',(_label,change)=>{
  const input=data(),before=JSON.stringify(input),r=request();change(r);expect(()=>planRestaurant(r,input,actor,{})).toThrow();expect(JSON.stringify(input)).toBe(before)
 })
 test('current catalogue repricing is not silently accepted for the original customer quote',()=>{
  const input=data();input.products.find(p=>p.id==='ready').price=81;expect(()=>planRestaurant(request(),input,actor,{})).toThrow(/售價/)
 })
 test('broken or duplicated customer links cannot pass history validation',()=>{
  const plan=planRestaurant(request(),data(),actor,{})
  for(const change of [e=>e.tableNum='other',e=>e.total=81,e=>e.customerOrderId='COmissing']){const entry=structuredClone(plan.entry);change(entry);expect(()=>validateRestaurantRecords([entry],[],plan.next.orders,plan.next.products)).toThrow()}
  expect(()=>validateRestaurantRecords([plan.entry,{...plan.entry,id:'another'}],[],plan.next.orders,plan.next.products)).toThrow(/重複接單/)
 })
 test('table setup rejects reused identities, duplicate labels, unknown fields and ambiguous counts',()=>{
  const valid={version:1,enabled:true,tables:[{id:'table-1',label:'1'}]};expect(normalizeTableOrdering(valid)).toEqual(valid)
  for(const bad of [{...valid,version:2},{...valid,enabled:1},{...valid,tables:[]},{...valid,secret:'do-not-accept'},{...valid,tables:[...valid.tables,...valid.tables]},{...valid,tables:[{id:'table-1',label:'1'},{id:'other',label:'1'}]}])expect(()=>normalizeTableOrdering(bad)).toThrow()
 })
 test('five accepted originals fill the original slot while the sixth stays untouched; another slot still respects the daily limit',()=>{
  let state=data();state.products.find(p=>p.id==='ready').stock=10;state.orders=Array.from({length:6},(_,i)=>({...structuredClone(source),id:'CO00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')}))
  for(let i=0;i<5;i++){const r={...makeCustomerIntake(state.orders[i],new Date(time)),id:'capacity-'+i,kind:'restaurant',time},p=planRestaurant(r,state,actor,{});state={...state,...p.next,operations:[...state.operations,p.receipt]}}
  const r={...makeCustomerIntake(state.orders[5],new Date(time)),id:'capacity-6',kind:'restaurant',time},before=JSON.stringify(state);expect(()=>planRestaurant(r,state,actor,{})).toThrow('這個時段已滿，請選其他時段');expect(JSON.stringify(state)).toBe(before)
  state.config={...state.config,dailyCapacity:5};const later='2026-10-16T11:00:00Z';expect(()=>planRestaurant({...makeCustomerIntake(state.orders[5],new Date(later)),id:'another-slot',kind:'restaurant',time:later},state,actor,{})).toThrow('已超過當日產能，請選其他日期')
 })
 test.each(['en','ja','zh-CN'])('capacity, stock and rejection controls have an actual%s translation',locale=>{
  for(const message of ['拒絕','這個時段已滿，請選其他時段','已超過當日產能，請選其他日期','Rice可用庫存不足'])expect(trMessage(message,locale)).not.toBe(message)
 })
})
