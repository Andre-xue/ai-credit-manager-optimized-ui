// 账户体检分：按 Key 配置、剩余额度、到期状态、耗尽预测给每个账户打分（0–100），
// 并给出扣分原因，方便一眼看出先救哪个账户。纯函数。

import type { AppState } from './types'
import { PROVIDER_MAP } from '../data/providers'
import { predictExhaustion } from './forecast'
import { todayISO } from './store'

export interface AccountHealth {
  accountId: string
  label: string
  platform: string
  score: number
  grade: '健康' | '注意' | '告急'
  reasons: string[]
}

const LOW_BALANCE = 10

export function scoreAccounts(state: AppState, today: string = todayISO()): AccountHealth[] {
  const out: AccountHealth[] = []
  for (const a of state.accounts) {
    let score = 100
    const reasons: string[] = []
    const isLocal = a.providerId.startsWith('local-') || a.providerId === 'voice-config'
    if (!isLocal && a.mode === 'api' && !a.encryptedKey) {
      score -= 45
      reasons.push('未配置 API Key')
    }
    const qs = state.quotas.filter((q) => q.accountId === a.id && q.unit === 'currency')
    if (qs.length) {
      const latest = qs.reduce((m, q) => (q.capturedAt > m.capturedAt ? q : m), qs[0])
      const remaining = latest.total - latest.used
      if (remaining <= 0) {
        score -= 40
        reasons.push('额度已用完')
      } else if (remaining < LOW_BALANCE) {
        score -= 25
        reasons.push(`余额不足 ¥${LOW_BALANCE}（剩 ¥${remaining.toFixed(2)}）`)
      } else if (latest.total > 0 && remaining / latest.total < 0.1) {
        score -= 15
        reasons.push('余额低于总量的 10%')
      }
      if (latest.resetAt && latest.resetAt.slice(0, 10) < today) {
        score -= 15
        reasons.push('额度已过重置/到期日，可能已失效')
      }
    } else if (!isLocal) {
      score -= 10
      reasons.push('暂无额度数据')
    }
    const fc = predictExhaustion(state, a.id)
    if (fc.exhaustDate && fc.level !== 'insufficient') {
      const days = Math.round((new Date(`${fc.exhaustDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
      if (days >= 0 && days <= 7 && !(qs.length && qs[qs.length - 1].total - qs[qs.length - 1].used <= 0)) {
        score -= 20
        reasons.push(`预计 ${days} 天后耗尽`)
      }
    }
    score = Math.max(0, Math.min(100, score))
    out.push({
      accountId: a.id,
      label: a.label,
      platform: PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId,
      score,
      grade: score >= 80 ? '健康' : score >= 50 ? '注意' : '告急',
      reasons,
    })
  }
  return out.sort((x, y) => x.score - y.score)
}
