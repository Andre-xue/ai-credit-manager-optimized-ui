import { describe, it, expect } from 'vitest'
import { estimateAccountValue, unitPrice, totalPortfolioValue, monthlySpendByPlatform } from './value'
import type { AppState } from './types'
import { DEFAULT_UNIT_PRICES } from './value'

function state(): AppState {
  return {
    version: 1,
    accounts: [
      { id: 'a1', providerId: 'openai', label: 'OpenAI', mode: 'manual', createdAt: '', updatedAt: '' },
      { id: 'a2', providerId: 'cursor', label: 'Cursor', mode: 'manual', createdAt: '', updatedAt: '' },
      { id: 'a3', providerId: 'qwen', label: '通义', mode: 'manual', createdAt: '', updatedAt: '' },
    ],
    quotas: [
      { id: 'q1', accountId: 'a1', unit: 'token', total: 1000, used: 200, capturedAt: '2026-01-01T00:00:00Z', source: 'manual' },
      { id: 'q2', accountId: 'a2', unit: 'request', total: 100, used: 40, capturedAt: '2026-01-01T00:00:00Z', source: 'manual' },
      { id: 'q3', accountId: 'a3', unit: 'currency', total: 50, used: 10, capturedAt: '2026-01-01T00:00:00Z', source: 'manual' },
    ],
    checkins: [], benefitMarks: [],
    usage: [
      { id: 'u1', accountId: 'a1', date: '2026-06-01', inputTokens: 100, outputTokens: 50, estimatedCost: 2 },
      { id: 'u2', accountId: 'a2', date: '2026-06-02', inputTokens: 0, outputTokens: 0, estimatedCost: 3 },
      { id: 'u3', accountId: 'a1', date: '2026-05-01', inputTokens: 100, outputTokens: 50, estimatedCost: 9 },
    ],
    settings: { vaultInitialized: false, monthlyBudget: 200, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, unlockMethod: 'password', unitPrices: {} },
  }
}

describe('价值归一化', () => {
  it('默认单价与用户覆盖', () => {
    const s = state()
    expect(unitPrice(s, 'openai')).toBe(DEFAULT_UNIT_PRICES.openai)
    s.settings.unitPrices = { openai: 0.5 }
    expect(unitPrice(s, 'openai')).toBe(0.5)
    expect(unitPrice(s, 'unknown')).toBe(DEFAULT_UNIT_PRICES.default)
  })

  it('currency 单位按 1:1 估值', () => {
    const s = state()
    expect(estimateAccountValue(s, 'qwen', 40, 'currency')).toBe(40)
  })

  it('总估值为各账户剩余量 × 单价之和', () => {
    const s = state()
    const expected = 800 * DEFAULT_UNIT_PRICES.openai + 60 * DEFAULT_UNIT_PRICES.cursor + 40
    expect(totalPortfolioValue(s)).toBeCloseTo(expected, 2)
  })

  it('已用尽的账户不计入估值', () => {
    const s = state()
    expect(estimateAccountValue(s, 'openai', 0, 'token')).toBe(0)
  })

  it('消费按平台汇总并排序，含占比', () => {
    const s = state()
    const r = monthlySpendByPlatform(s, '2026-06')
    expect(r).toHaveLength(2)
    expect(r[0].providerId).toBe('cursor') // 3 元 > 2 元
    expect(r[0].share).toBeCloseTo(0.6, 2)
    expect(r[1].inputTokens).toBe(100)
  })

  it('无消费时返回空数组', () => {
    expect(monthlySpendByPlatform(state(), '2025-01')).toEqual([])
  })
})
