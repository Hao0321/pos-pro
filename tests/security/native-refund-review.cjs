const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const init=require('../../electron/database.js'),fixture=require('../fixtures/refund-review-native-v1.json'),{assertReviewedRefundResult}=require('../../electron/refundReview.mjs')
const folder=process.env.POS_SECURITY_FIXTURE_ROOT;if(!folder)throw Error('isolated refund fixture required');const file=path.join(folder,'book.db')
fs.mkdirSync(process.env.POS_CUSTOMERS_EVIDENCE||folder,{recursive:true});const RealDate=Date;let clock=Date.parse(fixture.provenance.clock);global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
let db;const ok=result=>{assert.equal(result.success,true,result.error);return result},input={...fixture.request};delete input.id;delete input.time
try{
 db=init(file);db.addUser({...fixture.book.users[0]});const imported=db.previewRestore({kind:'import',data:structuredClone(fixture.book)},fixture.owner);ok(db.applyRestorePreview(imported.id,fixture.owner));const context=db.getRefundContext(fixture.owner),preview=db.previewRefund(input,fixture.owner),request={...fixture.request,review:preview.review}
 assert.equal(preview.review.costMode,'active');assert.equal(preview.review.summary.totalReturnedCents,964)
 assert.throws(()=>db.previewRefund(input,{...fixture.owner,username:'forged'}),/店主/)
 const before=JSON.stringify(db.exportData()),sql=new(require('better-sqlite3'))(file)
 sql.exec("CREATE TRIGGER test_refund_late BEFORE UPDATE ON products WHEN NEW.stock != OLD.stock BEGIN SELECT RAISE(ABORT,'injected late refund rollback'); END")
 const rejected=db.refundOrder(request.refundOf,request,fixture.owner);assert.equal(rejected.success,false);assert.equal(rejected.committed,false);assert.equal(JSON.stringify(db.exportData()),before)
 sql.exec('DROP TRIGGER test_refund_late');sql.close()
 const result=ok(db.refundOrder(request.refundOf,request,fixture.owner));assertReviewedRefundResult(request,result);assert.equal(result.order.total,-7.28);assert.equal(result.member.balance,45.29)
 const after=JSON.stringify(db.exportData());clock+=600001
 assertReviewedRefundResult(request,ok(db.refundOrder(request.refundOf,request,fixture.owner)));assert.equal(JSON.stringify(db.exportData()),after)
 const mismatch=db.refundOrder(request.refundOf,{...request,reason:'changed'},fixture.owner);assert.equal(mismatch.success,false);assert.equal(JSON.stringify(db.exportData()),after)
 db.close();db=init(file);assertReviewedRefundResult(request,ok(db.refundOrder(request.refundOf,request,fixture.owner)))
 const staleInput={...input,items:[{id:'p',qty:.333}]},stale=db.previewRefund(staleInput,fixture.owner),second=db.previewRefund({...input,items:[{id:'p',qty:.667}]},fixture.owner)
 ok(db.refundOrder(input.refundOf,{...second.input,id:'second',time:new Date().toISOString(),review:second.review},fixture.owner))
 const beforeStale=JSON.stringify(db.exportData()),denied=db.refundOrder(input.refundOf,{...stale.input,id:'stale',time:new Date().toISOString(),review:stale.review},fixture.owner);assert.equal(denied.success,false);assert.equal(JSON.stringify(db.exportData()),beforeStale)
 const final=db.previewRefund({...input,items:[{id:'p',qty:1.333}]},fixture.owner),finalRequest={...final.input,id:'last',time:new Date().toISOString(),review:final.review},last=ok(db.refundOrder(input.refundOf,finalRequest,fixture.owner));assertReviewedRefundResult(finalRequest,last);assert.equal(last.original.status,'refunded');assert.equal(db.getProducts().find(row=>row.id==='p').stock,10)
 const refunds=db.getOrders().filter(row=>row.refundOf===input.refundOf);assert.equal(Math.round(refunds.reduce((sum,row)=>sum-row.total,0)*100),2185);assert.equal(db.getMembers()[0].balance,50)
 const summary={instrumentSuccess:true,scope:'actual native SQLite; synthetic copied baseline; no installer or human claim',context,preview,request,result,rollbackVerified:true,restartReplayVerified:true,staleRejected:true,fullConservation:true,folder};fs.writeFileSync(path.join(process.env.POS_CUSTOMERS_EVIDENCE||folder,'result.json'),JSON.stringify(summary,null,2));db.close();db=null;global.Date=RealDate;console.log(JSON.stringify({success:true,marker:'POS_REFUND_REVIEW_PASS',tests:8,realMerchantData:false}))
}catch(error){console.error(error.stack);try{db?.close()}catch{}global.Date=RealDate;process.exitCode=1}
