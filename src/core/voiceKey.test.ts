import { describe, it, expect } from 'vitest'
import { findVoiceConfigAccount } from './voiceKey'
import type { Account } from './types'

const acct = (id: string, provider?: string): Account => ({
  id, providerId: 'voice-config', label: id, mode: 'api',
  encryptedKey: 'iv:cipher', note: '', voiceProvider: provider,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
})

describe('语音配置账户按服务商匹配', () => {
  const accounts = [acct('a1', 'aliyun'), acct('a2', 'volcengine'), acct('a3', 'elevenlabs')]

  it('按 voiceProvider 精确匹配', () => {
    expect(findVoiceConfigAccount(accounts, 'volcengine')?.id).toBe('a2')
    expect(findVoiceConfigAccount(accounts, 'elevenlabs')?.id).toBe('a3')
  })
  it('未匹配的服务商回退到第一个账户', () => {
    expect(findVoiceConfigAccount(accounts, 'tencent')?.id).toBe('a1')
  })
  it('不指定服务商返回第一个', () => {
    expect(findVoiceConfigAccount(accounts)?.id).toBe('a1')
  })
  it('无语音账户返回 undefined', () => {
    expect(findVoiceConfigAccount([], 'aliyun')).toBeUndefined()
  })
})
