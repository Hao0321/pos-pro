// @vitest-environment jsdom
import React from 'react'
import {test,expect,afterEach,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {ProcurementPanel} from '../../src/pages/purchase/ProcurementPanel'
import {planInventory} from '../../electron/inventoryOperations.mjs'
import {canonicalSignature} from '../../electron/operationRules.mjs'
afterEach(cleanup)
function po(){const data={products:[{id:'p',stock:0}],suppliers:[{id:'s',name:'fixture'}],purchases:[]};const time=new Date().toISOString(),request={id:'create',kind:'purchase-create',time,purchase:{id:'po',supplierId:'s',date:time.slice(0,10),items:[{productId:'p',name:'rice',qty:2,unitCost:10}]}};data.purchases=[planInventory(request,data).purchase];return planInventory({id:'receive',kind:'receive',time,purchaseId:'po',expectedPurchase:canonicalSignature(data.purchases[0]),quantities:[1]},data).purchase}
test('received purchase delegates invoice entry to the persistent page controller',()=>{const open=vi.fn(),command=vi.fn();render(<ProcurementPanel po={po()} onCommand={command} onOpenInvoice={open}/>);fireEvent.click(screen.getByText('登錄請款'));expect(open).toHaveBeenCalledWith('po');expect(command).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull()})
test('unsettled draft authority and purchase approval prevent starting invoice entry',()=>{const open=vi.fn(),view=render(<ProcurementPanel po={po()} onCommand={vi.fn()} onOpenInvoice={open} invoiceReady={false}/>);fireEvent.click(screen.getByText('登錄請款'));expect(open).not.toHaveBeenCalled();view.rerender(<ProcurementPanel po={po()} onCommand={vi.fn()} onOpenInvoice={open} approvalBlocked/>);fireEvent.click(screen.getByText('登錄請款'));expect(open).not.toHaveBeenCalled()})
test('read-only purchase view has no invoice mutation entry',()=>{render(<ProcurementPanel po={po()} onCommand={vi.fn()} readOnly/>);expect(screen.queryByText('登錄請款')).toBeNull()})
test('legacy purchases explicitly retain their historical mode',()=>{render(<ProcurementPanel po={{id:'legacy',items:[]}} onCommand={vi.fn()}/>);expect(screen.getByText(/歷史進貨單保留原帳/)).toBeTruthy();expect(screen.queryByText('登錄請款')).toBeNull()})
