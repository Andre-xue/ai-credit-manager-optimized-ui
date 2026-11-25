// 订阅续费总览：汇总订阅制账户的续费日与固定支出。
// 续费日会按周期自动滚动推算（renewAt 已过时按月/年往后推到未来最近一期）。

import type { AppState } from './types'
import { PROVIDER_MAP } from '../data/providers'
import { todayISO } from './store'

export interface SubscriptionRow {
  accountId: string
  label: string
  platform: string
  price: number
  cycle: 'monthly' | 'yearly'
  /** 推算出的下次续费日 YYYY-MM-DD */
  nextRenewAt: string
  /** 距下次续费的天数（>= 0） */
  daysLeft: number
  /** 摊到每月的成本 */
  monthlyCost: number
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1 + months, 1)
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(Math.min(d, lastDay))}`
}

/** 把续费日按周期往后滚动到 >= today 的最近一期（每步都从原始日期累计推算，避免月末钳制后日期漂移） */
export function nextRenewalDate(renewAt: string, cycle: 'monthly' | 'yearly', today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(renewAt)) return renewAt
  const step = cycle === 'monthly' ? 1 : 12
  let months = 0
  let cur = renewAt
  while (cur < today && months < 240) {
    months += step
    cur = addMonths(renewAt, months)
  }
  return cur
}

export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()
  return Math.round(ms / 86_400_000)
}

export function summarizeSubscriptions(state: AppState, today: string = todayISO()): { rows: SubscriptionRow[]; monthlyTotal: number } {
  const rows: SubscriptionRow[] = []
  for (const a of state.accounts) {
    const sub = a.subscription
    if (!sub || !(sub.price > 0) || !sub.renewAt) continue
    const next = nextRenewalDate(sub.renewAt, sub.cycle, today)
    rows.push({
      accountId: a.id,
      label: a.label,
      platform: PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId,
      price: sub.price,
      cycle: sub.cycle,
      nextRenewAt: next,
      daysLeft: Math.max(0, daysBetween(today, next)),
      monthlyCost: sub.cycle === 'monthly' ? sub.price : sub.price / 12,
    })
  }
  rows.sort((x, y) => x.daysLeft - y.daysLeft)
  return { rows, monthlyTotal: rows.reduce((s, r) => s + r.monthlyCost, 0) }
}
