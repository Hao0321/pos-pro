// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
const fixture=vi.hoisted(()=>({context:null}))
vi.mock('../../src/utils/dataAccess',()=>({getAgentContext:()=>Promise.resolve(fixture.context),loadPrivateDraftContext:async actor=>privateContext(actor),lookupPrivateDraftOriginal:vi.fn(async input=>({protocol:'pos-private-draft-original/v1',status:'missing',id:input.id})),rememberAgentMappings:vi.fn(),loadRestaurantAgentPreview:async input=>previewRestaurantAgent(input,{...fixture.authority,now:Date.now()},session)}))
import QuickDocumentPage from '../../src/pages/QuickDocumentPage'
import {makeAgentContext,AGENT_PROTOCOL} from '../../electron/agentDraftRules.mjs'
import {workspaceScope,writeWorkspaceDraft} from '../../src/utils/workspaceDraft'
import {validWorkspaceQuickDraft} from '../../src/utils/restaurantDraftShapes.mjs'
import {previewRestaurantAgent} from '../../electron/restaurantAgent.mjs'
const session={userId:'owner-journey',username:'Journey owner',role:'owner'}
const privateContext=(actor=session)=>({protocol:'pos-private-draft-context/v1',storeId:fixture.context.storeId,epoch:fixture.authority.epoch,userId:actor.userId,role:actor.role})
const scopeFor=(context=fixture.context,actor=session)=>workspaceScope({...privateContext(actor),storeId:context.storeId},'quick')
const seed=(scope,state)=>writeWorkspaceDraft(localStorage,scope,{documentId:'draft-'+crypto.randomUUID(),state,original:null},null,validWorkspaceQuickDraft)
let store
beforeEach(async()=>{localStorage.clear();vi.stubGlobal('navigator',{locks:{request:async(_name,options,work)=>{if(typeof options==='function')return options({});if(options.signal?.aborted)throw new DOMException('aborted','AbortError');return work({})}}});fixture.authority={storeId:'journey',epoch:'journey-generation',costMode:'reference',users:[{id:session.userId,username:session.username,role:session.role}],products:[{id:'p',name:'牛丼',unit:'碗',stock:10,price:95,cost:40}],suppliers:[{id:'s',name:'供應商'}],config:{enabled:true,dailyCapacity:30,slotCapacity:5,recipes:{}},entries:[],operations:[],orders:[],cashLogs:[],waste:[],shifts:[]};fixture.context=await makeAgentContext({...fixture.authority,restaurantConfig:fixture.authority.config,role:'owner'});store={cart:[],stageQuickSale:vi.fn(),commitInventory:vi.fn(),commitRestaurant:vi.fn(),setView:vi.fn()}})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
const draft=()=>({protocol:AGENT_PROTOCOL,id:'journey-draft',issuedAt:new Date().toISOString(),storeId:'journey',catalogueRevision:fixture.context.catalogueRevision,kind:'purchase',supplierId:'s',date:'2026-10-15',items:[{productId:'p',qty:2,unitCost:37.5}]})
const paste=raw=>fireEvent.paste(screen.getByLabelText('建單內容'),{clipboardData:{getData:()=>raw}})
test('review disclosures preserve the original private price, note and identity through an explicit purchase confirmation',async()=>{
  const original={...draft(),note:'Private delivery terms stay with this order'}
  render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify(original)}/>);await screen.findByText('確認建立採購')
  const source=document.querySelector('[data-quick-source]'),facts=document.querySelector('[data-quick-purchase-edit]')
  expect(source.open).toBe(false);expect(facts.open).toBe(false);expect(screen.getByText('合計 NT$ 75.00')).toBeTruthy()
  expect(document.querySelector('[data-quick-purchase-summary]').textContent).toContain('供應商')
  fireEvent.click(screen.getByText('修改建單來源'));expect(source.open).toBe(true)
  fireEvent.click(screen.getByText('修改建單來源'));expect(source.open).toBe(false)
  fireEvent.click(screen.getByText('修改供應商與日期'));await waitFor(()=>expect(facts.open).toBe(true))
  fireEvent.change(screen.getByLabelText('快速採購日期'),{target:{value:'2026-10-16'}})
  expect(facts.open).toBe(true);expect(store.commitInventory).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('確認建立採購'));await waitFor(()=>expect(store.commitInventory).toHaveBeenCalledTimes(1))
  const [kind,input,identity]=store.commitInventory.mock.calls[0]
  expect(kind).toBe('purchase-create');expect(identity.id).toBe('agent-journey-draft')
  expect(input.purchase.date).toBe('2026-10-16');expect(input.purchase.note).toBe(original.note)
  expect(input.purchase.items[0]).toMatchObject({qty:2,unitCost:37.5})
})

