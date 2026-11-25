// 提醒引擎：把当前应用状态翻译成「值得打扰用户」的提醒事件。
// 纯函数 + 本地去重记录：同一事件同一天只提醒一次（预算按月），避免反复打扰。

import type { AppSettings, NotifyPrefs } from './types'

export type { NotifyPrefs }

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: false,
  checkin: true,
  checkinTime: '09:00',
  expiry: true,
  forecast: true,
  budget: true,
  lowBalance: true,
  anomaly: true,
  monthlyReport: true,
}

export function notifyPrefsOf(settings: AppSettings): NotifyPrefs {
  return { ...DEFAULT_NOTIFY_PREFS, ...(settings.notify ?? {}) }
}

export type ReminderKind = 'checkin' | 'expiry' | 'forecast' | 'budget' | 'lowbalance' | 'anomaly' | 'monthlyreport'

export interface ReminderEvent {
  /** 稳定 ID（含日期/月份），用于去重 */
  id: string
  kind: ReminderKind
  title: string
  body: string
}

export interface ReminderInput {
  now: Date
  prefs: NotifyPrefs
  /** 今日待签到的工具名列表 */
  pendingCheckins: string[]
  /** 即将到期（days 为距到期天数，>= 0；是否在阈值内由调用方按 alertDays 过滤） */
  expiring: Array<{ accountId: string; name: string; days: number }>
  /** 按当前用量预测即将耗尽的账户 */
  forecastAlerts: Array<{ accountId: string; name: string; daysLeft: number }>
  monthCost: number
  monthlyBudget: number
  /** 分平台预算使用情况（可选）：有预算且本月有消费的平台 */
  providerBudgets?: Array<{ providerId: string; name: string; cost: number; budget: number }>
  /** 分账户预算使用情况（可选）：有预算的账户本月消费 */
  accountBudgets?: Array<{ accountId: string; name: string; cost: number; budget: number }>
  /** 余额已低于阈值的账户（可选，阈值过滤由调用方完成） */
  lowBalances?: Array<{ accountId: string; name: string; remaining: number; symbol: string }>
  /** 消费异常（可选，由 anomaly.detectSpendAnomalies 计算后附上账户名） */
  spendAnomalies?: Array<{ accountId: string; name: string; dateLabel: string; cost: number; avgDaily: number; ratio: number }>
  /** 上月消费报告摘要（可选）：事件 ID 按月份去重，每月只推一次 */
  monthlyReportSummary?: { month: string; totalCost: number; recordCount: number; topPlatform?: string; deltaPct?: number | null }
  /** 订阅续费临近（可选）：days 为距下次续费天数，窗口过滤由调用方按 alertDays 完成 */
  subscriptionRenewals?: Array<{ accountId: string; name: string; days: number; renewAt: string }>
}

