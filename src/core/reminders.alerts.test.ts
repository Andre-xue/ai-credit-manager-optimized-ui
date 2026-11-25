import { describe, expect, it } from 'vitest'
import { buildReminders, DEFAULT_NOTIFY_PREFS, type ReminderInput } from './reminders'

const base = (over: Partial<ReminderInput>): ReminderInput => ({
  now: new Date('2026-11-20T10:00:00'),
  prefs: { ...DEFAULT_NOTIFY_PREFS, enabled: true },
  pendingCheckins: [],
  expiring: [],
  forecastAlerts: [],
  monthCost: 0,
  monthlyBudget: 0,
  ...over,
})

describe('buildReminders 新增提醒', () => {
  it('低余额：生成 lowbalance 事件', () => {
    const evts = buildReminders(base({ lowBalances: [{ accountId: 'a1', name: 'DeepSeek 主力', remaining: 3.5, symbol: '¥' }] }))
    expect(evts).toHaveLength(1)
    expect(evts[0].kind).toBe('lowbalance')
    expect(evts[0].body).toContain('¥3.5')
  })

  it('低余额开关关时不生成', () => {
    const evts = buildReminders(base({
      prefs: { ...DEFAULT_NOTIFY_PREFS, enabled: true, lowBalance: false },
      lowBalances: [{ accountId: 'a1', name: 'x', remaining: 1, symbol: '¥' }],
    }))
    expect(evts).toHaveLength(0)
  })

  it('消费异常：生成 anomaly 事件并带倍数', () => {
    const evts = buildReminders(base({ spendAnomalies: [{ accountId: 'a1', name: 'Kimi', dateLabel: '昨日', cost: 30, avgDaily: 3, ratio: 10 }] }))
    expect(evts).toHaveLength(1)
    expect(evts[0].kind).toBe('anomaly')
    expect(evts[0].body).toContain('10.0 倍')
  })
})