test('missing purchase facts stay open and unknown dates remain blank until the user supplies them',async()=>{
  render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify({...draft(),supplierId:'',date:''})}/>);await screen.findByText('下一步：選供應商')
  const facts=document.querySelector('[data-quick-purchase-edit]');expect(facts.open).toBe(true)
  expect(screen.getByLabelText('快速採購日期').value).toBe('')
  fireEvent.click(screen.getByText('下一步：選供應商'));expect(document.activeElement).toBe(screen.getByLabelText('叫貨供應商'))
  fireEvent.change(screen.getByLabelText('叫貨供應商'),{target:{value:'s'}})
  fireEvent.click(await screen.findByText('下一步：選叫貨日期'));expect(document.activeElement).toBe(screen.getByLabelText('快速採購日期'))
  expect(facts.open).toBe(true);expect(store.commitInventory).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('快速採購日期'),{target:{value:'2026-10-17'}})
  expect(facts.open).toBe(true);fireEvent.click(await screen.findByText('確認建立採購'))
  await waitFor(()=>expect(store.commitInventory).toHaveBeenCalledTimes(1));expect(store.commitInventory.mock.calls[0][1].purchase.date).toBe('2026-10-17')
})

test('closing missing purchase facts and pressing Next reopens and focuses each required fact without saving',async()=>{
  render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify({...draft(),supplierId:'',date:''})}/>);await screen.findByText('下一步：選供應商')
  const facts=document.querySelector('[data-quick-purchase-edit]'),summary=screen.getByText('修改供應商與日期')
  fireEvent.click(summary);expect(facts.open).toBe(false)
  fireEvent.click(screen.getByText('下一步：選供應商'));expect(facts.open).toBe(true);expect(document.activeElement).toBe(screen.getByLabelText('叫貨供應商'))
  fireEvent.change(screen.getByLabelText('叫貨供應商'),{target:{value:'s'}})
  fireEvent.click(summary);expect(facts.open).toBe(false)
  fireEvent.click(await screen.findByText('下一步：選叫貨日期'));expect(facts.open).toBe(true);expect(document.activeElement).toBe(screen.getByLabelText('快速採購日期'))
  expect(screen.getByLabelText('快速採購日期').value).toBe('');expect(store.commitInventory).not.toHaveBeenCalled()
})

test('pasting a complete Agent reply opens a priced review without another organize click',async()=>{
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByLabelText('建單內容');paste(JSON.stringify(draft()))
  await waitFor(()=>expect(screen.getByLabelText('單據草稿')).toBeTruthy());expect(screen.getByText('合計 NT$ 75.00')).toBeTruthy();expect(store.commitInventory).not.toHaveBeenCalled()
})
test('one fenced document inside an ordinary Agent reply preserves its ID and needs only confirmation',async()=>{
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByLabelText('建單內容');paste('已幫你整理，請確認：\n```json\n'+JSON.stringify(draft())+'\n```\n確認後再收貨。')
  await waitFor(()=>expect(screen.getByText('確認建立採購')).toBeTruthy());fireEvent.click(screen.getByText('確認建立採購'))
  await waitFor(()=>expect(store.commitInventory).toHaveBeenCalledTimes(1));expect(store.commitInventory.mock.calls[0][2].id).toBe('agent-journey-draft')
})
test('leaving and returning to an unfinished purchase preserves the original document identity and quantity',async()=>{
  const first=render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify(draft())}/>);await screen.findByText('確認建立採購')
  await waitFor(()=>expect(Object.keys(localStorage).some(key=>key.startsWith('pos_workspace_draft_v1:'))).toBe(true))
  first.unmount();render(<QuickDocumentPage store={store} session={session}/>);await screen.findByText('確認建立採購');expect(screen.getByLabelText('數量 牛丼').value).toBe('2')
  fireEvent.click(screen.getByText('確認建立採購'));await waitFor(()=>expect(store.commitInventory).toHaveBeenCalledTimes(1));expect(store.commitInventory.mock.calls[0][2].id).toBe('agent-journey-draft')
})

