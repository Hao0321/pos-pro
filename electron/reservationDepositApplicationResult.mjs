import {canonicalSignature} from './operationRules.mjs'
import {assertRestaurantFundsResult} from './restaurantFundsResult.mjs'
import {reservationDepositFundingInput} from './reservationDepositApplication.mjs'
import {depositError} from './reservationDepositPolicy.mjs'

export function assertReservationDepositApplicationResult(input,result){
 const application=result?.receipt?.event?.change.depositApplication
 if(!application){if(input.action==='deposit-apply'||input.action==='dine'&&input.depositReview)throw depositError('SOURCE');return result}
 const expected=reservationDepositFundingInput(input,application,input.action==='dine'?input.order.costMode:input.costMode),funded=result.depositFunding
 if(canonicalSignature(funded?.fundsEvent?.input?.depositApplication)!==canonicalSignature(application))throw depositError('SOURCE')
 assertRestaurantFundsResult(expected,funded)
 if(input.action==='dine'&&canonicalSignature(result.dining?.entry)!==canonicalSignature(funded.entry))throw depositError('SOURCE')
 return result
}
