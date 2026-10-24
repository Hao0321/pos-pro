import {decimalUnits} from '../../electron/decimalUnits.mjs'
export const readBaseUnits=(raw,message)=>decimalUnits(raw,3,1e12,message)
