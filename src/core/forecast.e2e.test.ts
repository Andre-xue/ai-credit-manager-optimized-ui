import { describe, it, expect } from 'vitest'
import { predictExhaustion, forecastText } from './forecast'
import { upsertQuota, latestQuota } from './store'
import type { AppState } from './types'

// 端到端场景：模拟用户连续 6 天录入额度，验证预测从"数据不足"演进到"告急"
describe('真实使用轨迹端到端', () => {
  const base = (): AppState => ({
    version: 1,
    accounts: [{ id: 'a1', providerId: 'cursor', label: 'Cursor 订阅', mode: 'manual', createdAt: '', updatedAt: '' }],
    quotas: [], checkins: [], benefitMarks: [], usage: [],
    settings: { vaultInitialized: false, monthlyBudget: 200, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, unlockMethod: 'password', unitPrices: {} },
  })

  it('每天消耗约 10 单位，总额度 100：预测逐步收敛', () => {
    let s = base()
    // 第 0 天：录入 0/100
    s = upsertQuota(s, { accountId: 'a1', unit: 'credit', used: 0, total: 100 })
    expect(predictExhaustion(s, 'a1').level).toBe('insufficient')
    expect(forecastText(predictExhaustion(s, 'a1'))).toContain('预测')

    // 模拟后续 6 天，每天 used +10（通过构造 capturedAt 间隔一天的快照）
    const days = [0, 1, 2, 3, 4, 5, 6]
    let quotas = [...s.quotas]
    for (const d of days) {
      quotas.push({
        id: `q${d}`, accountId: 'a1', unit: 'credit', total: 100, used: d * 10,
        capturedAt: new Date(Date.now() - (6 - d) * 86400000).toISOString(), source: 'manual',
      })
    }
    s = { ...s, quotas }
    const f = predictExhaustion(s, 'a1')
    expect(f.basis).toBe('quota-history')
    expect(f.dailyBurn).toBeCloseTo(10, 0)
    expect(f.daysLeft).toBeCloseTo(4, 0) // 剩余 40 / 日均 10 ≈ 4 天
    expect(forecastText(f)).toContain('天后耗尽')
    expect(latestQuota(s.quotas, 'a1')?.used).toBe(60)
  })

  it('额度重置后（used 回退）不会误判为"已耗尽"', () => {
    const s: AppState = {
      ...base(),
      quotas: [
        { id: 'old', accountId: 'a1', unit: 'credit', total: 100, used: 90, capturedAt: new Date(Date.now() - 7 * 86400000).toISOString(), source: 'manual' },
        { id: 'new', accountId: 'a1', unit: 'credit', total: 100, used: 10, capturedAt: new Date(Date.now() - 86400000).toISOString(), source: 'manual' },
      ],
    }
    const f = predictExhaustion(s, 'a1')
    expect(f.level).not.toBe('exhausted')
    expect(f.level).toBe('insufficient') // used 回退，样本不足以可靠预测
  })
})
