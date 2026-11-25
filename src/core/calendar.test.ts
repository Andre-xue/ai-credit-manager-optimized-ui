import { describe, expect, it } from 'vitest'
import { checkinHeatmap, checkinStreak } from './calendar'
import type { AppState, CheckinRecord } from './types'

const rec = (providerId: string, date: string, done = true): CheckinRecord => ({ id: `${providerId}-${date}`, providerId, date, done })
const stateWith = (checkins: CheckinRecord[]): AppState => ({
  version: 1, accounts: [], quotas: [], checkins, usage: [], benefitMarks: [],
  settings: {} as AppState['settings'],
})

describe('checkinHeatmap', () => {
  it('按天聚合已签到数量，长度 = 周数 × 7', () => {
    const s = stateWith([rec('t1', '2026-11-20'), rec('t2', '2026-11-20'), rec('t1', '2026-11-19')])
    const h = checkinHeatmap(s, '2026-11-20', 2)
    expect(h).toHaveLength(14)
    expect(h[h.length - 1]).toEqual({ date: '2026-11-20', count: 2 })
    expect(h[h.length - 2]).toEqual({ date: '2026-11-19', count: 1 })
  })
  it('未完成的记录不计数', () => {
    const s = stateWith([rec('t1', '2026-11-20', false)])
    expect(checkinHeatmap(s, '2026-11-20', 1).at(-1)?.count).toBe(0)
  })
})

describe('checkinStreak', () => {
  it('连续三天含今天 → 3', () => {
    const s = stateWith([rec('t1', '2026-11-18'), rec('t1', '2026-11-19'), rec('t2', '2026-11-20')])
    expect(checkinStreak(s, '2026-11-20')).toBe(3)
  })
  it('今天还没签，从昨天起算', () => {
    const s = stateWith([rec('t1', '2026-11-18'), rec('t1', '2026-11-19')])
    expect(checkinStreak(s, '2026-11-20')).toBe(2)
  })
  it('昨天也没签 → 断签归零', () => {
    const s = stateWith([rec('t1', '2026-11-17'), rec('t1', '2026-11-18')])
    expect(checkinStreak(s, '2026-11-20')).toBe(0)
  })
  it('昨天签了今天还没签 → streak 仍计昨天起的连续段', () => {
    const s = stateWith([rec('t1', '2026-11-17'), rec('t1', '2026-11-19')])
    expect(checkinStreak(s, '2026-11-20')).toBe(1)
  })
})
