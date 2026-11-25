import { describe, it, expect } from 'vitest'
import { buildReminders, DEFAULT_NOTIFY_PREFS, type ReminderInput } from './reminders'

const base: ReminderInput = {
  now: new Date(2026, 10, 20, 10, 30), // 2026-11-20 10:30 local
  prefs: { ...DEFAULT_NOTIFY_PREFS, enabled: true },
  pendingCheckins: [],
  expiring: [],
  forecastAlerts: [],
  monthCost: 0,
  monthlyBudget: 200,
}

describe('buildReminders', () => {
  it('总开关关闭时不产生任何提醒', () => {
    const r = buildReminders({ ...base, prefs: { ...base.prefs, enabled: false }, pendingCheckins: ['ChatGPT'] })
    expect(r).toEqual([])
  })

  it('签到提醒：到点后且有待签到时产生，ID 含日期', () => {
    const r = buildReminders({ ...base, pendingCheckins: ['ChatGPT', 'Claude'] })
    expect(r).toHaveLength(1)
    expect(r[0].kind).toBe('checkin')
    expect(r[0].id).toBe('checkin:2026-11-20')
    expect(r[0].body).toContain('2 个工具待签到')
  })

  it('签到提醒：未到设定时间不提醒', () => {
    const r = buildReminders({ ...base, now: new Date(2026, 10, 20, 8, 0), pendingCheckins: ['ChatGPT'] })
    expect(r.filter((x) => x.kind === 'checkin')).toEqual([])
  })

  it('到期提醒：逐账户产生，含 0 天文案', () => {
    const r = buildReminders({ ...base, expiring: [{ accountId: 'a1', name: 'DeepSeek', days: 0 }, { accountId: 'a2', name: 'Kimi', days: 3 }] })
    const ex = r.filter((x) => x.kind === 'expiry')
    expect(ex).toHaveLength(2)
    expect(ex[0].body).toContain('今天到期')
    expect(ex[1].body).toContain('3 天后到期')
  })

  it('告急提醒：按预测天数产生', () => {
    const r = buildReminders({ ...base, forecastAlerts: [{ accountId: 'a1', name: 'GPT 账户', daysLeft: 2.4 }] })
    expect(r[0].kind).toBe('forecast')
    expect(r[0].body).toContain('2 天后耗尽')
  })

  it('预算提醒：90% 产生预警，超支产生超支提醒（按月 ID）', () => {
    const warn = buildReminders({ ...base, monthCost: 185 })
    expect(warn.find((x) => x.kind === 'budget')?.id).toBe('budget:2026-11:warn')
    const over = buildReminders({ ...base, monthCost: 210 })
    expect(over.find((x) => x.kind === 'budget')?.id).toBe('budget:2026-11:over')
    const ok = buildReminders({ ...base, monthCost: 100 })
    expect(ok.filter((x) => x.kind === 'budget')).toEqual([])
  })

  it('分账户预算提醒：90% 预警、超支提醒，ID 带账户且与平台预算互不冲突', () => {
    const warn = buildReminders({ ...base, accountBudgets: [{ accountId: 'a1', name: '主力', cost: 95, budget: 100 }] })
    expect(warn.find((x) => x.kind === 'budget' && x.id.includes('acc:a1'))?.id).toBe('budget:2026-11:warn:acc:a1')
    const over = buildReminders({ ...base, accountBudgets: [{ accountId: 'a1', name: '主力', cost: 120, budget: 100 }] })
    expect(over.find((x) => x.kind === 'budget' && x.id.includes('acc:a1'))?.id).toBe('budget:2026-11:over:acc:a1')
    const ok = buildReminders({ ...base, accountBudgets: [{ accountId: 'a1', name: '主力', cost: 50, budget: 100 }] })
    expect(ok.filter((x) => x.id.includes('acc:'))).toEqual([])
  })

  it('月度报告推送：有上月记录才产生，ID 按月份去重；开关关闭不产生', () => {
    const summary = { month: '2026-10', totalCost: 321.5, recordCount: 42, topPlatform: 'DeepSeek', deltaPct: 12.4 }
    const r = buildReminders({ ...base, monthlyReportSummary: summary })
    const ev = r.find((x) => x.kind === 'monthlyreport')
    expect(ev?.id).toBe('monthlyreport:2026-10')
    expect(ev?.body).toContain('¥321.50')
    const empty = buildReminders({ ...base, monthlyReportSummary: { ...summary, recordCount: 0 } })
    expect(empty.some((x) => x.kind === 'monthlyreport')).toBe(false)
    const off = buildReminders({ ...base, prefs: { ...base.prefs, monthlyReport: false }, monthlyReportSummary: summary })
    expect(off.some((x) => x.kind === 'monthlyreport')).toBe(false)
  })

  it('单项开关关闭时跳过该类提醒', () => {
    const r = buildReminders({
      ...base,
      prefs: { ...base.prefs, checkin: false, budget: false },
      pendingCheckins: ['ChatGPT'],
      monthCost: 300,
    })
    expect(r).toEqual([])
  })
})
