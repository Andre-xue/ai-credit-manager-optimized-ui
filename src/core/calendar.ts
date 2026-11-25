// 额度日历：把签到 / 用量 / 额度重置日按天分桶，供月历视图渲染（纯函数）。
import type { AppState } from './types'
import { PROVIDER_MAP } from '../data/providers'

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string
  /** 当日已完成签到的平台名 */
  checkins: string[]
  /** 当日用量费用合计 */
  cost: number
  /** 当日 Tokens 合计 */
  tokens: number
  /** 当日有额度重置/到期的账户名 */
  resets: string[]
}

export interface CalendarMonth {
  /** YYYY-MM */
  month: string
  days: Map<string, CalendarDay>
}

const emptyDay = (date: string): CalendarDay => ({ date, checkins: [], cost: 0, tokens: 0, resets: [] })

export function buildCalendarMonth(state: AppState, month: string): CalendarMonth {
  const days = new Map<string, CalendarDay>()
  const get = (date: string) => {
    let d = days.get(date)
    if (!d) { d = emptyDay(date); days.set(date, d) }
    return d
  }
  for (const c of state.checkins) {
    if (!c.date.startsWith(month) || !c.done) continue
    get(c.date).checkins.push(PROVIDER_MAP[c.providerId]?.shortName ?? c.providerId)
  }
  for (const u of state.usage) {
    if (!u.date.startsWith(month)) continue
    const d = get(u.date)
    d.cost += u.estimatedCost || 0
    d.tokens += (u.inputTokens || 0) + (u.outputTokens || 0)
  }
  // 每个账户取最新一张额度快照的 resetAt（重置/到期日）
  const accountName = new Map(state.accounts.map(a => [a.id, a.label]))
  const latest = new Map<string, string>()
  for (const q of state.quotas) {
    if (!q.resetAt) continue
    const cur = latest.get(q.accountId)
    if (!cur || q.capturedAt > cur) latest.set(q.accountId, q.resetAt)
  }
  for (const [accountId, resetAt] of latest) {
    const date = resetAt.slice(0, 10)
    if (!date.startsWith(month)) continue
    get(date).resets.push(accountName.get(accountId) ?? '账户')
  }
  return { month, days }
}

/** 生成月历网格：6 行 × 7 列（周一起始），格子为日期字符串或 null（跨月留空） */
export function monthGrid(month: string): Array<string | null> {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()
  // JS getDay: 0=周日；换算为周一起始的偏移
  const lead = (first.getDay() + 6) % 7
  const cells: Array<string | null> = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/* ---------------- 签到热力图 / 连续天数 ---------------- */

function shiftDateISO(iso: string, deltaDays: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + deltaDays)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface HeatmapDay { date: string; count: number }

/** 最近 weeks 周（含今天所在周的已过天数）每天的已签到工具数，按日期升序 */
export function checkinHeatmap(state: AppState, today: string, weeks = 18): HeatmapDay[] {
  const counts = new Map<string, number>()
  for (const c of state.checkins) {
    if (c.done) counts.set(c.date, (counts.get(c.date) ?? 0) + 1)
  }
  const totalDays = weeks * 7
  const out: HeatmapDay[] = []
  for (let i = totalDays - 1; i >= 0; i--) {
    const date = shiftDateISO(today, -i)
    out.push({ date, count: counts.get(date) ?? 0 })
  }
  return out
}

/** 连续签到天数：从今天（今天还没签则从昨天）往前数，每天至少 1 个工具已签到 */
export function checkinStreak(state: AppState, today: string): number {
  const days = new Set(state.checkins.filter(c => c.done).map(c => c.date))
  let cursor = days.has(today) ? today : shiftDateISO(today, -1)
  let streak = 0
  while (days.has(cursor)) {
    streak++
    cursor = shiftDateISO(cursor, -1)
  }
  return streak
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