test('delivery guidance focuses the missing contact then address and never creates an incomplete order',async()=>{
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByLabelText('建單內容')
  fireEvent.change(screen.getByLabelText('建單內容'),{target:{value:'外送牛丼2，下午五點'}});fireEvent.click(screen.getByText('幫我整理'))
  fireEvent.click(await screen.findByText('下一步：填聯絡方式'));expect(document.activeElement).toBe(screen.getByLabelText('快速聯絡方式'));expect(store.commitRestaurant).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('快速聯絡方式'),{target:{value:'0900000000'}})
  fireEvent.click(screen.getByText('下一步：填外送地址'));expect(document.activeElement).toBe(screen.getByLabelText('快速單據備註'));expect(store.commitRestaurant).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('快速單據備註'),{target:{value:'測試路 10 號'}});fireEvent.click(screen.getByText('確認建立預訂'))
  await waitFor(()=>expect(store.commitRestaurant).toHaveBeenCalledTimes(1));expect(store.commitRestaurant.mock.calls[0][0].note).toBe('測試路 10 號')
})

test('a saved owner draft never appears under a different user, role or store',async()=>{
  const scope=scopeFor(),saved={kind:'purchase',text:'',draft:draft(),external:null}
  seed(scope,saved);const raw=localStorage.getItem(scope.key)
  for(const current of [{userId:'another',role:'owner'},{...session,role:'staff'}]){
    const view=render(<QuickDocumentPage store={store} session={current}/>);await screen.findByLabelText('建單內容');await waitFor(()=>expect(screen.getByText('賣東西').disabled).toBe(false))
    expect(screen.queryByLabelText('單據草稿')).toBeNull();view.unmount()
  }
  fixture.context={...fixture.context,storeId:'another-store'}
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByLabelText('建單內容');expect(screen.queryByLabelText('單據草稿')).toBeNull();expect(localStorage.getItem(scope.key)).toBe(raw)
})

test('corrupt saved input is preserved for recovery until an explicit discard',async()=>{
  const scope=scopeFor();localStorage.setItem(scope.key,'{broken')
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByText(/草稿讀不到/);expect(localStorage.getItem(scope.key)).toBe('{broken');expect(store.commitInventory).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('清除這張未完成草稿'));await waitFor(()=>expect(localStorage.getItem(scope.key)).toBeNull());expect(screen.queryByText(/草稿讀不到/)).toBeNull()
})

test('quota failure keeps the draft visible and warns before leaving',async()=>{
  const original=Storage.prototype.setItem
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key.startsWith('pos_workspace_draft_v1:'))throw new DOMException('full','QuotaExceededError');return original.call(this,key,value)})
  render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify(draft())}/>);await screen.findByText(/暫時無法保留草稿/)
  expect(screen.getByLabelText('數量 牛丼').value).toBe('2');expect(store.commitInventory).not.toHaveBeenCalled()
})

test('a temporary zero quantity survives recovery but cannot be committed until corrected',async()=>{
  const view=render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify(draft())}/>);await screen.findByText('確認建立採購')
  fireEvent.change(screen.getByLabelText('數量 牛丼'),{target:{value:'0'}});view.unmount()
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByText('已接回未完成的草稿，確認前會重新核對。')
  expect(screen.getByLabelText('數量 牛丼').value).toBe('0');expect(screen.getByText('確認建立採購').disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('數量 牛丼'),{target:{value:'3'}});fireEvent.click(screen.getByText('確認建立採購'))
  await waitFor(()=>expect(store.commitInventory).toHaveBeenCalledTimes(1));expect(store.commitInventory.mock.calls[0][2].id).toBe('agent-journey-draft')
})

test('restoring a draft never silently updates its old catalogue or price',async()=>{
  seed(scopeFor(),{kind:'purchase',text:'',draft:draft(),external:null})
  fixture.context={...fixture.context,catalogueRevision:'new-price-revision',products:fixture.context.products.map(p=>({...p,unitCost:90}))}
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByText(/品項或價格已更新/)
  expect(screen.getByText('確認建立採購').disabled).toBe(true);expect(store.commitInventory).not.toHaveBeenCalled()
})

