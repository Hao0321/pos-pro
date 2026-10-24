// @vitest-environment jsdom
import {it,expect} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import RecoverySummary from '../../src/components/RecoverySummary'

function summary(current,target){const host=document.createElement('div');host.innerHTML=renderToStaticMarkup(<RecoverySummary current={current} target={target}/>);return host}
it('shows a cash-only change before the collapsed unchanged categories',()=>{
 const current={products:2,orders:4,stockCostEntries:3,purchases:5,cashLogs:0},target={...current,cashLogs:1},host=summary(current,target),cash=host.querySelector('[data-recovery-count=cashLogs]')
 expect(cash.closest('details')).toBeNull();expect(cash.textContent).toContain('1');expect(host.querySelector('details').open).toBe(false);expect(host.querySelectorAll(':scope > [role=table] [data-recovery-count]')).toHaveLength(4)
})
it('makes additional changed categories explicit and keeps every category available',()=>{
 const current={products:0,orders:0,stockCostEntries:0,purchases:0,cashLogs:0,members:0},host=summary(current,Object.fromEntries(Object.keys(current).map(key=>[key,1])))
 expect(host.querySelector('details summary').textContent).toContain('2');expect(host.querySelectorAll('[data-recovery-count]')).toHaveLength(12);expect(host.querySelector('details [data-recovery-count=cashLogs]')).not.toBeNull()
})
