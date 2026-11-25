// AI 助手「查自己的数据」：把本地 AppState 压成一份紧凑的中文数据摘要，
// 作为附加 system 上下文随对话发给当前模型，使助手能回答「我还剩多少额度 /
// 本月哪个平台花得最多 / 今天还有哪些没签到」这类问题。
// 纯函数：只读 state，不含任何 Key/密文（账户只出现名称/平台/额度数字）。

import type { AppState} from './types'
import { PROVIDER_MAP} from '../data/providers'
import { CHECKIN_TOOLS} from '../data/agentTools'
import { buildMonthlyReport} from './monthlyReport'
import { checkinStreak} from './calendar'
import { todayISO} from './store'

const money = (n: number) => `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2})}`
const platformName = (providerId: string) => PROVIDER_MAP[providerId]?.shortName?? providerId

/** 低余额口径与提醒引擎一致：剩余货币额度低于此值（元） */
export const DIGEST_LOW_BALANCE = 10

export function buildDataDigest(state: AppState, today: string = todayISO()): string {
const month = today.slice(0, 7)
const lines: string[] = []
lines.push(``)
lines.push('回答额度、消费、预算、签到类问题时以以下数据为准；摘要里没有的数据请明确说不知道，不要编造。')

// ---- 账户与剩余额度（货币类，取每账户最新快照） ----
const withKey = state.accounts.filter((a) =>!!a.encryptedKey).length
const perAccount: Array<{ label: string; platform: string; remaining: number; total: number; resetAt?: string}> = []
for (const a of state.accounts) {
const qs = state.quotas.filter((q) => q.accountId === a.id && q.unit === 'currency')
if (!qs.length) continue
const latest = qs.reduce((m, q) => (q.capturedAt > m.capturedAt? q: m), qs[0])
perAccount.push({
label: a.label,
platform: platformName(a.providerId),
remaining: Math.max(0, latest.total - latest.used),
total: latest.total,
resetAt: latest.resetAt,
})
}
const totalRemaining = perAccount.reduce((s, x) => s + x.remaining, 0)
lines.push(`账户共 ${state.accounts.length} 个（${withKey} 个已配置 API Key）；货币额度剩余合计 ${money(totalRemaining)}。`)
if (perAccount.length) {
lines.push('各账户剩余额度（按剩余从少到多）：')
for (const x of perAccount.sort((a, b) => a.remaining - b.remaining).slice(0, 12)) {
const reset = x.resetAt? `，额度重置/到期 ${x.resetAt.slice(0, 10)}`: ''
lines.push(`- ${x.label}（${x.platform}）：剩 ${money(x.remaining)} / 共 ${money(x.total)}${reset}`)
}
}
const low = perAccount.filter((x) => x.remaining < DIGEST_LOW_BALANCE)
if (low.length) lines.push(`低余额账户（剩余不足 ${money(DIGEST_LOW_BALANCE)}）：${low.map((x) => `${x.label} ${money(x.remaining)}`).join('、')}。`)

// ---- 本月消费与预算 ----
const report = buildMonthlyReport(state, month)
if (report.recordCount > 0) {
const top = report.byPlatform.slice(0, 3).map((p) => `${p.name} ${money(p.cost)}`).join('、')
lines.push(`本月（${month}）消费：共 ${money(report.totalCost)}，${report.recordCount} 笔记录；花费最高的平台：${top}。`)
if (report.topModels.length) lines.push(`本月最常用模型：${report.topModels.slice(0, 3).map((m) => m.model).join('、')}。`)
} else {
lines.push(`本月（${month}）暂无消费记录。`)
}
if (report.budget > 0 && report.budgetRate!== null) {
lines.push(`本月总预算 ${money(report.budget)}，已用 ${Math.round(report.budgetRate * 100)}%。`)
}

// ---- 签到 ----
const pending = CHECKIN_TOOLS.filter((t) =>!state.checkins.some((c) => c.providerId === t.id && c.date === today && c.done))
const streak = checkinStreak(state, today)
lines.push(pending.length
? `今日待签到 ${pending.length} 个：${pending.slice(0, 6).map((t) => t.name).join('、')}${pending.length > 6? ' 等': ''}；已连续签到 ${streak} 天。`
: `今日签到已全部完成；已连续签到 ${streak} 天。`)

// ---- 7 天内到期/重置 ----
const soon = perAccount
.filter((x) => x.resetAt && x.resetAt.slice(0, 10) >= today && x.resetAt.slice(0, 10) <= addDays(today, 7))
.sort((a, b) => (a.resetAt! < b.resetAt!? -1: 1))
if (soon.length) lines.push(`7 天内额度到期/重置：${soon.map((x) => `${x.label}（${x.resetAt!.slice(0, 10)}）`).join('、')}。`)

return lines.join('\n')
}

function addDays(iso: string, days: number): string {
const d = new Date(`${iso}T00:00:00`)
d.setDate(d.getDate() + days)
const p = (n: number) => String(n).padStart(2, '0')
return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
