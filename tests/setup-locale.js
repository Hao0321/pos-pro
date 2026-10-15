// Legacy UI journeys assert Traditional Chinese labels. Declare that device
// language explicitly; locale tests and native English journeys override it.
if(globalThis.navigator){
  Object.defineProperties(navigator,{
    language:{configurable:true,get:()=> 'zh-TW'},
    languages:{configurable:true,get:()=> ['zh-TW']},
  })
}