function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function buildReminders(input: ReminderInput): ReminderEvent[] {
  const { now, prefs } = input
  if (!prefs.enabled) return []
  const out: ReminderEvent[] = []
  const dateKey = localDateKey(now)

  if (prefs.checkin && input.pendingCheckins.length > 0) {
    const [h, m] = prefs.checkinTime.split(':').map((x) => Number(x) || 0)
    const reached = now.getHours() * 60 + now.getMinutes() >= h * 60 + m
    if (reached) {
      const names = input.pendingCheckins
      const preview = names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${names.length} 个` : '')
      out.push({
        id: `checkin:${dateKey}`,
        kind: 'checkin',
        title: '今日签到提醒',
        body: `还有 ${names.length} 个工具待签到：${preview}。去领取今天的免费额度吧。`,
      })
    }
  }

  if (prefs.expiry) {
    for (const e of input.expiring) {
      if (e.days < 0) continue
      out.push({
        id: `expiry:${e.accountId}:${dateKey}`,
        kind: 'expiry',
        title: '订阅 / 额度即将到期',
        body: e.days === 0 ? `「${e.name}」今天到期，记得及时处理。` : `「${e.name}」将在 ${e.days} 天后到期，记得及时处理。`,
      })
    }
  }

  if (prefs.expiry && input.subscriptionRenewals) {
    for (const r of input.subscriptionRenewals) {
      if (r.days < 0) continue
      out.push({
        id: `subrenew:${r.accountId}:${r.renewAt}`,
        kind: 'expiry',
        title: '订阅即将续费',
        body: r.days === 0
          ? `「${r.name}」今天（${r.renewAt}）续费，记得确认余额/支付方式。`
          : `「${r.name}」将在 ${r.days} 天后（${r.renewAt}）续费，记得提前处理。`,
      })
    }
  }

  if (prefs.forecast) {
    for (const f of input.forecastAlerts) {
      out.push({
        id: `forecast:${f.accountId}:${dateKey}`,
        kind: 'forecast',
        title: '额度即将耗尽',
        body: `按当前用量，「${f.name}」预计 ${Math.max(0, Math.round(f.daysLeft))} 天后耗尽，留意补充或切换。`,
      })
    }
  }

  if (prefs.budget && input.monthlyBudget > 0) {
    const ratio = input.monthCost / input.monthlyBudget
    const monthKey = dateKey.slice(0, 7)
    if (ratio >= 1) {
      out.push({
        id: `budget:${monthKey}:over`,
        kind: 'budget',
        title: '本月预算已超支',
        body: `本月已花 ¥${input.monthCost.toFixed(2)}，超过月预算 ¥${input.monthlyBudget.toFixed(0)}，注意控制用量。`,
      })
    } else if (ratio >= 0.9) {
      out.push({
        id: `budget:${monthKey}:warn`,
        kind: 'budget',
        title: '本月预算接近上限',
        body: `本月已花 ¥${input.monthCost.toFixed(2)}，达到月预算的 ${Math.round(ratio * 100)}%。`,
      })
    }
  }

  if (prefs.budget && input.providerBudgets?.length) {
    const monthKey = dateKey.slice(0, 7)
    for (const pb of input.providerBudgets) {
      if (pb.budget <= 0) continue
      const ratio = pb.cost / pb.budget
      if (ratio >= 1) {
        out.push({
          id: `budget:${monthKey}:over:${pb.providerId}`,
          kind: 'budget',
          title: `${pb.name} 本月预算已超支`,
          body: `${pb.name} 本月已花 ¥${pb.cost.toFixed(2)}，超过其月预算 ¥${pb.budget.toFixed(0)}。`,
        })
      } else if (ratio >= 0.9) {
        out.push({
          id: `budget:${monthKey}:warn:${pb.providerId}`,
          kind: 'budget',
          title: `${pb.name} 预算接近上限`,
          body: `${pb.name} 本月已花 ¥${pb.cost.toFixed(2)}，达到其月预算的 ${Math.round(ratio * 100)}%。`,
        })
      }
    }
  }

  if (prefs.budget && input.accountBudgets?.length) {
    const monthKey = dateKey.slice(0, 7)
    for (const ab of input.accountBudgets) {
      if (ab.budget <= 0) continue
      const ratio = ab.cost / ab.budget
      if (ratio >= 1) {
        out.push({
          id: `budget:${monthKey}:over:acc:${ab.accountId}`,
          kind: 'budget',
          title: `「${ab.name}」本月预算已超支`,
          body: `账户「${ab.name}」本月已花 ¥${ab.cost.toFixed(2)}，超过其月预算 ¥${ab.budget.toFixed(0)}。`,
        })
      } else if (ratio >= 0.9) {
        out.push({
          id: `budget:${monthKey}:warn:acc:${ab.accountId}`,
          kind: 'budget',
          title: `「${ab.name}」预算接近上限`,
          body: `账户「${ab.name}」本月已花 ¥${ab.cost.toFixed(2)}，达到其月预算的 ${Math.round(ratio * 100)}%。`,
        })
      }
    }
  }

  if (prefs.lowBalance && input.lowBalances?.length) {
    for (const lb of input.lowBalances) {
      out.push({
        id: `lowbalance:${lb.accountId}:${dateKey}`,
        kind: 'lowbalance',
        title: '余额不足提醒',
        body: `「${lb.name}」余额仅剩 ${lb.symbol}${lb.remaining.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}，记得及时充值。`,
      })
    }
  }

  if (prefs.anomaly && input.spendAnomalies?.length) {
    for (const sa of input.spendAnomalies) {
      out.push({
        id: `anomaly:${sa.accountId}:${dateKey}`,
        kind: 'anomaly',
        title: '消费异常提醒',
        body: `「${sa.name}」${sa.dateLabel}消费 ¥${sa.cost.toFixed(2)}，约为近 7 天日均（¥${sa.avgDaily.toFixed(2)}）的 ${sa.ratio.toFixed(1)} 倍，请确认是否正常。`,
      })
    }
  }

  if (prefs.monthlyReport && input.monthlyReportSummary && input.monthlyReportSummary.recordCount > 0) {
    const r = input.monthlyReportSummary
    const delta = r.deltaPct == null ? '' : `，较前月${r.deltaPct >= 0 ? '增加' : '减少'} ${Math.abs(Math.round(r.deltaPct))}%`
    out.push({
      id: `monthlyreport:${r.month}`,
      kind: 'monthlyreport',
      title: `${r.month.slice(5)} 月消费报告已生成`,
      body: `${r.month} 共消费 ¥${r.totalCost.toFixed(2)}（${r.recordCount} 条记录）${r.topPlatform ? `，消费最高：${r.topPlatform}` : ''}${delta}。在「用量」页点「查看月度报告」看详情。`,
    })
  }

  return out
}

/* ---------------- 去重记录（localStorage） ---------------- */

const SENT_KEY = 'acm.notify.sent.v1'

export function loadSentIds(): Record<string, number> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(SENT_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch { return {} }
}

export function filterUnsent(events: ReminderEvent[], sent: Record<string, number> = loadSentIds()): ReminderEvent[] {
  return events.filter((e) => !sent[e.id])
}

export function markSent(events: ReminderEvent[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    const sent = loadSentIds()
    const now = Date.now()
    for (const e of events) sent[e.id] = now
    // 只保留最近 90 天的记录，避免无限增长
    const cutoff = now - 90 * 86400000
    for (const k of Object.keys(sent)) if (sent[k] < cutoff) delete sent[k]
    localStorage.setItem(SENT_KEY, JSON.stringify(sent))
  } catch { /* 存储不可用时忽略 */ }
}
