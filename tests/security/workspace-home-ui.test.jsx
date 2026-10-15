// @vitest-environment jsdom
import React,{useState} from 'react'
import {test,expect,vi,afterEach} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
vi.mock('../../src/utils/dataAccess',()=>({isElectron:true,isSharedStore:false}))
import SimpleHomePage from '../../src/pages/SimpleHomePage'
afterEach(cleanup)
const makeStore=()=>({products:[{id:'p',stock:5}],cart:[],purchases:[],openShift:{id:'shift'},todayOrders:[],todayRevenue:0,setView:vi.fn()})
function Home({store,role='owner'}){const [area,setArea]=useState('all');return <SimpleHomePage store={store} session={{role,userId:'fixture'}} area={area} onAreaChange={setArea}/>}

test('home provides both plain-language workspaces and direct checkout without creating new data',()=>{
  const store=makeStore();render(<Home store={store}/>);expect(screen.getByRole('button',{name:'顧客與點餐（CRM）'})).toBeTruthy();expect(screen.getByRole('button',{name:'營運管理（ERP）'})).toBeTruthy()
  expect(document.querySelectorAll('.easy-task').length).toBe(6);fireEvent.click(screen.getByText('直接收銀'));expect(store.setView).toHaveBeenCalledExactlyOnceWith('pos');expect(store.products).toEqual([{id:'p',stock:5}])
})

test('CRM contains existing membership and ordering workflows while ERP keeps purchasing and accounting',()=>{
  const store=makeStore();render(<Home store={store}/>);fireEvent.click(screen.getByRole('button',{name:'顧客與點餐（CRM）'}))
  expect(screen.getByText('找客人、會員')).toBeTruthy();expect(screen.getByText('查看顧客點餐')).toBeTruthy();expect(screen.queryByText('查看帳務')).toBeNull()
  fireEvent.click(screen.getByText('找客人、會員'));expect(store.setView).toHaveBeenCalledExactlyOnceWith('members')
  fireEvent.click(screen.getByRole('button',{name:'營運管理（ERP）'}));expect(screen.getByText('進貨、退貨、付款')).toBeTruthy();expect(screen.getByText('查看帳務')).toBeTruthy();expect(screen.queryByText('找客人、會員')).toBeNull()
  fireEvent.click(screen.getByText('換工作區'));expect(document.activeElement.textContent).toBe('先選工作區');expect(document.querySelectorAll('.easy-task').length).toBe(6)
})

test('workspace switching preserves permissions and global search can reach outside the selected area',()=>{
  const store=makeStore();render(<Home store={store} role="staff"/>);fireEvent.click(screen.getByRole('button',{name:'營運管理（ERP）'}));expect(screen.queryByText('查看帳務')).toBeNull();expect(screen.queryByText('設定、備份還原')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'顧客與點餐（CRM）'}));fireEvent.change(screen.getByLabelText('找想做的事'),{target:{value:'備份'}})
  expect(screen.getByText('搜尋全部工作')).toBeTruthy();expect(screen.getByText('營業前檢查、備份')).toBeTruthy();expect(screen.queryByText('設定、備份還原')).toBeNull()
  fireEvent.change(screen.getByLabelText('找想做的事'),{target:{value:''}});expect(screen.getByRole('button',{name:'顧客與點餐（CRM）'}).getAttribute('aria-pressed')).toBe('true');expect(screen.getByText('找客人、會員')).toBeTruthy()
})
