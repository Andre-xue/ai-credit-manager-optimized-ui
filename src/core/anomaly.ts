// 消费异常检测：某账户单日花费远超其近 7 天日均时产出异常项，供提醒引擎消费。
// 纯函数：只看 state.usage 的 estimatedCost 本地记录，不发任何请求。
import type { AppState } from './types'

export interface SpendAnomaly {
  accountId: string
  /** '昨日' 或 '今日已' */
  dateLabel: string
  cost: number
  avgDaily: number
  ratio: number
}

function shiftISO(iso: string, deltaDays: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + deltaDays)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 检测消费异常：
 * - 基线 = 目标日前 7 天的日均花费（无记录的天按 0 计，口径保守）
 * - 昨日（完整一天）：花费 ≥ max(3 × 日均, ¥5) 且日均 > 0 → 异常
 * - 今日（未过完）：门槛更高，花费 ≥ max(5 × 日均, ¥10) 且日均 > 0 → 异常
 * 日均为 0（新账户/无历史）时不报，避免把「第一次使用」误报成异常。
 */
export function detectSpendAnomalies(state: AppState, today: string): SpendAnomaly[] {
  const byAccount = new Map<string, Map<string, number>>()
  for (const u of state.usage) {
    if (!(u.estimatedCost > 0)) continue
    let m = byAccount.get(u.accountId)
    if (!m) { m = new Map(); byAccount.set(u.accountId, m) }
    m.set(u.date, (m.get(u.date) ?? 0) + u.estimatedCost)
  }
  const out: SpendAnomaly[] = []
  for (const [accountId, days] of byAccount) {
    const baseline = (target: string) => {
      let sum = 0
      for (let i = 1; i <= 7; i++) sum += days.get(shiftISO(target, -i)) ?? 0
      return sum / 7
    }
    const check = (date: string, dateLabel: string, mult: number, floor: number) => {
      const cost = days.get(date) ?? 0
      if (cost <= 0) return
      const avg = baseline(date)
      if (avg <= 0) return
      if (cost >= Math.max(mult * avg, floor)) {
        out.push({ accountId, dateLabel, cost, avgDaily: avg, ratio: cost / avg })
      }
    }
    check(shiftISO(today, -1), '昨日', 3, 5)
    check(today, '今日已', 5, 10)
  }
  return out
}
