// 用量预测：基于本地额度快照历史计算消耗速度，预测耗尽时间。
// 纯函数，无副作用，便于单元测试与多端复用。
import type { AppState, CreditUnit } from './types'

export type ForecastLevel = 'insufficient' | 'healthy' | 'warning' | 'critical' | 'exhausted'

export interface Forecast {
  level: ForecastLevel
  /** 预测还可使用的天数；无法预测时为 undefined */
  daysLeft?: number
  /** 预计耗尽日期 ISO（YYYY-MM-DD） */
  exhaustDate?: string
  /** 日均消耗量（与额度单位一致） */
  dailyBurn?: number
  /** 估算依据，便于向用户解释 */
  basis: 'quota-history' | 'usage-events' | 'none'
  /** 样本数量 */
  samples: number
}

const DAY_MS = 86_400_000

/** 与 UsageEvent.date 一致的本地日期格式（避免 UTC/本地混用） */
function localDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 依据：某单位能否从 usage 事件可靠换算 */
function usageBurnPerDay(state: AppState, accountId: string, unit: CreditUnit, now: number, windowDays = 14): { burn: number; samples: number } | null {
  const cutoff = localDate(now - windowDays * DAY_MS)
  const events = state.usage.filter(u => u.accountId === accountId && u.date >= cutoff)
  if (events.length < 2) return null
  const dates = new Set(events.map(e => e.date))
  if (dates.size < 2) return null
  let total = 0
  for (const e of events) {
    if (unit === 'token') total += e.inputTokens + e.outputTokens
    else if (unit === 'currency') total += e.estimatedCost
    else return null // credit/request/day 无法可靠换算
  }
  const spanDays = Math.max(1, (now - new Date([...dates].sort()[0] + 'T00:00:00').getTime()) / DAY_MS)
  const burn = total / spanDays
  return burn > 0 ? { burn, samples: events.length } : null
}

/**
 * 预测账户额度耗尽时间。
 * @param state 应用状态
 * @param accountId 账户 id
 * @param now 当前时间戳（毫秒），默认 Date.now()
 * @param windowDays 参与计算的时间窗口（天），默认 14
 */
export function predictExhaustion(state: AppState, accountId: string, now: number = Date.now(), windowDays = 14): Forecast {
  const empty: Forecast = { level: 'insufficient', basis: 'none', samples: 0 }
  const snapshots = state.quotas.filter(q => q.accountId === accountId)
  if (snapshots.length === 0) return empty

  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  const latest = sorted[sorted.length - 1]
  const remaining = latest.total - latest.used
  if (latest.total <= 0) return empty
  if (remaining <= 0) return { level: 'exhausted', daysLeft: 0, dailyBurn: 0, basis: 'quota-history', samples: sorted.length }

  // 方案一：额度快照历史 —— 找到窗口内最早且 used 递增的快照对
  const cutoff = now - windowDays * DAY_MS
  let burn: number | undefined
  let samples = 0
  let basis: Forecast['basis'] = 'quota-history'
  const inWindow = sorted.filter(q => new Date(q.capturedAt).getTime() >= cutoff)
  const first = inWindow[0]
  if (first) {
    const spanDays = (new Date(latest.capturedAt).getTime() - new Date(first.capturedAt).getTime()) / DAY_MS
    // used 增加才说明在消耗；若减少或持平说明重置过或刚录入，不用
    if (spanDays >= 0.5 && latest.used > first.used) {
      burn = (latest.used - first.used) / spanDays
      samples = inWindow.length
    }
  }

  // 方案二：用量事件（仅 token / currency 单位可换算）
  if (burn === undefined) {
    const fromUsage = usageBurnPerDay(state, accountId, latest.unit, now, windowDays)
    if (fromUsage) {
      burn = fromUsage.burn
      samples = fromUsage.samples
      basis = 'usage-events'
    }
  }

  if (burn === undefined || burn <= 0) return { ...empty, samples: sorted.length }
  const daysLeft = Math.max(0, remaining / burn)
  const level: ForecastLevel = daysLeft <= 3 ? 'critical' : daysLeft <= 7 ? 'warning' : 'healthy'
  const exhaustDate = localDate(now + daysLeft * DAY_MS)
  return { level, daysLeft, exhaustDate, dailyBurn: burn, basis, samples }
}

/** 预测文案（中文），供 UI 直接展示 */
export function forecastText(f: Forecast): string {
  switch (f.level) {
    case 'exhausted': return '额度已用尽'
    case 'insufficient': return '记录满 2 次后可预测'
    case 'critical': return `按近期速度约 ${Math.max(1, Math.round(f.daysLeft ?? 0))} 天后耗尽`
    case 'warning': return `按近期速度约 ${Math.round(f.daysLeft ?? 0)} 天后耗尽`
    case 'healthy': return `按近期速度约 ${Math.ceil(f.daysLeft ?? 0)} 天后耗尽`
  }
}
