import {describe,it,expect} from 'vitest'
import {memberTopupMoney,memberTopupTotals,admitMemberTopup,memberTopupOriginal} from '../../electron/memberTopupDraft.mjs'
import {newMemberTopupDraft,validMemberTopupDraft,memberTopupRequest,memberTopupReview} from '../../src/utils/memberTopupDraft'
import {workspaceScope} from '../../src/utils/workspaceDraft'
const actor={userId:'owner',username:'Owner',role:'owner'},context={protocol:'pos-private-draft-context/v1',storeId:'store',epoch:'epoch',userId:'owner',role:'owner'},member={id:'member',name:'Member',phone:'0900000001',balance:125.5,points:20,totalSpent:800,tier:'silver'},facts={members:[member],shifts:[{id:'shift',status:'open'}],topups:[]}
function draft(){return {...newMemberTopupDraft(member,'shift'),amount:' １,０００.５０ ',bonus:'0.25',submission:{id:'member-topup-00000000-0000-4000-8000-000000000001',time:'2026-10-25T03:00:00Z',cashier:'Owner'}}}
describe('explicit money input and exact balances',()=>{
 it.each([['0.01',.01],['125.50',125.5],[' １,０００.５０ ',1000.5],['0009.05',9.05],['1,234,567',1234567]])('accepts %s without changing the saved raw text',(raw,value)=>{expect(memberTopupMoney(raw)).toBe(value)})
 it.each(['','0','-1','1e3','0x10','1.005','12,34','1,00,000','12.','Infinity','NaN','1 000','1,000.001'])('rejects ambiguous or invalid %s',raw=>{expect(()=>memberTopupMoney(raw)).toThrow()})
 it('keeps optional zero and separates cash from gift',()=>{expect(memberTopupMoney(' ',{optional:true})).toBe(0);expect(memberTopupTotals(125.5,.1,.2)).toEqual({received:.1,gift:.2,credited:.3,balance:125.8})})
})
describe('raw and operation identity',()=>{
 it('keeps incomplete and whitespace input before submission',()=>{const value={...newMemberTopupDraft(member,'shift'),amount:' 12. ',bonus:'partial'};expect(validMemberTopupDraft(value)).toBe(true);expect(validMemberTopupDraft({...value,submission:draft().submission})).toBe(false)})
 it('converts only on explicit submission',()=>{const value=draft(),raw=value.amount,request=memberTopupRequest(value,context);expect(request.amount).toBe(1000.5);expect(value.amount).toBe(raw);expect(admitMemberTopup(request,context,facts,actor).data.memberId).toBe(member.id)})
 it('retains the saved top-up even when member or shift later changes',()=>{const request=memberTopupRequest(draft(),context),row=admitMemberTopup(request,context,facts,actor).data;expect(admitMemberTopup(request,context,{members:[],shifts:[],topups:[row]},actor).original).toEqual(row)})
 it('rejects same operation ID with different money',()=>{const request=memberTopupRequest(draft(),context),row=admitMemberTopup(request,context,facts,actor).data;expect(()=>memberTopupOriginal({...row,bonus:99},[row])).toThrow(/內容不同/)})
 it.each(['balance','points','totalSpent','idOverride'])('rejects injected %s',field=>{expect(()=>admitMemberTopup({...memberTopupRequest(draft(),context),[field]:999},context,facts,actor)).toThrow()})
 it.each(['storeId','epoch','userId','role'])('rejects changed scope %s',field=>{expect(()=>admitMemberTopup(memberTopupRequest(draft(),context),{...context,[field]:'changed'},facts,actor)).toThrow()})
 it('rejects a forged cashier and a staff gift',()=>{const request=memberTopupRequest(draft(),context);expect(()=>admitMemberTopup(request,context,facts,{...actor,username:'Other'})).toThrow();const staff={...actor,role:'staff'},scope={...context,role:'staff'};expect(()=>admitMemberTopup({...request,draftContext:scope},scope,facts,staff)).toThrow(/贈額/)})
 it('reviews changes to member name or original shift before credit',()=>{const request=memberTopupRequest(draft(),context);expect(()=>admitMemberTopup(request,context,{...facts,members:[{...member,name:'Changed'}]},actor)).toThrow(/會員資料已更新/);expect(()=>admitMemberTopup(request,context,{...facts,shifts:[]},actor)).toThrow(/原班次已結束/);expect(memberTopupReview(draft(),{...facts,shifts:[]})).toMatchObject({shiftChanged:true,memberChanged:false})})
 it('isolates actor, store, role and restore generation drafts',()=>{const base=workspaceScope(context,'member-topup').key;for(const field of ['storeId','epoch','userId','role'])expect(workspaceScope({...context,[field]:field==='role'?'staff':'different'},'member-topup').key).not.toBe(base)})
})