test('an unfinished external item mapping returns with the same identity and agreed purchase price',async()=>{
  const doc={protocol:'business-document/v1',id:'PARTNER-RECOVERY-001',createdAt:new Date().toISOString(),sender:{id:'partner',name:'合作公司'},intent:'purchase',currency:'TWD',items:[{sku:'vendor-beef',name:'對方牛肉飯',qty:2,unit:'碗',unitPrice:37.5}],total:75,fulfilment:{supplierId:'s',date:'2026-10-15'}}
  const view=render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify(doc)}/>);fireEvent.change(await screen.findByLabelText('對照 對方牛肉飯'),{target:{value:'p'}})
  await screen.findByText('確認建立採購');const scope=scopeFor();await waitFor(()=>expect(JSON.parse(localStorage.getItem(scope.key)).state.draft?.id).toBeTruthy());const saved=JSON.parse(localStorage.getItem(scope.key)).state
  view.unmount();render(<QuickDocumentPage store={store} session={session}/>);await screen.findByText('已接回未完成的草稿，確認前會重新核對。');expect(screen.getByText('合計 NT$ 75.00')).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox',{name:'記住這家公司的品項對照'}));fireEvent.click(screen.getByText('確認建立採購'))
  await waitFor(()=>expect(store.commitInventory).toHaveBeenCalledTimes(1));expect(store.commitInventory.mock.calls[0][2]).toEqual({id:'agent-'+saved.draft.id,time:doc.createdAt});expect(store.commitInventory.mock.calls[0][1].purchase.items[0].unitCost).toBe(37.5)
})

test('pending original identity locks edits and defers a new incoming link until recovery',async()=>{
  const original=draft(),next={...original,id:'next-agent-draft'},view=render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify(original)}/>)
  await screen.findByText('確認建立採購');store.financialState={phase:'uncertain',id:'agent-journey-draft'};store.retryFinancial=vi.fn().mockResolvedValue({receipt:{id:'agent-journey-draft'}})
  view.rerender(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify(next)}/>)
  const qty=screen.getByLabelText('數量 牛丼');expect(qty.closest('fieldset').disabled).toBe(true);expect(screen.getByRole('button',{name:'叫貨進貨'}).disabled).toBe(true)
  fireEvent.click(screen.getByText('確認這張單的結果'));await waitFor(()=>expect(store.retryFinancial).toHaveBeenCalledTimes(1));expect(store.commitInventory).not.toHaveBeenCalled()
  store.financialState={phase:'idle'};view.rerender(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify(next)}/>)
  fireEvent.click(await screen.findByText('確認建立採購'));await waitFor(()=>expect(store.commitInventory).toHaveBeenCalledTimes(1));expect(store.commitInventory.mock.calls[0][2].id).toBe('agent-next-agent-draft')
})

test('an unrelated pending financial operation blocks new quick entry',async()=>{
  store.financialState={phase:'uncertain',id:'different-operation'}
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByText(/還有一張單的結果需要確認/);await screen.findByLabelText('建單內容')
  expect(screen.getByLabelText('建單內容').closest('fieldset').parentElement.closest('fieldset').disabled).toBe(true);expect(store.commitInventory).not.toHaveBeenCalled()
})

test('reopening with a new link while the original save is pending preserves the original cached draft',async()=>{
  const original=draft(),scope=scopeFor()
  seed(scope,{kind:'purchase',text:'',draft:original,external:null})
  store.financialState={phase:'uncertain',id:'agent-'+original.id};store.retryFinancial=vi.fn()
  render(<QuickDocumentPage store={store} session={session} incoming={JSON.stringify({...original,id:'new-link-must-wait',items:[{productId:'p',qty:8}]})}/>)
  await screen.findByText('確認這張單的結果');expect(screen.getByLabelText('數量 牛丼').value).toBe('2')
  expect(JSON.parse(localStorage.getItem(scope.key)).state.draft.id).toBe(original.id);expect(store.commitInventory).not.toHaveBeenCalled()
})

test('product search reaches items beyond the initial grid and stages the selected item',async()=>{
  fixture.context.products=Array.from({length:40},(_,i)=>({id:'p'+i,name:'測試商品 '+i,sku:'SKU'+i,barcode:'471000'+i,unit:'個',price:50,unitCost:20,stock:10}))
  render(<QuickDocumentPage store={store} session={session}/>);await screen.findByLabelText('找建單商品');expect(screen.queryByText('測試商品 39')).toBeNull()
  fireEvent.change(screen.getByLabelText('找建單商品'),{target:{value:'47100039'}});fireEvent.click(screen.getByRole('button',{name:/測試商品 39/}));fireEvent.click(screen.getByText('帶入收銀台'))
  await waitFor(()=>expect(store.stageQuickSale).toHaveBeenCalledTimes(1));expect(store.stageQuickSale.mock.calls[0][0][0].id).toBe('p39');expect(store.commitInventory).not.toHaveBeenCalled()
})
