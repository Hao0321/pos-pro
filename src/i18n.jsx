import {useSyncExternalStore} from 'react'
import {getDisplayPreferences,subscribeDisplayPreferences} from '../public/i18n/preferences.mjs'
export {tr,trMessage,getLocale} from '../public/i18n/core.mjs'
export function useDisplayPreferences(){return useSyncExternalStore(subscribeDisplayPreferences,getDisplayPreferences,getDisplayPreferences)}
