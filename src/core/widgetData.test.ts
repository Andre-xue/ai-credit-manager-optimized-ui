import { describe, it, expect } from 'vitest'
import { buildWidgetSummary } from './widgetData'
import { CHECKIN_TOOLS } from '../data/agentTools'
import { todayISO } from './store'
import type { AppState } from './types'

function mkState(partial: Partial<AppState>): AppState {
  return {
    version: 1,
    accounts: [],
    quotas: [],
    checkins: [],
    benefitMarks: [],
    usage: [],
    settings: { vaultInitialized: false, monthlyBudget: 200, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, backupReminderDays: 7, unlockMethod: 'password', uiStyle: 'claude', uiMotion: true, unitPrices: {} },
    ...partial,
  } as AppState
}

describe('buildWidgetSummary', () => {
  it('货币额度取每账户最新快照求和，非货币单位不计', () => {
    const s = mkState({
      accounts: [{ id: 'a1' }, { id: 'a2' }] as AppState['accounts'],
      quotas: [
        { id: 'q1', accountId: 'a1', unit: 'currency', total: 100, used: 30, capturedAt: '2026-11-20T08:00:00' },
        { id: 'q2', accountId: 'a1', unit: 'currency', total: 100, used: 90, capturedAt: '2026-11-19T08:00:00' },
        { id: 'q3', accountId: 'a2', unit: 'credit', total: 500, used: 0, capturedAt: '2026-11-20T08:00:00' },
      ] as AppState['quotas'],
    })
    const sum = buildWidgetSummary(s)
    expect(sum.remainingText).toBe('¥70')
  })

  it('无货币额度时给出占位文案；待签到按目录减今日已签', () => {
    const first = CHECKIN_TOOLS[0]
    const s = mkState({
      checkins: [{ id: 'c1', providerId: first.id, date: todayISO(), done: true }] as AppState['checkins'],
    })
    const sum = buildWidgetSummary(s)
    expect(sum.remainingText).toBe('暂无额度数据')
    expect(sum.pendingCheckins).toBe(CHECKIN_TOOLS.length - 1)
    expect(sum.updatedLabel).toMatch(/^\d{2}:\d{2}$/)
  })
})
