// 本月消费预测：按已过天数的日均消费线性推算月底总消费，提前看是否会超预算。纯函数。

import type { AppState } from './types'
import { todayISO } from './store'

export interface SpendForecast {
  month: string
  daysElapsed: number
  daysInMonth: number
  spent: number
  dailyAvg: number
  projected: number
}

export function forecastMonthSpend(state: AppState, today: string = todayISO()): SpendForecast {
  const month = today.slice(0, 7)
  const [y, m, d] = today.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const daysElapsed = Math.max(1, Math.min(d, daysInMonth))
  const spent = state.usage
    .filter((u) => u.date.startsWith(month))
    .reduce((s, u) => s + u.estimatedCost, 0)
  const dailyAvg = spent / daysElapsed
  const projected = daysElapsed >= daysInMonth ? spent : dailyAvg * daysInMonth
  return { month, daysElapsed, daysInMonth, spent, dailyAvg, projected }
}
