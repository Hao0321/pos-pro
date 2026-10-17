import {test,expect} from 'vitest'
import {restaurantMenuFixture,bowl,choose} from '../fixtures/restaurant-menu-v1.mjs'
import {quoteRestaurantMenu} from '../../electron/restaurantMenu.mjs'
import {publicMenuQuoteBody} from '../../electron/restaurantCustomerMenu.mjs'
import {PUBLIC_MENU_PROTOCOL,assertQuotedSelections} from '../../public/menu/menuProtocol.mjs'
import {beginCustomerRequest,readCustomerJournal,confirmCustomerRequest,assertCustomerAcknowledgement,CUSTOMER_JOURNAL} from '../../public/menu/orderJournal.mjs'
const source=()=>{const data=restaurantMenuFixture(),quote=quoteRestaurantMenu(data,[bowl(),bowl(1,{selections:[choose('extras','egg')]})]).quote,menuReview={...publicMenuQuoteBody({quote}),token:'a'.repeat(64)},request={requestId:'00000000-0000-4000-8000-000000000001',menuProtocol:PUBLIC_MENU_PROTOCOL,items:menuReview.input,menuReview,customerName:'Guest',tableNum:'',note:''};return {data,quote,menuReview,request}}
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}}
test('selected original survives journal reload and is confirmed only at the exact reviewed amount',()=>{
 const {request,menuReview}=source(),saved=storage(),before=beginCustomerRequest(saved,menuReview.storeId,request,menuReview.items)
 expect(readCustomerJournal(saved)).toEqual(before);expect(()=>assertCustomerAcknowledgement(request,{success:true,orderId:'CO'+request.requestId,total:214,trackingToken:'b'.repeat(64)})).toThrow()
 const ack={success:true,orderId:'CO'+request.requestId,total:215,trackingToken:'b'.repeat(64)};confirmCustomerRequest(saved,request,ack);expect(readCustomerJournal(saved).phase).toBe('confirmed')
 const once=saved.getItem(CUSTOMER_JOURNAL);confirmCustomerRequest(saved,request,ack);expect(saved.getItem(CUSTOMER_JOURNAL)).toBe(once)
})
test('a selected cart quote cannot replace choices or drop one of two versions of the same meal',()=>{
 const {menuReview}=source();expect(assertQuotedSelections(menuReview.input,menuReview)).toBe(menuReview)
 expect(()=>assertQuotedSelections([menuReview.input[0]],menuReview)).toThrow()
 const changed=structuredClone(menuReview.input);changed[1].selections.find(row=>row.groupId==='extras').choices=[];expect(()=>assertQuotedSelections(changed,menuReview)).toThrow()
})
test('explicit free selected meals retain zero while a mismatched acknowledgement is rejected',()=>{
 const {data,request}=source();data.menu.offers[0].variants[0].price=0;const quote=quoteRestaurantMenu(data,[bowl()]).quote,q={...publicMenuQuoteBody({quote}),token:'c'.repeat(64)},input={...request,items:q.input,menuReview:q},saved=storage()
 beginCustomerRequest(saved,q.storeId,input,q.items);expect(assertCustomerAcknowledgement(input,{success:true,orderId:'CO'+input.requestId,total:0,trackingToken:'b'.repeat(64)}).total).toBe(0)
 expect(()=>assertCustomerAcknowledgement(input,{success:true,orderId:'CO'+input.requestId,total:1,trackingToken:'b'.repeat(64)})).toThrow()
})
