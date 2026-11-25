import { describe, expect, it } from 'vitest'
import { errMsg } from './sync'

describe('sync.errMsg 错误文本提取', () => {
  it('普通字符串原样返回', () => {
    expect(errMsg('网络错误')).toBe('网络错误')
  })

  it('Error 对象取 message', () => {
    expect(errMsg(new Error('连接超时'))).toBe('连接超时')
  })

  it('云 SDK 的 {message} 对象', () => {
    expect(errMsg({ message: 'permission denied' })).toBe('permission denied')
  })

  it('嵌套 {error:{message}} 对象', () => {
    expect(errMsg({ error: { message: 'row level security 拒绝' } })).toBe('row level security 拒绝')
  })

  it('message 本身是对象时不返回 [object Object]', () => {
    const out = errMsg({ message: { detail: 'RLS 策略拦截' } })
    expect(out).not.toBe('[object Object]')
    expect(out).toContain('RLS 策略拦截')
  })

  it('空错误给出可读兜底', () => {
    expect(errMsg({})).toBeTruthy()
    expect(errMsg({})).not.toContain('[object Object]')
    expect(errMsg(null)).toBeTruthy()
  })
})

import { applyPayload } from './sync'
import type { AppState } from './types'

describe('sync 网关令牌本机保留', () => {
  it('applyPayload 不让远端覆盖本机网关令牌', () => {
    const base = {
      version: 1, accounts: [], quotas: [], checkins: [], benefitMarks: [], usage: [],
      settings: { vaultInitialized: false, monthlyBudget: 0, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, backupReminderDays: 7, unlockMethod: 'password', uiStyle: 'claude', uiMotion: true, unitPrices: {} },
    } as unknown as AppState
    const local = { ...base, settings: { ...base.settings, gatewayToken: 'local-token' } } as AppState
    const remote = { ...base, settings: { ...base.settings, gatewayToken: 'remote-token' } } as AppState
    const out = applyPayload({ appState: remote, clientAt: '2026-11-20T00:00:00.000Z', clientId: 'x' } as never, local)
    expect(out.settings.gatewayToken).toBe('local-token')
  })

  it('applyPayload 不让远端覆盖本机界面语言（语言不云同步）', () => {
    const base = {
      version: 1, accounts: [], quotas: [], checkins: [], benefitMarks: [], usage: [],
      settings: { vaultInitialized: false, monthlyBudget: 0, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, backupReminderDays: 7, unlockMethod: 'password', uiStyle: 'claude', uiMotion: true, unitPrices: {} },
    } as unknown as AppState
    const local = { ...base, settings: { ...base.settings, language: 'ja' } } as AppState
    const remote = { ...base, settings: { ...base.settings, language: 'en' } } as AppState
    const out = applyPayload({ appState: remote, clientAt: '2026-11-21T00:00:00.000Z', clientId: 'x' } as never, local)
    expect(out.settings.language).toBe('ja')
  })
})
