import {test,expect} from 'vitest'
import {CASH_DENOMINATIONS,emptyCashCount,countedCash,countedDifference,cashQuantity} from '../../src/utils/cashCount.mjs'
const count=counts=>({mode:'count',manual:'',counts}),manual=raw=>({...emptyCashCount(),manual:raw})
test('unknown cash is not zero in either entry mode; zero is an explicit entered fact',()=>{
 expect(countedCash(emptyCashCount())).toMatchObject({valid:false,reason:'empty'});expect(countedCash(count({}))).toMatchObject({valid:false,reason:'empty'});expect(countedCash(manual('0'))).toMatchObject({valid:true,cents:0,amount:0});expect(countedCash(count({100:'0'}))).toMatchObject({valid:true,cents:0})
})
test('NT$ note and coin quantities yield one exact count including the optional half dollar',()=>{
 expect(CASH_DENOMINATIONS.map(r=>r.amount)).toEqual([1000,500,100,50,10,5,1,2000,200,20,.5]);expect(countedCash(count({100:'2',10:'3',5:'1',1:'2'}))).toMatchObject({valid:true,cents:23700,amount:237});expect(countedCash(count({2000:'1',200:'1',20:'1',.5:'3'}))).toMatchObject({valid:true,cents:222150,amount:2221.5})
})
test.each(['-1','1.5','1e2','NaN','Infinity','1,2','++1','9'.repeat(65)])('rejects invalid quantity %s without calculating a substitute sum',raw=>{expect(countedCash(count({100:raw})).valid).toBe(false);expect(cashQuantity(raw)).toBeNull()})
test('counting cannot silently accept an unknown denomination or unsafe oversized total',()=>{
 expect(countedCash(count({3:'1'})).valid).toBe(false);expect(countedCash(count({2000:'1000000'})).valid).toBe(false);expect(countedCash(count({1000:'1000000'}))).toMatchObject({valid:true,amount:1e9});expect(countedCash(count({1000:'1000000',1:'1'})).valid).toBe(false)
})
test.each(['-1','1e2','1,50','1.234','NaN','Infinity','1 000','1000000000.01'])('rejects invalid manual amount %s without assuming the intended value',raw=>expect(countedCash(manual(raw)).valid).toBe(false))
test('supported grouped and full-width input retains exact cents rather than binary subtraction artifacts',()=>{
 expect(countedCash(manual(' １，２３４．５０ '))).toMatchObject({valid:true,cents:123450,amount:1234.5});expect(countedCash(manual('.05'))).toMatchObject({valid:true,cents:5});expect(countedDifference(manual('0.3'),.1)).toBe(20);expect(countedDifference(manual('331'),332)).toBe(-100);expect(countedDifference(manual('332'),332)).toBe(0);expect(countedDifference(emptyCashCount(),332)).toBeNull();expect(countedDifference(manual('0'),-5)).toBe(500)
})
test('choosing manual or count uses only that selected input and never expected cash',()=>{
 const state={mode:'manual',manual:'1.25',counts:{100:'10'}};expect(countedCash(state).amount).toBe(1.25);expect(countedCash({...state,mode:'count'}).amount).toBe(1000);expect(countedDifference(manual('1'),NaN)).toBeNull()
})
