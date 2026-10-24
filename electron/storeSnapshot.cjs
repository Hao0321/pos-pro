module.exports=function storeSnapshot(db,actor){const products=db.getProducts(),restaurant=db.getRestaurantState();return {
  products,members:db.getMembers(),orders:db.getOrders(),
  purchases:actor.role==='owner'?db.getPurchases():[],
  sales:actor.role==='owner'?db.getSalesState(actor):null,
  supplierState:actor.role==='owner'?db.getSupplierState(actor):null,
  restaurantConfig:restaurant.config,restaurantEntries:restaurant.entries,
  manualEntries:actor.role==='owner'?db.getManualJournal():[],heldOrders:db.getHeldOrders(),wasteLog:db.getWasteLog(),topups:db.getTopups(),openShift:db.getOpenShift(),
  rules:{earn:db.getSetting('pointsEarnRate'),redeem:db.getSetting('pointsRedeemRate'),birthdayBonus:db.getSetting('birthdayBonus')},
}}
