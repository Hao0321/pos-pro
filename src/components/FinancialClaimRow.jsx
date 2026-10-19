import {tr} from '../i18n'
import {salesMoney} from '../pages/sales/SalesOrderForm'

export default function FinancialClaimRow({claim,identity,onOpen}){
 const Element=claim.opening?'article':'button'
 return <Element className="card customer-claim" onClick={claim.opening?undefined:onOpen} data-opening-claim={claim.opening?identity:undefined}><span>{claim.reference||claim.name}<small>{claim.dueDate} · {claim.opening?tr('原單'):identity}</small></span><strong>{salesMoney(claim.owed)}</strong></Element>
}
