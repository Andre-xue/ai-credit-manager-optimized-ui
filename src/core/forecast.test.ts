import { describe, it, expect } from 'vitest'
import { predictExhaustion, forecastText } from './forecast'
import type { AppState, QuotaSnapshot } from './types'

const NOW = new Date('2026-06-30T00:00:00Z').getTime()
const DAY = 86_400_000

function stateWith(quotas: QuotaSnapshot[], usage: AppState['usage'] = []): AppState {
  return { version: 1, accounts: [], quotas, checkins: [], benefitMarks: [], usage, settings: { vaultInitialized: false, monthlyBudget: 200, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, unlockMethod: 'password', unitPrices: {} } }
}

function q(daysAgo: number, used: number, total = 100, unit: QuotaSnapshot['unit'] = 'credit'): QuotaSnapshot {
  return {
    id: 'q' + daysAgo + used, accountId: 'a1', unit,
    total, used, capturedAt: new Date(NOW - daysAgo * DAY).toISOString(), source: 'manual',
  }
}

describe('predictExhaustion', () => {
  it('无快照时数据不足', () => {
    expect(predictExhaustion(stateWith([]), 'a1', NOW).level).toBe('insufficient')
  })

  it('仅一条快照时数据不足', () => {
    expect(predictExhaustion(stateWith([q(0, 20)]), 'a1', NOW).level).toBe('insufficient')
  })

  it('剩余为 0 时判定已耗尽', () => {
    const f = predictExhaustion(stateWith([q(10, 50), q(0, 100)]), 'a1', NOW)
    expect(f.level).toBe('exhausted')
    expect(f.daysLeft).toBe(0)
  })

  it('按窗口内 used 增量计算日均：10 天用 20，剩余 80 → 约 40 天', () => {
    const f = predictExhaustion(stateWith([q(10, 20), q(0, 40)]), 'a1', NOW)
    expect(f.basis).toBe('quota-history')
    expect(f.dailyBurn).toBeCloseTo(2, 1)
    expect(f.daysLeft).toBeCloseTo(30, 0)
    expect(f.level).toBe('healthy')
    expect(f.exhaustDate).toMatch(/^2026-07-/)
  })

  it('窗口外的老快照不参与计算', () => {
    // 30 天前和 20 天前的快照在 14 天窗口外，仅剩 1 条在窗口内 → 数据不足
    const f = predictExhaustion(stateWith([q(30, 0), q(20, 50), q(0, 60)]), 'a1', NOW)
    expect(f.level).toBe('insufficient')
  })

  it('used 回退（重置）时不误算为负消耗', () => {
    const f = predictExhaustion(stateWith([q(10, 90), q(0, 20)]), 'a1', NOW)
    expect(f.dailyBurn).toBeUndefined()
    expect(f.level).toBe('insufficient')
  })

  it('消耗极快时判定告急（≤3 天）', () => {
    const f = predictExhaustion(stateWith([q(4, 20), q(0, 92)]), 'a1', NOW)
    expect(f.level).toBe('critical')
    expect((f.daysLeft ?? 99)).toBeLessThanOrEqual(3)
  })

  it('中等速度判定警告（≤7 天）', () => {
    const f = predictExhaustion(stateWith([q(4, 20), q(0, 60)]), 'a1', NOW)
    expect(f.level).toBe('warning')
  })

  it('快照不足时用 token 用量事件估算', () => {
    const usage: AppState['usage'] = [
      { id: 'u1', accountId: 'a1', date: '2026-06-20', inputTokens: 1000, outputTokens: 1000, estimatedCost: 0 },
      { id: 'u2', accountId: 'a1', date: '2026-06-30', inputTokens: 1000, outputTokens: 1000, estimatedCost: 0 },
    ]
    const snap = stateWith([q(0, 0, 1000, 'token')], usage)
    const f = predictExhaustion(snap, 'a1', NOW, 14)
    expect(f.basis).toBe('usage-events')
    expect(f.dailyBurn).toBeGreaterThan(0)
  })

  it('credit 单位不尝试用 usage 事件换算', () => {
    const usage: AppState['usage'] = [
      { id: 'u1', accountId: 'a1', date: '2026-06-20', inputTokens: 5000, outputTokens: 5000, estimatedCost: 0 },
      { id: 'u2', accountId: 'a1', date: '2026-06-30', inputTokens: 5000, outputTokens: 5000, estimatedCost: 0 },
    ]
    const f = predictExhaustion(stateWith([q(0, 10)], usage), 'a1', NOW)
    expect(f.level).toBe('insufficient')
  })
})

describe('forecastText', () => {
  it('各状态均有中文文案', () => {
    expect(forecastText({ level: 'exhausted', basis: 'none', samples: 0 })).toContain('用尽')
    expect(forecastText({ level: 'insufficient', basis: 'none', samples: 0 })).toContain('预测')
    expect(forecastText({ level: 'critical', daysLeft: 2, basis: 'quota-history', samples: 2 })).toContain('2 天后耗尽')
  })
})
