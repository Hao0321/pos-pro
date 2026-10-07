const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const init=require('../../electron/database.js'),{prepareCheckout}=require('../../electron/checkoutSafety.cjs')
const {pbkdf2Sync}=require('node:crypto')
const temp=process.env.POS_SECURITY_FIXTURE_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'pos-isolated-security-')),file=path.join(temp,'fixture.db')
let db=init(file),count=0
function test(name,fn){fn();count++;process.stdout.write('PASS '+name+'\n')}
try{
  const hash=JSON.stringify({salt:Array(32).fill(1),iter:1000,hash:[...pbkdf2Sync('fixture-password',Buffer.alloc(32,1),1000,32,'sha256')]})
  db.addUser({id:'owner',username:'fixture',password:hash,role:'owner'})
  db.addProduct({id:'p',name:'商品',price:33.33,cost:10,stock:10})
  db.addMember({id:'m',name:'會員',points:100,totalSpent:0,balance:100})
  db.openShift({id:'s',cashier:'fixture',openCash:100})
  const input={cart:[{id:'p',price:33.33,qty:3}],products:db.getProducts(),members:db.getMembers(),activeMember:{id:'m'},openShift:db.getOpenShift(),pointsRule:{earn:10,redeem:1},birthdayBonus:100,payMethod:'cash',paid:100,pointsUsed:1,opts:{balanceUsed:10},id:'sale',now:new Date()}
  const order=prepareCheckout(input).order
  test('native SQLite transaction derives stock and balance instead of trusting client deltas',()=>{
    const r=db.checkout(order,[{id:'p',delta:1000}],{id:'m',balanceDelta:10000})
    assert.equal(r.success,true);assert.equal(r.products[0].stock,7);assert.equal(r.member.balance,90)
  })
  test('same ID replay after closing and reopening a real SQLite file is exactly once',()=>{
    db.close();db=init(file);assert.equal(db.checkout(order).success,true);assert.equal(db.getProducts()[0].stock,7);assert.equal(db.getOrders().length,1)
  })
  test('native tampered financial fields and stale inventory roll back without a partial write',()=>{
    const before=db.exportData()._revision
    assert.equal(db.checkout({...order,id:'forged',total:0}).success,false)
    assert.equal(db.checkout({...order,id:'oversold',items:[{...order.items[0],qty:100}]}).success,false)
    assert.equal(db.exportData()._revision,before)
  })
  test('native costs remain historical when catalogue costs change',()=>{
    db.updateProduct('p',{cost:25});assert.equal(db.getOrders()[0].itemCosts.p,10)
  })
  test('customer workflow cannot hide a paid POS sale by changing its status',()=>{
    assert.throws(()=>db.updateOrderStatus(order.id,'rejected'),/不能修改收款訂單/)
    assert.equal(db.getOrder(order.id).status,'completed')
  })
  test('three partial native refunds and their retries restore only original money and stock',()=>{
    let total=0
    for(let i=0;i<3;i++){
      const r={id:'r'+i,refundOf:order.id,items:[{id:'p',qty:1}],time:new Date().toISOString(),shiftId:'s'}
      const receipt=db.refundOrder(order.id,r,[{id:'p',delta:999}],{id:'m',balanceDelta:999})
      assert.equal(receipt.success,true);total+=receipt.order.total;assert.equal(db.refundOrder(order.id,r).success,true)
    }
    assert.equal(Math.round(total*100),-Math.round(order.total*100));assert.equal(db.getProducts()[0].stock,10)
    assert.equal(db.getMembers()[0].balance,100);assert.equal(db.getMembers()[0].points,100);assert.equal(db.getMembers()[0].totalSpent,0)
    assert.equal(db.refundOrder(order.id,{id:'r-extra',refundOf:order.id,items:[{id:'p',qty:1}],time:new Date().toISOString()}).success,false)
  })
  test('shift cash stays balanced across cumulative refunds',()=>{const result=db.closeShift('s',{closeCash:100});assert.equal(result.expected,100)})
  test('native topup is atomic, rejects malformed values and deduplicates its ID',()=>{
    const t={id:'t',memberId:'m',amount:10,bonus:1,payMethod:'cash',time:new Date().toISOString(),cashier:''}
    assert.equal(db.addTopup(t).success,true);assert.equal(db.addTopup(t).success,true);assert.equal(db.getMembers()[0].balance,111)
    for(const n of [-1,'10',Infinity])assert.equal(db.addTopup({...t,id:'invalid',amount:n}).success,false)
    assert.equal(db.getMembers()[0].balance,111)
  })
  test('a failed native waste mutation cannot insert a log or decrement stock',()=>{
    const before=db.exportData()._revision;assert.throws(()=>db.addWaste({id:'w',productId:'p',qty:100,time:new Date().toISOString()}));assert.equal(db.exportData()._revision,before)
  })
  const time=new Date().toISOString()
  db.migrateFromLocalStorage({auditLog:Array.from({length:2105},(_,i)=>({id:'a'+i,timestamp:time,action:'fixture'})),
    shifts:Array.from({length:205},(_,i)=>({id:'closed'+i,cashier:'fixture',openTime:time,status:'closed'})),
    cashLog:Array.from({length:505},(_,i)=>({id:'c'+i,shiftId:'s',time,type:'in',amount:1})),
    memberTopups:Array.from({length:505},(_,i)=>({id:'bulk'+i,memberId:'m',amount:1,bonus:0,payMethod:'cash',time})),
    wasteLog:Array.from({length:1005},(_,i)=>({id:'bulk-w'+i,productId:'p',qty:1,time}))})
  const snapshot=db.exportData(),backup=db.createBackup('fixture','fixture')
  test('full native backup does not inherit UI limits for audit, shifts, cash, waste or topups',()=>{
    assert.equal(snapshot.auditLog.length,2105);assert.equal(snapshot.shifts.length,206);assert.equal(snapshot.cashLog.length,505);assert.equal(snapshot.wasteLog.length,1005);assert.equal(snapshot.memberTopups.length,506)
    db.importData({auditLog:[],cashLog:[],wasteLog:[],memberTopups:[],shifts:[]});db.restoreBackup(backup.id)
    assert.equal(db.exportData().auditLog.length,2105);assert.equal(db.exportData().memberTopups.length,506)
  })
  test('a stale cloud import token cannot overwrite a newer local change',()=>{
    const revision=db.exportData()._revision;db.updateProduct('p',{stock:12})
    assert.throws(()=>db.importData(snapshot,revision),/資料已改變/);assert.equal(db.getProducts()[0].stock,12)
  })
  test('malformed restore rolls back deletions and preserves the current owner',()=>{
    const before=db.exportData()._revision;assert.throws(()=>db.importData({products:[{id:'duplicate'},{id:'duplicate'}]}));assert.equal(db.exportData()._revision,before)
    assert.throws(()=>db.importData({users:[]}),/管理員/);assert.equal(db.getUsers()[0].id,'owner')
  })
  process.stdout.write(JSON.stringify({success:true,marker:'POS_NATIVE_SECURITY_PASS',tests:count,electron:process.versions.electron,sqlite:process.versions.modules})+'\n')
}finally{
  db.close()
  const resolved=path.resolve(temp),parent=path.resolve(os.tmpdir())
  if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('pos-isolated-security-'))throw new Error('unsafe fixture cleanup target')
  fs.rmSync(resolved,{recursive:true,force:true})
}
