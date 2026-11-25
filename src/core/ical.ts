// iCal（.ics）导出：把额度重置/到期日 + 每日签到提醒导出为日历文件，
// 可导入手机/电脑自带日历订阅查看。纯函数生成文本（RFC 5545，CRLF 行尾）。

import type { AppState } from './types'
import { PROVIDER_MAP } from '../data/providers'
import { CHECKIN_TOOLS } from '../data/agentTools'
import { todayISO } from './store'

const DAY = 86_400_000

function fmtDate(iso: string): string {
  return iso.replace(/-/g, '')
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}
function dtstamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
}

/** 未来 90 天的额度重置/到期（每账户取最新快照的 resetAt）+ 每日签到提醒（重复 90 天） */
export function buildICalendar(state: AppState, today: string = todayISO(), now: Date = new Date()): string {
  const horizon = addDays(today, 90)
  const stamp = dtstamp(now)
  const events: string[] = []

  for (const a of state.accounts) {
    const qs = state.quotas.filter((q) => q.accountId === a.id && q.resetAt)
    if (!qs.length) continue
    const latest = qs.reduce((m, q) => (q.capturedAt > m.capturedAt ? q : m), qs[0])
    const date = latest.resetAt!.slice(0, 10)
    if (date < today || date > horizon) continue
    const platform = PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId
    events.push([
      'BEGIN:VEVENT',
      `UID:acm-quota-${a.id}-${date}@ai-credit-manager`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${fmtDate(date)}`,
      `DTEND;VALUE=DATE:${fmtDate(addDays(date, 1))}`,
      `SUMMARY:${esc(`额度重置/到期：${a.label}（${platform}）`)}`,
      'END:VEVENT',
    ].join('\r\n'))
  }

  if (CHECKIN_TOOLS.length) {
    events.push([
      'BEGIN:VEVENT',
      'UID:acm-checkin-daily@ai-credit-manager',
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${fmtDate(today)}`,
      `DTEND;VALUE=DATE:${fmtDate(addDays(today, 1))}`,
      `RRULE:FREQ=DAILY;UNTIL=${fmtDate(horizon)}`,
      `SUMMARY:${esc(`AI 平台签到提醒（共 ${CHECKIN_TOOLS.length} 个可签到平台，打开 AI 魔方处理）`)}`,
      'END:VEVENT',
    ].join('\r\n'))
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Credit Manager//Quota Calendar//CN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

export { DAY as _ICAL_DAY_MS }
