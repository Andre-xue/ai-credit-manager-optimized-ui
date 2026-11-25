import { describe, it, expect } from 'vitest'
import { buildDataDigest } from './dataDigest'
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

const TODAY = '2026-11-20'

describe('buildDataDigest', () => {
  it('汇总剩余额度（最新快照）、低余额与本月消费 Top 平台', () => {
    const s = mkState({
      accounts: [
        { id: 'a1', providerId: 'deepseek', label: 'DS主号', encryptedKey: 'x' },
        { id: 'a2', providerId: 'openai', label: 'GPT号' },
      ] as AppState['accounts'],
      quotas: [
        { id: 'q1', accountId: 'a1', unit: 'currency', total: 100, used: 95, capturedAt: '2026-11-20T08:00:00', resetAt: '2026-11-25' },
        { id: 'q2', accountId: 'a2', unit: 'currency', total: 50, used: 10, capturedAt: '2026-11-20T08:00:00' },
      ] as AppState['quotas'],
      usage: [
        { id: 'u1', accountId: 'a1', date: '2026-11-05', inputTokens: 1000, outputTokens: 500, estimatedCost: 12.5, model: 'deepseek-chat' },
        { id: 'u2', accountId: 'a2', date: '2026-11-06', inputTokens: 100, outputTokens: 50, estimatedCost: 3, model: 'gpt-4o' },
        { id: 'u3', accountId: 'a1', date: '2026-10-06', inputTokens: 100, outputTokens: 50, estimatedCost: 99 },
      ] as AppState['usage'],
    })
    const d = buildDataDigest(s, TODAY)
    expect(d).toContain('账户共 2 个（1 个已配置 API Key）')
    expect(d).toContain('货币额度剩余合计 ¥45')
    expect(d).toContain('低余额账户')
    expect(d).toContain('DS主号')
    expect(d).toContain('本月（2026-11）消费：共 ¥15.5，2 笔记录')
    expect(d).toContain('7 天内额度到期/重置')
    expect(d).toContain('今日待签到')
    // 摘要绝不包含 Key 密文
    expect(d).not.toContain('encryptedKey')
  })

  it('无任何数据时给出空态文案而非报错', () => {
    const d = buildDataDigest(mkState({}), TODAY)
    expect(d).toContain('账户共 0 个')
    expect(d).toContain('本月（2026-11）暂无消费记录')
  })
})

describe('buildDataDigest 凭据隔离', () => {
  it('摘要不包含任何 Key 密文或指纹', () => {
    const cipher = 'U2FsdGVkX1+fakeCipherTextForTest1234567890'
    const s = mkState({
      accounts: [{ id: 'a1', providerId: 'deepseek', label: 'DS', encryptedKey: cipher, keyFingerprint: 'fp-abcdef' }] as AppState['accounts'],
    })
    const d = buildDataDigest(s, TODAY)
    expect(d).not.toContain(cipher)
    expect(d).not.toContain('fp-abcdef')
    expect(d).not.toContain('encryptedKey')
  })
})
