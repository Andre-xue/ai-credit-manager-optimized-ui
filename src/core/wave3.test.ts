import { describe, it, expect } from 'vitest'
import { nextRenewalDate, summarizeSubscriptions } from './subscriptions'
import { buildAchievements, checkinStats } from './achievements'
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

describe('subscriptions', () => {
  it('续费日按周期滚动到未来最近一期（含月末钳制）', () => {
    expect(nextRenewalDate('2026-10-15', 'monthly', '2026-11-20')).toBe('2026-11-15'.replace('11-15', '12-15'))
    expect(nextRenewalDate('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31')
    expect(nextRenewalDate('2025-12-01', 'yearly', '2026-11-20')).toBe('2026-12-01')
    expect(nextRenewalDate('2026-11-25', 'monthly', '2026-11-20')).toBe('2026-11-25')
  })
  it('汇总：按剩余天数排序，年付摊月，合计每月固定支出', () => {
    const s = mkState({
      accounts: [
        { id: 'a1', providerId: 'openai', label: 'GPT Plus', subscription: { price: 140, cycle: 'monthly', renewAt: '2026-11-25' } },
        { id: 'a2', providerId: 'anthropic', label: 'Claude 年付', subscription: { price: 1200, cycle: 'yearly', renewAt: '2026-12-10' } },
        { id: 'a3', providerId: 'deepseek', label: '无订阅' },
      ] as AppState['accounts'],
    })
    const { rows, monthlyTotal } = summarizeSubscriptions(s, '2026-11-20')
    expect(rows.map((r) => r.accountId)).toEqual(['a1', 'a2'])
    expect(rows[0].daysLeft).toBe(5)
    expect(monthlyTotal).toBeCloseTo(140 + 100)
  })
})

describe('achievements', () => {
  it('统计累计次数/天数并判定徽章', () => {
    const checkins = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, providerId: 'p1', date: `2026-11-${String(9 + i).padStart(2, '0')}`, done: true,
    })) as AppState['checkins']
    const s = mkState({ checkins })
    const stats = checkinStats(s, '2026-11-20')
    expect(stats.totalDone).toBe(12)
    expect(stats.totalDays).toBe(12)
    const list = buildAchievements(s, '2026-11-20')
    expect(list.find((a) => a.id === 'done-10')?.earned).toBe(true)
    expect(list.find((a) => a.id === 'done-50')?.earned).toBe(false)
    expect(list.find((a) => a.id === 'done-50')?.current).toBe(12)
  })
})

import { scoreAccounts } from './healthScore'

describe('scoreAccounts', () => {
  it('无 Key 扣 45、额度用完扣 40 并标告急；健康账户 100 分', () => {
    const s = mkState({
      accounts: [
        { id: 'bad', providerId: 'deepseek', label: '坏号', mode: 'api' },
        { id: 'good', providerId: 'openai', label: '好号', mode: 'api', encryptedKey: 'x' },
      ] as AppState['accounts'],
      quotas: [
        { id: 'q1', accountId: 'bad', unit: 'currency', total: 100, used: 100, capturedAt: '2026-11-20T08:00:00' },
        { id: 'q2', accountId: 'good', unit: 'currency', total: 100, used: 10, capturedAt: '2026-11-20T08:00:00' },
      ] as AppState['quotas'],
    })
    const rows = scoreAccounts(s, '2026-11-20')
    expect(rows[0].accountId).toBe('bad')
    expect(rows[0].grade).toBe('告急')
    expect(rows[0].reasons.join(' ')).toContain('未配置 API Key')
    expect(rows.find((r) => r.accountId === 'good')?.score).toBe(100)
  })
})

import { summarizeByProject } from './projectStats'

describe('summarizeByProject', () => {
  it('按项目汇总本月/累计，无标签归未分类', () => {
    const s = mkState({
      usage: [
        { id: 'u1', accountId: 'a', date: '2026-11-05', inputTokens: 1000, outputTokens: 500, estimatedCost: 3, project: '短视频' },
        { id: 'u2', accountId: 'a', date: '2026-10-05', inputTokens: 0, outputTokens: 0, estimatedCost: 2, project: '短视频' },
        { id: 'u3', accountId: 'a', date: '2026-11-06', inputTokens: 0, outputTokens: 0, estimatedCost: 1 },
      ] as AppState['usage'],
    })
    const rows = summarizeByProject(s, '2026-11')
    expect(rows[0]).toMatchObject({ project: '短视频', monthCost: 3, totalCost: 5, count: 2 })
    expect(rows[1]).toMatchObject({ project: '未分类', totalCost: 1 })
  })
})

import { forecastMonthSpend } from './spendForecast'
import { buildYearReport } from './monthlyReport'

describe('forecastMonthSpend / buildYearReport', () => {
  it('按日均速度推算月底消费', () => {
    const s = mkState({
      usage: [
        { id: 'u1', accountId: 'a', date: '2026-11-05', inputTokens: 0, outputTokens: 0, estimatedCost: 100 },
      ] as AppState['usage'],
    })
    const fc = forecastMonthSpend(s, '2026-11-10')
    expect(fc.daysElapsed).toBe(10)
    expect(fc.daysInMonth).toBe(30)
    expect(fc.projected).toBeCloseTo(300)
  })
  it('年度总结汇总全年并找出最烧钱的月份', () => {
    const s = mkState({
      accounts: [{ id: 'a', providerId: 'deepseek', label: 'DS' }] as AppState['accounts'],
      usage: [
        { id: 'u1', accountId: 'a', date: '2026-03-05', inputTokens: 10, outputTokens: 5, estimatedCost: 50, model: 'deepseek-chat' },
        { id: 'u2', accountId: 'a', date: '2026-11-05', inputTokens: 0, outputTokens: 0, estimatedCost: 80 },
        { id: 'u3', accountId: 'a', date: '2025-11-05', inputTokens: 0, outputTokens: 0, estimatedCost: 999 },
      ] as AppState['usage'],
    })
    const yr = buildYearReport(s, '2026')
    expect(yr.totalCost).toBe(130)
    expect(yr.bestMonth?.month).toBe('2026-11')
    expect(yr.topModel?.name).toBe('deepseek-chat')
  })
})
