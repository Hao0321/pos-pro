import {test,expect} from 'vitest'
import {prepareRestaurantCommand} from '../../src/utils/restaurantCommand.mjs'
const state={config:{fundsEnabled:true},entries:[{id:'booking',funds:{}}],storeId:'store',epoch:'current-epoch',costMode:'active',now:'2026-10-17T03:00:00Z'}
test('new booking and existing funded actions bind protocol, current store, epoch, cost policy and authority clock automatically',()=>{
 for(const input of [{action:'create'},{action:'funds-receive',entryId:'booking',amount:50},{action:'advance',entryId:'booking',status:'cooking'}]){
  const command=prepareRestaurantCommand(input,{state})
  expect(command.input).toMatchObject({...input,kind:'restaurant',storeId:'store',epoch:'current-epoch',costMode:'active',fundsProtocol:'pos-restaurant-funds/v1'})
  expect(command.identity.time).toBe(state.now);expect(command.identity.id).toMatch(/^restaurant-/)
 }
})
test('an original pending operation retains its old epoch and cost policy instead of being rebound to restored data',()=>{
 const input={action:'funds-receive',entryId:'booking',expectedVersion:1,amount:50,paid:50,payMethod:'cash',shiftId:'shift',kind:'restaurant',storeId:'original-store',epoch:'original-epoch',fundsProtocol:'pos-restaurant-funds/v1',costMode:'reference'},pending={kind:'restaurant',signature:JSON.stringify({kind:'restaurant',input})}
 const command=prepareRestaurantCommand({action:'funds-receive',entryId:'booking',expectedVersion:1,amount:50,paid:50,payMethod:'cash',shiftId:'shift'},{state,pending})
 expect(command.input).toEqual(input);expect(command.identity).toBeNull()
})
test('ordinary legacy entries and configure requests preserve the existing protocol',()=>{
 expect(prepareRestaurantCommand({action:'pay',entryId:'old'},{state}).input).toEqual({action:'pay',entryId:'old',kind:'restaurant'})
 expect(prepareRestaurantCommand({action:'configure',config:{}},{state}).input).toEqual({action:'configure',config:{},kind:'restaurant'})
})
test('explicit stale scope is retained for rejection and an already chosen original identity is not replaced',()=>{
 const identity={id:'original',time:'2026-10-17T01:00:00Z'},result=prepareRestaurantCommand({action:'create',storeId:'stale-store',epoch:'stale-epoch'},{state,identity})
 expect(result.input.storeId).toBe('stale-store');expect(result.input.epoch).toBe('stale-epoch');expect(result.identity).toEqual(identity)
 expect(()=>prepareRestaurantCommand({action:'create'},{state:{...state,epoch:''}})).toThrow()
})
