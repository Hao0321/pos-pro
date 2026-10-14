module.exports=function storeSnapshot(db,actor){const products=db.getProducts();return {
  products,members:db.getMembers(),orders:db.getOrders(),
  restaurantConfig:require('./restaurantRules.mjs').readRestaurantConfig(db.getSetting('restaurantConfig'),products),
  manualEntries:actor.role==='owner'?db.getManualJournal():[],heldOrders:db.getHeldOrders(),wasteLog:db.getWasteLog(),topups:db.getTopups(),openShift:db.getOpenShift(),
  rules:{earn:db.getSetting('pointsEarnRate'),redeem:db.getSetting('pointsRedeemRate'),birthdayBonus:db.getSetting('birthdayBonus')},
}}
