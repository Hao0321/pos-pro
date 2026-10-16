// @vitest-environment jsdom
import React from 'react'
import {test,afterEach,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,waitFor,act} from '@testing-library/react'
import KitchenPrintStatus from '../../src/pages/restaurant/KitchenPrintStatus'
import {setDisplayPreferences} from '../../public/i18n/preferences.mjs'
import {kitchenPreparationReview} from '../../electron/fundedKitchenPrint.mjs'
const entry={id:'booking',version:4,status:'cooking',items:[{id:'ready',name:'Ready meal',qty:1}],total:80,funds:{events:[{id:'cancel-one',version:4}]}},ticket={entryId:'booking',items:[{id:'ready',name:'Ready meal',qty:2}],total:160},original={id:'original',entryId:entry.id,sourceOperationId:entry.id,kind:'prepare',copy:0,state:'uncertain',displayState:'uncertain',ticket},notice={id:'notice',entryId:entry.id,sourceOperationId:'cancel-one',kind:'cancel',copy:0,state:'submitted',displayState:'submitted',ticket:{...ticket,items:entry.items.map(({id,name,qty})=>({id,name,qty})),total:80}}
afterEach(()=>{cleanup();delete window.electronAPI;localStorage.clear();vi.restoreAllMocks()})
test.each(['zh-TW','en','ja','zh-CN'])('the %s current-meal review shows only remaining portions, requires review and submits a bound source preview',async locale=>{
 setDisplayPreferences({locale,style:'simple'});window.electronAPI={db:{applyKitchenPrintOperation:vi.fn()}}
 const printing={state:{binding:{ready:true},jobs:[original,notice]},act:vi.fn(async()=>({success:true}))},rendered=render(<KitchenPrintStatus printing={printing} entry={entry}/>)
 fireEvent.click(rendered.container.querySelector('[data-print-current]'));const dialog=screen.getByRole('dialog')
 expect(dialog.querySelector('[data-print-current-items]').textContent).toBe('Ready meal × 1');expect(dialog.querySelector('[data-print-risk]').checked).toBe(false);expect(dialog.querySelector('[data-print-copy]').disabled).toBe(true)
 fireEvent.click(dialog.querySelector('[data-print-risk]'));fireEvent.click(dialog.querySelector('[data-print-copy]'));await waitFor(()=>expect(printing.act).toHaveBeenCalledTimes(1))
 expect(printing.act.mock.calls[0][0]).toEqual({action:'request',entryId:entry.id,review:kitchenPreparationReview(entry),acknowledgeDuplicateRisk:true})
})
test('obsolete prep copies are not exposed and Escape closes the current review without printing or changing pending work',()=>{
 setDisplayPreferences({locale:'zh-TW'});window.electronAPI={db:{applyKitchenPrintOperation:vi.fn()}}
 const printing={state:{binding:{ready:true},jobs:[original]},act:vi.fn()},rendered=render(<KitchenPrintStatus printing={printing} entry={entry}/>)
 expect(rendered.container.querySelector('[data-print-reprint]')).toBeNull();expect(rendered.container.querySelector('[data-print-send]')).toBeNull()
 fireEvent.click(rendered.container.querySelector('[data-print-current]'));expect(screen.getByRole('dialog')).toBeTruthy();fireEvent.keyDown(window,{key:'Escape'})
 expect(screen.queryByRole('dialog')).toBeNull();expect(printing.act).not.toHaveBeenCalled()
})

test('a fresh review does not inherit the controller error, while its own rejected attempt remains visible until that review is closed',async()=>{
 setDisplayPreferences({locale:'en'});window.electronAPI={db:{applyKitchenPrintOperation:vi.fn()}}
 const printing={state:{binding:{ready:true},jobs:[original,notice]},error:'a previous attempt failed',act:vi.fn(async()=>null)},rendered=render(<KitchenPrintStatus printing={printing} entry={entry}/>)
 const open=()=>fireEvent.click(rendered.container.querySelector('[data-print-current]'));open();expect(screen.queryByRole('alert')).toBeNull()
 fireEvent.click(screen.getByRole('dialog').querySelector('[data-print-risk]'));fireEvent.click(screen.getByRole('dialog').querySelector('[data-print-copy]'));await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy())
 expect(screen.getByRole('dialog').querySelector('[data-print-current-items]').textContent).toBe('Ready meal × 1');expect(printing.error).toBe('a previous attempt failed')
 fireEvent.keyDown(window,{key:'Escape'});open();expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('dialog').querySelector('[data-print-risk]').checked).toBe(false);expect(printing.act).toHaveBeenCalledTimes(1)
})

test('a late failure from a closed review cannot mark a newly opened review as failed',async()=>{
 setDisplayPreferences({locale:'en'});window.electronAPI={db:{applyKitchenPrintOperation:vi.fn()}};let finish
 const printing={state:{binding:{ready:true},jobs:[original,notice]},act:vi.fn(()=>new Promise(resolve=>{finish=resolve}))},rendered=render(<KitchenPrintStatus printing={printing} entry={entry}/>)
 const open=()=>fireEvent.click(rendered.container.querySelector('[data-print-current]'));open();fireEvent.click(screen.getByRole('dialog').querySelector('[data-print-risk]'));fireEvent.click(screen.getByRole('dialog').querySelector('[data-print-copy]'))
 fireEvent.keyDown(window,{key:'Escape'});open();await act(async()=>finish(null))
 expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('dialog').querySelector('[data-print-risk]').checked).toBe(false)
})
