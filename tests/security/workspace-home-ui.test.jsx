// @vitest-environment jsdom
import React,{useState} from 'react'
import {test,expect,vi,afterEach} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
vi.mock('../../src/utils/dataAccess',()=>({isElectron:true,isSharedStore:false}))
import SimpleHomePage from '../../src/pages/SimpleHomePage'
afterEach(cleanup)
const makeStore=()=>({products:[{id:'p',stock:5}],cart:[],purchases:[],openShift:{id:'shift'},todayOrders:[],todayRevenue:0,setView:vi.fn()})
function Home({store,role='owner',initialArea='all'}){const [area,setArea]=useState(initialArea);return <SimpleHomePage store={store} session={{role,userId:'fixture'}} area={area} onAreaChange={setArea}/>}
function otherWork(){fireEvent.click(screen.getByText('其他工作'));expect(document.querySelector('[data-home-more]').open).toBe(true)}

test('default home offers the current sale and quick order while other destinations stay behind one disclosure',()=>{
  const store=makeStore();render(<Home store={store}/>)
  expect(document.querySelector('[data-home-more]').open).toBe(false)
  expect(screen.getByRole('button',{name:'顧客與點餐（CRM）'}).closest('details').open).toBe(false)
  expect(document.querySelectorAll('[data-home-primary],[data-home-quick]')).toHaveLength(2)
  fireEvent.click(document.querySelector('[data-home-primary]'))
  expect(store.setView).toHaveBeenCalledExactlyOnceWith('pos');expect(store.products).toEqual([{id:'p',stock:5}])
})

test('CRM contains existing membership and ordering workflows while ERP keeps purchasing and accounting',()=>{
  const store=makeStore();render(<Home store={store}/>);otherWork();fireEvent.click(screen.getByRole('button',{name:'顧客與點餐（CRM）'}))
  expect(screen.getByRole('button',{name:'找客人、會員'})).toBeTruthy();expect(screen.getByRole('button',{name:'查看顧客點餐'})).toBeTruthy();expect(screen.queryByRole('button',{name:'查看帳務'})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'找客人、會員'}));expect(store.setView).toHaveBeenCalledExactlyOnceWith('members')
  fireEvent.click(screen.getByRole('button',{name:'營運管理（ERP）'}));expect(screen.getByText('進貨、退貨、付款')).toBeTruthy();expect(screen.getByText('查看帳務')).toBeTruthy();expect(screen.queryByText('找客人、會員')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'全部功能'}));expect(document.activeElement.textContent).toBe('日常工作');expect(screen.getByRole('button',{name:'找客人、會員'})).toBeTruthy()
})

test('workspace switching preserves permissions and global search can reach outside the selected area',()=>{
  const store=makeStore();render(<Home store={store} role="staff"/>);otherWork();fireEvent.click(screen.getByRole('button',{name:'營運管理（ERP）'}));expect(screen.queryByText('查看帳務')).toBeNull();expect(screen.queryByText('設定、備份還原')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'顧客與點餐（CRM）'}));fireEvent.change(screen.getByLabelText('找想做的事'),{target:{value:'備份'}})
  expect(screen.getByText('搜尋全部工作')).toBeTruthy();expect(screen.getByText('營業前檢查、備份')).toBeTruthy();expect(screen.queryByText('設定、備份還原')).toBeNull()
  fireEvent.change(screen.getByLabelText('找想做的事'),{target:{value:''}});expect(screen.getByRole('button',{name:'顧客與點餐（CRM）'}).getAttribute('aria-pressed')).toBe('true');expect(screen.getByText('找客人、會員')).toBeTruthy()
})

test('a closed shift routes through the existing opening guide and does not offer duplicate opening reminders',()=>{
  const store={...makeStore(),products:[],openShift:null};render(<Home store={store}/>)
  expect(document.querySelector('[data-home-primary]').dataset.homePrimary).toBe('start')
  expect(document.querySelector('[data-home-reminders]')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:/^帶我開始營業/}))
  expect(store.setView).toHaveBeenCalledExactlyOnceWith('readiness');expect(store.openShift).toBeNull()
})

test('a retained cart remains intact when the primary action resumes its existing sale',()=>{
  const cart=[{id:'p',qty:2}],store={...makeStore(),cart};render(<Home store={store}/>)
  fireEvent.click(screen.getByRole('button',{name:/^繼續這筆收款/}))
  expect(store.setView).toHaveBeenCalledExactlyOnceWith('pos');expect(store.cart).toBe(cart);expect(store.cart).toEqual([{id:'p',qty:2}])
})

test('all original permitted owner destinations remain discoverable and stock setup stays conditional',()=>{
  const store=makeStore();render(<Home store={store}/>);otherWork()
  const ids=[...document.querySelectorAll('[data-home-task]')].map(row=>row.dataset.homeTask)
  expect(ids).toEqual(['sale','quick','restaurant','reservations','purchase','exchange','shifts','inventory','warehouse','lots','stockhistory','readiness','devices','members','refunds','reports','accounting','stocktake','waste','promotions','orders','settings','recovery','scenarios','sales','customers','suppliers'])
  expect(document.querySelector('[data-home-task=stocksetup]')).toBeNull()
  expect(screen.getByRole('button',{name:'Agent 幫我搬家'})).toBeTruthy()
})

test('stock setup is shown only when the owner has a real unfinished setup and staff never gains the owner migration action',()=>{
  const store={...makeStore(),stockSetupEnabled:true};const view=render(<Home store={store}/>);otherWork();expect(screen.getByRole('button',{name:'核對庫存成本'})).toBeTruthy();view.unmount()
  render(<Home store={store} role="staff"/>);otherWork();expect(screen.queryByRole('button',{name:'核對庫存成本'})).toBeNull();expect(screen.queryByRole('button',{name:'Agent 幫我搬家'})).toBeNull()
})

test('Escape closes the finder and returns focus without navigation or forgetting its selected area',()=>{
  const store=makeStore();render(<Home store={store} initialArea="erp"/>);otherWork()
  const finder=document.querySelector('[data-home-more]');fireEvent.keyDown(screen.getByLabelText('找想做的事'),{key:'Escape'})
  expect(finder.open).toBe(false);expect(document.activeElement).toBe(finder.querySelector('summary'));expect(store.setView).not.toHaveBeenCalled()
  otherWork();expect(screen.getByRole('button',{name:'營運管理（ERP）'}).getAttribute('aria-pressed')).toBe('true')
})

test('search never navigates on its own and a no-match result leaves all store data intact',()=>{
  const store=makeStore();render(<Home store={store}/>);otherWork()
  fireEvent.change(screen.getByLabelText('找想做的事'),{target:{value:'完全找不到的功能'}})
  expect(screen.getByRole('status').textContent).toContain('完全找不到的功能');expect(document.querySelectorAll('[data-home-task]')).toHaveLength(0)
  expect(store.setView).not.toHaveBeenCalled();expect(store.products).toEqual([{id:'p',stock:5}]);expect(store.cart).toEqual([])
})
