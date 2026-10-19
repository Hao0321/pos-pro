import {tr} from '../i18n'

export default function OriginalCreditMethod({kind,method,onChange}){
 const attribute=kind==='customer'?{'data-customer-method':true}:{'data-supplier-method':true}
 return <label>{tr('實際退款方式')}<select className="field" {...attribute} value={method} onChange={event=>onChange(event.target.value)}><option value="cash">{tr('現金')}</option><option value="bank">{tr(kind==='customer'?'銀行付款':'銀行收款')}</option></select></label>
}
