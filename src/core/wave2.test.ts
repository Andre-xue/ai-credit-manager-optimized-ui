import { describe, it, expect } from 'vitest'
import { detectProviderFromKey, extractKey } from './keyDetect'
import { rankProvidersByValue, rankModelsByValue } from './valueRank'
import { buildICalendar } from './ical'
import type { AppState } from './types'

function mkState(partial: Partial<AppState>): AppState {
  return {
    version: 1,
    accounts: [],
    quotas: [],
    checkins: [],
    benefitMarks: [],
    usage: [],
    settings: { vaultInitialized: false, monthlyBudget: 0, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, backupReminderDays: 7, unlockMethod: 'password', uiStyle: 'claude', uiMotion: true, unitPrices: {} },
    ...partial,
  } as AppState
}

describe('detectProviderFromKey', () => {
  it('高置信前缀：anthropic / groq / gemini / xai / openai-proj', () => {
    expect(detectProviderFromKey('sk-ant-api03-abcdef123456')?.providerId).toBe('anthropic')
    expect(detectProviderFromKey('gsk_abcdef1234567890')?.providerId).toBe('groq')
    expect(detectProviderFromKey('AIzaSyAbcdef1234567890')?.providerId).toBe('gemini')
    expect(detectProviderFromKey('xai-abcdef1234567890')?.providerId).toBe('xai')
    expect(detectProviderFromKey('sk-proj-abcdef1234567890')?.confidence).toBe('high')
  })
  it('通用 sk- 为低置信 openai；带说明文字也能提取', () => {
    const d = detectProviderFromKey('我的 key 是： sk-abcdef1234567890xyz 请保存')
    expect(d?.providerId).toBe('openai')
    expect(d?.confidence).toBe('low')
    expect(d?.key).toBe('sk-abcdef1234567890xyz')
  })
  it('识别不了返回 null；extractKey 忽略短串', () => {
    expect(detectProviderFromKey('hello world this is nothing')).toBeNull()
    expect(extractKey('短 文本')).toBe('')
  })
})

describe('rankProvidersByValue / rankModelsByValue', () => {
  const s = mkState({
    accounts: [
      { id: 'a1', providerId: 'deepseek' },
      { id: 'a2', providerId: 'openai' },
    ] as AppState['accounts'],
    usage: [
      { id: 'u1', accountId: 'a1', date: '2026-11-01', inputTokens: 600_000, outputTokens: 400_000, estimatedCost: 2, model: 'deepseek-chat' },
      { id: 'u2', accountId: 'a2', date: '2026-11-01', inputTokens: 600_000, outputTokens: 400_000, estimatedCost: 30, model: 'gpt-4o' },
      { id: 'u3', accountId: 'a2', date: '2026-11-02', inputTokens: 100, outputTokens: 100, estimatedCost: 0.1, model: 'gpt-4o-mini' },
    ] as AppState['usage'],
  })
  it('按 ¥/百万 token 升序，样本不足的模型被过滤', () => {
    const rows = rankProvidersByValue(s)
    expect(rows.map((r) => r.key)).toEqual(['deepseek', 'openai'])
    expect(rows[0].perMillion).toBeCloseTo(2)
    const models = rankModelsByValue(s)
    expect(models.map((r) => r.key)).toEqual(['deepseek-chat', 'gpt-4o'])
  })
})

describe('buildICalendar', () => {
  it('生成额度到期事件 + 每日签到重复事件，CRLF 行尾', () => {
    const s = mkState({
      accounts: [{ id: 'a1', providerId: 'deepseek', label: 'DS主号' }] as AppState['accounts'],
      quotas: [
        { id: 'q1', accountId: 'a1', unit: 'currency', total: 100, used: 10, capturedAt: '2026-11-20T08:00:00', resetAt: '2026-12-01' },
      ] as AppState['quotas'],
    })
    const ics = buildICalendar(s, '2026-11-20', new Date(Date.UTC(2026, 10, 20, 1, 2, 3)))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261201')
    expect(ics).toContain('额度重置/到期：DS主号')
    expect(ics).toContain('RRULE:FREQ=DAILY')
    expect(ics).toContain('DTSTAMP:20261120T010203Z')
    expect(ics.includes('\r\n')).toBe(true)
  })
  it('过期/超 90 天的重置日不导出', () => {
    const s = mkState({
      accounts: [{ id: 'a1', providerId: 'deepseek', label: 'X' }] as AppState['accounts'],
      quotas: [
        { id: 'q1', accountId: 'a1', unit: 'currency', total: 1, used: 0, capturedAt: '2026-11-20T08:00:00', resetAt: '2026-01-01' },
      ] as AppState['quotas'],
    })
    const ics = buildICalendar(s, '2026-11-20')
    expect(ics).not.toContain('额度重置/到期')
  })
})
