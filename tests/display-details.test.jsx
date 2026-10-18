// @vitest-environment jsdom
import React from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup} from '@testing-library/react'
import {setDisplayPreferences} from '../public/i18n/preferences.mjs'
import SyncStatusBadge from '../src/components/SyncStatusBadge'

vi.mock('../src/utils/cloudSync',()=>({pushAll:vi.fn(),pullAll:vi.fn()}))

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-16T04:00:00Z'));localStorage.clear();localStorage.setItem('pos_supabase_config',JSON.stringify({url:'https://fixture.supabase.co',anonKey:'sb_publishable_fixture'}))})
afterEach(()=>{cleanup();vi.useRealTimers()})

it.each([['en','7 minutes ago'],['ja','7分前'],['zh-CN','7 分钟前'],['zh-TW','7 分鐘前']])('shows a localized sync age in %s without changing its saved timestamp', (locale,expected)=>{
  const saved='2026-10-16T03:53:00Z';localStorage.setItem('pos_last_sync',saved);setDisplayPreferences({locale})
  render(<SyncStatusBadge/>);expect(screen.getByText(expected)).toBeTruthy();expect(localStorage.getItem('pos_last_sync')).toBe(saved)
})

it.each([['damaged','Never synced'],['','Never synced'],['2026-10-17T04:00:00Z','Just now']])('does not display an invalid or negative sync age for %s',(saved,expected)=>{
  localStorage.setItem('pos_last_sync',saved);setDisplayPreferences({locale:'en'})
  render(<SyncStatusBadge/>);expect(screen.getByText(expected)).toBeTruthy();expect(screen.queryByText(/NaN/)).toBeNull();expect(localStorage.getItem('pos_last_sync')).toBe(saved)
})
