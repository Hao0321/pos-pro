import {expect,test} from 'vitest'
import {workspaceTasks,workspaceReminders} from '../../src/utils/workspaceTasks'

test('every task uses current permissions and everyday-language searches reach the existing workflow',()=>{expect(workspaceTasks({role:'owner'},'手機').map(t=>t.view)).toContain('devices');expect(workspaceTasks({role:'owner'},'退款').map(t=>t.view)).toContain('purchase');expect(workspaceTasks({role:'staff'},'會計')).toEqual([]);expect(workspaceTasks(null)).toEqual([]);expect(workspaceTasks({role:'owner'},'完全不存在')).toEqual([])})

test('work areas reuse existing destinations and never broaden account permissions',()=>{
  const crm=workspaceTasks({role:'owner'},'','crm').map(t=>t.view),erp=workspaceTasks({role:'owner'},'','erp').map(t=>t.view)
  expect(crm).toContain('members');expect(crm).toContain('orders');expect(crm).toContain('restaurant');expect(erp).toContain('purchase');expect(erp).toContain('accounting')
  expect(workspaceTasks({role:'staff'},'','erp').some(t=>t.view==='accounting')).toBe(false);expect(workspaceTasks({role:'owner'},'','unknown')).toEqual([])
})
test('reminders are derived without writing or changing the cart and stale UI cannot authorize a payment',()=>{const store={products:[],cart:[{id:'p',qty:1}],purchases:[],openShift:null},before=structuredClone(store);expect(workspaceReminders(store,{role:'owner'}).map(r=>r.id)).toEqual(['first-product','open-shift','cart']);expect(store).toEqual(before);expect(workspaceReminders({...store,products:[{id:'p'}],cart:[],openShift:{id:'shift'}},{role:'staff'})).toEqual([])})
