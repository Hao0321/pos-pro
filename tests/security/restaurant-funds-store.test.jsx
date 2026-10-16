// @vitest-environment jsdom
import React,{useState} from 'react'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import legacy from '../fixtures/table-kitchen-v1.json'
import {useStore} from '../../src/store/useStore'
import * as access from '../../src/utils/dataAccess'
import {DATA_KEYS,RECORD_KEY,readRecords} from '../../src/utils/browserStorage'
import {commitBrowserRestaurant,browserRestaurantState} from '../../src/utils/browserRestaurant'
import {readPendingFinancial} from '../../src/utils/financialCommand'
import {canonicalSignature} from '../../electron/operationRules.mjs'
let records,ordinal,latest
const session=legacy.owner,ok=result=>{expect(result.success,result.error).toBe(true);return result}
const account=(rows,id)=>Math.round(rows.flatMap(row=>row.lines).filter(row=>row.account===id).reduce((sum,row)=>sum+row.debit-row.credit,0)*100)/100
function input(action,fields={}){const state=browserRestaurantState(),entry=state.entries[0];return {action,...(entry?{entryId:entry.id,expectedVersion:entry.version}:{}),...fields}}
async function direct(action,fields={}){const state=browserRestaurantState();return ok(await commitBrowserRestaurant({id:'direct-'+(++ordinal),time:new Date().toISOString(),kind:'restaurant',storeId:state.storeId,epoch:state.epoch,...input(action,fields)},session))}
// This test-only harness exercises the real hook and adapters. It is not the
// restaurant product screen or a claim of F11/human acceptance.
function Harness(){
 const store=useStore(session),[message,setMessage]=useState('');latest=store
 const run=work=>async()=>{try{await work();setMessage('saved')}catch(error){setMessage(error.message)}}
 return <main><output data-testid="ready">{String(store.ready)}</output><output data-testid="money">{JSON.stringify(Object.fromEntries(['1101','1103','2193','4101','5101','5208'].map(id=>[id,account(store.allJournal,id)])))}</output><output data-testid="orders">{store.orders.map(row=>row.id).join(',')}</output><output data-testid="error">{store.dataError}</output><output data-testid="message">{message}</output>
  <button onClick={run(()=>store.commitRestaurant(input('funds-receive',{amount:50,paid:50,payMethod:'cash',shiftId:'shift'})))}>receive</button><button onClick={run(()=>store.commitRestaurant(input('cancel',{reason:'full prepared',shiftId:'shift'})))}>cancel</button><button onClick={run(store.reloadFromDB)}>reload</button><button onClick={run(store.retryFinancial)}>retry</button></main>
}
beforeEach(async()=>{
 records=new Map();ordinal=0;latest=null
 vi.stubGlobal('localStorage',{getItem:key=>records.get(key)??null,removeItem:key=>records.delete(key),setItem:(key,value)=>records.set(key,String(value))})
 vi.stubGlobal('navigator',{locks:{request:async(_name,options,work)=>typeof options==='function'?options():work({name:_name})}})
 const data=Object.fromEntries(DATA_KEYS.map(key=>[key,[]]));data.pos_users=structuredClone(legacy.before.users);data.pos2_products=[{id:'p',name:'Bowl',price:95,cost:40,stock:3}];data.pos2_shifts=[{id:'shift',status:'open'}]
 records.set(RECORD_KEY,JSON.stringify({version:1,revision:1,data}))
 const config=browserRestaurantState().config
 ok(await commitBrowserRestaurant({id:'configure',time:new Date().toISOString(),kind:'restaurant',action:'configure',expectedConfig:canonicalSignature(config),config:{...config,enabled:true,fundsEnabled:true}},session))
 await direct('create',{day:browserRestaurantState().today,slot:'12:00',channel:'walkin',customer:'Guest',contact:'',note:'',items:[{id:'p',qty:2,price:95}]})
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
const money=()=>JSON.parse(screen.getByTestId('money').textContent)
async function mounted(){render(<Harness/>);await waitFor(()=>expect(screen.getByTestId('ready').textContent).toBe('true'));expect(screen.getByTestId('error').textContent).toBe('')}
async function click(label){fireEvent.click(screen.getByText(label));await waitFor(()=>expect(screen.getByTestId('message').textContent).toBe('saved'))}
test('the real browser store reloads one coherent funded book for collection, fulfilment and full refund',async()=>{
 await mounted();await click('receive');expect(money()).toMatchObject({'1101':50,'2193':-50,'4101':0})
 const received=browserRestaurantState().entries[0].funds.events[0]
 expect(received.input).toMatchObject({fundsProtocol:'pos-restaurant-funds/v1',costMode:'reference'});expect(readPendingFinancial()).toBeNull()
 await direct('funds-receive',{amount:140,paid:140,payMethod:'card',shiftId:'shift'});await direct('advance',{status:'cooking'});await direct('advance',{status:'ready'});await direct('advance',{status:'completed'})
 await click('reload');await waitFor(()=>expect(money()).toMatchObject({'1101':50,'1103':140,'2193':0,'4101':-190,'5101':80}))
 await click('cancel');await waitFor(()=>expect(money()).toMatchObject({'1101':0,'1103':0,'2193':0,'4101':0,'5101':0,'5208':80}))
 const ids=screen.getByTestId('orders').textContent.split(',');expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(2);expect(screen.getByTestId('error').textContent).toBe('')
})
test('the real store retains its original pending receipt and recovers a newer fully cancelled book after lost reply',async()=>{
 const original=access.applyRestaurantOperation;let lose=true
 vi.spyOn(access,'applyRestaurantOperation').mockImplementation(async(request,actor)=>{const result=await original(request,actor);if(lose&&request.action==='funds-receive'){lose=false;throw Error('fixture reply lost')}return result})
 await mounted();fireEvent.click(screen.getByText('receive'));await waitFor(()=>expect(readPendingFinancial()).not.toBeNull());await waitFor(()=>expect(latest.financialState.phase).toBe('uncertain'))
 const id=readPendingFinancial().request.id
 await direct('funds-receive',{amount:140,paid:140,payMethod:'card',shiftId:'shift'});await direct('advance',{status:'cooking'});await direct('advance',{status:'ready'});await direct('advance',{status:'completed'});await direct('cancel',{reason:'another device',shiftId:'shift'})
 const saved=records.get(RECORD_KEY);await click('retry');await waitFor(()=>expect(money()).toMatchObject({'1101':0,'1103':0,'2193':0,'4101':0,'5101':0,'5208':80}))
 expect(readPendingFinancial()).toBeNull();expect(records.get(RECORD_KEY)).toBe(saved);expect(readRecords().data.pos_restaurant_operations.filter(row=>row.id===id)).toHaveLength(1);expect(screen.getByTestId('error').textContent).toBe('')
})
