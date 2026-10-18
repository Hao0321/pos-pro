import {it,expect} from 'vitest'
import catalogue from '../../public/i18n/catalogue/opening-balances.mjs'
import messages from '../../public/i18n/messages.mjs'
const check=(value,required=Object.keys(catalogue))=>{for(const key of required){if(!Object.hasOwn(value,key)||!Array.isArray(value[key])||value[key].length<3||value[key].slice(0,3).some(text=>typeof text!=='string'||!text.trim()))throw Error('Missing opening balance translation: '+key)}return required.length*3}
it('provides English, Japanese and Simplified Chinese for every new original-balance validation message',()=>{expect(Object.keys(catalogue)).toHaveLength(47);expect(check(messages)).toBe(141);for(const [key,row]of Object.entries(catalogue))expect(messages[key]).toEqual(row.slice(0,3))})
it('detects a missing key rather than counting fallback Chinese as a translation',()=>{const changed={...messages};delete changed['原單帳款已更新，請重新核對。'];expect(()=>check(changed)).toThrow('Missing opening balance translation')})
it.each([0,1,2])('detects a missing translation in locale %s',locale=>{const changed=structuredClone(messages);changed['原單帳款已更新，請重新核對。'][locale]='';expect(()=>check(changed)).toThrow('Missing opening balance translation')})
