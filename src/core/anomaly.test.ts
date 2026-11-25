import { describe, expect, it } from 'vitest'
import { detectSpendAnomalies } from './anomaly'
import type { AppState, UsageEvent } from './types'

const ev = (accountId: string, date: string, estimatedCost: number): UsageEvent => ({
  id: `${accountId}-${date}-${estimatedCost}`, accountId, date, inputTokens: 0, outputTokens: 0, estimatedCost,
})
const stateWith = (usage: UsageEvent[]): AppState => ({
  version: 1, accounts: [], quotas: [], checkins: [], usage, benefitMarks: [],
  settings: {} as AppState['settings'],
})

describe('detectSpendAnomalies', () => {
  it('昨日花费达日均 3 倍以上 → 异常', () => {
    const usage: UsageEvent[] = []
    for (let d = 2; d <= 8; d++) usage.push(ev('a1', `2026-11-${String(d).padStart(2, '0')}`, 2))
    usage.push(ev('a1', '2026-11-09', 20)) // 昨日：日均 2 的 10 倍
    const r = detectSpendAnomalies(stateWith(usage), '2026-11-10')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ accountId: 'a1', dateLabel: '昨日', cost: 20 })
    expect(r[0].ratio).toBeCloseTo(10)
  })

  it('平稳花费不报', () => {
    const usage: UsageEvent[] = []
    for (let d = 2; d <= 9; d++) usage.push(ev('a1', `2026-11-${String(d).padStart(2, '0')}`, 2))
    expect(detectSpendAnomalies(stateWith(usage), '2026-11-10')).toHaveLength(0)
  })

  it('无历史（日均为 0）时首次大额不误报', () => {
    const usage = [ev('a1', '2026-11-09', 500)]
    expect(detectSpendAnomalies(stateWith(usage), '2026-11-10')).toHaveLength(0)
  })

  it('今日门槛更高：4 倍不报、6 倍报', () => {
    const base: UsageEvent[] = []
    for (let d = 3; d <= 9; d++) base.push(ev('a1', `2026-11-${String(d).padStart(2, '0')}`, 2))
    expect(detectSpendAnomalies(stateWith([...base, ev('a1', '2026-11-10', 8)]), '2026-11-10')).toHaveLength(0)
    const r = detectSpendAnomalies(stateWith([...base, ev('a1', '2026-11-10', 12)]), '2026-11-10')
    expect(r.some(x => x.dateLabel === '今日已')).toBe(true)
  })

  it('小额突增低于地板价不报', () => {
    const usage: UsageEvent[] = []
    for (let d = 2; d <= 8; d++) usage.push(ev('a1', `2026-11-${String(d).padStart(2, '0')}`, 0.1))
    usage.push(ev('a1', '2026-11-09', 1)) // 10 倍但仅 ¥1 < 地板 ¥5
    expect(detectSpendAnomalies(stateWith(usage), '2026-11-10')).toHaveLength(0)
  })
})
