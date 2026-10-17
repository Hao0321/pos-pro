const rice={id:'rice',name:'白米',price:0,cost:50,stock:10,unit:'kg'},beef={id:'beef',name:'牛肉',price:0,cost:200,stock:10,unit:'kg'},box={id:'box',name:'餐盒',price:0,cost:3,stock:100,unit:'個'}
const extra={id:'extras',name:'加料',min:0,max:2,defaults:[],choices:[{id:'egg',name:'加蛋',priceDelta:15,max:2,components:[{id:'egg',qty:1}]}]}
const riceGroup={id:'rice',name:'飯量',min:1,max:1,defaults:[{id:'normal',qty:1}],choices:[{id:'normal',name:'正常飯',priceDelta:0,max:1,components:[]},{id:'less',name:'少飯',priceDelta:0,max:1,components:[{id:'rice',qty:-.05}]},{id:'without',name:'不加飯',priceDelta:-5,max:1,components:[],omit:['rice']}]}
export function restaurantMenuFixture(){return {
 storeId:'menu-store',epoch:'menu-epoch',costMode:'reference',now:'2026-10-17T04:00:00+08:00',
 products:[{id:'bowl',name:'牛肉丼',price:100,cost:0,stock:0,unit:'碗'},rice,beef,box,{id:'egg',name:'雞蛋',price:15,cost:10,stock:20,unit:'顆'},{id:'tea',name:'冬瓜茶',price:20,cost:5,stock:10,unit:'杯'}].map(row=>({...row})),
 config:{recipes:{bowl:[{id:'rice',qty:.2},{id:'beef',qty:.1},{id:'box',qty:1}]}},
 menu:{protocol:'pos-restaurant-menu/v1',offers:[
  {id:'bowl-offer',productId:'bowl',name:'牛肉丼',defaultVariantId:'regular',variants:[{id:'regular',name:'正常份',price:100,capacity:1,components:[{id:'bowl',qty:1}]},{id:'large',name:'大份',price:120,capacity:1,components:[{id:'rice',qty:.3},{id:'beef',qty:.15},{id:'box',qty:1}]}],groups:structuredClone([riceGroup,extra])},
  {id:'bowl-set',productId:'bowl',name:'丼飯加飲料',defaultVariantId:'standard',variants:[{id:'standard',name:'套餐',price:115,capacity:2,components:[{id:'bowl',qty:1},{id:'tea',qty:1}]}],groups:structuredClone([riceGroup,extra])},
 ]},
}}
export const bowl=(qty=1,fields={})=>({offerId:'bowl-offer',qty,...fields})
export const choose=(groupId,id,qty=1)=>({groupId,choices:[{id,qty}]})
