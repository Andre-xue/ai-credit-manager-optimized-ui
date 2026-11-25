import { describe, expect, it } from 'vitest'
import { appendAudit, mergeAudit, makeAuditEntry } from './auditLog'
import { buildMonthlyReport, reportToText, prevMonthKey } from './monthlyReport'
import { buildCalendarMonth, monthGrid, shiftMonth } from './calendar'
import type { AppState } from './types'

const baseState = (patch: Partial<AppState> = {}): AppState => ({
  version: 1,
  accounts: [
    { id: 'a1', providerId: 'deepseek', label: 'DeepSeek', mode: 'api', createdAt: '', updatedAt: '' } as any,
    { id: 'a2', providerId: 'kim', label: 'Kimi', mode: 'api', createdAt: '', updatedAt: '' } as any,
  ],
  quotas: [
    { id: 'q1', accountId: 'a1', unit: 'currency', total: 100, used: 10, resetAt: '2026-11-20T00:00:00.000Z', capturedAt: '2026-11-01T00:00:00.000Z', source: 'manual' },
  ],
  checkins: [
    { id: 'c1', providerId: 'deepseek', accountId: 'a1', date: '2026-11-03', done: true },
    { id: 'c2', providerId: 'deepseek', accountId: 'a1', date: '2026-11-04', done: true },
    { id: 'c3', providerId: 'kim', accountId: 'a2', date: '2026-11-04', done: false },
  ],
  usage: [
    { id: 'u1', accountId: 'a1', date: '2026-11-03', inputTokens: 100, outputTokens: 50, estimatedCost: 3, model: 'deepseek-chat' },
    { id: 'u2', accountId: 'a2', date: '2026-11-04', inputTokens: 200, outputTokens: 100, estimatedCost: 7, model: 'kimi-k2' },
    { id: 'u3', accountId: 'a1', date: '2026-10-15', inputTokens: 10, outputTokens: 10, estimatedCost: 5 },
  ],
  benefitMarks: [],
  settings: { vaultInitialized: true, monthlyBudget: 100, checkinReminder: false, checkinProviders: [], alertDays: 3, defaultUnit: 'token', backupReminder: false, unlockMethod: 'password', unitPrices: {} } as any,
  ...patch,
})

describe('月度报告', () => {
  it('汇总当月消费/签到/平台分布并与上月对比', () => {
    const r = buildMonthlyReport(baseState(), '2026-11')
    expect(r.totalCost).toBe(10)
    expect(r.prevCost).toBe(5)
    expect(r.costDeltaPct).toBe(1)
    expect(r.totalTokens).toBe(450)
    expect(r.checkinCount).toBe(2)
    expect(r.checkinDays).toBe(2)
    expect(r.byPlatform[0].providerId).toBe('kim')
    expect(r.budgetRate).toBe(0.1)
    expect(reportToText(r)).toContain('月度报告')
  })
  it('上月无消费时环比为 null', () => {
    const r = buildMonthlyReport(baseState({ usage: [] }), '2026-11')
    expect(r.costDeltaPct).toBeNull()
  })
  it('prevMonthKey 跨年', () => {
    expect(prevMonthKey('2026-01')).toBe('2025-12')
  })
})

describe('额度日历', () => {
  it('按天分桶签到/用量/重置日', () => {
    const cal = buildCalendarMonth(baseState(), '2026-11')
    expect(cal.days.get('2026-11-03')?.checkins).toEqual(['DeepSeek'])
    expect(cal.days.get('2026-11-04')?.cost).toBe(7)
    expect(cal.days.get('2026-11-04')?.checkins).toEqual(['DeepSeek'])
    expect(cal.days.get('2026-11-20')?.resets).toEqual(['DeepSeek'])
  })
  it('月历网格周一起始且长度为 7 的倍数', () => {
    const g = monthGrid('2026-11') // 2026-11-01 是周日
    expect(g.length % 7).toBe(0)
    expect(g.indexOf('2026-11-01')).toBe(6)
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
})

describe('审计日志', () => {
  it('追加与上限截断', () => {
    let s = baseState()
    for (let i = 0; i < 5; i++) s = appendAudit(s, makeAuditEntry('查看Key', `acc${i}`, new Date(2026, 10, 1, 0, 0, i)))
    expect(s.audit).toHaveLength(5)
    expect(s.audit?.[4].detail).toBe('acc4')
  })
  it('跨端合并按 id 去重', () => {
    const e1 = makeAuditEntry('云登录', undefined, new Date('2026-11-01T00:00:00Z'))
    const e2 = makeAuditEntry('导出备份', undefined, new Date('2026-11-02T00:00:00Z'))
    const merged = mergeAudit([e1], [e1, e2])
    expect(merged.map(e => e.id)).toEqual([e1.id, e2.id])
  })
})
