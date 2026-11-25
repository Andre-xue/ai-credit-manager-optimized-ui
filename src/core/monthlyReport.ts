// 月度报告：对某个月的用量/签到/预算做纯函数汇总（用量与费用页与报告视图共用）。
import type { AppState } from './types'
import { PROVIDER_MAP } from '../data/providers'

export interface MonthlyReport {
  /** YYYY-MM */
  month: string
  totalCost: number
  totalTokens: number
  recordCount: number
  /** 有用量记录的天数 */
  activeDays: number
  /** 本月签到完成次数（done 的记录数） */
  checkinCount: number
  /** 本月签到的不同天数 */
  checkinDays: number
  byPlatform: Array<{ providerId: string; name: string; cost: number; tokens: number; share: number }>
  topModels: Array<{ model: string; cost: number; tokens: number }>
  /** 与上月总消费对比（上月为 0 时为 null） */
  costDeltaPct: number | null
  prevCost: number
  /** 本月预算与使用率（预算为 0 时 rate 为 null） */
  budget: number
  budgetRate: number | null
}

const tokensOf = (u: { inputTokens: number; outputTokens: number }) => (u.inputTokens || 0) + (u.outputTokens || 0)

export function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function buildMonthlyReport(state: AppState, month: string): MonthlyReport {
  const inMonth = state.usage.filter(u => u.date.startsWith(month))
  const totalCost = inMonth.reduce((s, u) => s + (u.estimatedCost || 0), 0)
  const totalTokens = inMonth.reduce((s, u) => s + tokensOf(u), 0)
  const activeDays = new Set(inMonth.map(u => u.date)).size

  const accountProvider = new Map(state.accounts.map(a => [a.id, a.providerId]))
  const plat = new Map<string, { cost: number; tokens: number }>()
  const models = new Map<string, { cost: number; tokens: number }>()
  for (const u of inMonth) {
    const pid = accountProvider.get(u.accountId) ?? 'unknown'
    const p = plat.get(pid) ?? { cost: 0, tokens: 0 }
    p.cost += u.estimatedCost || 0; p.tokens += tokensOf(u)
    plat.set(pid, p)
    if (u.model) {
      const mm = models.get(u.model) ?? { cost: 0, tokens: 0 }
      mm.cost += u.estimatedCost || 0; mm.tokens += tokensOf(u)
      models.set(u.model, mm)
    }
  }
  const byPlatform = [...plat.entries()]
    .map(([providerId, v]) => ({
      providerId,
      name: PROVIDER_MAP[providerId]?.shortName ?? (providerId === 'unknown' ? '未知平台' : providerId),
      cost: v.cost, tokens: v.tokens,
      share: totalCost > 0 ? v.cost / totalCost : 0,
    }))
    .sort((a, b) => b.cost - a.cost)
  const topModels = [...models.entries()]
    .map(([model, v]) => ({ model, cost: v.cost, tokens: v.tokens }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)

  const monthCheckins = state.checkins.filter(c => c.date.startsWith(month) && c.done)
  const prev = prevMonthKey(month)
  const prevCost = state.usage.filter(u => u.date.startsWith(prev)).reduce((s, u) => s + (u.estimatedCost || 0), 0)
  const budget = state.settings.monthlyBudget || 0

  return {
    month,
    totalCost, totalTokens,
    recordCount: inMonth.length,
    activeDays,
    checkinCount: monthCheckins.length,
    checkinDays: new Set(monthCheckins.map(c => c.date)).size,
    byPlatform, topModels,
    costDeltaPct: prevCost > 0 ? (totalCost - prevCost) / prevCost : null,
    prevCost,
    budget,
    budgetRate: budget > 0 ? totalCost / budget : null,
  }
}

/** 报告的一段可复制文本（Markdown 风格） */
export function reportToText(r: MonthlyReport): string {
  const lines = [
    `# AI 魔方 · ${r.month} 月度报告`,
    `总消费 ¥${r.totalCost.toFixed(2)}（上月 ¥${r.prevCost.toFixed(2)}${r.costDeltaPct !== null ? `，环比 ${r.costDeltaPct >= 0 ? '+' : ''}${(r.costDeltaPct * 100).toFixed(0)}%` : ''}）`,
    `总 Tokens ${r.totalTokens.toLocaleString()} · 记录 ${r.recordCount} 条 · 活跃 ${r.activeDays} 天`,
    `签到 ${r.checkinCount} 次（${r.checkinDays} 天）`,
  ]
  if (r.budgetRate !== null) lines.push(`预算 ¥${r.budget.toFixed(0)}，已用 ${(r.budgetRate * 100).toFixed(0)}%`)
  if (r.byPlatform.length) {
    lines.push('', '## 分平台消费')
    for (const p of r.byPlatform) lines.push(`- ${p.name}：¥${p.cost.toFixed(2)}（${(p.share * 100).toFixed(0)}%）`)
  }
  if (r.topModels.length) {
    lines.push('', '## 模型 Top')
    for (const m of r.topModels) lines.push(`- ${m.model}：¥${m.cost.toFixed(2)}`)
  }
  return lines.join('\n')
}

/** 年度总结：全年消费/签到/平台与模型之最/分月走势 */
export interface YearReport {
  year: string
  totalCost: number
  totalTokens: number
  recordCount: number
  activeDays: number
  checkinDays: number
  checkinCount: number
  topPlatform?: { name: string; cost: number }
  topModel?: { name: string; cost: number }
  bestMonth?: { month: string; cost: number }
  byMonth: Array<{ month: string; cost: number }>
  accountCount: number
}

export function buildYearReport(state: AppState, year: string): YearReport {
  const events = state.usage.filter((u) => u.date.startsWith(year))
  const totalCost = events.reduce((s, u) => s + u.estimatedCost, 0)
  const totalTokens = events.reduce((s, u) => s + (u.inputTokens || 0) + (u.outputTokens || 0), 0)
  const monthMap = new Map<string, number>()
  const platMap = new Map<string, number>()
  const modelMap = new Map<string, number>()
  for (const u of events) {
    const mk = u.date.slice(0, 7)
    monthMap.set(mk, (monthMap.get(mk) ?? 0) + u.estimatedCost)
    const acc = state.accounts.find((a) => a.id === u.accountId)
    const pname = acc ? (PROVIDER_MAP[acc.providerId]?.shortName ?? acc.providerId) : '未知账户'
    platMap.set(pname, (platMap.get(pname) ?? 0) + u.estimatedCost)
    if (u.model) modelMap.set(u.model, (modelMap.get(u.model) ?? 0) + u.estimatedCost)
  }
  const byMonth = [...monthMap.entries()].map(([month, cost]) => ({ month, cost })).sort((a, b) => a.month.localeCompare(b.month))
  const topOf = (m: Map<string, number>) => {
    let best: { name: string; cost: number } | undefined
    for (const [name, cost] of m) if (!best || cost > best.cost) best = { name, cost }
    return best
  }
  const doneCheckins = state.checkins.filter((c) => c.done && c.date.startsWith(year))
  return {
    year,
    totalCost,
    totalTokens,
    recordCount: events.length,
    activeDays: new Set(events.map((u) => u.date)).size,
    checkinDays: new Set(doneCheckins.map((c) => c.date)).size,
    checkinCount: doneCheckins.length,
    topPlatform: topOf(platMap),
    topModel: topOf(modelMap),
    bestMonth: byMonth.length ? byMonth.reduce((a, b) => (b.cost > a.cost ? b : a)) : undefined,
    byMonth,
    accountCount: state.accounts.length,
  }
}

export function yearReportToText(r: YearReport): string {
  const lines = [
    `# AI 魔方 · ${r.year} 年度总结`,
    `总消费 ¥${r.totalCost.toFixed(2)} · 总 Tokens ${r.totalTokens.toLocaleString()} · 记录 ${r.recordCount} 条 · 活跃 ${r.activeDays} 天`,
    `签到 ${r.checkinCount} 次（${r.checkinDays} 天）· 账户 ${r.accountCount} 个`,
  ]
  if (r.topPlatform) lines.push(`最常用平台：${r.topPlatform.name}（¥${r.topPlatform.cost.toFixed(2)}）`)
  if (r.topModel) lines.push(`最常用模型：${r.topModel.name}（¥${r.topModel.cost.toFixed(2)}）`)
  if (r.bestMonth) lines.push(`消费最高的月份：${r.bestMonth.month}（¥${r.bestMonth.cost.toFixed(2)}）`)
  if (r.byMonth.length) {
    lines.push('', '## 分月消费')
    for (const m of r.byMonth) lines.push(`- ${m.month}：¥${m.cost.toFixed(2)}`)
  }
  return lines.join('\n')
}
